const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  const isDev = process.env.NODE_ENV !== 'production';

  // Always print full error to terminal
  console.error('\n--- ERROR ---');
  console.error(`[${req.method}] ${req.originalUrl}`);
  console.error('Message :', err.message);
  if (err.code)  console.error('Code    :', err.code);
  if (err.meta)  console.error('Meta    :', JSON.stringify(err.meta));
  console.error('Stack   :', err.stack);
  console.error('Body    :', JSON.stringify(req.body));
  console.error('-------------\n');

  logger.error(err.message, { stack: err.stack, path: req.path, method: req.method, body: req.body, meta: err.meta });

  // Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({ success: false, message: 'A record with this value already exists', field: err.meta?.target });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ success: false, message: 'Record not found' });
  }
  if (err.code === 'P2003') {
    return res.status(400).json({ success: false, message: 'Related record not found', field: err.meta?.field_name });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired' });
  }

  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : (isDev ? err.message : 'Internal server error');

  res.status(statusCode).json({
    success: false,
    message,
    ...(isDev && !err.isOperational && { stack: err.stack }),
  });
};

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { errorHandler, AppError };
