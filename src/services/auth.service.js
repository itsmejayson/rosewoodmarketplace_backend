const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const env = require('../config/env');
const { AppError } = require('../middleware/error.middleware');
const { notifyNewPendingSeller } = require('../config/socket');

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
  const refreshToken = jwt.sign({ userId }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  });
  return { accessToken, refreshToken };
};

const register = async ({ fullName, email, password, phone, role, storeName }, fileInfo = {}) => {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError('Email already registered', 409);

  const resolvedRole = (role || 'BUYER').toUpperCase();
  if (resolvedRole === 'SELLER' && !storeName?.trim()) {
    throw new AppError('Store name is required for sellers', 400);
  }
  if (resolvedRole === 'SELLER' && !fileInfo.proofDocumentUrl) {
    throw new AppError('Proof of residency document is required for seller registration', 400);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Sellers registered via public form need admin approval
  const isApproved = resolvedRole !== 'SELLER';

  const user = await prisma.user.create({
    data: {
      fullName,
      email,
      passwordHash,
      phone,
      role: resolvedRole,
      storeName: resolvedRole === 'SELLER' ? storeName.trim() : null,
      isApproved,
      proofDocument: fileInfo.proofDocumentUrl ?? null,
      proofDocumentPublicId: fileInfo.proofDocumentPublicId ?? null,
    },
    select: { id: true, fullName: true, email: true, role: true, storeName: true, createdAt: true, isApproved: true },
  });

  // Create cart for buyers
  if (user.role === 'BUYER') {
    await prisma.cart.create({ data: { buyerId: user.id } });
  }

  // Notify admins of new pending seller (non-fatal)
  if (resolvedRole === 'SELLER') {
    try {
      const admins = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true } });
      await prisma.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          type: 'SYSTEM',
          title: 'New Seller Registration',
          message: `${fullName} (${email}) has registered as a seller and is awaiting your approval.`,
          data: { sellerId: user.id, sellerEmail: email, sellerName: fullName, actionUrl: '/admin/pending-sellers' },
        })),
      });
      notifyNewPendingSeller({ id: user.id, fullName, email, storeName: user.storeName });
    } catch (_) { /* non-fatal */ }
  }

  // Always return tokens — sellers log in immediately but are gated in the frontend
  const tokens = generateTokens(user.id);
  return { user, ...tokens };
};

const login = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new AppError('Invalid email or password', 401);
  if (!user.isActive) throw new AppError('Account is deactivated', 403);

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) throw new AppError('Invalid email or password', 401);

  const { passwordHash: _ph, ...safeUser } = user;
  const tokens = generateTokens(user.id);
  return { user: safeUser, ...tokens };

};

const refreshAccessToken = async (refreshToken) => {
  try {
    const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || !user.isActive) throw new AppError('Invalid refresh token', 401);
    const accessToken = jwt.sign({ userId: user.id }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN,
    });
    return { accessToken };
  } catch {
    throw new AppError('Invalid or expired refresh token', 401);
  }
};

module.exports = { register, login, refreshAccessToken };
