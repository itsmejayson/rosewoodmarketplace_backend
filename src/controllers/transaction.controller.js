const prisma = require('../config/db');
const { success, paginated } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');

const getBuyerTransactions = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const where = { buyerId: req.user.id };

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        include: {
          order: {
            select: {
              orderNumber: true, status: true, totalAmount: true, createdAt: true, fulfillmentType: true,
              orderItems: { select: { productName: true, quantity: true, unitPrice: true } },
            },
          },
          seller: { select: { id: true, fullName: true, storeName: true } },
          logs: { orderBy: { createdAt: 'desc' } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.transaction.count({ where }),
    ]);

    return paginated(res, transactions, {
      total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) { next(err); }
};

const getSellerTransactions = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, paymentStatus } = req.query;
    const where = { sellerId: req.user.id };
    if (paymentStatus) where.paymentStatus = paymentStatus;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        include: {
          order: {
            select: {
              orderNumber: true, status: true, totalAmount: true, createdAt: true, fulfillmentType: true,
              buyer: { select: { fullName: true, email: true } },
              orderItems: { where: { sellerId: req.user.id } },
            },
          },
          logs: { orderBy: { createdAt: 'desc' } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.transaction.count({ where }),
    ]);

    return paginated(res, transactions, {
      total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) { next(err); }
};

const getTransactionById = async (req, res, next) => {
  try {
    const transaction = await prisma.transaction.findUnique({
      where: { id: req.params.id },
      include: {
        order: { include: { orderItems: true, buyer: { select: { fullName: true, email: true } } } },
        logs: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!transaction) throw new AppError('Transaction not found', 404);

    const isOwner =
      transaction.buyerId === req.user.id ||
      transaction.sellerId === req.user.id ||
      req.user.role === 'ADMIN';
    if (!isOwner) throw new AppError('Forbidden', 403);

    return success(res, transaction);
  } catch (err) { next(err); }
};

const getSellerSalesReport = async (req, res, next) => {
  try {
    const { period = 'monthly' } = req.query;
    const sellerId = req.user.id;

    const now = new Date();
    let startDate;
    if (period === 'daily') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'weekly') {
      startDate = new Date(now); startDate.setDate(now.getDate() - 7);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const orders = await prisma.orderItem.findMany({
      where: {
        sellerId,
        order: { status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] }, createdAt: { gte: startDate } },
      },
      include: { order: { select: { createdAt: true, orderNumber: true } } },
    });

    const totalRevenue = orders.reduce((sum, i) => sum + parseFloat(i.totalPrice), 0);
    const totalItems = orders.reduce((sum, i) => sum + i.quantity, 0);

    return success(res, { period, startDate, totalRevenue, totalItems, orderCount: orders.length, orders });
  } catch (err) { next(err); }
};

const getAllTransactionsAdmin = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, paymentStatus, paymentMethod } = req.query;
    const where = {};
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (paymentMethod) where.paymentMethod = paymentMethod;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
        include: {
          order: {
            select: {
              orderNumber: true, status: true, totalAmount: true, createdAt: true, fulfillmentType: true,
              buyer: { select: { fullName: true, email: true } },
              orderItems: { select: { productName: true, quantity: true, unitPrice: true, totalPrice: true } },
            },
          },
          logs: { orderBy: { createdAt: 'desc' } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.transaction.count({ where }),
    ]);

    return paginated(res, transactions, {
      total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) { next(err); }
};

module.exports = {
  getBuyerTransactions, getSellerTransactions, getTransactionById, getSellerSalesReport, getAllTransactionsAdmin,
};
