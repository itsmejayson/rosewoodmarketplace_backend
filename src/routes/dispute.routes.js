const router = require('express').Router();
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { success, created } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');
const { createNotification } = require('../services/notification.service');

// POST /api/disputes/open/:orderId — buyer opens a dispute
router.post('/open/:orderId', authenticate, authorize('BUYER'), async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { reason, description } = req.body;

    if (!reason) throw new AppError('Reason is required', 400);

    const order = await prisma.order.findFirst({
      where: { id: orderId, buyerId: req.user.id },
      include: { orderItems: { take: 1 } },
    });
    if (!order) throw new AppError('Order not found', 404);

    const existingDispute = await prisma.dispute.findUnique({ where: { orderId } });
    if (existingDispute) throw new AppError('A dispute already exists for this order', 409);

    const dispute = await prisma.dispute.create({
      data: { orderId, openedBy: req.user.id, reason, description: description || null, status: 'OPEN' },
    });

    const sellerId = order.orderItems[0]?.sellerId;

    // Notify seller and admins
    const notifyJobs = [];

    if (sellerId) {
      notifyJobs.push(
        createNotification({
          userId: sellerId,
          type: 'DISPUTE_OPENED',
          title: 'Dispute Opened',
          message: `A dispute has been opened for order #${order.orderNumber}.`,
          data: { disputeId: dispute.id, orderId, orderNumber: order.orderNumber, actionUrl: `/seller/orders/${orderId}` },
        })
      );
    }

    // Notify all admins
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
    for (const admin of admins) {
      notifyJobs.push(
        createNotification({
          userId: admin.id,
          type: 'DISPUTE_OPENED',
          title: 'New Dispute Opened',
          message: `Buyer opened a dispute for order #${order.orderNumber}.`,
          data: { disputeId: dispute.id, orderId, orderNumber: order.orderNumber, actionUrl: `/admin/disputes/${dispute.id}` },
        })
      );
    }

    await Promise.all(notifyJobs);

    return created(res, dispute, 'Dispute opened');
  } catch (err) { next(err); }
});

// PATCH /api/disputes/:orderId/resolve — admin resolves a dispute
router.patch('/:orderId/resolve', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { resolution } = req.body;

    if (!resolution) throw new AppError('Resolution is required', 400);

    const dispute = await prisma.dispute.findUnique({
      where: { orderId },
      include: { order: { select: { id: true, orderNumber: true, buyerId: true } } },
    });
    if (!dispute) throw new AppError('Dispute not found', 404);
    if (dispute.status === 'RESOLVED' || dispute.status === 'CLOSED') {
      throw new AppError('Dispute is already resolved or closed', 400);
    }

    const updated = await prisma.dispute.update({
      where: { orderId },
      data: {
        status: 'RESOLVED',
        resolution,
        resolvedBy: req.user.id,
        resolvedAt: new Date(),
      },
    });

    // Notify buyer
    await createNotification({
      userId: dispute.order.buyerId,
      type: 'DISPUTE_RESOLVED',
      title: 'Dispute Resolved',
      message: `Your dispute for order #${dispute.order.orderNumber} has been resolved.`,
      data: { disputeId: dispute.id, orderId, orderNumber: dispute.order.orderNumber, actionUrl: `/orders/${orderId}` },
    });

    return success(res, updated, 'Dispute resolved');
  } catch (err) { next(err); }
});

// GET /api/disputes/admin — admin lists all disputes
router.get('/admin', authenticate, authorize('ADMIN'), async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = status ? { status } : {};

    const [disputes, total] = await Promise.all([
      prisma.dispute.findMany({
        where,
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
        skip,
        take: parseInt(limit),
      }),
      prisma.dispute.count({ where }),
    ]);

    return success(res, {
      disputes,
      meta: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) { next(err); }
});

// GET /api/disputes/my — buyer's disputes
router.get('/my', authenticate, async (req, res, next) => {
  try {
    const disputes = await prisma.dispute.findMany({
      where: { openedBy: req.user.id },
      include: {
        order: { select: { id: true, orderNumber: true, status: true, totalAmount: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, disputes);
  } catch (err) { next(err); }
});

module.exports = router;
