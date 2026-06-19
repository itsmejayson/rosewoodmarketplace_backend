const router = require('express').Router();
const storeController = require('../controllers/store.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');

router.get('/', storeController.listStores);
router.put('/settings', authenticate, authorize('SELLER', 'ADMIN'), storeController.updateStoreSettings);
router.get('/:sellerId', storeController.getStore);

module.exports = router;
