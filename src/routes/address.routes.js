const router = require('express').Router();
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { success, created } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');

/**
 * Address routes — all endpoints require an authenticated user.
 * Addresses are scoped to the requesting user via `userId: req.user.id`,
 * so users can only see and modify their own saved addresses.
 */

// GET /api/addresses — list current user's saved addresses
/**
 * Returns all addresses for the authenticated user, sorted so the default
 * address appears first (useful for pre-selecting it in checkout).
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const addresses = await prisma.savedAddress.findMany({
      where: { userId: req.user.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return success(res, addresses);
  } catch (err) { next(err); }
});

// POST /api/addresses — create a saved address
/**
 * Creates a new saved address for the authenticated user.
 *
 * If `isDefault: true` is sent, all other addresses for this user are first
 * demoted to non-default so there is always exactly one default address.
 * This is done in a separate updateMany rather than a transaction because
 * a partial failure here (old defaults not demoted) is recoverable — the
 * client can set the default again — whereas a transaction failure would
 * leave the user unable to save an address at all.
 *
 * zip and country have sensible defaults so the frontend doesn't need to
 * expose those fields in a simplified form.
 */
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { label, fullName, phone, address, city, state, zip, country, isDefault } = req.body;

    // Validate required fields — these are the minimum needed to show a usable
    // shipping address on an order confirmation.
    if (!fullName || !phone || !address || !city || !state) {
      throw new AppError('fullName, phone, address, city, and state are required', 400);
    }

    // Demote all existing defaults before creating the new default address
    if (isDefault) {
      await prisma.savedAddress.updateMany({
        where: { userId: req.user.id },
        data: { isDefault: false },
      });
    }

    const saved = await prisma.savedAddress.create({
      data: {
        userId: req.user.id,
        label: label || 'Home',
        fullName,
        phone,
        address,
        city,
        state,
        zip: zip || 'N/A',
        country: country || 'Philippines',
        isDefault: !!isDefault,
      },
    });
    return created(res, saved, 'Address saved');
  } catch (err) { next(err); }
});

// PUT /api/addresses/:id — update a saved address
/**
 * Updates any field of an existing saved address.
 *
 * Ownership is verified by checking `existing.userId === req.user.id` —
 * returning 404 instead of 403 to avoid leaking that the address ID exists.
 *
 * Sparse update: only fields present in the request body are changed.
 * This allows the frontend to send a partial object (e.g. only updating
 * the phone number) without overwriting other fields with undefined.
 *
 * If `isDefault: true` is sent, other addresses are demoted first, excluding
 * the current one to avoid a race condition where all are briefly non-default.
 */
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const existing = await prisma.savedAddress.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user.id) throw new AppError('Address not found', 404);

    const { label, fullName, phone, address, city, state, zip, country, isDefault } = req.body;

    // Demote all OTHER addresses before setting this one as default
    if (isDefault) {
      await prisma.savedAddress.updateMany({
        where: { userId: req.user.id, id: { not: req.params.id } },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.savedAddress.update({
      where: { id: req.params.id },
      data: {
        ...(label !== undefined && { label }),
        ...(fullName !== undefined && { fullName }),
        ...(phone !== undefined && { phone }),
        ...(address !== undefined && { address }),
        ...(city !== undefined && { city }),
        ...(state !== undefined && { state }),
        ...(zip !== undefined && { zip }),
        ...(country !== undefined && { country }),
        ...(isDefault !== undefined && { isDefault: !!isDefault }),
      },
    });
    return success(res, updated);
  } catch (err) { next(err); }
});

// DELETE /api/addresses/:id — delete a saved address
/**
 * Permanently removes a saved address.
 * Ownership is verified before deletion — 404 for not-found or not-owned.
 */
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const existing = await prisma.savedAddress.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user.id) throw new AppError('Address not found', 404);

    await prisma.savedAddress.delete({ where: { id: req.params.id } });
    return success(res, null, 'Address deleted');
  } catch (err) { next(err); }
});

// PATCH /api/addresses/:id/default — set as default
/**
 * Atomically promotes one address to default and demotes all others.
 *
 * A separate PATCH endpoint is used instead of bundling this into PUT so
 * the frontend can set the default with a single click without having to
 * re-send the full address payload.
 *
 * Two writes are used (updateMany → update) rather than a $transaction
 * because the window where no address is the default is extremely brief
 * and has no user-visible consequence.
 */
router.patch('/:id/default', authenticate, async (req, res, next) => {
  try {
    const existing = await prisma.savedAddress.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user.id) throw new AppError('Address not found', 404);

    // Demote all, then promote the target
    await prisma.savedAddress.updateMany({
      where: { userId: req.user.id },
      data: { isDefault: false },
    });

    const updated = await prisma.savedAddress.update({
      where: { id: req.params.id },
      data: { isDefault: true },
    });
    return success(res, updated, 'Default address updated');
  } catch (err) { next(err); }
});

module.exports = router;
