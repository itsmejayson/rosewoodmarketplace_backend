const { v4: uuidv4 } = require('uuid');
const prisma = require('../config/db');
const { AppError } = require('../middleware/error.middleware');
const notificationService = require('./notification.service');
const { getIO } = require('../config/socket');

const generateOrderNumber = () => {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `RW-${ts}-${rand}`;
};

// Generates a short human-readable reference e.g. GC-A3F9B2
const generateReference = () =>
  'GC-' + Math.random().toString(36).substring(2, 8).toUpperCase();

// ── Create order from cart ────────────────────────────────────────────────────

const createOrderFromCart = async ({ buyerId, shippingDetails, paymentMethod, fulfillmentType }) => {
  const cart = await prisma.cart.findUnique({
    where: { buyerId },
    include: {
      cartItems: {
        include: {
          product: {
            include: { images: { where: { isPrimary: true }, take: 1 } },
          },
        },
      },
    },
  });

  if (!cart || cart.cartItems.length === 0) throw new AppError('Cart is empty', 400);

  for (const item of cart.cartItems) {
    if (!item.product.isAvailable) throw new AppError(`"${item.product.name}" is no longer available`, 400);
    if (item.product.stockQty < item.quantity) {
      throw new AppError(`Only ${item.product.stockQty} units of "${item.product.name}" available`, 400);
    }
  }

  const subtotal = cart.cartItems.reduce(
    (sum, i) => sum + parseFloat(i.product.price) * i.quantity, 0
  );
  const shippingFee = 0;
  const tax = 0;
  const totalAmount = subtotal;

  const orderNumber = generateOrderNumber();
  const method = (paymentMethod || 'CASH').toUpperCase();
  const fulfillment = (fulfillmentType || 'DELIVERY').toUpperCase();
  // PICKUP orders skip seller confirmation and go straight to AWAITING_PAYMENT
  const initialStatus = fulfillment === 'PICKUP' ? 'AWAITING_PAYMENT' : 'PENDING';

  // For GCash: pre-generate reference number only
  let referenceNumber = null;
  let gcashQrData = null;
  if (method === 'GCASH') {
    referenceNumber = generateReference();
  }

  const order = await prisma.order.create({
    data: {
      orderNumber,
      buyerId,
      status: initialStatus,
      paymentMethod: method,
      fulfillmentType: fulfillment,
      subtotal,
      shippingFee,
      tax,
      totalAmount,
      ...shippingDetails,
      orderItems: {
        create: cart.cartItems.map((item) => ({
          productId: item.productId,
          sellerId: item.product.sellerId,
          quantity: item.quantity,
          unitPrice: item.product.price,
          totalPrice: parseFloat(item.product.price) * item.quantity,
          productName: item.product.name,
          productImage: item.product.images[0]?.url || null,
        })),
      },
    },
    include: { orderItems: true },
  });

  const sellerIds = [...new Set(cart.cartItems.map((i) => i.product.sellerId))];

  const transaction = await prisma.transaction.create({
    data: {
      orderId: order.id,
      buyerId,
      sellerId: sellerIds[0],
      paymentMethod: method,
      referenceNumber,
      gcashQrData,
      amount: totalAmount,
      currency: 'PHP',
      paymentStatus: 'PENDING',
      orderStatus: 'PENDING',
      orderStatus: initialStatus,
      logs: {
        create: {
          event: 'ORDER_CREATED',
          description: `Order ${orderNumber} created via ${method} (${fulfillment})`,
        },
      },
    },
  });

  // Notify seller(s)
  for (const sellerId of sellerIds) {
    await notificationService.notifyOrderPlaced({
      buyerId,
      sellerId,
      orderId: order.id,
      orderNumber,
    });
  }

  // Real-time seller dashboard update
  try {
    const io = getIO();
    sellerIds.forEach((sid) => io.to(`seller:${sid}`).emit('newOrder', { orderId: order.id, orderNumber }));
  } catch {}

  return { order, transaction };
};

// ── GCash: buyer uploads receipt ──────────────────────────────────────────────

const submitGcashReceipt = async ({ orderId, buyerId, receiptUrl, receiptPublicId }) => {
  const tx = await prisma.transaction.findUnique({
    where: { orderId },
    include: { order: true },
  });
  if (!tx) throw new AppError('Transaction not found', 404);
  if (tx.buyerId !== buyerId) throw new AppError('Forbidden', 403);
  if (tx.paymentMethod !== 'GCASH') throw new AppError('Not a GCash transaction', 400);
  if (tx.order.status !== 'AWAITING_PAYMENT') {
    throw new AppError('Seller has not yet confirmed the order. Please wait.', 400);
  }
  if (tx.paymentStatus === 'APPROVED' || tx.paymentStatus === 'PAID') {
    throw new AppError('Payment already confirmed', 400);
  }

  const updated = await prisma.transaction.update({
    where: { id: tx.id },
    data: {
      receiptImage: receiptUrl,
      receiptPublicId,
      paymentStatus: 'PENDING_VERIFICATION',
      logs: {
        create: {
          event: 'RECEIPT_SUBMITTED',
          description: 'Buyer submitted GCash receipt for verification',
        },
      },
    },
  });

  // Notify seller to verify
  await notificationService.createNotification({
    userId: tx.sellerId,
    type: 'PAYMENT_VERIFICATION',
    title: 'GCash Receipt Submitted',
    message: `Buyer submitted payment receipt for order #${tx.order.orderNumber}. Please verify.`,
    data: { orderId, transactionId: tx.id },
  });

  try {
    const io = getIO();
    io.to(`seller:${tx.sellerId}`).emit('receiptSubmitted', {
      orderId,
      orderNumber: tx.order.orderNumber,
      transactionId: tx.id,
    });
  } catch {}

  return updated;
};

// ── Seller: approve or reject payment ────────────────────────────────────────

const approvePayment = async ({ orderId, sellerId, approved, rejectionReason }) => {
  const tx = await prisma.transaction.findUnique({
    where: { orderId },
    include: { order: { include: { orderItems: true } } },
  });
  if (!tx) throw new AppError('Transaction not found', 404);
  if (tx.sellerId !== sellerId) throw new AppError('Forbidden', 403);

  if (approved) {
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        paymentStatus: 'APPROVED',
        orderStatus: 'PAID',
        approvedAt: new Date(),
        approvedBy: sellerId,
        logs: {
          create: { event: 'PAYMENT_APPROVED', description: 'Seller confirmed payment received' },
        },
      },
    });

    await prisma.order.update({ where: { id: orderId }, data: { status: 'PAID' } });

    // Deduct stock
    await _deductStock(orderId);

    // Notify buyer
    await notificationService.notifyPayment({
      buyerId: tx.buyerId,
      orderId,
      orderNumber: tx.order.orderNumber,
      success: true,
      amount: tx.amount,
    });

    try {
      const io = getIO();
      io.to(`user:${tx.buyerId}`).emit('paymentApproved', { orderId, orderNumber: tx.order.orderNumber });
      io.to(`seller:${sellerId}`).emit('dashboardUpdate');
    } catch {}
  } else {
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        paymentStatus: 'REJECTED',
        rejectionReason: rejectionReason || 'Payment not verified',
        logs: {
          create: { event: 'PAYMENT_REJECTED', description: rejectionReason || 'Seller rejected receipt' },
        },
      },
    });

    await notificationService.createNotification({
      userId: tx.buyerId,
      type: 'PAYMENT_FAILED',
      title: 'Payment Rejected',
      message: `Your payment for order #${tx.order.orderNumber} was rejected. Reason: ${rejectionReason || 'Not verified'}`,
      data: { orderId },
    });

    try {
      const io = getIO();
      io.to(`user:${tx.buyerId}`).emit('paymentRejected', { orderId, reason: rejectionReason });
    } catch {}
  }

  return prisma.transaction.findUnique({ where: { id: tx.id } });
};

// ── Cash: seller confirms received ───────────────────────────────────────────

const confirmCashPayment = async ({ orderId, sellerId }) => {
  const tx = await prisma.transaction.findUnique({
    where: { orderId },
    include: { order: { include: { orderItems: true } } },
  });
  if (!tx) throw new AppError('Transaction not found', 404);
  if (tx.sellerId !== sellerId) throw new AppError('Forbidden', 403);
  if (tx.paymentMethod !== 'CASH') throw new AppError('Not a cash transaction', 400);
  if (tx.order.status !== 'AWAITING_PAYMENT') {
    throw new AppError('Order is not ready for payment confirmation', 400);
  }

  await prisma.transaction.update({
    where: { id: tx.id },
    data: {
      paymentStatus: 'APPROVED',
      orderStatus: 'PAID',
      approvedAt: new Date(),
      approvedBy: sellerId,
      logs: {
        create: { event: 'CASH_CONFIRMED', description: 'Seller confirmed cash payment received' },
      },
    },
  });

  await prisma.order.update({ where: { id: orderId }, data: { status: 'PAID' } });
  await _deductStock(orderId);

  await notificationService.notifyPayment({
    buyerId: tx.buyerId,
    orderId,
    orderNumber: tx.order.orderNumber,
    success: true,
    amount: tx.amount,
  });

  try {
    const io = getIO();
    io.to(`user:${tx.buyerId}`).emit('paymentApproved', { orderId, orderNumber: tx.order.orderNumber });
    io.to(`seller:${sellerId}`).emit('dashboardUpdate');
  } catch {}

  return prisma.transaction.findUnique({ where: { id: tx.id } });
};

// ── Order status update ───────────────────────────────────────────────────────

const updateOrderStatus = async ({ orderId, status, sellerId }) => {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { orderItems: true } });
  if (!order) throw new AppError('Order not found', 404);

  if (sellerId) {
    const owns = order.orderItems.some((i) => i.sellerId === sellerId);
    if (!owns) throw new AppError('Forbidden', 403);
  }

  const [updated] = await Promise.all([
    prisma.order.update({ where: { id: orderId }, data: { status } }),
    prisma.transaction.update({
      where: { orderId },
      data: {
        orderStatus: status,
        logs: {
          create: { event: `STATUS_${status}`, description: `Order status updated to ${status}` },
        },
      },
    }),
  ]);

  await notificationService.notifyOrderStatusChange({
    buyerId: order.buyerId,
    orderId,
    orderNumber: order.orderNumber,
    status,
  });

  return updated;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const _deductStock = async (orderId) => {
  const items = await prisma.orderItem.findMany({ where: { orderId } });
  for (const item of items) {
    const product = await prisma.product.update({
      where: { id: item.productId },
      data: {
        stockQty: { decrement: item.quantity },
        salesCount: { increment: item.quantity },
      },
    });
    if (product.stockQty <= 10) {
      const notif = require('./notification.service');
      await notif.notifyLowStock({
        sellerId: product.sellerId,
        productId: product.id,
        productName: product.name,
        stockQty: product.stockQty,
      });
    }
  }
};

module.exports = {
  createOrderFromCart,
  submitGcashReceipt,
  approvePayment,
  confirmCashPayment,
  updateOrderStatus,
};
