const router = require('express').Router();
const txController = require('../controllers/transaction.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');

router.use(authenticate);

router.get('/admin/all', authorize('ADMIN'), txController.getAllTransactionsAdmin);
router.get('/buyer', authorize('BUYER'), txController.getBuyerTransactions);
router.get('/seller', authorize('SELLER', 'ADMIN'), txController.getSellerTransactions);
router.get('/seller/report', authorize('SELLER', 'ADMIN'), txController.getSellerSalesReport);
router.get('/:id', txController.getTransactionById);

module.exports = router;
