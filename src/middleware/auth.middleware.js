const jwt = require('jsonwebtoken');
const env = require('../config/env');
const prisma = require('../config/db');
const { error } = require('../utils/response');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return error(res, 'Authentication token required', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        isApproved: true,
      },
    });

    if (!user) return error(res, 'User not found', 401);
    if (!user.isActive) return error(res, 'Account is deactivated', 403);

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return error(res, 'Token expired', 401);
    if (err.name === 'JsonWebTokenError') return error(res, 'Invalid token', 401);
    next(err);
  }
};

module.exports = { authenticate };
