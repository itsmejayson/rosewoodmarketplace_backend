const prisma = require('../config/db');
const orderService = require('../services/order.service');
const { success, created, paginated } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');
const { getIO } = require('../config/socket');
const notifService = require('../services/notification.service');

// ── Buyer ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/orders/checkout
 *
 * Creates one order per seller from the buyer's current cart.
 * Heavy lifting (stock reservation, cart clearing, transaction record) is
 * handled by orderService.createOrderFromCart so this handler stays thin.
 *
 * sellerId is optional — when the cart contains items from multiple sellers,
 * the service fans out and creates a separate order for each.
 */
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

/**
 * POST /api/orders/:orderId/gcash-receipt
 *
 * Lets a buyer upload a GCash payment screenshot after placing an order.
 * The file is already uploaded to Cloudinary by the multer middleware before
 * this handler runs; we only receive the resulting URL and public ID.
 */
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

/**
 * GET /api/orders (buyer)
 *
 * Paginates the authenticated buyer's orders, optionally filtered by status.
 * Includes transaction summary so the order list page can show payment state
 * without a second round-trip.
 */
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

/**
 * GET /api/orders/:id (buyer)
 *
 * Returns a single order with full detail: product images, transaction logs
 * (timeline of events), the chat thread, and refund record.
 *
 * The buyerId filter prevents buyers from viewing another buyer's order —
 * returning 404 rather than 403 to avoid leaking that the order ID exists.
 */
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

/**
 * GET /api/seller/orders
 *
 * Returns all orders that contain at least one item belonging to the
 * authenticated seller, with only the seller's own order items included.
 *
 * Using `orderItems: { some: { sellerId } }` in the `where` clause ensures
 * orders from other sellers in a multi-seller checkout are not leaked here.
 * The nested `include: { orderItems: { where: { sellerId } } }` further
 * restricts the line items to only this seller's products.
 */
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

/**
 * POST /api/seller/orders/:orderId/approve
 *
 * Approves or rejects a GCash receipt submitted by the buyer.
 * Accepts `approved: true` (mark as paid) or `approved: false` (reject with
 * optional rejectionReason).
 *
 * The boolean check is strict — the client must send a JSON boolean, not the
 * string "true", to avoid ambiguity when the value comes from a form body.
 */
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

/**
 * POST /api/seller/orders/:orderId/confirm-cash
 *
 * Marks a Cash-on-Delivery or Cash-on-Pickup order as paid once the seller
 * physically receives the money.  No receipt image upload is needed.
 */
const confirmCashPayment = async (req, res, next) => {
  try {
    const result = await orderService.confirmCashPayment({
      orderId: req.params.orderId,
      sellerId: req.user.id,
    });
    return success(res, result, 'Cash payment confirmed');
  } catch (err) { next(err); }
};

/**
 * PATCH /api/orders/:id/status
 *
 * Advances an order through the fulfilment state machine.
 * Only the transitions in `validTransitions` are allowed — attempting an
 * invalid jump (e.g. PENDING → SHIPPED) returns 400 to prevent data
 * inconsistency without a real-time check on the service layer.
 *
 * The state machine intentionally does not allow backwards transitions:
 *   PAID → PROCESSING → SHIPPED → DELIVERED
 */
const updateOrderStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) throw new AppError('Order not found', 404);

    // Pickup orders skip SHIPPED entirely: PROCESSING → DELIVERED
    // Delivery orders follow the full flow: PAID → PROCESSING → SHIPPED → DELIVERED
    const validTransitions = order.fulfillmentType === 'PICKUP'
      ? { PROCESSING: ['DELIVERED'] }
      : { PAID: ['PROCESSING'], PROCESSING: ['SHIPPED'], SHIPPED: ['DELIVERED'] };

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

/**
 * POST /api/orders/:id/confirm  (seller)
 *
 * Seller confirms a DELIVERY order and optionally sets the delivery fee.
 * This atomically:
 *   1. Moves the order from PENDING → AWAITING_PAYMENT.
 *   2. Adds the delivery fee to the total amount so the buyer knows how much
 *      to pay before sending their GCash receipt.
 *   3. Logs the confirmation event to the transaction timeline.
 *   4. Notifies the buyer via in-app notification + Socket.IO event so they
 *      can react in real time.
 *
 * A Prisma $transaction is used so both the order and transaction records
 * are updated atomically — no partial state is possible if one write fails.
 *
 * PICKUP orders are rejected here because they skip the seller-confirmation
 * step; their status moves directly to AWAITING_PAYMENT at checkout.
 */
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

    // Parse fee carefully: empty string or missing value means "no fee set"
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

    // Notify buyer of the confirmed total so they can proceed with payment
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

/**
 * POST /api/orders/:id/cancel
 *
 * Allows a buyer or seller to cancel an order while it is still in the
 * pre-payment stages (PENDING or AWAITING_PAYMENT).
 *
 * Authorization rules:
 *   - Buyer: may only cancel their own order.
 *   - Seller: may only cancel if they have at least one item in the order.
 *
 * Side effects:
 *   1. The order status is set to CANCELLED.
 *   2. The linked transaction is marked FAILED so the payment log is consistent.
 *   3. Reserved stock is returned to each product so other buyers can purchase.
 *   4. A Socket.IO event is emitted to each involved seller so their dashboard
 *      pending-order count updates in real time.
 */
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

    // Restore stock for every item in the order so inventory is accurate
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

/**
 * GET /api/seller/orders/:id
 *
 * Returns a single order's full detail for the seller view.
 * The buyer filter is applied at the query level (seller must have an item
 * in the order) so a seller cannot view orders they aren't involved in.
 */
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

/**
 * PUT /api/orders/:id/delivery-fee  (seller)
 *
 * Sets or updates the delivery fee on a PENDING order before confirmation.
 * Calling confirmOrder later incorporates this fee into the total.
 *
 * The fee must be a non-negative number.  An empty string is treated as
 * "no fee" (0) rather than an error, for cases where the seller previously
 * set a fee and wants to waive it.
 *
 * When the fee is positive, the buyer is notified via push notification and
 * Socket.IO so they see the updated amount in real time.
 */
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

/**
 * POST /api/orders/:id/pay-delivery-fee  (buyer)
 *
 * Buyer acknowledges payment of an outstanding delivery fee.
 * This advances `deliveryFeeStatus` from PENDING_PAYMENT → PAID and emits
 * a Socket.IO event to the seller(s) so their view updates in real time.
 *
 * We look up the seller IDs from the order items at call time rather than
 * storing them on the order, to avoid denormalization issues if items are
 * later modified.
 */
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

/**
 * POST /api/orders/:id/notify-pickup  (seller)
 *
 * Informs the buyer that their PICKUP order is ready for collection.
 *
 * If the order is still in PAID status, it is first advanced to PROCESSING
 * to reflect that the seller is preparing it — this keeps the status machine
 * consistent with the delivery flow where PROCESSING means "being prepared".
 *
 * The try/catch around the Socket.IO emit is intentional: a disconnected
 * socket server should not cause the HTTP response to fail — the push
 * notification from notifService is the primary delivery channel.
 */
const notifyReadyForPickup = async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, orderItems: { some: { sellerId: req.user.id } } },
      include: { buyer: { select: { id: true } }, transaction: { select: { id: true } } },
    });
    if (!order) throw new AppError('Order not found', 404);
    if (order.fulfillmentType !== 'PICKUP') throw new AppError('This order is not a pickup order', 400);
    if (!['PAID', 'PROCESSING'].includes(order.status)) throw new AppError('Order must be paid before notifying pickup', 400);

    // Move to PROCESSING if still PAID, so the status reflects preparation
    if (order.status === 'PAID') {
      await prisma.order.update({ where: { id: order.id }, data: { status: 'PROCESSING' } });
    }

    // Write a transaction log entry so the activity tracker shows this event
    if (order.transaction) {
      await prisma.transactionLog.create({
        data: {
          transactionId: order.transaction.id,
          event: 'PICKUP_READY',
          description: 'Seller has prepared the order and notified the buyer — ready for pickup.',
        },
      });
    }

    await notifService.notifyReadyForPickup({
      buyerId: order.buyer.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
    });

    // Emit socket event to buyer — wrapped in try/catch so a broken socket
    // server doesn't prevent the HTTP response from succeeding.
    try {
      const io = getIO();
      io.to(`user:${order.buyer.id}`).emit('readyForPickup', { orderId: order.id, orderNumber: order.orderNumber });
    } catch {}

    return success(res, {}, 'Buyer notified that order is ready for pickup');
  } catch (err) { next(err); }
};

module.exports = {
  checkout, submitGcashReceipt,
  getBuyerOrders, getBuyerOrderDetail,
  getSellerOrders, getSellerOrderDetail, approvePayment, confirmCashPayment, updateOrderStatus, cancelOrder,
  confirmOrder, setDeliveryFee, payDeliveryFee, notifyReadyForPickup,
};
