const router = require('express').Router();
const prisma = require('../config/db');
const { success } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');

// ── Public: get all active FAQs (grouped by section on the frontend) ──────────
router.get('/', async (req, res, next) => {
  try {
    const faqs = await prisma.faq.findMany({
      where: { isActive: true },
      orderBy: [{ section: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return success(res, faqs);
  } catch (err) { next(err); }
});

// ── Admin middleware ───────────────────────────────────────────────────────────
router.use(authenticate, authorize('ADMIN'));

// GET /api/faqs/admin — all FAQs including inactive
router.get('/admin', async (req, res, next) => {
  try {
    const faqs = await prisma.faq.findMany({
      orderBy: [{ section: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return success(res, faqs);
  } catch (err) { next(err); }
});

// POST /api/faqs/admin — create
router.post('/admin', async (req, res, next) => {
  try {
    const { section, question, answer, sortOrder } = req.body;
    if (!section?.trim()) throw new AppError('Section is required', 400);
    if (!question?.trim()) throw new AppError('Question is required', 400);
    if (!answer?.trim()) throw new AppError('Answer is required', 400);
    const faq = await prisma.faq.create({
      data: {
        section: section.trim(),
        question: question.trim(),
        answer: answer.trim(),
        sortOrder: sortOrder ?? 0,
      },
    });
    return success(res, faq, 'FAQ created');
  } catch (err) { next(err); }
});

// PUT /api/faqs/admin/:id — update
router.put('/admin/:id', async (req, res, next) => {
  try {
    const { section, question, answer, sortOrder, isActive } = req.body;
    const existing = await prisma.faq.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('FAQ not found', 404);
    const data = {};
    if (section   !== undefined) data.section   = section.trim();
    if (question  !== undefined) data.question  = question.trim();
    if (answer    !== undefined) data.answer    = answer.trim();
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (isActive  !== undefined) data.isActive  = isActive;
    const updated = await prisma.faq.update({ where: { id: req.params.id }, data });
    return success(res, updated, 'FAQ updated');
  } catch (err) { next(err); }
});

// DELETE /api/faqs/admin/:id — delete
router.delete('/admin/:id', async (req, res, next) => {
  try {
    const existing = await prisma.faq.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('FAQ not found', 404);
    await prisma.faq.delete({ where: { id: req.params.id } });
    return success(res, null, 'FAQ deleted');
  } catch (err) { next(err); }
});

// POST /api/faqs/admin/seed — load default FAQ content into the database
router.post('/admin/seed', async (req, res, next) => {
  try {
    const count = await prisma.faq.count();
    if (count > 0) throw new AppError('FAQs already exist. Clear them first or edit individually.', 409);
    const defaults = require('../data/faqDefaults');
    await prisma.faq.createMany({ data: defaults });
    return success(res, null, `${defaults.length} default FAQs loaded`);
  } catch (err) { next(err); }
});

module.exports = router;
