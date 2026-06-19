const prisma = require('../config/db');
const { getIO } = require('../config/socket');
const logger = require('../utils/logger');
const webpush = require('web-push');
const env = require('../config/env');

// Only set VAPID if keys are configured
if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    env.VAPID_EMAIL || 'mailto:admin@rosewoodmarketplace.com',
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );
}

const sendPushToUser = async (userId, payload) => {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    const dead = [];
    await Promise.all(subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) dead.push(sub.endpoint);
      }
    }));
    if (dead.length > 0) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: dead } } });
    }
  } catch {}
};

const createNotification = async ({ userId, type, title, message, data }) => {
  try {
    const notification = await prisma.notification.create({
      data: { userId, type, title, message, data: data || undefined },
    });

    // Emit real-time notification
    try {
      const io = getIO();
      io.to(`user:${userId}`).emit('notification', notification);
    } catch {
      // Socket may not be initialized in test environments
    }

    // Fire push notification (non-blocking)
    sendPushToUser(userId, {
      title,
      body: message,
      data: data || {},
    }).catch(() => {});

    return notification;
  } catch (err) {
    logger.error('Failed to create notification:', err);
  }
};

const notifyOrderPlaced = async ({ buyerId, sellerId, orderId, orderNumber }) => {
  await Promise.all([
    createNotification({
      userId: buyerId,
      type: 'ORDER_PLACED',
      title: 'Order Placed',
      message: `Your order #${orderNumber} has been placed successfully.`,
      data: { orderId, orderNumber, actionUrl: `/orders/${orderId}` },
    }),
    createNotification({
      userId: sellerId,
      type: 'ORDER_PLACED',
      title: 'New Order Received',
      message: `You have a new order #${orderNumber}.`,
      data: { orderId, orderNumber, actionUrl: `/seller/orders/${orderId}` },
    }),
  ]);

  // Notify seller room specifically
  try {
    const io = getIO();
    io.to(`seller:${sellerId}`).emit('newOrder', { orderId, orderNumber });
  } catch {}
};

const notifyOrderStatusChange = async ({ buyerId, sellerId, orderId, orderNumber, status }) => {
  const jobs = [
    createNotification({
      userId: buyerId,
      type: 'ORDER_STATUS_UPDATE',
      title: 'Order Update',
      message: `Order #${orderNumber} status changed to ${status}.`,
      data: { orderId, orderNumber, status, actionUrl: `/orders/${orderId}` },
    }),
  ];
  if (sellerId) {
    jobs.push(createNotification({
      userId: sellerId,
      type: 'ORDER_STATUS_UPDATE',
      title: 'Order Update',
      message: `Order #${orderNumber} status changed to ${status}.`,
      data: { orderId, orderNumber, status, actionUrl: `/seller/orders/${orderId}` },
    }));
  }
  await Promise.all(jobs);
};

const notifyPayment = async ({ buyerId, sellerId, orderId, orderNumber, success, amount }) => {
  const type = success ? 'PAYMENT_SUCCESS' : 'PAYMENT_FAILED';
  const title = success ? 'Payment Successful' : 'Payment Failed';
  const message = success
    ? `Payment of ₱${amount} for order #${orderNumber} was successful.`
    : `Payment for order #${orderNumber} failed. Please try again.`;

  const jobs = [
    createNotification({ userId: buyerId, type, title, message, data: { orderId, amount, actionUrl: `/orders/${orderId}` } }),
  ];
  if (sellerId) {
    jobs.push(createNotification({
      userId: sellerId,
      type,
      title,
      message,
      data: { orderId, amount, actionUrl: `/seller/orders/${orderId}` },
    }));
  }
  await Promise.all(jobs);
};

const notifyPaymentVerification = async ({ sellerId, orderId, orderNumber }) => {
  await createNotification({
    userId: sellerId,
    type: 'PAYMENT_VERIFICATION',
    title: 'Payment Receipt Submitted',
    message: `Buyer submitted a GCash receipt for order #${orderNumber}. Please verify.`,
    data: { orderId, orderNumber, actionUrl: `/seller/orders/${orderId}` },
  });
};

const notifyLowStock = async ({ sellerId, productId, productName, stockQty }) => {
  await createNotification({
    userId: sellerId,
    type: 'LOW_STOCK',
    title: 'Low Stock Alert',
    message: `${productName} has only ${stockQty} units left.`,
    data: { productId, stockQty, actionUrl: `/seller/products/${productId}/edit` },
  });
};

module.exports = {
  createNotification,
  notifyOrderPlaced,
  notifyOrderStatusChange,
  notifyPayment,
  notifyPaymentVerification,
  notifyLowStock,
};
