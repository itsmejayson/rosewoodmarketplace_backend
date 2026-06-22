const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const { errorHandler } = require('./middleware/error.middleware');
const logger = require('./utils/logger');

// Catch any unhandled promise rejections or exceptions so they appear in the terminal
process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandledRejection]', reason);
  logger.error('Unhandled Rejection', { reason: String(reason), stack: reason?.stack });
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message, err.stack);
  logger.error('Uncaught Exception', { message: err.message, stack: err.stack });
});

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const productRoutes = require('./routes/product.routes');
const cartRoutes = require('./routes/cart.routes');
const orderRoutes = require('./routes/order.routes');
const transactionRoutes = require('./routes/transaction.routes');
const notificationRoutes = require('./routes/notification.routes');
const messageRoutes = require('./routes/message.routes');
const storeRoutes = require('./routes/store.routes');
const favoriteRoutes = require('./routes/favorite.routes');
const addressRoutes = require('./routes/address.routes');
const reviewRoutes = require('./routes/review.routes');
const refundRoutes = require('./routes/refund.routes');
const adminRoutes = require('./routes/admin.routes');
const aiRoutes = require('./routes/ai.routes');
const reportRoutes = require('./routes/report.routes');
const appSettings = require('./config/settings');

const app = express();

app.use(helmet());
app.use(compression());
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many auth attempts, please try again later' },
});
app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/refunds', refundRoutes);
app.use('/api/push', require('./routes/push.routes'));
app.use('/api/admin', adminRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/reports', reportRoutes);

// Public: read system settings (no auth required)
app.get('/api/settings', (req, res) => {
  res.json({ success: true, data: { ...appSettings } });
});

// Public: FAQ list
app.use('/api/faqs', require('./routes/faq.routes'));

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.path} not found` });
});

app.use(errorHandler);

module.exports = app;
