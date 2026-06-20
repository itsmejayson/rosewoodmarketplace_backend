const router = require('express').Router();
const { createReport, getMyReports } = require('../controllers/report.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { upload } = require('../services/cloudinary.service');

router.use(authenticate);

router.get('/my', getMyReports);
router.post('/', upload.single('screenshot'), createReport);

module.exports = router;
