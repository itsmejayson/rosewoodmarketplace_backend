const router = require('express').Router();
const userController = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { upload } = require('../services/cloudinary.service');

router.use(authenticate);

router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);
router.post('/profile/image', upload.single('image'), userController.uploadProfileImage);
router.put('/change-password', userController.changePassword);

router.get('/admin/stats', authorize('ADMIN'), userController.getAdminStats);
router.get('/admin/online', authorize('ADMIN'), userController.getOnlineUsersAdmin);
router.get('/admin/pending-sellers', authorize('ADMIN'), userController.getPendingSellers);
router.patch('/admin/approve/:id', authorize('ADMIN'), userController.approveSeller);
router.get('/', authorize('ADMIN'), userController.listUsers);
router.post('/', authorize('ADMIN'), userController.createUser);
router.get('/:id', authorize('ADMIN'), userController.getUserDetail);
router.put('/:id', authorize('ADMIN'), userController.adminUpdateUser);
router.delete('/:id', authorize('ADMIN'), userController.deleteUser);
router.patch('/:id/toggle-active', authorize('ADMIN'), userController.toggleUserActive);

module.exports = router;
