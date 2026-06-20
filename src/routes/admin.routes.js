const router = require('express').Router();
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { success } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');
const appSettings = require('../config/settings');

router.use(authenticate, authorize('ADMIN'));

// ── System Settings ───────────────────────────────────────────────────────────
router.get('/settings', (req, res) => {
  return success(res, { ...appSettings });
});

router.put('/settings', (req, res) => {
  Object.assign(appSettings, req.body);
  return success(res, { ...appSettings }, 'Settings updated');
});

// ── Products: list all (across all sellers) ───────────────────────────────────
router.get('/products', async (req, res, next) => {
  try {
    const { search, sellerId, page = 1, limit = 20 } = req.query;
    const where = {};
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }];
    if (sellerId) where.sellerId = sellerId;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          images: { where: { isPrimary: true }, take: 1 },
          seller: { select: { id: true, fullName: true, storeName: true } },
          category: { select: { id: true, name: true } },
          _count: { select: { orderItems: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    return res.json({ success: true, data: products, meta: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) } });
  } catch (err) { next(err); }
});

// ── Products: delete one (with cascade cleanup) ───────────────────────────────
router.delete('/products/:id', async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) throw new AppError('Product not found', 404);

    // Remove from any carts first
    await prisma.cartItem.deleteMany({ where: { productId: req.params.id } });
    await prisma.favorite.deleteMany({ where: { productId: req.params.id } });

    await prisma.product.delete({ where: { id: req.params.id } });
    return success(res, null, 'Product deleted');
  } catch (err) { next(err); }
});

// ── Store cleanup: delete all products + transactions for a seller ─────────────
router.delete('/sellers/:sellerId/cleanup', async (req, res, next) => {
  try {
    const { sellerId } = req.params;
    const seller = await prisma.user.findUnique({ where: { id: sellerId } });
    if (!seller || seller.role !== 'SELLER') throw new AppError('Seller not found', 404);

    // Remove cart items referencing this seller's products
    const products = await prisma.product.findMany({ where: { sellerId }, select: { id: true } });
    const productIds = products.map((p) => p.id);

    await prisma.cartItem.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.favorite.deleteMany({ where: { productId: { in: productIds } } });

    // Delete transactions (and logs/messages) for this seller
    const txns = await prisma.transaction.findMany({ where: { sellerId }, select: { id: true } });
    const txnIds = txns.map((t) => t.id);
    await prisma.message.deleteMany({ where: { transactionId: { in: txnIds } } });
    await prisma.transactionLog.deleteMany({ where: { transactionId: { in: txnIds } } });
    await prisma.transaction.deleteMany({ where: { sellerId } });

    // Delete orders belonging only to this seller (order items for this seller)
    await prisma.orderItem.deleteMany({ where: { sellerId } });

    // Delete products
    await prisma.product.deleteMany({ where: { sellerId } });

    return success(res, null, `Cleaned up store data for ${seller.storeName || seller.fullName}`);
  } catch (err) { next(err); }
});

// ── Orders: force-cancel any order ────────────────────────────────────────────
router.post('/orders/:id/force-cancel', async (req, res, next) => {
  try {
    const { reason = 'Cancelled by admin' } = req.body;
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { orderItems: true } });
    if (!order) throw new AppError('Order not found', 404);

    if (['CANCELLED', 'DELIVERED', 'REFUNDED'].includes(order.status)) {
      throw new AppError('Order cannot be cancelled in its current status', 400);
    }

    // Restore stock
    for (const item of order.orderItems) {
      await prisma.product.update({
        where: { id: item.productId },
        data: { stockQty: { increment: item.quantity } },
      }).catch(() => {});
    }

    await prisma.order.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED', notes: `${order.notes ? order.notes + ' | ' : ''}Admin: ${reason}` },
    });

    return success(res, null, 'Order force-cancelled');
  } catch (err) { next(err); }
});

// ── Users: clear a buyer's cart ───────────────────────────────────────────────
router.delete('/users/:userId/cart', async (req, res, next) => {
  try {
    const cart = await prisma.cart.findUnique({ where: { buyerId: req.params.userId } });
    if (!cart) return success(res, null, 'Cart already empty');
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return success(res, null, 'Cart cleared');
  } catch (err) { next(err); }
});

// ── Sellers: list all sellers with basic stats ────────────────────────────────
router.get('/sellers', async (req, res, next) => {
  try {
    const sellers = await prisma.user.findMany({
      where: { role: 'SELLER' },
      select: {
        id: true,
        fullName: true,
        storeName: true,
        email: true,
        isActive: true,
        isApproved: true,
        createdAt: true,
        _count: { select: { products: true, sellerTxns: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, sellers);
  } catch (err) { next(err); }
});

// ── Public settings endpoint (no auth needed for frontend to read AI flag) ────
// Mounted separately in app.js under /api/settings
module.exports = router;
