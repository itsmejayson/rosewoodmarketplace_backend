'use strict';

/**
 * Tests for controllers/user.controller.js
 *
 * Covers profile management, admin CRUD, and seller approval flows.
 * Prisma is mocked so no real DB connection is required.
 */

const request = require('supertest');
const express = require('express');

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('../config/db', () => ({
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
  },
  cart: { create: jest.fn() },
  order: { count: jest.fn(), findMany: jest.fn(), aggregate: jest.fn() },
  orderItem: { count: jest.fn() },
  product: { count: jest.fn(), updateMany: jest.fn() },
  notification: { create: jest.fn() },
  $transaction: jest.fn(),
}));

jest.mock('../services/cloudinary.service', () => ({
  deleteImage: jest.fn(),
}));

jest.mock('../config/socket', () => ({
  getOnlineUsers: jest.fn(() => []),
  getIO: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })) })),
}));

const prisma = require('../config/db');
const userController = require('../controllers/user.controller');

// ── App fixture ───────────────────────────────────────────────────────────────
function buildApp(userOverride = {}) {
  const app = express();
  app.use(express.json());

  // Inject a fake authenticated user into every request
  app.use((req, _res, next) => {
    req.user = { id: 'usr-001', role: 'BUYER', ...userOverride };
    next();
  });

  app.get('/profile', userController.getProfile);
  app.put('/profile', userController.updateProfile);
  app.put('/password', userController.changePassword);

  // Admin routes
  app.get('/admin/users', userController.listUsers);
  app.get('/admin/users/:id', userController.getUserDetail);
  app.post('/admin/users', userController.createUser);
  app.put('/admin/users/:id', userController.adminUpdateUser);
  app.delete('/admin/users/:id', userController.deleteUser);
  app.patch('/admin/users/:id/toggle', userController.toggleUserActive);
  app.get('/admin/stats', userController.getAdminStats);
  app.get('/admin/pending-sellers', userController.getPendingSellers);
  app.post('/admin/sellers/:id/approve', userController.approveSeller);

  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  });

  return app;
}

// ── Sample data ───────────────────────────────────────────────────────────────
const SAMPLE_USER = {
  id: 'usr-001',
  fullName: 'Jane Buyer',
  email: 'jane@example.com',
  phone: '09171234567',
  address: '123 Main St',
  profileImage: null,
  role: 'BUYER',
  isActive: true,
  isApproved: true,
  createdAt: new Date().toISOString(),
};

describe('User Controller', () => {
  // ── GET /profile ─────────────────────────────────────────────────────────────

  describe('GET /profile', () => {
    it('happy path — returns current user profile', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(SAMPLE_USER);
      const app = buildApp();
      const res = await request(app).get('/profile');
      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('jane@example.com');
    });
  });

  // ── PUT /profile ─────────────────────────────────────────────────────────────

  describe('PUT /profile', () => {
    it('happy path — updates and returns updated user', async () => {
      prisma.user.update.mockResolvedValueOnce({ ...SAMPLE_USER, fullName: 'Jane Updated' });
      const app = buildApp();
      const res = await request(app).put('/profile').send({ fullName: 'Jane Updated' });
      expect(res.status).toBe(200);
      expect(res.body.data.fullName).toBe('Jane Updated');
    });

    it('error path — seller with empty storeName => 400', async () => {
      const app = buildApp({ id: 'usr-001', role: 'SELLER' });
      const res = await request(app).put('/profile').send({ storeName: '   ' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/store name/i);
    });
  });

  // ── Admin: GET /admin/users ───────────────────────────────────────────────────

  describe('GET /admin/users', () => {
    it('happy path — returns paginated user list', async () => {
      prisma.user.findMany.mockResolvedValueOnce([SAMPLE_USER]);
      prisma.user.count.mockResolvedValueOnce(1);
      const app = buildApp({ role: 'ADMIN' });
      const res = await request(app).get('/admin/users');
      expect(res.status).toBe(200);
      expect(res.body.data.users).toHaveLength(1);
    });
  });

  // ── Admin: GET /admin/users/:id ───────────────────────────────────────────────

  describe('GET /admin/users/:id', () => {
    it('happy path — returns user detail', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(SAMPLE_USER);
      const app = buildApp({ role: 'ADMIN' });
      const res = await request(app).get('/admin/users/usr-001');
      expect(res.status).toBe(200);
    });

    it('error path — not found => 404', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const app = buildApp({ role: 'ADMIN' });
      const res = await request(app).get('/admin/users/not-exist');
      expect(res.status).toBe(404);
    });
  });

  // ── Admin: POST /admin/users ──────────────────────────────────────────────────

  describe('POST /admin/users', () => {
    const validBody = {
      fullName: 'New Buyer',
      email: 'newbuyer@example.com',
      password: 'Pass123!',
      role: 'BUYER',
      phone: '09179876543',
    };

    it('happy path — creates and returns user', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null); // no existing email
      prisma.user.create.mockResolvedValueOnce({ ...SAMPLE_USER, id: 'usr-new', email: 'newbuyer@example.com' });
      prisma.cart.create.mockResolvedValueOnce({});
      const app = buildApp({ role: 'ADMIN' });
      const res = await request(app).post('/admin/users').send(validBody);
      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('newbuyer@example.com');
    });

    it('validation path — missing required fields => 400', async () => {
      const app = buildApp({ role: 'ADMIN' });
      const res = await request(app).post('/admin/users').send({ email: 'x@x.com' });
      expect(res.status).toBe(400);
    });

    it('error path — duplicate email => 409', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(SAMPLE_USER); // email taken
      const app = buildApp({ role: 'ADMIN' });
      const res = await request(app).post('/admin/users').send(validBody);
      expect(res.status).toBe(409);
    });
  });

  // ── Admin: DELETE /admin/users/:id ────────────────────────────────────────────

  describe('DELETE /admin/users/:id', () => {
    it('happy path — soft-deletes user', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ ...SAMPLE_USER, id: 'usr-other' });
      prisma.order.count.mockResolvedValue(0);
      prisma.orderItem.count.mockResolvedValue(0);
      prisma.user.update.mockResolvedValueOnce({});
      const app = buildApp({ id: 'usr-001', role: 'ADMIN' });
      const res = await request(app).delete('/admin/users/usr-other');
      expect(res.status).toBe(200);
    });

    it('error path — user has active orders => 400', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ ...SAMPLE_USER, id: 'usr-other', role: 'BUYER' });
      prisma.order.count.mockResolvedValue(2);
      prisma.orderItem.count.mockResolvedValue(0);
      const app = buildApp({ id: 'usr-001', role: 'ADMIN' });
      const res = await request(app).delete('/admin/users/usr-other');
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/active order/i);
    });

    it('auth guard — cannot delete own account => 400', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(SAMPLE_USER); // same id as req.user
      const app = buildApp({ id: 'usr-001', role: 'ADMIN' });
      const res = await request(app).delete('/admin/users/usr-001');
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cannot delete your own/i);
    });
  });

  // ── Admin: seller approval ────────────────────────────────────────────────────

  describe('POST /admin/sellers/:id/approve', () => {
    const pendingSeller = {
      ...SAMPLE_USER,
      id: 'seller-001',
      role: 'SELLER',
      isApproved: false,
    };

    it('happy path — approves seller', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(pendingSeller);
      prisma.user.update.mockResolvedValueOnce({});
      prisma.notification.create.mockResolvedValueOnce({});
      const app = buildApp({ role: 'ADMIN' });
      const res = await request(app)
        .post('/admin/sellers/seller-001/approve')
        .send({ approve: true });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/approved/i);
    });

    it('error path — user is not a seller => 400', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(SAMPLE_USER); // role: BUYER
      const app = buildApp({ role: 'ADMIN' });
      const res = await request(app)
        .post('/admin/sellers/usr-001/approve')
        .send({ approve: true });
      expect(res.status).toBe(400);
    });
  });
});
