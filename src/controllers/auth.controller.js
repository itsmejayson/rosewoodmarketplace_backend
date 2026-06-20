const authService = require('../services/auth.service');
const { success, created, error } = require('../utils/response');

/**
 * POST /api/auth/register
 *
 * Delegates all registration logic (hashing, duplicate-email check, cart
 * creation for buyers, JWT minting) to authService.register.
 *
 * Accepts an optional file upload for seller proof-of-residency documents —
 * multer places the Cloudinary URL on req.file.path and the public ID on
 * req.file.filename, which are forwarded as metadata rather than stored in
 * the request body directly.
 */
const register = async (req, res, next) => {
  try {
    const result = await authService.register(req.body, {
      proofDocumentUrl: req.file?.path,
      proofDocumentPublicId: req.file?.filename,
    });
    return created(res, result, 'Registration successful');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/login
 *
 * Validates credentials and returns both an access token (short-lived, used
 * on every authenticated request) and a refresh token (longer-lived, stored
 * by the client to obtain new access tokens without re-entering credentials).
 */
const login = async (req, res, next) => {
  try {
    const result = await authService.login(req.body);
    return success(res, result, 'Login successful');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/refresh
 *
 * Issues a new access token from a valid refresh token.
 *
 * The refresh token is sent in the request body (not in the Authorization
 * header) so it can be a longer-lived opaque token stored in localStorage
 * or a cookie by the client, separate from the bearer access token.
 *
 * Returns 400 immediately if the refresh token is missing — this is a client
 * programming error and doesn't need to propagate to the error middleware.
 */
const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return error(res, 'Refresh token required', 400);
    const result = await authService.refreshAccessToken(refreshToken);
    return success(res, result);
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/auth/me
 *
 * Returns the currently authenticated user from req.user.
 *
 * req.user is populated by the authenticate middleware, which verifies the
 * JWT and fetches the user from the DB on every protected request — so this
 * handler is intentionally trivial: it just serialises what the middleware
 * already resolved.
 */
const me = async (req, res) => {
  return success(res, req.user);
};

module.exports = { register, login, refresh, me };
