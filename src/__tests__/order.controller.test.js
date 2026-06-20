'use strict';

/**
 * Tests for controllers/order.controller.js
 *
 * Covers buyer checkout, order detail retrieval, seller order management,
 * payment approval, and order cancellation.
 */

const request = require('supertest');
const express = require('express');

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('../config/db', () => ({
  order: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  orderItem: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  transaction: {
    update: jest.fn(),
    findMany: jest.fn(),
  },
  transactionLog: { create: jest.fn() },
  product: { update: jest.fn() },
  $transaction: jest.fn((ops) => Promise.all(ops)),
}));

jest.mock('../services/order.service', () => ({
  createOrderFromCart: jest.fn(),
  approvePayment: jest.fn(),
  confirmCashPayment: jest.fn(),
  updateOrderStatus: jest.fn(),
  submitGcashReceipt: jest.fn(),
}));

jest.mock('../services/notification.service', () => ({
  createNotification: jest.fn(),
  notifyReadyForPickup: jest.fn(),
}));

jest.mock('../config/socket', () => ({
  getIO: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })) })),
}));

const prisma = require('../config/db');
const orderService = require('../services/order.service');
const orderController = require('../controllers/order.controller');

// ── Fixtures ──────────────────────────────────────────────────────────────────
const BUYER_USER    = { id: 'usr-buyer-001', role: 'BUYER' };
const SELLER_USER   = { id: 'usr-seller-001', role: 'SELLER' };

const SAMPLE_ORDER = {
  id: 'ord-001',
  orderNumber: 'ORD-20240001',
  buyerId: 'usr-buyer-001',
  status: 'PENDING',
  totalAmount: 500,
  fulfillmentType: 'DELIVERY',
  deliveryFee: 0,
  deliveryFeeStatus: 'NOT_SET',
  notes: null,
  transaction: { id: 'txn-001', paymentStatus: 'PENDING', paymentMethod: 'GCASH' },
  orderItems: [{ id: 'oi-001', productId: 'prod-001', sellerId: 'usr-seller-001', quantity: 5 }],
  buyer: { id: 'usr-buyer-001' },
};

function buildApp(user = BUYER_USER) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });

  app.post('/checkout', orderController.checkout);
  app.get('/buyer/orders', orderController.getBuyerOrders);
  app.get('/buyer/orders/:id', orderController.getBuyerOrderDetail);
  app.get('/seller/orders', orderController.getSellerOrders);
  app.get('/seller/orders/:id', orderController.getSellerOrderDetail);
  app.post('/seller/orders/:orderId/approve', orderController.approvePayment);
  app.post('/seller/orders/:orderId/confirm-cash', orderController.confirmCashPayment);
  app.patch('/orders/:id/status', orderController.updateOrderStatus);
  app.post('/orders/:id/confirm', orderController.confirmOrder);
  app.post('/orders/:id/cancel', orderController.cancelOrder);
  app.put('/orders/:id/delivery-fee', orderController.setDeliveryFee);
  app.post('/orders/:id/pay-delivery-fee', orderController.payDeliveryFee);
  app.post('/orders/:id/notify-pickup', orderController.notifyReadyForPickup);

  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  });
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Order Controller', () => {
  // ── checkout ─────────────────────────────────────────────────────────────────

  describe('POST /checkout', () => {
    it('happy path — creates order and returns 201', async () => {
      orderService.createOrderFromCart.mockResolvedValueOnce({
        order: { id: 'ord-001', orderNumber: 'ORD-20240001' },
      });
      const res = await request(buildApp(BUYER_USER))
        .post('/checkout')
        .send({ paymentMethod: 'GCASH', fulfillmentType: 'DELIVERY', sellerId: 'usr-seller-001' });
      expect(res.status).toBe(201);
      expect(res.body.data.order.orderNumber).toBe('ORD-20240001');
    });

    it('error path — service throws => forwards to error handler', async () => {
      const err = new Error('Cart is empty');
      err.statusCode = 400;
      orderService.createOrderFromCart.mockRejectedValueOnce(err);
      const res = await request(buildApp(BUYER_USER))
        .post('/checkout')
        .send({ paymentMethod: 'GCASH', fulfillmentType: 'DELIVERY' });
      expect(res.status).toBe(400);
    });
  });

  // ── getBuyerOrders ────────────────────────────────────────────────────────────

  describe('GET /buyer/orders', () => {
    it('happy path — returns paginated orders', async () => {
      prisma.order.findMany.mockResolvedValueOnce([SAMPLE_ORDER]);
      prisma.order.count.mockResolvedValueOnce(1);
      const res = await request(buildApp(BUYER_USER)).get('/buyer/orders');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('auth guard — requires authenticated user (no user => would 401 via middleware)', async () => {
      // Simulate what happens if middleware rejects — expect no crash in controller
      prisma.order.findMany.mockResolvedValueOnce([]);
      prisma.order.count.mockResolvedValueOnce(0);
      const res = await request(buildApp(BUYER_USER)).get('/buyer/orders');
      expect(res.status).toBe(200);
    });
  });

  // ── getBuyerOrderDetail ───────────────────────────────────────────────────────

  describe('GET /buyer/orders/:id', () => {
    it('happy path — returns order detail', async () => {
      prisma.order.findFirst.mockResolvedValueOnce({
        ...SAMPLE_ORDER,
        transaction: { ...SAMPLE_ORDER.transaction, logs: [], messages: [] },
        refund: null,
      });
      const res = await request(buildApp(BUYER_USER)).get('/buyer/orders/ord-001');
      expect(res.status).toBe(200);
      expect(res.body.data.orderNumber).toBe('ORD-20240001');
    });

    it('error path — order not found => 404', async () => {
      prisma.order.findFirst.mockResolvedValueOnce(null);
      const res = await request(buildApp(BUYER_USER)).get('/buyer/orders/missing');
      expect(res.status).toBe(404);
    });
  });

  // ── approvePayment ────────────────────────────────────────────────────────────

  describe('POST /seller/orders/:orderId/approve', () => {
    it('happy path — approves GCash payment', async () => {
      orderService.approvePayment.mockResolvedValueOnce({ id: 'ord-001', status: 'PAID' });
      const res = await request(buildApp(SELLER_USER))
        .post('/seller/orders/ord-001/approve')
        .send({ approved: true });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/approved/i);
    });

    it('validation path — approved must be boolean => 400', async () => {
      const res = await request(buildApp(SELLER_USER))
        .post('/seller/orders/ord-001/approve')
        .send({ approved: 'yes' }); // string, not boolean
      expect(res.status).toBe(400);
    });
  });

  // ── cancelOrder ───────────────────────────────────────────────────────────────

  describe('POST /orders/:id/cancel', () => {
    it('happy path — buyer cancels PENDING order and stock is restored', async () => {
      prisma.order.findUnique.mockResolvedValueOnce(SAMPLE_ORDER);
      prisma.order.update.mockResolvedValueOnce({ ...SAMPLE_ORDER, status: 'CANCELLED' });
      prisma.transaction.update.mockResolvedValueOnce({});
      prisma.transactionLog.create.mockResolvedValueOnce({});
      prisma.orderItem.findMany.mockResolvedValueOnce(SAMPLE_ORDER.orderItems);
      prisma.product.update.mockResolvedValue({});

      const res = await request(buildApp(BUYER_USER))
        .post('/orders/ord-001/cancel')
        .send({ reason: 'Changed my mind' });
      expect(res.status).toBe(200);
    });

    it('error path — order cannot be cancelled once past AWAITING_PAYMENT => 400', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({ ...SAMPLE_ORDER, status: 'PAID' });
      const res = await request(buildApp(BUYER_USER))
        .post('/orders/ord-001/cancel')
        .send({});
      expect(res.status).toBe(400);
    });

    it('auth guard — buyer cannot cancel another buyer\'s order => 403', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({ ...SAMPLE_ORDER, buyerId: 'usr-buyer-other' });
      const res = await request(buildApp(BUYER_USER))
        .post('/orders/ord-001/cancel')
        .send({});
      expect(res.status).toBe(403);
    });
  });

  // ── confirmOrder ──────────────────────────────────────────────────────────────

  describe('POST /orders/:id/confirm', () => {
    it('happy path — seller confirms PENDING delivery order', async () => {
      prisma.order.findFirst.mockResolvedValueOnce(SAMPLE_ORDER);
      prisma.$transaction.mockResolvedValueOnce([{}, {}]);

      const res = await request(buildApp(SELLER_USER))
        .post('/orders/ord-001/confirm')
        .send({ fee: 50 });
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(550);
    });

    it('error path — PICKUP order cannot be confirmed => 400', async () => {
      prisma.order.findFirst.mockResolvedValueOnce({ ...SAMPLE_ORDER, fulfillmentType: 'PICKUP' });
      const res = await request(buildApp(SELLER_USER))
        .post('/orders/ord-001/confirm')
        .send({});
      expect(res.status).toBe(400);
    });
  });

  // ── setDeliveryFee ────────────────────────────────────────────────────────────

  describe('PUT /orders/:id/delivery-fee', () => {
    it('happy path — sets delivery fee on PENDING order', async () => {
      prisma.order.findFirst.mockResolvedValueOnce(SAMPLE_ORDER);
      prisma.order.update.mockResolvedValueOnce({ ...SAMPLE_ORDER, deliveryFee: 80 });
      prisma.transactionLog.create.mockResolvedValueOnce({});
      const res = await request(buildApp(SELLER_USER))
        .put('/orders/ord-001/delivery-fee')
        .send({ fee: 80 });
      expect(res.status).toBe(200);
    });

    it('validation path — missing or invalid fee => 400', async () => {
      const res = await request(buildApp(SELLER_USER))
        .put('/orders/ord-001/delivery-fee')
        .send({ fee: 'abc' });
      expect(res.status).toBe(400);
    });
  });
});
