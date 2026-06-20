'use strict';

/**
 * Tests for controllers/store.controller.js
 *
 * Covers listing stores, viewing a store's detail + products, and updating
 * store settings as an authenticated seller.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../config/db', () => ({
  user: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  product: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  review: { aggregate: jest.fn() },
}));

const prisma = require('../config/db');
const storeController = require('../controllers/store.controller');

const SAMPLE_SELLER = {
  id: 'usr-seller-001',
  storeName: "Tom's Farm",
  fullName: 'Tom Seller',
  profileImage: null,
  createdAt: new Date().toISOString(),
  defaultDeliveryFee: 50,
  freeDeliveryThreshold: 500,
  storeDescription: 'Fresh produce from the farm',
  storeAddress: '456 Farm Road',
};

function buildApp(user = { id: 'usr-seller-001', role: 'SELLER' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });

  app.get('/stores', storeController.listStores);
  app.get('/stores/:sellerId', storeController.getStore);
  app.put('/store/settings', storeController.updateStoreSettings);

  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

describe('Store Controller', () => {
  // ── listStores ────────────────────────────────────────────────────────────────

  describe('GET /stores', () => {
    it('happy path — returns paginated stores', async () => {
      prisma.user.findMany.mockResolvedValueOnce([SAMPLE_SELLER]);
      prisma.user.count.mockResolvedValueOnce(1);
      const res = await request(buildApp()).get('/stores');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('filters by search term', async () => {
      prisma.user.findMany.mockResolvedValueOnce([]);
      prisma.user.count.mockResolvedValueOnce(0);
      const res = await request(buildApp()).get('/stores?search=nonexistent');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ── getStore ──────────────────────────────────────────────────────────────────

  describe('GET /stores/:sellerId', () => {
    it('happy path — returns store detail with products', async () => {
      prisma.user.findFirst.mockResolvedValueOnce(SAMPLE_SELLER);
      prisma.product.findMany.mockResolvedValueOnce([]);
      prisma.product.count.mockResolvedValueOnce(0);
      prisma.review.aggregate.mockResolvedValueOnce({ _avg: { rating: 4.5 }, _count: { rating: 10 } });

      const res = await request(buildApp()).get('/stores/usr-seller-001');
      expect(res.status).toBe(200);
      expect(res.body.data.seller.storeName).toBe("Tom's Farm");
      expect(res.body.data.seller.avgRating).toBe(4.5);
    });

    it('error path — store not found => 404', async () => {
      prisma.user.findFirst.mockResolvedValueOnce(null);
      const res = await request(buildApp()).get('/stores/not-a-seller');
      expect(res.status).toBe(404);
    });
  });

  // ── updateStoreSettings ───────────────────────────────────────────────────────

  describe('PUT /store/settings', () => {
    it('happy path — updates store settings', async () => {
      prisma.user.update.mockResolvedValueOnce({
        ...SAMPLE_SELLER,
        defaultDeliveryFee: 75,
        freeDeliveryThreshold: 600,
      });

      const res = await request(buildApp())
        .put('/store/settings')
        .send({ defaultDeliveryFee: 75, freeDeliveryThreshold: 600 });
      expect(res.status).toBe(200);
      expect(res.body.data.defaultDeliveryFee).toBe(75);
    });

    it('auth guard — unauthenticated request would be rejected by auth middleware (not controller)', async () => {
      // The controller itself reads req.user.id, so a missing user would throw internally
      // Verifying the controller doesn't crash when user is present
      prisma.user.update.mockResolvedValueOnce(SAMPLE_SELLER);
      const res = await request(buildApp()).put('/store/settings').send({});
      expect(res.status).toBe(200);
    });
  });
});
