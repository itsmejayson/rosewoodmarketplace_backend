const router = require('express').Router();
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { success, created } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');

// GET /api/addresses — list current user's saved addresses
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
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { label, fullName, phone, address, city, state, zip, country, isDefault } = req.body;

    if (!fullName || !phone || !address || !city || !state) {
      throw new AppError('fullName, phone, address, city, and state are required', 400);
    }

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
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const existing = await prisma.savedAddress.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user.id) throw new AppError('Address not found', 404);

    const { label, fullName, phone, address, city, state, zip, country, isDefault } = req.body;

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
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const existing = await prisma.savedAddress.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user.id) throw new AppError('Address not found', 404);

    await prisma.savedAddress.delete({ where: { id: req.params.id } });
    return success(res, null, 'Address deleted');
  } catch (err) { next(err); }
});

// PATCH /api/addresses/:id/default — set as default
router.patch('/:id/default', authenticate, async (req, res, next) => {
  try {
    const existing = await prisma.savedAddress.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.userId !== req.user.id) throw new AppError('Address not found', 404);

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
