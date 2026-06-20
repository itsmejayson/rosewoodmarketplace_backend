const prisma = require('../config/db');
const orderService = require('../services/order.service');
const { success, created, paginated } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');
const { getIO } = require('../config/socket');
const notifService = require('../services/notification.service');

// ── Buyer ─────────────────────────────────────────────────────────────────────

const checkout = async (req, res, next) => {
  try {
    const { paymentMethod, fulfillmentType, sellerId, ...shippingDetails } = req.body;
    const result = await orderService.createOrderFromCart({
      buyerId: req.user.id,
      shippingDetails,
      paymentMethod,
      fulfillmentType,
      sellerId: sellerId || undefined,
    });
    return created(res, result, 'Order placed successfully');
  } catch (err) { next(err); }
};

const submitGcashReceipt = async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('Receipt image is required', 400);
    const result = await orderService.submitGcashReceipt({
      orderId: req.params.orderId,
      buyerId: req.user.id,
      receiptUrl: req.file.path,
      receiptPublicId: req.file.filename,
    });
    return success(res, result, 'Receipt submitted. Awaiting seller verification.');
  } catch (err) { next(err); }
};

const getBuyerOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const where = { buyerId: req.user.id };
    if (status) where.status = status;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        include: {
          orderItems: true,
          transaction: {
            select: {
              id: true, paymentStatus: true, paymentMethod: true,
              referenceNumber: true, gcashQrData: true, receiptImage: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.count({ where }),
    ]);

    return paginated(res, orders, {
      total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) { next(err); }
};

const getBuyerOrderDetail = async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, buyerId: req.user.id },
      include: {
        orderItems: {
          include: { product: { include: { images: { where: { isPrimary: true }, take: 1 } } } },
        },
        transaction: {
          include: {
            logs: { orderBy: { createdAt: 'desc' } },
            messages: {
              include: { sender: { select: { id: true, fullName: true, profileImage: true, role: true } } },
              orderBy: { createdAt: 'asc' },
              take: 50,
            },
          },
        },
        buyer: { select: { fullName: true, email: true, phone: true } },
        refund: true,
      },
    });
    if (!order) throw new AppError('Order not found', 404);
    return success(res, order);
  } catch (err) { next(err); }
};

// ── Seller ────────────────────────────────────────────────────────────────────

const getSellerOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const where = { orderItems: { some: { sellerId: req.user.id } } };
    if (status) where.status = status;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        include: {
          orderItems: { where: { sellerId: req.user.id } },
          buyer: { select: { fullName: true, email: true, phone: true } },
          transaction: {
            select: {
              id: true, paymentStatus: true, paymentMethod: true,
              receiptImage: true, referenceNumber: true, approvedAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.count({ where }),
    ]);

    return paginated(res, orders, {
      total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) { next(err); }
};

const approvePayment = async (req, res, next) => {
  try {
    const { approved, rejectionReason } = req.body;
    if (typeof approved !== 'boolean') throw new AppError('approved must be a boolean', 400);
    const result = await orderService.approvePayment({
      orderId: req.params.orderId,
      sellerId: req.user.id,
      approved,
      rejectionReason,
    });
    return success(res, result, approved ? 'Payment approved' : 'Payment rejected');
  } catch (err) { next(err); }
};

const confirmCashPayment = async (req, res, next) => {
  try {
    const result = await orderService.confirmCashPayment({
      orderId: req.params.orderId,
      sellerId: req.user.id,
    });
    return success(res, result, 'Cash payment confirmed');
  } catch (err) { next(err); }
};

const updateOrderStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const validTransitions = {
      PAID: ['PROCESSING'],
      PROCESSING: ['SHIPPED'],
      SHIPPED: ['DELIVERED'],
    };
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) throw new AppError('Order not found', 404);
    if (!validTransitions[order.status]?.includes(status)) {
      throw new AppError(`Cannot transition from ${order.status} to ${status}`, 400);
    }
    const updated = await orderService.updateOrderStatus({
      orderId: req.params.id,
      status,
      sellerId: req.user.role === 'SELLER' ? req.user.id : undefined,
    });
    return success(res, updated, 'Order status updated');
  } catch (err) { next(err); }
};

const confirmOrder = async (req, res, next) => {
  try {
    const { fee } = req.body;
    const { id } = req.params;

    const order = await prisma.order.findFirst({
      where: { id, orderItems: { some: { sellerId: req.user.id } } },
      include: { transaction: true, buyer: { select: { id: true } } },
    });
    if (!order) throw new AppError('Order not found', 404);
    if (order.fulfillmentType === 'PICKUP') throw new AppError('Pickup orders do not require seller confirmation', 400);
    if (order.status !== 'PENDING') throw new AppError('Only PENDING orders can be confirmed', 400);

    const deliveryFee = fee !== undefined && fee !== '' && !isNaN(parseFloat(fee)) ? parseFloat(fee) : null;
    const extraFee = (deliveryFee != null && deliveryFee > 0) ? deliveryFee : 0;
    const newTotal = parseFloat(order.totalAmount) + extraFee;

    await prisma.$transaction([
      prisma.order.update({
        where: { id },
        data: {
          status: 'AWAITING_PAYMENT',
          totalAmount: newTotal,
          ...(deliveryFee != null ? {
            deliveryFee: deliveryFee,
            deliveryFeeStatus: deliveryFee > 0 ? 'INCLUDED' : 'NOT_SET',
          } : {}),
        },
      }),
      prisma.transaction.update({
        where: { orderId: id },
        data: {
          orderStatus: 'AWAITING_PAYMENT',
          amount: newTotal,
          logs: {
            create: {
              event: 'ORDER_CONFIRMED',
              description: `Seller confirmed the order${extraFee > 0 ? `. Delivery fee: ₱${deliveryFee.toFixed(2)}` : ''}. Total: ₱${newTotal.toFixed(2)}`,
            },
          },
        },
      }),
    ]);

    await notifService.createNotification({
      userId: order.buyer.id,
      type: 'ORDER_CONFIRMED',
      title: 'Order confirmed — please pay',
      message: `Your order #${order.orderNumber} has been confirmed by the seller. Please pay ₱${newTotal.toFixed(2)} to proceed.`,
      data: { orderId: id, orderNumber: order.orderNumber },
    });

    const io = getIO();
    if (io) io.to(`user:${order.buyer.id}`).emit('orderConfirmed', { orderId: id, total: newTotal });

    return success(res, { orderId: id, total: newTotal }, 'Order confirmed');
  } catch (err) { next(err); }
};

const cancelOrder = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const { id } = req.params;
    const userId = req.user.id;
    const role = req.user.role;

    const order = await prisma.order.findUnique({
      where: { id },
      include: { transaction: true },
    });

    if (!order) throw new AppError('Order not found', 404);
    if (!['PENDING', 'AWAITING_PAYMENT'].includes(order.status)) {
      throw new AppError('Only PENDING or AWAITING_PAYMENT orders can be cancelled', 400);
    }

    // Buyer can cancel their own order; seller can cancel if they have items in it
    if (role === 'BUYER' && order.buyerId !== userId) throw new AppError('Forbidden', 403);
    if (role === 'SELLER') {
      const hasItem = await prisma.orderItem.findFirst({ where: { orderId: id, sellerId: userId } });
      if (!hasItem) throw new AppError('Forbidden', 403);
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    if (order.transaction) {
      await prisma.transaction.update({
        where: { id: order.transaction.id },
        data: { paymentStatus: 'FAILED' },
      });
      await prisma.transactionLog.create({
        data: {
          transactionId: order.transaction.id,
          event: 'ORDER_CANCELLED',
          description: `Order cancelled by ${role.toLowerCase()}${reason ? `: ${reason}` : ''}`,
        },
      });
    }

    // Restore stock
    const items = await prisma.orderItem.findMany({ where: { orderId: id } });
    await Promise.all(items.map((item) =>
      prisma.product.update({
        where: { id: item.productId },
        data: { stockQty: { increment: item.quantity } },
      })
    ));

    // Notify seller(s) so their dashboard refreshes
    const sellerIds = [...new Set(items.map((i) => i.sellerId))];
    const io = getIO();
    if (io) {
      sellerIds.forEach((sid) => {
        io.to(`seller:${sid}`).emit('orderCancelled', { orderId: id, orderNumber: order.orderNumber });
      });
    }

    return success(res, updated, 'Order cancelled');
  } catch (err) { next(err); }
};

const getSellerOrderDetail = async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: {
        id: req.params.id,
        orderItems: { some: { sellerId: req.user.id } },
      },
      include: {
        orderItems: {
          where: { sellerId: req.user.id },
          include: { product: { include: { images: { where: { isPrimary: true }, take: 1 } } } },
        },
        transaction: {
          include: {
            logs: { orderBy: { createdAt: 'desc' } },
            messages: {
              include: { sender: { select: { id: true, fullName: true, profileImage: true, role: true } } },
              orderBy: { createdAt: 'asc' },
              take: 50,
            },
          },
        },
        buyer: { select: { fullName: true, email: true, phone: true, address: true } },
      },
    });
    if (!order) throw new AppError('Order not found', 404);
    return success(res, order);
  } catch (err) { next(err); }
};

const setDeliveryFee = async (req, res, next) => {
  try {
    const { fee } = req.body;
    const { id } = req.params;
    if (fee === undefined || isNaN(parseFloat(fee)) || parseFloat(fee) < 0) {
      throw new AppError('Valid delivery fee is required', 400);
    }

    const order = await prisma.order.findFirst({
      where: { id, orderItems: { some: { sellerId: req.user.id } } },
      include: { transaction: true, buyer: { select: { id: true } } },
    });
    if (!order) throw new AppError('Order not found', 404);
    if (order.status !== 'PENDING') {
      throw new AppError('Delivery fee can only be set before confirming the order', 400);
    }

    const feeAmount = parseFloat(fee);
    const updated = await prisma.order.update({
      where: { id },
      data: {
        deliveryFee: feeAmount,
        deliveryFeeStatus: feeAmount > 0 ? 'PENDING_PAYMENT' : 'NOT_SET',
      },
    });

    if (order.transaction) {
      await prisma.transactionLog.create({
        data: {
          transactionId: order.transaction.id,
          event: 'DELIVERY_FEE_SET',
          description: `Delivery fee set to ₱${feeAmount.toFixed(2)} by seller`,
        },
      });
    }

    const io = getIO();
    if (feeAmount > 0) {
      await notifService.createNotification({
        userId: order.buyer.id,
        type: 'DELIVERY_FEE_ADDED',
        title: 'Delivery fee added',
        message: `Seller added a delivery fee of ₱${feeAmount.toFixed(2)} to order #${order.orderNumber}. Please pay to proceed.`,
        data: { orderId: id, orderNumber: order.orderNumber },
      });
      if (io) io.to(`user:${order.buyer.id}`).emit('deliveryFeeSet', { orderId: id, fee: feeAmount });
    }

    return success(res, updated, 'Delivery fee updated');
  } catch (err) { next(err); }
};

const payDeliveryFee = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await prisma.order.findFirst({
      where: { id, buyerId: req.user.id },
      include: { transaction: true },
    });
    if (!order) throw new AppError('Order not found', 404);
    if (order.deliveryFeeStatus !== 'PENDING_PAYMENT') {
      throw new AppError('No pending delivery fee for this order', 400);
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { deliveryFeeStatus: 'PAID' },
    });

    if (order.transaction) {
      await prisma.transactionLog.create({
        data: {
          transactionId: order.transaction.id,
          event: 'DELIVERY_FEE_PAID',
          description: `Buyer confirmed delivery fee payment of ₱${parseFloat(order.deliveryFee).toFixed(2)}`,
        },
      });
    }

    const sellerIds = [...new Set((await prisma.orderItem.findMany({ where: { orderId: id }, select: { sellerId: true } })).map(i => i.sellerId))];
    const io = getIO();
    if (io) sellerIds.forEach(sid => io.to(`seller:${sid}`).emit('deliveryFeePaid', { orderId: id }));

    return success(res, updated, 'Delivery fee marked as paid');
  } catch (err) { next(err); }
};

module.exports = {
  checkout, submitGcashReceipt,
  getBuyerOrders, getBuyerOrderDetail,
  getSellerOrders, getSellerOrderDetail, approvePayment, confirmCashPayment, updateOrderStatus, cancelOrder,
  confirmOrder, setDeliveryFee, payDeliveryFee,
};
