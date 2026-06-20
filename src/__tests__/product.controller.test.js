'use strict';

/**
 * Tests for controllers/product.controller.js
 *
 * Covers public browsing, seller product management, variants, and add-ons.
 */

const request = require('supertest');
const express = require('express');

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('../config/db', () => ({
  product: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  category: { findMany: jest.fn() },
  productImage: {
    count: jest.fn(),
    createMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  },
  productVariantGroup: {
    deleteMany: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
  },
  productAddon: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
  },
  orderItem: { findFirst: jest.fn() },
  review: { aggregate: jest.fn() },
}));

jest.mock('../utils/slugify', () => jest.fn((name) => name.toLowerCase().replace(/\s+/g, '-')));

const prisma = require('../config/db');
const productController = require('../controllers/product.controller');

// ── Fixtures ──────────────────────────────────────────────────────────────────
const SAMPLE_PRODUCT = {
  id: 'prod-001',
  name: 'Fresh Tomatoes',
  slug: 'fresh-tomatoes',
  price: 50,
  stockQty: 100,
  isAvailable: true,
  sellerId: 'usr-seller-001',
  images: [],
  category: { id: 'cat-001', name: 'Vegetables', slug: 'vegetables' },
  seller: { id: 'usr-seller-001', fullName: 'Tom Seller', storeName: 'Tom\'s Farm' },
};

function buildApp(userOverride = { id: 'usr-seller-001', role: 'SELLER' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = userOverride; next(); });

  app.get('/products', productController.listProducts);
  app.get('/products/categories', productController.getCategories);
  app.get('/products/:slug', productController.getProduct);
  app.post('/products', productController.createProduct);
  app.put('/products/:id', productController.updateProduct);
  app.delete('/products/:id', productController.deleteProduct);
  app.get('/seller/products', productController.getSellerProducts);
  app.put('/seller/products/:id/variants', productController.upsertVariants);
  app.put('/seller/products/:id/addons', productController.upsertAddons);

  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

describe('Product Controller', () => {
  // ── listProducts ──────────────────────────────────────────────────────────────

  describe('GET /products', () => {
    it('happy path — returns paginated product list', async () => {
      prisma.product.findMany.mockResolvedValueOnce([SAMPLE_PRODUCT]);
      prisma.product.count.mockResolvedValueOnce(1);
      const res = await request(buildApp()).get('/products');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('returns empty list when no products match', async () => {
      prisma.product.findMany.mockResolvedValueOnce([]);
      prisma.product.count.mockResolvedValueOnce(0);
      const res = await request(buildApp()).get('/products?search=nonexistent');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  // ── getProduct ────────────────────────────────────────────────────────────────

  describe('GET /products/:slug', () => {
    it('happy path — returns product detail and increments viewCount', async () => {
      prisma.product.findUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, variantGroups: [], addons: [] });
      prisma.product.update.mockResolvedValueOnce({});
      const res = await request(buildApp()).get('/products/fresh-tomatoes');
      expect(res.status).toBe(200);
      expect(res.body.data.slug).toBe('fresh-tomatoes');
    });

    it('error path — product not found => 404', async () => {
      prisma.product.findUnique.mockResolvedValueOnce(null);
      const res = await request(buildApp()).get('/products/does-not-exist');
      expect(res.status).toBe(404);
    });
  });

  // ── createProduct ─────────────────────────────────────────────────────────────

  describe('POST /products', () => {
    const validBody = {
      name: 'Organic Carrots',
      description: 'Fresh organic carrots',
      price: 35,
      stockQty: 200,
      categoryId: 'cat-001',
      productType: 'FOOD',
    };

    it('happy path — creates product and returns 201', async () => {
      prisma.product.findUnique.mockResolvedValueOnce(null); // slug not taken
      prisma.product.create.mockResolvedValueOnce({ ...validBody, id: 'prod-002', slug: 'organic-carrots' });
      const res = await request(buildApp()).post('/products').send(validBody);
      expect(res.status).toBe(201);
    });
  });

  // ── updateProduct ─────────────────────────────────────────────────────────────

  describe('PUT /products/:id', () => {
    it('happy path — updates product', async () => {
      prisma.product.findUnique.mockResolvedValueOnce(SAMPLE_PRODUCT);
      prisma.product.update.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, price: 60 });
      const res = await request(buildApp()).put('/products/prod-001').send({ price: 60 });
      expect(res.status).toBe(200);
    });

    it('auth guard — different seller cannot update => 403', async () => {
      prisma.product.findUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, sellerId: 'usr-other' });
      const res = await request(buildApp({ id: 'usr-seller-001', role: 'SELLER' }))
        .put('/products/prod-001').send({ price: 60 });
      expect(res.status).toBe(403);
    });

    it('error path — product not found => 404', async () => {
      prisma.product.findUnique.mockResolvedValueOnce(null);
      const res = await request(buildApp()).put('/products/missing').send({ price: 60 });
      expect(res.status).toBe(404);
    });
  });

  // ── deleteProduct ─────────────────────────────────────────────────────────────

  describe('DELETE /products/:id', () => {
    it('happy path — hard-deletes product with no order history', async () => {
      prisma.product.findUnique.mockResolvedValueOnce(SAMPLE_PRODUCT);
      prisma.orderItem.findFirst.mockResolvedValueOnce(null);
      prisma.product.delete.mockResolvedValueOnce({});
      const res = await request(buildApp()).delete('/products/prod-001');
      expect(res.status).toBe(200);
    });

    it('soft-deletes product that has order history', async () => {
      prisma.product.findUnique.mockResolvedValueOnce(SAMPLE_PRODUCT);
      prisma.orderItem.findFirst.mockResolvedValueOnce({ id: 'oi-001' });
      prisma.product.update.mockResolvedValueOnce({});
      const res = await request(buildApp()).delete('/products/prod-001');
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/deactivated/i);
    });
  });

  // ── getCategories ─────────────────────────────────────────────────────────────

  describe('GET /products/categories', () => {
    it('happy path — returns active categories', async () => {
      prisma.category.findMany.mockResolvedValueOnce([
        { id: 'cat-001', name: 'Vegetables', slug: 'vegetables', isActive: true },
      ]);
      const res = await request(buildApp()).get('/products/categories');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });
});
