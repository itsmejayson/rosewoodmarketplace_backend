const prisma = require('../config/db');
const { success } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');
const notificationService = require('../services/notification.service');

const createReport = async (req, res, next) => {
  try {
    const { subject, description } = req.body;
    if (!subject || !description) throw new AppError('Subject and description are required', 400);

    const report = await prisma.report.create({
      data: {
        userId: req.user.id,
        subject,
        description,
        screenshotUrl: req.file?.path || null,
        screenshotPublicId: req.file?.filename || null,
      },
    });

    // Notify all admins
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    await Promise.all(admins.map((admin) =>
      notificationService.createNotification({
        userId: admin.id,
        type: 'SYSTEM',
        title: 'New Issue Report',
        message: `${req.user.fullName} submitted a report: "${subject}"`,
        data: { actionUrl: '/admin/reports' },
      })
    ));

    return success(res, report, 'Report submitted successfully', 201);
  } catch (err) { next(err); }
};

const getMyReports = async (req, res, next) => {
  try {
    const reports = await prisma.report.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, reports);
  } catch (err) { next(err); }
};

// Admin: list all reports with optional status filter
const listReports = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const where = status ? { status } : {};
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [reports, total] = await Promise.all([
      prisma.report.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, fullName: true, email: true, role: true } } },
      }),
      prisma.report.count({ where }),
    ]);

    return success(res, { reports, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
};

// Admin: update report status and add notes
const updateReport = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;
    const allowed = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED'];
    if (status && !allowed.includes(status)) throw new AppError('Invalid status', 400);

    const report = await prisma.report.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(adminNotes !== undefined && { adminNotes }),
        ...(['RESOLVED', 'DISMISSED'].includes(status) && {
          resolvedBy: req.user.id,
          resolvedAt: new Date(),
        }),
      },
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });

    return success(res, report, 'Report updated');
  } catch (err) { next(err); }
};

module.exports = { createReport, getMyReports, listReports, updateReport };
