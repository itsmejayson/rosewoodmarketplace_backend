const router = require('express').Router();
const productController = require('../controllers/product.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { validate, productSchemas } = require('../middleware/validation.middleware');
const { upload } = require('../services/cloudinary.service');

// Public routes
router.get('/', productController.listProducts);
router.get('/categories', productController.getCategories);
router.get('/seller/my-products', authenticate, authorize('SELLER', 'ADMIN'), productController.getSellerProducts);
router.get('/seller/stats', authenticate, authorize('SELLER', 'ADMIN'), productController.getSellerStats);
router.get('/seller/product/:id', authenticate, authorize('SELLER', 'ADMIN'), productController.getSellerProductById);
router.get('/:slug', productController.getProduct);

// Seller routes
router.use(authenticate);
router.post('/', authorize('SELLER', 'ADMIN'), validate(productSchemas.create), productController.createProduct);
router.put('/:id', authorize('SELLER', 'ADMIN'), productController.updateProduct);
router.delete('/:id', authorize('SELLER', 'ADMIN'), productController.deleteProduct);
router.post('/:id/images', authorize('SELLER', 'ADMIN'), upload.array('images', 5), productController.uploadProductImages);
router.delete('/:id/images/:imageId', authorize('SELLER', 'ADMIN'), productController.deleteProductImage);

module.exports = router;
