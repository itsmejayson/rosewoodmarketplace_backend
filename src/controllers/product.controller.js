const prisma = require('../config/db');
const slugify = require('../utils/slugify');
const { success, created, paginated } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');

// ── Public ────────────────────────────────────────────────────────────────────

const listProducts = async (req, res, next) => {
  try {
    const {
      page = 1, limit = 12, search, categoryId, productType,
      sortBy = 'createdAt', sortOrder = 'desc',
    } = req.query;

    const where = { isAvailable: true };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (productType) where.productType = productType;

    const orderByMap = {
      price: { price: sortOrder },
      newest: { createdAt: 'desc' },
      popularity: { salesCount: 'desc' },
      createdAt: { createdAt: sortOrder },
    };
    const orderBy = orderByMap[sortBy] || { createdAt: 'desc' };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          images: { where: { isPrimary: true }, take: 1 },
          category: { select: { id: true, name: true, slug: true } },
          seller: { select: { id: true, fullName: true, storeName: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    return paginated(res, products, {
      total, page: parseInt(page),
      limit: take, pages: Math.ceil(total / take),
    });
  } catch (err) { next(err); }
};

const getProduct = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const product = await prisma.product.findUnique({
      where: { slug },
      include: {
        images: { orderBy: { order: 'asc' } },
        category: { select: { id: true, name: true, slug: true } },
        seller: { select: { id: true, fullName: true, storeName: true, profileImage: true } },
        variantGroups: { include: { options: true }, orderBy: { name: 'asc' } },
        addons: { orderBy: { name: 'asc' } },
      },
    });
    if (!product) throw new AppError('Product not found', 404);

    // Increment view count
    await prisma.product.update({ where: { id: product.id }, data: { viewCount: { increment: 1 } } });

    return success(res, product);
  } catch (err) { next(err); }
};

const getSellerProductById = async (req, res, next) => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, sellerId: req.user.id },
      include: {
        images: { orderBy: { order: 'asc' } },
        category: true,
        variantGroups: { include: { options: true }, orderBy: { name: 'asc' } },
        addons: { orderBy: { name: 'asc' } },
      },
    });
    if (!product) throw new AppError('Product not found', 404);
    return success(res, product);
  } catch (err) { next(err); }
};

const getCategories = async (req, res, next) => {
  try {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return success(res, categories);
  } catch (err) { next(err); }
};

// ── Seller ────────────────────────────────────────────────────────────────────

const normalizeDate = (v) => {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
};

const createProduct = async (req, res, next) => {
  try {
    const slug = await generateUniqueSlug(req.body.name);
    const { expirationDate, ...rest } = req.body;
    const product = await prisma.product.create({
      data: { ...rest, slug, sellerId: req.user.id, expirationDate: normalizeDate(expirationDate) },
    });
    return created(res, product, 'Product created');
  } catch (err) { next(err); }
};

const updateProduct = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) throw new AppError('Product not found', 404);
    if (product.sellerId !== req.user.id && req.user.role !== 'ADMIN') {
      throw new AppError('Forbidden', 403);
    }
    const { expirationDate, ...rest } = req.body;
    const updated = await prisma.product.update({
      where: { id: req.params.id },
      data: { ...rest, expirationDate: normalizeDate(expirationDate) },
    });
    return success(res, updated, 'Product updated');
  } catch (err) { next(err); }
};

const deleteProduct = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) throw new AppError('Product not found', 404);
    if (product.sellerId !== req.user.id && req.user.role !== 'ADMIN') {
      throw new AppError('Forbidden', 403);
    }
    // Check if product has any order history — if so, soft-delete to preserve data integrity
    const hasOrders = await prisma.orderItem.findFirst({ where: { productId: req.params.id } });
    if (hasOrders) {
      await prisma.product.update({
        where: { id: req.params.id },
        data: { isAvailable: false, stockQty: 0 },
      });
      return success(res, null, 'Product deactivated (has order history)');
    }
    await prisma.product.delete({ where: { id: req.params.id } });
    return success(res, null, 'Product deleted');
  } catch (err) { next(err); }
};

const uploadProductImages = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) throw new AppError('No files uploaded', 400);
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product || product.sellerId !== req.user.id) throw new AppError('Forbidden', 403);

    const existing = await prisma.productImage.count({ where: { productId: product.id } });

    const images = await prisma.productImage.createMany({
      data: req.files.map((file, idx) => ({
        productId: product.id,
        url: file.path,
        publicId: file.filename,
        isPrimary: existing === 0 && idx === 0,
        order: existing + idx,
      })),
    });
    return created(res, images, 'Images uploaded');
  } catch (err) { next(err); }
};

const deleteProductImage = async (req, res, next) => {
  try {
    const { id, imageId } = req.params;
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product || product.sellerId !== req.user.id) throw new AppError('Forbidden', 403);
    const image = await prisma.productImage.findUnique({ where: { id: imageId } });
    if (!image || image.productId !== id) throw new AppError('Image not found', 404);
    if (image.publicId) {
      const { deleteImage } = require('../services/cloudinary.service');
      await deleteImage(image.publicId);
    }
    await prisma.productImage.delete({ where: { id: imageId } });
    // If deleted image was primary, promote the next one
    if (image.isPrimary) {
      const next = await prisma.productImage.findFirst({ where: { productId: id }, orderBy: { order: 'asc' } });
      if (next) await prisma.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    return success(res, null, 'Image deleted');
  } catch (err) { next(err); }
};

const getSellerProducts = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const sellerId = req.user.id;
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where: { sellerId, isAvailable: { not: false } },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        include: { images: { where: { isPrimary: true }, take: 1 }, category: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.product.count({ where: { sellerId, isAvailable: { not: false } } }),
    ]);
    return paginated(res, products, { total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { next(err); }
};

const getSellerStats = async (req, res, next) => {
  try {
    const sellerId = req.user.id;
    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalOrders, revenue, pending, completed, cancelled, topProducts] = await Promise.all([
      prisma.orderItem.count({ where: { sellerId } }),
      prisma.orderItem.aggregate({
        where: { sellerId, order: { status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] } } },
        _sum: { totalPrice: true },
      }),
      prisma.orderItem.count({ where: { sellerId, order: { status: 'PENDING' } } }),
      prisma.orderItem.count({ where: { sellerId, order: { status: 'DELIVERED' } } }),
      prisma.orderItem.count({ where: { sellerId, order: { status: 'CANCELLED' } } }),
      prisma.product.findMany({
        where: { sellerId },
        orderBy: { salesCount: 'desc' },
        take: 5,
        select: { id: true, name: true, salesCount: true, price: true, images: { where: { isPrimary: true }, take: 1 } },
      }),
    ]);

    return success(res, {
      totalOrders,
      totalRevenue: revenue._sum.totalPrice || 0,
      pendingOrders: pending,
      completedOrders: completed,
      cancelledOrders: cancelled,
      topProducts,
    });
  } catch (err) { next(err); }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const generateUniqueSlug = async (name) => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  let slug = base;
  let count = 0;
  while (await prisma.product.findUnique({ where: { slug } })) {
    slug = `${base}-${++count}`;
  }
  return slug;
};

const upsertVariants = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product || product.sellerId !== req.user.id) throw new AppError('Not found', 404);

    const { groups } = req.body;

    await prisma.productVariantGroup.deleteMany({ where: { productId: id } });
    if (groups?.length) {
      for (const g of groups) {
        await prisma.productVariantGroup.create({
          data: {
            productId: id,
            name: g.name,
            required: g.required ?? false,
            maxSelect: g.maxSelect ?? 1,
            options: {
              create: (g.options || []).map((o) => ({
                name: o.name,
                priceModifier: parseFloat(o.priceModifier) || 0,
              })),
            },
          },
        });
      }
    }

    const updated = await prisma.productVariantGroup.findMany({
      where: { productId: id },
      include: { options: true },
    });
    return success(res, updated, 'Variants saved');
  } catch (err) { next(err); }
};

const upsertAddons = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product || product.sellerId !== req.user.id) throw new AppError('Not found', 404);

    const { addons } = req.body;

    await prisma.productAddon.deleteMany({ where: { productId: id } });
    if (addons?.length) {
      await prisma.productAddon.createMany({
        data: addons.map((a) => ({
          productId: id,
          name: a.name,
          price: parseFloat(a.price) || 0,
        })),
      });
    }

    const updated = await prisma.productAddon.findMany({ where: { productId: id } });
    return success(res, updated, 'Add-ons saved');
  } catch (err) { next(err); }
};

module.exports = {
  listProducts, getProduct, getSellerProductById, getCategories,
  createProduct, updateProduct, deleteProduct,
  uploadProductImages, deleteProductImage, getSellerProducts, getSellerStats,
  upsertVariants, upsertAddons,
};
