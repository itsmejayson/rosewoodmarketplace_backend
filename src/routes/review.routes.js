const router = require('express').Router();
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { success, created } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');
const { createNotification } = require('../services/notification.service');

// POST /api/reviews — create a review
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { productId, orderId, rating, comment } = req.body;

    if (!productId || !orderId || !rating) {
      throw new AppError('productId, orderId, and rating are required', 400);
    }
    if (!Number.isInteger(Number(rating)) || rating < 1 || rating > 5) {
      throw new AppError('Rating must be an integer between 1 and 5', 400);
    }

    // Verify the order belongs to this buyer, contains this product, and is DELIVERED
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        buyerId: req.user.id,
        status: 'DELIVERED',
        orderItems: { some: { productId } },
      },
      include: { orderItems: { where: { productId }, take: 1 } },
    });
    if (!order) {
      throw new AppError('You can only review products from your delivered orders', 403);
    }

    const sellerId = order.orderItems[0].sellerId;

    const review = await prisma.review.create({
      data: {
        buyerId: req.user.id,
        sellerId,
        productId,
        orderId,
        rating: Number(rating),
        comment: comment || null,
      },
      include: {
        buyer: { select: { id: true, fullName: true, profileImage: true } },
        product: { select: { id: true, name: true } },
      },
    });

    // Notify seller
    await createNotification({
      userId: sellerId,
      type: 'REVIEW_RECEIVED',
      title: 'New Review Received',
      message: `${req.user.fullName} left a ${rating}-star review on ${review.product.name}.`,
      data: { reviewId: review.id, productId, orderId, actionUrl: `/seller/reviews` },
    });

    return created(res, review, 'Review submitted');
  } catch (err) { next(err); }
});

// GET /api/reviews/product/:productId — list reviews for a product
router.get('/product/:productId', async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [reviews, total, aggregate] = await Promise.all([
      prisma.review.findMany({
        where: { productId },
        include: {
          buyer: { select: { id: true, fullName: true, profileImage: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.review.count({ where: { productId } }),
      prisma.review.aggregate({
        where: { productId },
        _avg: { rating: true },
        _count: { rating: true },
      }),
    ]);

    return success(res, {
      reviews,
      avgRating: aggregate._avg.rating ? parseFloat(aggregate._avg.rating.toFixed(2)) : null,
      count: aggregate._count.rating,
      meta: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) { next(err); }
});

// GET /api/reviews/seller — all reviews for seller's products
router.get('/seller', authenticate, async (req, res, next) => {
  try {
    const reviews = await prisma.review.findMany({
      where: { sellerId: req.user.id },
      include: {
        buyer: { select: { id: true, fullName: true, profileImage: true } },
        product: { select: { id: true, name: true, slug: true, images: { where: { isPrimary: true }, take: 1 } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, reviews);
  } catch (err) { next(err); }
});

// GET /api/reviews/my — buyer's own reviews
router.get('/my', authenticate, async (req, res, next) => {
  try {
    const reviews = await prisma.review.findMany({
      where: { buyerId: req.user.id },
      include: {
        product: {
          select: { id: true, name: true, images: { where: { isPrimary: true }, take: 1 } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, reviews);
  } catch (err) { next(err); }
});

// DELETE /api/reviews/:id — delete own review
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const review = await prisma.review.findUnique({ where: { id: req.params.id } });
    if (!review) throw new AppError('Review not found', 404);
    if (review.buyerId !== req.user.id && req.user.role !== 'ADMIN') {
      throw new AppError('Forbidden', 403);
    }

    await prisma.review.delete({ where: { id: req.params.id } });
    return success(res, null, 'Review deleted');
  } catch (err) { next(err); }
});

module.exports = router;
