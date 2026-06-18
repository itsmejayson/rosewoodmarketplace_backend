const router = require('express').Router();
const notifController = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/', notifController.getNotifications);
router.put('/read-all', notifController.markAllRead);
router.put('/:id/read', notifController.markRead);
router.delete('/:id', notifController.deleteNotification);

module.exports = router;
