const router = require('express').Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate, authSchemas } = require('../middleware/validation.middleware');
const { upload } = require('../services/cloudinary.service');

router.post('/register', upload.document('proofDocument'), validate(authSchemas.register), authController.register);
router.post('/login', validate(authSchemas.login), authController.login);
router.post('/refresh', authController.refresh);
router.get('/me', authenticate, authController.me);

module.exports = router;
