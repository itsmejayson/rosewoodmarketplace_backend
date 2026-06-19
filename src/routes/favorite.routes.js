const router = require('express').Router();
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { success } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');

// GET /api/favorites — list current user's favorites
router.get('/', authenticate, async (req, res, next) => {
  try {
    const favorites = await prisma.favorite.findMany({
      where: { userId: req.user.id },
      include: {
        product: {
          include: {
            images: { where: { isPrimary: true }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, favorites);
  } catch (err) { next(err); }
});

// GET /api/favorites/check/:productId — check if product is favorited
router.get('/check/:productId', authenticate, async (req, res, next) => {
  try {
    const existing = await prisma.favorite.findUnique({
      where: { userId_productId: { userId: req.user.id, productId: req.params.productId } },
    });
    return success(res, { favorited: !!existing });
  } catch (err) { next(err); }
});

// POST /api/favorites/:productId — toggle favorite
router.post('/:productId', authenticate, async (req, res, next) => {
  try {
    const { productId } = req.params;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new AppError('Product not found', 404);

    const existing = await prisma.favorite.findUnique({
      where: { userId_productId: { userId: req.user.id, productId } },
    });

    if (existing) {
      await prisma.favorite.delete({ where: { id: existing.id } });
      return success(res, { favorited: false });
    } else {
      await prisma.favorite.create({ data: { userId: req.user.id, productId } });
      return success(res, { favorited: true });
    }
  } catch (err) { next(err); }
});

module.exports = router;
