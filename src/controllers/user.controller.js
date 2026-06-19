const prisma = require('../config/db');
const bcrypt = require('bcryptjs');
const { success, error } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');
const cloudinary = require('../services/cloudinary.service');
const { getOnlineUsers, getIO } = require('../config/socket');

const getProfile = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, fullName: true, email: true, phone: true,
        address: true, profileImage: true, role: true, isApproved: true, createdAt: true,
      },
    });
    return success(res, user);
  } catch (err) { next(err); }
};

const updateProfile = async (req, res, next) => {
  try {
    const { fullName, phone, address, storeName } = req.body;
    if (req.user.role === 'SELLER' && storeName !== undefined && !storeName?.trim()) {
      throw new AppError('Store name cannot be empty', 400);
    }
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        fullName,
        phone,
        address,
        ...(req.user.role === 'SELLER' && storeName !== undefined
          ? { storeName: storeName.trim() }
          : {}),
      },
      select: {
        id: true, fullName: true, email: true, phone: true,
        address: true, profileImage: true, role: true, storeName: true,
      },
    });
    return success(res, updated, 'Profile updated');
  } catch (err) { next(err); }
};

const uploadProfileImage = async (req, res, next) => {
  try {
    if (!req.file) return error(res, 'No file uploaded', 400);
    const url = req.file.path; // Cloudinary URL from multer-storage-cloudinary
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { profileImage: url },
      select: { id: true, profileImage: true },
    });
    return success(res, updated, 'Profile image updated');
  } catch (err) { next(err); }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) throw new AppError('Current password is incorrect', 400);
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } });
    return success(res, null, 'Password changed successfully');
  } catch (err) { next(err); }
};

// ── Admin ─────────────────────────────────────────────────────────────────────

const listUsers = async (req, res, next) => {
  try {
    const { role, search = '', page = 1, limit = 20, pending, status } = req.query;

    let baseWhere = {};
    if (pending === 'true') {
      baseWhere = { role: 'SELLER', isApproved: false, isActive: true };
    } else if (status === 'deleted') {
      baseWhere = { email: { startsWith: 'deleted_' } };
    } else if (status === 'inactive') {
      baseWhere = { isActive: false, NOT: { email: { startsWith: 'deleted_' } } };
    } else if (role && role !== 'ALL') {
      // Active (non-deleted) users only for normal role tabs
      baseWhere = { role, isActive: true, NOT: { email: { startsWith: 'deleted_' } } };
    } else {
      // Default: only active, non-deleted users
      baseWhere = { isActive: true, NOT: { email: { startsWith: 'deleted_' } } };
    }

    const where = {
      ...baseWhere,
      ...(search ? { OR: [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { storeName: { contains: search, mode: 'insensitive' } },
      ]} : {}),
    };
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        select: {
          id: true, fullName: true, email: true, role: true,
          isActive: true, isApproved: true, storeName: true, phone: true, createdAt: true,
          _count: { select: { products: true, orders: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);
    return success(res, { users, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { next(err); }
};

const getUserDetail = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, fullName: true, email: true, role: true, isActive: true,
        storeName: true, phone: true, address: true, profileImage: true, createdAt: true,
        _count: { select: { products: true, orders: true } },
      },
    });
    if (!user) throw new AppError('User not found', 404);
    return success(res, user);
  } catch (err) { next(err); }
};

const createUser = async (req, res, next) => {
  try {
    const { fullName, email, password, role, phone, storeName } = req.body;
    if (!fullName || !email || !password || !role) {
      throw new AppError('fullName, email, password, role are required', 400);
    }
    const resolvedRole = role.toUpperCase();
    if (!['BUYER', 'SELLER', 'ADMIN'].includes(resolvedRole)) {
      throw new AppError('Invalid role', 400);
    }
    if (resolvedRole === 'SELLER' && !storeName?.trim()) {
      throw new AppError('Store name is required for sellers', 400);
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError('Email already registered', 409);

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        fullName, email, passwordHash, phone,
        role: resolvedRole,
        storeName: resolvedRole === 'SELLER' ? storeName.trim() : null,
        isApproved: true, // admin-created accounts are pre-approved
      },
      select: { id: true, fullName: true, email: true, role: true, isActive: true, storeName: true, createdAt: true },
    });
    if (resolvedRole === 'BUYER') {
      await prisma.cart.create({ data: { buyerId: user.id } });
    }
    return success(res, user, 'User created');
  } catch (err) { next(err); }
};

const toggleUserActive = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw new AppError('User not found', 404);
    const newActive = !user.isActive;
    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: req.params.id },
        data: { isActive: newActive },
        select: { id: true, isActive: true, fullName: true },
      }),
      ...(user.role === 'SELLER'
        ? [prisma.product.updateMany({
            where: { sellerId: req.params.id },
            data: { isAvailable: newActive },
          })]
        : []),
    ]);
    return success(res, updated, `${updated.fullName} is now ${updated.isActive ? 'active' : 'inactive'}`);
  } catch (err) { next(err); }
};

const getAdminStats = async (req, res, next) => {
  try {
    const [totalUsers, totalSellers, totalBuyers, totalProducts, totalOrders, recentOrders] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: 'SELLER' } }),
      prisma.user.count({ where: { role: 'BUYER' } }),
      prisma.product.count({ where: { isAvailable: { not: false } } }),
      prisma.order.count(),
      prisma.order.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          buyer: { select: { fullName: true } },
          orderItems: { take: 1, include: { product: { select: { name: true } } } },
        },
      }),
    ]);
    const revenue = await prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] } },
    });
    return success(res, {
      totalUsers, totalSellers, totalBuyers, totalProducts, totalOrders,
      revenue: revenue._sum.totalAmount || 0,
      recentOrders,
    });
  } catch (err) { next(err); }
};

const adminUpdateUser = async (req, res, next) => {
  try {
    const { fullName, email, phone, address, storeName, role, password } = req.body;
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('User not found', 404);

    // Check email uniqueness if changed
    if (email && email !== existing.email) {
      const taken = await prisma.user.findUnique({ where: { email } });
      if (taken) throw new AppError('Email already in use', 409);
    }

    const resolvedRole = role ? role.toUpperCase() : existing.role;
    if (resolvedRole === 'SELLER' && storeName !== undefined && !storeName?.trim()) {
      throw new AppError('Store name cannot be empty for sellers', 400);
    }

    const data = {
      ...(fullName ? { fullName } : {}),
      ...(email ? { email } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(address !== undefined ? { address } : {}),
      ...(role ? { role: resolvedRole } : {}),
      ...(storeName !== undefined ? { storeName: storeName?.trim() || null } : {}),
      ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
    };

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: {
        id: true, fullName: true, email: true, role: true, isActive: true,
        storeName: true, phone: true, address: true, profileImage: true, createdAt: true,
        _count: { select: { products: true, orders: true } },
      },
    });
    return success(res, updated, 'User updated');
  } catch (err) { next(err); }
};

const deleteUser = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw new AppError('User not found', 404);
    if (user.id === req.user.id) throw new AppError('Cannot delete your own account', 400);

    // Check for active orders before deleting (buyers and sellers)
    const [buyerOrders, sellerOrderItems] = await Promise.all([
      prisma.order.count({
        where: { buyerId: user.id, status: { notIn: ['CANCELLED', 'DELIVERED', 'REFUNDED'] } },
      }),
      user.role === 'SELLER'
        ? prisma.orderItem.count({
            where: { sellerId: user.id, order: { status: { notIn: ['CANCELLED', 'DELIVERED', 'REFUNDED'] } } },
          })
        : Promise.resolve(0),
    ]);

    const activeOrders = buyerOrders + sellerOrderItems;
    if (activeOrders > 0) throw new AppError(`User has ${activeOrders} active order(s). Resolve them first.`, 400);

    // Soft-delete — rename email so the address can be reused, deactivate account
    await prisma.user.update({
      where: { id: req.params.id },
      data: {
        isActive: false,
        isApproved: false,
        email: `deleted_${Date.now()}_${user.email}`,
      },
    });

    // Unpublish seller products separately (avoids transaction array spread issues)
    if (user.role === 'SELLER') {
      await prisma.product.updateMany({
        where: { sellerId: req.params.id },
        data: { isAvailable: false },
      });
    }

    return success(res, null, 'User deleted successfully');
  } catch (err) { next(err); }
};

const getOnlineUsersAdmin = (req, res) => {
  return success(res, getOnlineUsers());
};

const getPendingSellers = async (req, res, next) => {
  try {
    const sellers = await prisma.user.findMany({
      where: { role: 'SELLER', isApproved: false, isActive: true, NOT: { email: { startsWith: 'deleted_' } } },
      select: {
        id: true, fullName: true, email: true, phone: true,
        storeName: true, createdAt: true, isActive: true,
        proofDocument: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, sellers);
  } catch (err) { next(err); }
};

const approveSeller = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { approve } = req.body; // true = approve, false = reject

    const seller = await prisma.user.findUnique({ where: { id } });
    if (!seller) throw new AppError('User not found', 404);
    if (seller.role !== 'SELLER') throw new AppError('User is not a seller', 400);

    if (approve) {
      await prisma.user.update({ where: { id }, data: { isApproved: true, isActive: true } });
      await prisma.notification.create({
        data: {
          userId: id,
          type: 'SYSTEM',
          title: 'Account Approved!',
          message: 'Your seller account has been approved. You can now access the full marketplace!',
          data: { actionUrl: '/seller/dashboard' },
        },
      });
      // Push real-time event so the pending page reacts immediately
      try { getIO().to(`user:${id}`).emit('sellerApproved'); } catch (_) {}
      return success(res, null, `${seller.fullName}'s account has been approved.`);
    } else {
      await prisma.user.update({ where: { id }, data: { isActive: false } });
      await prisma.notification.create({
        data: {
          userId: id,
          type: 'SYSTEM',
          title: 'Account Not Approved',
          message: 'Your seller account application was not approved. Please contact support for more information.',
        },
      });
      try { getIO().to(`user:${id}`).emit('sellerRejected'); } catch (_) {}
      return success(res, null, `${seller.fullName}'s account has been rejected.`);
    }
  } catch (err) { next(err); }
};

module.exports = {
  getProfile, updateProfile, uploadProfileImage, changePassword,
  listUsers, getUserDetail, createUser, adminUpdateUser, deleteUser, toggleUserActive, getAdminStats,
  getOnlineUsersAdmin, getPendingSellers, approveSeller,
};
