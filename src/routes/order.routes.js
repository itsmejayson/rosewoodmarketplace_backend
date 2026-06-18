const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { upload } = require('../services/cloudinary.service');

router.use(authenticate);

// Buyer
router.post('/checkout', authorize('BUYER'), orderController.checkout);
router.get('/my-orders', authorize('BUYER'), orderController.getBuyerOrders);
router.get('/my-orders/:id', authorize('BUYER'), orderController.getBuyerOrderDetail);
router.post('/:orderId/receipt', authorize('BUYER'), upload.single('receipt'), orderController.submitGcashReceipt);
router.post('/:id/cancel', orderController.cancelOrder);
router.post('/:id/pay-delivery-fee', authorize('BUYER'), orderController.payDeliveryFee);

// Seller
router.get('/seller-orders', authorize('SELLER', 'ADMIN'), orderController.getSellerOrders);
router.get('/seller-orders/:id', authorize('SELLER', 'ADMIN'), orderController.getSellerOrderDetail);
router.post('/:id/confirm', authorize('SELLER', 'ADMIN'), orderController.confirmOrder);
router.post('/:orderId/approve-payment', authorize('SELLER', 'ADMIN'), orderController.approvePayment);
router.post('/:orderId/confirm-cash', authorize('SELLER', 'ADMIN'), orderController.confirmCashPayment);
router.patch('/:id/status', authorize('SELLER', 'ADMIN'), orderController.updateOrderStatus);
router.post('/:id/delivery-fee', authorize('SELLER', 'ADMIN'), orderController.setDeliveryFee);

module.exports = router;
