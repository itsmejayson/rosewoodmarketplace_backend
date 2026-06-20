require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initSocket } = require('./config/socket');
const env = require('./config/env');
const logger = require('./utils/logger');
const { startAutoCancelJob } = require('./jobs/autoCancelOrders');

const server = http.createServer(app);

initSocket(server);

server.listen(env.PORT, () => {
  logger.info(`Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
  logger.info(`Health check: http://localhost:${env.PORT}/health`);
  startAutoCancelJob();
});

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Promise Rejection:', err);
  server.close(() => process.exit(1));
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
