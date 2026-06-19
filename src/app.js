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
const disputeRoutes = require('./routes/dispute.routes');

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
  max: 200,
  message: { success: false, message: 'Too many requests, please try again later' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many auth attempts' },
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
app.use('/api/disputes', disputeRoutes);
app.use('/api/push', require('./routes/push.routes'));

app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.path} not found` });
});

app.use(errorHandler);

module.exports = app;
