const prisma = require('../config/db');
const { success, paginated } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');

const listStores = async (req, res, next) => {
  try {
    const { search = '', page = 1, limit = 20 } = req.query;
    const where = {
      role: 'SELLER',
      isActive: true,
      storeName: { not: null },
      ...(search ? { OR: [
        { storeName: { contains: search, mode: 'insensitive' } },
        { fullName: { contains: search, mode: 'insensitive' } },
      ]} : {}),
    };

    const [sellers, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          storeName: true,
          fullName: true,
          profileImage: true,
          _count: { select: { products: { where: { isAvailable: { not: false } } } } },
        },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        orderBy: { storeName: 'asc' },
      }),
      prisma.user.count({ where }),
    ]);

    return paginated(res, sellers, { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { next(err); }
};

const getStore = async (req, res, next) => {
  try {
    const { sellerId } = req.params;
    const { page = 1, limit = 20, productType, categoryId } = req.query;

    const seller = await prisma.user.findFirst({
      where: { id: sellerId, role: 'SELLER', isActive: true },
      select: {
        id: true,
        storeName: true,
        fullName: true,
        profileImage: true,
        createdAt: true,
        defaultDeliveryFee: true,
        storeDescription: true,
        storeAddress: true,
      },
    });
    if (!seller) throw new AppError('Store not found', 404);

    const productWhere = {
      sellerId,
      isAvailable: { not: false },
      ...(productType ? { productType } : {}),
      ...(categoryId ? { categoryId } : {}),
    };

    const [products, total, reviewAggregate] = await Promise.all([
      prisma.product.findMany({
        where: productWhere,
        include: { images: { where: { isPrimary: true }, take: 1 }, category: true },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.product.count({ where: productWhere }),
      prisma.review.aggregate({
        where: { sellerId },
        _avg: { rating: true },
        _count: { rating: true },
      }),
    ]);

    return success(res, {
      seller: {
        ...seller,
        avgRating: reviewAggregate._avg.rating
          ? parseFloat(reviewAggregate._avg.rating.toFixed(2))
          : null,
        reviewCount: reviewAggregate._count.rating,
      },
      products,
      meta: { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) { next(err); }
};

const updateStoreSettings = async (req, res, next) => {
  try {
    const { defaultDeliveryFee, freeDeliveryThreshold, storeDescription, storeAddress } = req.body;

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(defaultDeliveryFee !== undefined && { defaultDeliveryFee: parseFloat(defaultDeliveryFee) }),
        ...(freeDeliveryThreshold !== undefined && {
          freeDeliveryThreshold: freeDeliveryThreshold === '' || freeDeliveryThreshold === null
            ? null
            : parseFloat(freeDeliveryThreshold),
        }),
        ...(storeDescription !== undefined && { storeDescription }),
        ...(storeAddress !== undefined && { storeAddress }),
      },
      select: {
        id: true,
        storeName: true,
        defaultDeliveryFee: true,
        freeDeliveryThreshold: true,
        storeDescription: true,
        storeAddress: true,
      },
    });
    return success(res, updated, 'Store settings updated');
  } catch (err) { next(err); }
};

module.exports = { listStores, getStore, updateStoreSettings };
