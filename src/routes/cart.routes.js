const router = require('express').Router();
const cartController = require('../controllers/cart.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { validate, cartSchemas } = require('../middleware/validation.middleware');

router.use(authenticate, authorize('BUYER'));

router.get('/', cartController.getCart);
router.post('/items', validate(cartSchemas.addItem), cartController.addItem);
router.put('/items/:productId', validate(cartSchemas.updateItem), cartController.updateItem);
router.delete('/items/:productId', cartController.removeItem);
router.delete('/', cartController.clearCart);

module.exports = router;
