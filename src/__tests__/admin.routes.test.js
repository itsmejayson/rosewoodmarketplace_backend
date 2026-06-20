'use strict';

/**
 * Tests for routes/admin.routes.js
 *
 * All routes require ADMIN role. The authenticate + authorize middleware
 * are mocked so we can test both the protected and unprotected scenarios.
 */

const request = require('supertest');
const express = require('express');

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('../config/db', () => ({
  product: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  cartItem: { deleteMany: jest.fn() },
  favorite: { deleteMany: jest.fn() },
  transaction: { findMany: jest.fn(), deleteMany: jest.fn() },
  transactionLog: { deleteMany: jest.fn() },
  message: { deleteMany: jest.fn() },
  orderItem: { deleteMany: jest.fn() },
  order: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  cart: { findUnique: jest.fn() },
  user: { findUnique: jest.fn(), findMany: jest.fn() },
}));

jest.mock('../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req, _res, next) => {
    req.user = { id: 'usr-admin-001', role: 'ADMIN' };
    next();
  }),
}));

jest.mock('../middleware/role.middleware', () => ({
  authorize: jest.fn(() => (_req, _res, next) => next()),
}));

jest.mock('../config/settings', () => ({ aiAssistantEnabled: true }));

const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const adminRouter = require('../routes/admin.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

describe('Admin Routes', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  // ── GET /admin/settings ────────────────────────────────────────────────────────

  describe('GET /admin/settings', () => {
    it('happy path — returns current settings', async () => {
      const res = await request(app).get('/admin/settings');
      expect(res.status).toBe(200);
      expect(res.body.data.aiAssistantEnabled).toBe(true);
    });

    it('auth guard — unauthenticated request returns 401', async () => {
      authenticate.mockImplementationOnce((_req, res) => {
        res.status(401).json({ success: false, message: 'Authentication token required' });
      });
      const res = await request(app).get('/admin/settings');
      expect(res.status).toBe(401);
    });
  });

  // ── PUT /admin/settings ────────────────────────────────────────────────────────

  describe('PUT /admin/settings', () => {
    it('happy path — updates and returns settings', async () => {
      const res = await request(app)
        .put('/admin/settings')
        .send({ aiAssistantEnabled: false });
      expect(res.status).toBe(200);
      expect(res.body.data.aiAssistantEnabled).toBe(false);
    });
  });

  // ── GET /admin/products ────────────────────────────────────────────────────────

  describe('GET /admin/products', () => {
    it('happy path — returns all products with pagination', async () => {
      prisma.product.findMany.mockResolvedValueOnce([
        { id: 'prod-001', name: 'Tomatoes', seller: {}, category: {}, images: [], _count: { orderItems: 0 } },
      ]);
      prisma.product.count.mockResolvedValueOnce(1);

      const res = await request(app).get('/admin/products');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  // ── DELETE /admin/products/:id ─────────────────────────────────────────────────

  describe('DELETE /admin/products/:id', () => {
    it('happy path — hard-deletes product and cleans up carts/favorites', async () => {
      prisma.product.findUnique.mockResolvedValueOnce({ id: 'prod-001', name: 'Tomatoes' });
      prisma.cartItem.deleteMany.mockResolvedValueOnce({});
      prisma.favorite.deleteMany.mockResolvedValueOnce({});
      prisma.product.delete.mockResolvedValueOnce({});

      const res = await request(app).delete('/admin/products/prod-001');
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/deleted/i);
    });

    it('error path — product not found => 404', async () => {
      prisma.product.findUnique.mockResolvedValueOnce(null);
      const res = await request(app).delete('/admin/products/not-exist');
      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /admin/sellers/:sellerId/cleanup ────────────────────────────────────

  describe('DELETE /admin/sellers/:sellerId/cleanup', () => {
    it('happy path — removes all seller products/transactions', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'usr-seller-001', role: 'SELLER', storeName: "Tom's Farm" });
      prisma.product.findMany.mockResolvedValueOnce([{ id: 'prod-001' }]);
      prisma.cartItem.deleteMany.mockResolvedValueOnce({});
      prisma.favorite.deleteMany.mockResolvedValueOnce({});
      prisma.transaction.findMany.mockResolvedValueOnce([{ id: 'txn-001' }]);
      prisma.message.deleteMany.mockResolvedValueOnce({});
      prisma.transactionLog.deleteMany.mockResolvedValueOnce({});
      prisma.transaction.deleteMany.mockResolvedValueOnce({});
      prisma.orderItem.deleteMany.mockResolvedValueOnce({});
      prisma.product.deleteMany.mockResolvedValueOnce({});

      const res = await request(app).delete('/admin/sellers/usr-seller-001/cleanup');
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/cleaned/i);
    });

    it('error path — seller not found => 404', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const res = await request(app).delete('/admin/sellers/not-a-seller/cleanup');
      expect(res.status).toBe(404);
    });
  });

  // ── POST /admin/orders/:id/force-cancel ────────────────────────────────────────

  describe('POST /admin/orders/:id/force-cancel', () => {
    it('happy path — force-cancels order and restores stock', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: 'ord-001',
        status: 'PENDING',
        orderItems: [{ id: 'oi-001', productId: 'prod-001', quantity: 5 }],
        notes: null,
      });
      prisma.product.update.mockResolvedValueOnce({});
      prisma.order.update.mockResolvedValueOnce({});

      const res = await request(app)
        .post('/admin/orders/ord-001/force-cancel')
        .send({ reason: 'Fraudulent order' });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/cancelled/i);
    });

    it('error path — already delivered order cannot be cancelled => 400', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: 'ord-001',
        status: 'DELIVERED',
        orderItems: [],
      });
      const res = await request(app).post('/admin/orders/ord-001/force-cancel').send({});
      expect(res.status).toBe(400);
    });

    it('auth guard — unauthenticated request returns 401', async () => {
      authenticate.mockImplementationOnce((_req, res) => {
        res.status(401).json({ success: false, message: 'Authentication token required' });
      });
      const res = await request(app).post('/admin/orders/ord-001/force-cancel').send({});
      expect(res.status).toBe(401);
    });
  });

  // ── GET /admin/sellers ─────────────────────────────────────────────────────────

  describe('GET /admin/sellers', () => {
    it('happy path — returns all sellers', async () => {
      prisma.user.findMany.mockResolvedValueOnce([
        { id: 'usr-seller-001', fullName: 'Tom Seller', storeName: "Tom's Farm", isActive: true, _count: {} },
      ]);
      const res = await request(app).get('/admin/sellers');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });
});
