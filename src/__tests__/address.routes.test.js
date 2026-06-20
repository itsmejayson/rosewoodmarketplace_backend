'use strict';

/**
 * Tests for routes/address.routes.js
 *
 * Uses supertest against a mini app that mounts the real address router.
 * The authenticate middleware is mocked so auth-guarded routes can be tested
 * both with and without a valid token.
 */

const request = require('supertest');
const express = require('express');

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('../config/db', () => ({
  savedAddress: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
}));

// Mock the authenticate middleware so we can control whether requests are
// treated as authenticated in each test.
jest.mock('../middleware/auth.middleware', () => ({
  authenticate: jest.fn((req, _res, next) => {
    // Default: inject a buyer user; individual tests can override this behaviour
    req.user = { id: 'usr-buyer-001', role: 'BUYER' };
    next();
  }),
}));

const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const addressRouter = require('../routes/address.routes');

const SAMPLE_ADDRESS = {
  id: 'addr-001',
  userId: 'usr-buyer-001',
  label: 'Home',
  fullName: 'Jane Buyer',
  phone: '09171234567',
  address: 'Lot 1 Block 2',
  city: 'Block A',
  state: 'Phase 1',
  zip: '1000',
  country: 'Philippines',
  isDefault: true,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/addresses', addressRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

describe('Address Routes', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  // ── GET /addresses ────────────────────────────────────────────────────────────

  describe('GET /addresses', () => {
    it('happy path — returns saved addresses', async () => {
      prisma.savedAddress.findMany.mockResolvedValueOnce([SAMPLE_ADDRESS]);
      const res = await request(app).get('/addresses');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].label).toBe('Home');
    });

    it('auth guard — unauthenticated request returns 401', async () => {
      authenticate.mockImplementationOnce((_req, res) => {
        res.status(401).json({ success: false, message: 'Authentication token required' });
      });
      const res = await request(app).get('/addresses');
      expect(res.status).toBe(401);
    });
  });

  // ── POST /addresses ───────────────────────────────────────────────────────────

  describe('POST /addresses', () => {
    const validBody = {
      label: 'Office',
      fullName: 'Jane Buyer',
      phone: '09171234567',
      address: 'Lot 5 Block 3',
      city: 'Block B',
      state: 'Phase 2',
    };

    it('happy path — creates address and returns 201', async () => {
      prisma.savedAddress.updateMany.mockResolvedValueOnce({});
      prisma.savedAddress.create.mockResolvedValueOnce({ ...SAMPLE_ADDRESS, id: 'addr-002', label: 'Office' });

      const res = await request(app).post('/addresses').send({ ...validBody, isDefault: true });
      expect(res.status).toBe(201);
      expect(res.body.message).toMatch(/saved/i);
    });

    it('validation path — missing required fields => 400', async () => {
      const res = await request(app).post('/addresses').send({ label: 'Work' }); // missing fullName etc.
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/required/i);
    });

    it('auth guard — unauthenticated request returns 401', async () => {
      authenticate.mockImplementationOnce((_req, res) => {
        res.status(401).json({ success: false, message: 'Authentication token required' });
      });
      const res = await request(app).post('/addresses').send(validBody);
      expect(res.status).toBe(401);
    });
  });

  // ── PUT /addresses/:id ────────────────────────────────────────────────────────

  describe('PUT /addresses/:id', () => {
    it('happy path — updates address', async () => {
      prisma.savedAddress.findUnique.mockResolvedValueOnce(SAMPLE_ADDRESS);
      prisma.savedAddress.updateMany.mockResolvedValueOnce({});
      prisma.savedAddress.update.mockResolvedValueOnce({ ...SAMPLE_ADDRESS, label: 'Updated Home' });

      const res = await request(app)
        .put('/addresses/addr-001')
        .send({ label: 'Updated Home', isDefault: true });
      expect(res.status).toBe(200);
    });

    it('error path — address not found (or belongs to another user) => 404', async () => {
      prisma.savedAddress.findUnique.mockResolvedValueOnce({ ...SAMPLE_ADDRESS, userId: 'usr-other' });
      const res = await request(app).put('/addresses/addr-001').send({ label: 'X' });
      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /addresses/:id ─────────────────────────────────────────────────────

  describe('DELETE /addresses/:id', () => {
    it('happy path — deletes address', async () => {
      prisma.savedAddress.findUnique.mockResolvedValueOnce(SAMPLE_ADDRESS);
      prisma.savedAddress.delete.mockResolvedValueOnce({});

      const res = await request(app).delete('/addresses/addr-001');
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/deleted/i);
    });

    it('error path — address not found => 404', async () => {
      prisma.savedAddress.findUnique.mockResolvedValueOnce(null);
      const res = await request(app).delete('/addresses/missing');
      expect(res.status).toBe(404);
    });

    it('auth guard — unauthenticated request returns 401', async () => {
      authenticate.mockImplementationOnce((_req, res) => {
        res.status(401).json({ success: false, message: 'Authentication token required' });
      });
      const res = await request(app).delete('/addresses/addr-001');
      expect(res.status).toBe(401);
    });
  });

  // ── PATCH /addresses/:id/default ──────────────────────────────────────────────

  describe('PATCH /addresses/:id/default', () => {
    it('happy path — sets address as default', async () => {
      prisma.savedAddress.findUnique.mockResolvedValueOnce(SAMPLE_ADDRESS);
      prisma.savedAddress.updateMany.mockResolvedValueOnce({});
      prisma.savedAddress.update.mockResolvedValueOnce({ ...SAMPLE_ADDRESS, isDefault: true });

      const res = await request(app).patch('/addresses/addr-001/default');
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/default/i);
    });
  });
});
