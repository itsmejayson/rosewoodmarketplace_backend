const { Server } = require('socket.io');
const env = require('./env');
const logger = require('../utils/logger');

let io;

// userId → { id, fullName, email, role, connectedAt, socketId }
const onlineUsers = new Map();

const broadcastOnlineUsers = () => {
  if (!io) return;
  io.to('admin-room').emit('onlineUsers', Array.from(onlineUsers.values()));
};

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: env.FRONTEND_URL,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    // Join user-specific room for notifications
    socket.on('join', (userId) => {
      socket.join(`user:${userId}`);
      logger.info(`Socket ${socket.id} joined user:${userId}`);
    });

    // Register presence with user info
    socket.on('registerPresence', (userInfo) => {
      socket.data.userId = userInfo.id;
      onlineUsers.set(userInfo.id, {
        ...userInfo,
        socketId: socket.id,
        connectedAt: new Date().toISOString(),
      });
      broadcastOnlineUsers();
    });

    // Admin joins the admin room to receive live updates
    socket.on('joinAdmin', () => {
      socket.join('admin-room');
      socket.emit('onlineUsers', Array.from(onlineUsers.values()));
    });

    // Join seller room for order notifications + dashboard
    socket.on('joinSeller', (sellerId) => {
      socket.join(`seller:${sellerId}`);
    });

    // Join a transaction chat room
    socket.on('joinTransaction', (transactionId) => {
      socket.join(`tx:${transactionId}`);
      logger.info(`Socket ${socket.id} joined tx:${transactionId}`);
    });

    socket.on('leaveTransaction', (transactionId) => {
      socket.leave(`tx:${transactionId}`);
    });

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`);
      if (socket.data.userId) {
        onlineUsers.delete(socket.data.userId);
        broadcastOnlineUsers();
      }
    });
  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
};

const getOnlineUsers = () => Array.from(onlineUsers.values());

// Notify the admin room that a new seller is pending
const notifyNewPendingSeller = (sellerInfo) => {
  if (!io) return;
  io.to('admin-room').emit('newPendingSeller', sellerInfo);
};

module.exports = { initSocket, getIO, getOnlineUsers, notifyNewPendingSeller };
