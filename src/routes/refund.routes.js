const router = require('express').Router();
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { success, created } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');
const { createNotification } = require('../services/notification.service');

// POST /api/refunds/request/:orderId — buyer requests a refund
router.post('/request/:orderId', authenticate, authorize('BUYER'), async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    if (!reason) throw new AppError('Reason is required', 400);

    const order = await prisma.order.findFirst({
      where: { id: orderId, buyerId: req.user.id },
      include: { orderItems: { take: 1 } },
    });
    if (!order) throw new AppError('Order not found', 404);
    if (!['DELIVERED', 'PAID'].includes(order.status)) {
      throw new AppError('Refund can only be requested for PAID or DELIVERED orders', 400);
    }

    // Check if refund already exists
    const existingRefund = await prisma.refund.findUnique({ where: { orderId } });
    if (existingRefund) throw new AppError('A refund request already exists for this order', 409);

    const refund = await prisma.refund.create({
      data: { orderId, requestedBy: req.user.id, reason, status: 'PENDING' },
    });

    // Notify seller
    const sellerId = order.orderItems[0]?.sellerId;
    if (sellerId) {
      await createNotification({
        userId: sellerId,
        type: 'REFUND_REQUESTED',
        title: 'Refund Requested',
        message: `A refund has been requested for order #${order.orderNumber}.`,
        data: { refundId: refund.id, orderId, orderNumber: order.orderNumber, actionUrl: `/seller/orders/${orderId}` },
      });
    }

    return created(res, refund, 'Refund request submitted');
  } catch (err) { next(err); }
});

// PATCH /api/refunds/:orderId/process — seller processes a refund
router.patch('/:orderId/process', authenticate, authorize('SELLER', 'ADMIN'), async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { approved, notes } = req.body;

    if (approved === undefined) throw new AppError('approved (bool) is required', 400);

    const refund = await prisma.refund.findUnique({
      where: { orderId },
      include: { order: { include: { orderItems: true } } },
    });
    if (!refund) throw new AppError('Refund request not found', 404);
    if (refund.status !== 'PENDING') throw new AppError('This refund has already been processed', 400);

    // Sellers can only process refunds for their own orders
    const sellerId = refund.order.orderItems[0]?.sellerId;
    if (req.user.role === 'SELLER' && sellerId !== req.user.id) {
      throw new AppError('Forbidden', 403);
    }

    const newStatus = approved ? 'APPROVED' : 'REJECTED';

    const [updatedRefund] = await prisma.$transaction([
      prisma.refund.update({
        where: { orderId },
        data: {
          status: newStatus,
          processedBy: req.user.id,
          processedAt: new Date(),
          notes: notes || null,
        },
      }),
      ...(approved
        ? [
            prisma.order.update({ where: { id: orderId }, data: { status: 'REFUNDED' } }),
            // Restore stock and reverse salesCount for each refunded product
            ...refund.order.orderItems.map((item) =>
              prisma.product.update({
                where: { id: item.productId },
                data: {
                  stockQty: { increment: item.quantity },
                  salesCount: { decrement: item.quantity },
                },
              })
            ),
          ]
        : []),
    ]);

    // Notify buyer
    await createNotification({
      userId: refund.order.buyerId,
      type: approved ? 'REFUND_APPROVED' : 'REFUND_REJECTED',
      title: approved ? 'Refund Approved' : 'Refund Rejected',
      message: approved
        ? `Your refund for order #${refund.order.orderNumber} has been approved.`
        : `Your refund for order #${refund.order.orderNumber} was rejected.`,
      data: { refundId: refund.id, orderId, orderNumber: refund.order.orderNumber, actionUrl: `/orders/${orderId}` },
    });

    return success(res, updatedRefund, `Refund ${newStatus.toLowerCase()}`);
  } catch (err) { next(err); }
});

// GET /api/refunds/my — buyer's refund requests
router.get('/my', authenticate, async (req, res, next) => {
  try {
    const refunds = await prisma.refund.findMany({
      where: { requestedBy: req.user.id },
      include: { order: { select: { id: true, orderNumber: true, status: true, totalAmount: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, refunds);
  } catch (err) { next(err); }
});

// GET /api/refunds/seller — seller's incoming refund requests
router.get('/seller', authenticate, authorize('SELLER', 'ADMIN'), async (req, res, next) => {
  try {
    // Find orders that belong to this seller
    const sellerOrderIds = await prisma.orderItem.findMany({
      where: { sellerId: req.user.id },
      select: { orderId: true },
      distinct: ['orderId'],
    });
    const orderIds = sellerOrderIds.map((o) => o.orderId);

    const refunds = await prisma.refund.findMany({
      where: { orderId: { in: orderIds } },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            totalAmount: true,
            buyer: { select: { id: true, fullName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, refunds);
  } catch (err) { next(err); }
});

module.exports = router;
