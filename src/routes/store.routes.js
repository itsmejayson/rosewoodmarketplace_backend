const router = require('express').Router();
const storeController = require('../controllers/store.controller');

router.get('/', storeController.listStores);
router.get('/:sellerId', storeController.getStore);

module.exports = router;
