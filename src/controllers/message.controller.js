const prisma = require('../config/db');
const { success, created } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');
const { getIO } = require('../config/socket');
const notificationService = require('../services/notification.service');

// Verify the requesting user is buyer or seller on this transaction
const assertParticipant = async (transactionId, userId) => {
  const tx = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { buyerId: true, sellerId: true },
  });
  if (!tx) throw new AppError('Transaction not found', 404);
  if (tx.buyerId !== userId && tx.sellerId !== userId) throw new AppError('Forbidden', 403);
  return tx;
};

const getMessages = async (req, res, next) => {
  try {
    const { transactionId } = req.params;
    await assertParticipant(transactionId, req.user.id);

    const messages = await prisma.message.findMany({
      where: { transactionId },
      include: {
        sender: { select: { id: true, fullName: true, profileImage: true, role: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Mark unread messages sent by the other party as read
    await prisma.message.updateMany({
      where: { transactionId, isRead: false, senderId: { not: req.user.id } },
      data: { isRead: true },
    });

    return success(res, messages);
  } catch (err) { next(err); }
};

const sendMessage = async (req, res, next) => {
  try {
    const { transactionId } = req.params;
    const { content } = req.body;

    if (!content?.trim() && !req.file) throw new AppError('Message content or image is required', 400);

    const tx = await assertParticipant(transactionId, req.user.id);

    const message = await prisma.message.create({
      data: {
        transactionId,
        senderId: req.user.id,
        content: content?.trim() || '',
        imageUrl: req.file?.path || null,
      },
      include: {
        sender: { select: { id: true, fullName: true, profileImage: true, role: true } },
      },
    });

    // Determine the other party to notify
    const recipientId = tx.buyerId === req.user.id ? tx.sellerId : tx.buyerId;

    // Real-time delivery
    try {
      const io = getIO();
      io.to(`tx:${transactionId}`).emit('newMessage', message);
    } catch {}

    // Push notification to recipient
    if (recipientId) {
      await notificationService.createNotification({
        userId: recipientId,
        type: 'NEW_MESSAGE',
        title: `Message from ${req.user.fullName}`,
        message: content?.trim() ? content.substring(0, 100) : '📷 Sent an image',
        data: { transactionId },
      });
    }

    return created(res, message);
  } catch (err) { next(err); }
};

const getUnreadCount = async (req, res, next) => {
  try {
    // All transactions this user participates in
    const txIds = await prisma.transaction.findMany({
      where: {
        OR: [{ buyerId: req.user.id }, { sellerId: req.user.id }],
      },
      select: { id: true },
    });

    const ids = txIds.map((t) => t.id);
    const count = await prisma.message.count({
      where: { transactionId: { in: ids }, isRead: false, senderId: { not: req.user.id } },
    });

    return success(res, { unreadCount: count });
  } catch (err) { next(err); }
};

module.exports = { getMessages, sendMessage, getUnreadCount };
