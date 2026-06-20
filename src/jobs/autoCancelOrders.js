const prisma = require('../config/db');
const notifService = require('../services/notification.service');
const { getIO } = require('../config/socket');
const logger = require('../utils/logger');

const AUTO_CANCEL_MINUTES = 5;

async function cancelExpiredOrders() {
  const cutoff = new Date(Date.now() - AUTO_CANCEL_MINUTES * 60 * 1000);

  try {
    // Find GCash orders stuck in AWAITING_PAYMENT with no receipt submitted,
    // whose status has not changed in the past AUTO_CANCEL_MINUTES minutes.
    const expiredOrders = await prisma.order.findMany({
      where: {
        status: 'AWAITING_PAYMENT',
        paymentMethod: 'GCASH',
        updatedAt: { lt: cutoff },
        transaction: {
          paymentStatus: 'PENDING',
          receiptImage: null,
        },
      },
      include: {
        orderItems: true,
        transaction: true,
        buyer: { select: { id: true } },
      },
    });

    for (const order of expiredOrders) {
      try {
        await prisma.$transaction([
          prisma.order.update({
            where: { id: order.id },
            data: { status: 'CANCELLED' },
          }),
          ...(order.transaction ? [
            prisma.transaction.update({
              where: { id: order.transaction.id },
              data: { paymentStatus: 'FAILED' },
            }),
            prisma.transactionLog.create({
              data: {
                transactionId: order.transaction.id,
                event: 'AUTO_CANCELLED',
                description: `Order auto-cancelled: GCash receipt not submitted within ${AUTO_CANCEL_MINUTES} minutes`,
              },
            }),
          ] : []),
        ]);

        // Restore stock
        await Promise.all(
          order.orderItems.map((item) =>
            prisma.product.update({
              where: { id: item.productId },
              data: { stockQty: { increment: item.quantity } },
            })
          )
        );

        // Notify buyer
        await notifService.createNotification({
          userId: order.buyer.id,
          type: 'ORDER_STATUS_UPDATE',
          title: 'Order Auto-Cancelled',
          message: `Order #${order.orderNumber} was cancelled because no GCash receipt was submitted within ${AUTO_CANCEL_MINUTES} minutes.`,
          data: { orderId: order.id, orderNumber: order.orderNumber, actionUrl: `/orders/${order.id}` },
        });

        // Real-time push
        const io = getIO();
        if (io) {
          io.to(`user:${order.buyer.id}`).emit('orderCancelled', {
            orderId: order.id,
            orderNumber: order.orderNumber,
            reason: 'auto_cancel_no_receipt',
          });
          const sellerIds = [...new Set(order.orderItems.map((i) => i.sellerId))];
          sellerIds.forEach((sid) =>
            io.to(`seller:${sid}`).emit('orderCancelled', { orderId: order.id, orderNumber: order.orderNumber })
          );
        }

        logger.info(`Auto-cancelled order ${order.orderNumber} (no GCash receipt in ${AUTO_CANCEL_MINUTES}m)`);
      } catch (err) {
        logger.error(`Failed to auto-cancel order ${order.orderNumber}:`, err);
      }
    }
  } catch (err) {
    logger.error('autoCancelOrders job error:', err);
  }
}

function startAutoCancelJob() {
  // Run immediately on startup, then every minute
  cancelExpiredOrders();
  setInterval(cancelExpiredOrders, 60 * 1000);
  logger.info(`Auto-cancel job started (GCash receipt timeout: ${AUTO_CANCEL_MINUTES}m)`);
}

module.exports = { startAutoCancelJob };
