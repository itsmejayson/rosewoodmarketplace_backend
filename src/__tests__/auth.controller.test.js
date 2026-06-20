'use strict';

/**
 * Tests for controllers/auth.controller.js
 *
 * Strategy: mount just the auth routes on a mini Express app so we get real
 * HTTP-level behaviour (status codes, JSON shape) without touching a real DB.
 * Prisma is mocked at the module level; authService is also mocked so we can
 * control resolve/reject behaviour per test.
 */

const request = require('supertest');
const express = require('express');

// ── Mock heavy modules before any require of controllers ──────────────────────
jest.mock('../config/db', () => ({
  user: { findUnique: jest.fn() },
}));

jest.mock('../services/auth.service', () => ({
  register: jest.fn(),
  login: jest.fn(),
  refreshAccessToken: jest.fn(),
}));

const authService = require('../services/auth.service');
const authController = require('../controllers/auth.controller');

// ── Minimal app fixture ───────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());

  // Simulate a pre-authenticated user for the /me route
  app.get('/me', (req, _res, next) => {
    req.user = { id: 'usr-001', email: 'buyer@test.com', role: 'BUYER' };
    next();
  }, authController.me);

  app.post('/register', authController.register);
  app.post('/login', authController.login);
  app.post('/refresh', authController.refresh);

  // Generic error handler so AppErrors turn into JSON responses
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  });

  return app;
}

describe('Auth Controller', () => {
  let app;

  beforeAll(() => { app = buildApp(); });

  // ── register ────────────────────────────────────────────────────────────────

  describe('POST /register', () => {
    const validBody = {
      fullName: 'Jane Buyer',
      email: 'jane@example.com',
      password: 'Secret123!',
      role: 'BUYER',
      phone: '09171234567',
    };

    it('happy path — returns 201 with user data', async () => {
      authService.register.mockResolvedValueOnce({
        user: { id: 'usr-abc123', email: 'jane@example.com', role: 'BUYER' },
        accessToken: 'tok.access',
        refreshToken: 'tok.refresh',
      });

      const res = await request(app).post('/register').send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBe('tok.access');
    });

    it('error path — service throws AppError => forwards to error handler', async () => {
      const err = new Error('Email already registered');
      err.statusCode = 409;
      authService.register.mockRejectedValueOnce(err);

      const res = await request(app).post('/register').send(validBody);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already registered/i);
    });
  });

  // ── login ───────────────────────────────────────────────────────────────────

  describe('POST /login', () => {
    it('happy path — returns 200 with tokens', async () => {
      authService.login.mockResolvedValueOnce({
        user: { id: 'usr-abc123', role: 'BUYER' },
        accessToken: 'tok.access',
        refreshToken: 'tok.refresh',
      });

      const res = await request(app)
        .post('/login')
        .send({ email: 'jane@example.com', password: 'Secret123!' });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
    });

    it('error path — invalid credentials => 401', async () => {
      const err = new Error('Invalid credentials');
      err.statusCode = 401;
      authService.login.mockRejectedValueOnce(err);

      const res = await request(app)
        .post('/login')
        .send({ email: 'wrong@example.com', password: 'bad' });

      expect(res.status).toBe(401);
    });
  });

  // ── refresh ──────────────────────────────────────────────────────────────────

  describe('POST /refresh', () => {
    it('happy path — returns 200 with new access token', async () => {
      authService.refreshAccessToken.mockResolvedValueOnce({
        accessToken: 'new.tok',
      });

      const res = await request(app)
        .post('/refresh')
        .send({ refreshToken: 'valid.refresh.token' });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBe('new.tok');
    });

    it('validation path — missing refreshToken => 400', async () => {
      const res = await request(app).post('/refresh').send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/refresh token required/i);
    });
  });

  // ── me ───────────────────────────────────────────────────────────────────────

  describe('GET /me', () => {
    it('returns the current user from req.user', async () => {
      const res = await request(app).get('/me');
      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('buyer@test.com');
    });
  });
});
