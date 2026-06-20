const router = require('express').Router();
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { success } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');
const appSettings = require('../config/settings');

/**
 * All admin routes are protected by two middleware layers:
 *   1. authenticate — verifies the JWT and attaches req.user.
 *   2. authorize('ADMIN') — ensures the user has the ADMIN role.
 *
 * These are applied once at the router level so every route below inherits
 * them without repetition.
 */
router.use(authenticate, authorize('ADMIN'));

// ── System Settings ───────────────────────────────────────────────────────────

/**
 * GET /api/admin/settings
 *
 * Returns the current in-memory system settings object.
 * Settings are stored in config/settings.js as a plain mutable object so
 * they can be toggled at runtime without a DB write (suitable for simple
 * feature flags like the AI assistant toggle).
 */
router.get('/settings', (req, res) => {
  return success(res, { ...appSettings });
});

/**
 * PUT /api/admin/settings
 *
 * Merges the request body into the in-memory settings object using
 * Object.assign.  Changes take effect immediately for all subsequent
 * requests — no server restart required.
 *
 * Note: settings are NOT persisted to a database.  A server restart will
 * reset them to the defaults defined in config/settings.js.
 */
router.put('/settings', (req, res) => {
  Object.assign(appSettings, req.body);
  return success(res, { ...appSettings }, 'Settings updated');
});

// ── Products: list all (across all sellers) ───────────────────────────────────

/**
 * GET /api/admin/products
 *
 * Lists every product in the system (all sellers) with optional search and
 * seller filter.  Includes order item count so the admin can see which
 * products are in active use and shouldn't be hard-deleted.
 */
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

/**
 * DELETE /api/admin/products/:id
 *
 * Hard-deletes a product from the system.
 * Before deletion, all cart items and favorites referencing this product are
 * removed to avoid foreign-key constraint violations and stale data in
 * buyer carts.
 *
 * The admin version bypasses the soft-delete logic used by the seller
 * controller — admins may need to forcefully remove a product regardless of
 * order history (e.g. policy violation).
 */
router.delete('/products/:id', async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) throw new AppError('Product not found', 404);

    // Remove from any carts first to avoid FK constraint violations
    await prisma.cartItem.deleteMany({ where: { productId: req.params.id } });
    await prisma.favorite.deleteMany({ where: { productId: req.params.id } });

    await prisma.product.delete({ where: { id: req.params.id } });
    return success(res, null, 'Product deleted');
  } catch (err) { next(err); }
});

// ── Store cleanup: delete all products + transactions for a seller ─────────────

/**
 * DELETE /api/admin/sellers/:sellerId/cleanup
 *
 * Performs a full data cleanup for a seller's store.  Intended for use
 * when a seller account is being removed or suspended and their data must
 * be wiped from the marketplace.
 *
 * Deletion order matters because of foreign-key relationships:
 *   1. CartItems / Favorites referencing the seller's products
 *   2. Transaction messages and logs (children of Transaction)
 *   3. Transactions themselves
 *   4. OrderItems belonging to this seller
 *   5. Products
 *
 * Individual deletions are used rather than cascading deletes because Prisma
 * with the pg adapter does not always support multi-level cascades reliably.
 */
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

/**
 * POST /api/admin/orders/:id/force-cancel
 *
 * Allows an admin to cancel any order regardless of the current status,
 * except for terminal states (CANCELLED, DELIVERED, REFUNDED).
 *
 * Unlike the buyer/seller cancel endpoint, this bypasses ownership checks.
 * The admin reason is appended to the order's notes field for auditability.
 *
 * Stock is restored for each item using per-product updates rather than a
 * single query to ensure accurate inventory even if some products fail.
 * Individual failures are silenced (.catch(() => {})) so one bad product ID
 * doesn't prevent the rest from being restored.
 */
router.post('/orders/:id/force-cancel', async (req, res, next) => {
  try {
    const { reason = 'Cancelled by admin' } = req.body;
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { orderItems: true } });
    if (!order) throw new AppError('Order not found', 404);

    if (['CANCELLED', 'DELIVERED', 'REFUNDED'].includes(order.status)) {
      throw new AppError('Order cannot be cancelled in its current status', 400);
    }

    // Restore stock — individual catches prevent one bad productId from blocking the rest
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

/**
 * DELETE /api/admin/users/:userId/cart
 *
 * Clears all items from a specific buyer's cart.
 * Useful for resolving stuck orders or stale reserved stock in support
 * scenarios.  Returns success even if the cart is already empty so the
 * admin UI doesn't need to check first.
 */
router.delete('/users/:userId/cart', async (req, res, next) => {
  try {
    const cart = await prisma.cart.findUnique({ where: { buyerId: req.params.userId } });
    if (!cart) return success(res, null, 'Cart already empty');
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return success(res, null, 'Cart cleared');
  } catch (err) { next(err); }
});

// ── Sellers: list all sellers with basic stats ────────────────────────────────

/**
 * GET /api/admin/sellers
 *
 * Returns all seller accounts regardless of active/approved status so the
 * admin can see the full picture — including pending and deactivated sellers.
 * Includes counts of products and transactions for quick at-a-glance stats.
 */
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

// ── Reports ───────────────────────────────────────────────────────────────────

const { listReports, updateReport } = require('../controllers/report.controller');

router.get('/reports', listReports);
router.patch('/reports/:id', updateReport);

module.exports = router;
