const authService = require('../services/auth.service');
const { success, created, error } = require('../utils/response');

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

const login = async (req, res, next) => {
  try {
    const result = await authService.login(req.body);
    return success(res, result, 'Login successful');
  } catch (err) {
    next(err);
  }
};

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

const me = async (req, res) => {
  return success(res, req.user);
};

module.exports = { register, login, refresh, me };
