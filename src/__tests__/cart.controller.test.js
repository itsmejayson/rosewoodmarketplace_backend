'use strict';

/**
 * Tests for controllers/cart.controller.js
 *
 * Covers cart retrieval, adding/updating/removing items, and clearing the cart.
 * The options-matching logic (isSameOptions) is exercised through addItem.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../config/db', () => ({
  cart: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  cartItem: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  product: {
    findUnique: jest.fn(),
  },
}));

const prisma = require('../config/db');
const cartController = require('../controllers/cart.controller');

const BUYER_USER = { id: 'usr-buyer-001', role: 'BUYER' };

const SAMPLE_PRODUCT = {
  id: 'prod-001',
  name: 'Fresh Tomatoes',
  price: 50,
  stockQty: 100,
  isAvailable: true,
  images: [{ url: 'https://example.com/img.jpg', isPrimary: true }],
  seller: { id: 'usr-seller-001', fullName: 'Tom Seller', storeName: "Tom's Farm" },
};

const SAMPLE_CART = {
  id: 'cart-001',
  buyerId: 'usr-buyer-001',
  cartItems: [
    {
      id: 'ci-001',
      cartId: 'cart-001',
      productId: 'prod-001',
      quantity: 2,
      selectedOptions: null,
      product: SAMPLE_PRODUCT,
    },
  ],
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = BUYER_USER; next(); });

  app.get('/cart', cartController.getCart);
  app.post('/cart/items', cartController.addItem);
  app.put('/cart/items/:productId', cartController.updateItem);
  app.delete('/cart/items/:productId', cartController.removeItem);
  app.delete('/cart', cartController.clearCart);

  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

describe('Cart Controller', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  // ── getCart ───────────────────────────────────────────────────────────────────

  describe('GET /cart', () => {
    it('happy path — returns cart with computed subtotal', async () => {
      prisma.cart.findUnique.mockResolvedValueOnce(SAMPLE_CART);
      const res = await request(app).get('/cart');
      expect(res.status).toBe(200);
      expect(res.body.data.subtotal).toBe(100); // 50 * 2
      expect(res.body.data.itemCount).toBe(2);
    });

    it('returns empty cart when no cart exists', async () => {
      prisma.cart.findUnique.mockResolvedValueOnce(null);
      const res = await request(app).get('/cart');
      expect(res.status).toBe(200);
      expect(res.body.data.subtotal).toBe(0);
    });
  });

  // ── addItem ───────────────────────────────────────────────────────────────────

  describe('POST /cart/items', () => {
    it('happy path — adds new item to cart', async () => {
      prisma.product.findUnique.mockResolvedValueOnce(SAMPLE_PRODUCT);
      prisma.cart.upsert.mockResolvedValueOnce({ id: 'cart-001' });
      prisma.cartItem.findMany.mockResolvedValueOnce([]); // no existing candidates
      prisma.cartItem.create.mockResolvedValueOnce({
        id: 'ci-002', cartId: 'cart-001', productId: 'prod-001', quantity: 1,
      });

      const res = await request(app)
        .post('/cart/items')
        .send({ productId: 'prod-001', quantity: 1 });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/added/i);
    });

    it('merges quantity when same product+options already in cart', async () => {
      prisma.product.findUnique.mockResolvedValueOnce(SAMPLE_PRODUCT);
      prisma.cart.upsert.mockResolvedValueOnce({ id: 'cart-001' });
      prisma.cartItem.findMany.mockResolvedValueOnce([
        { id: 'ci-001', cartId: 'cart-001', productId: 'prod-001', quantity: 2, selectedOptions: null },
      ]);
      prisma.cartItem.update.mockResolvedValueOnce({ id: 'ci-001', quantity: 3 });

      const res = await request(app)
        .post('/cart/items')
        .send({ productId: 'prod-001', quantity: 1 });
      expect(res.status).toBe(200);
      expect(prisma.cartItem.update).toHaveBeenCalled();
    });

    it('error path — product not found => 404', async () => {
      prisma.product.findUnique.mockResolvedValueOnce(null);
      const res = await request(app).post('/cart/items').send({ productId: 'bad-id' });
      expect(res.status).toBe(404);
    });

    it('error path — out-of-stock product => 400', async () => {
      prisma.product.findUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, stockQty: 0 });
      const res = await request(app).post('/cart/items').send({ productId: 'prod-001' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/out of stock/i);
    });

    it('error path — unavailable product => 400', async () => {
      prisma.product.findUnique.mockResolvedValueOnce({ ...SAMPLE_PRODUCT, isAvailable: false });
      const res = await request(app).post('/cart/items').send({ productId: 'prod-001' });
      expect(res.status).toBe(400);
    });
  });

  // ── updateItem ────────────────────────────────────────────────────────────────

  describe('PUT /cart/items/:productId', () => {
    it('happy path — updates quantity', async () => {
      prisma.cart.findUnique.mockResolvedValueOnce({ id: 'cart-001' });
      prisma.cartItem.findFirst.mockResolvedValueOnce({ id: 'ci-001', cartId: 'cart-001', productId: 'prod-001', quantity: 2 });
      prisma.cartItem.update.mockResolvedValueOnce({ id: 'ci-001', quantity: 5 });

      const res = await request(app)
        .put('/cart/items/prod-001')
        .send({ quantity: 5 });
      expect(res.status).toBe(200);
    });

    it('error path — item not in cart => 404', async () => {
      prisma.cart.findUnique.mockResolvedValueOnce({ id: 'cart-001' });
      prisma.cartItem.findFirst.mockResolvedValueOnce(null);
      const res = await request(app)
        .put('/cart/items/prod-001')
        .send({ quantity: 5 });
      expect(res.status).toBe(404);
    });
  });

  // ── removeItem ────────────────────────────────────────────────────────────────

  describe('DELETE /cart/items/:productId', () => {
    it('happy path — removes item from cart', async () => {
      prisma.cart.findUnique.mockResolvedValueOnce({ id: 'cart-001' });
      prisma.cartItem.findFirst.mockResolvedValueOnce({ id: 'ci-001', cartId: 'cart-001' });
      prisma.cartItem.delete.mockResolvedValueOnce({});

      const res = await request(app).delete('/cart/items/prod-001');
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/removed/i);
    });

    it('auth guard — no cart => 404', async () => {
      prisma.cart.findUnique.mockResolvedValueOnce(null);
      const res = await request(app).delete('/cart/items/prod-001');
      expect(res.status).toBe(404);
    });
  });

  // ── clearCart ─────────────────────────────────────────────────────────────────

  describe('DELETE /cart', () => {
    it('happy path — clears all items', async () => {
      prisma.cart.findUnique.mockResolvedValueOnce({
        id: 'cart-001',
        cartItems: [{ id: 'ci-001' }],
      });
      prisma.cartItem.deleteMany.mockResolvedValueOnce({ count: 1 });

      const res = await request(app).delete('/cart');
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/cleared/i);
    });
  });
});
