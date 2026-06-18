const router = require('express').Router();
const messageController = require('../controllers/message.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { upload } = require('../services/cloudinary.service');

router.use(authenticate);

router.get('/unread-count', messageController.getUnreadCount);
router.get('/:transactionId', messageController.getMessages);
router.post('/:transactionId', upload.single('image'), messageController.sendMessage);

module.exports = router;
