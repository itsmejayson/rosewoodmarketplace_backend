const router = require('express').Router();
const prisma = require('../config/db');
const webpush = require('web-push');
const { authenticate } = require('../middleware/auth.middleware');
const { success } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');
const env = require('../config/env');

webpush.setVapidDetails(
  env.VAPID_EMAIL,
  env.VAPID_PUBLIC_KEY,
  env.VAPID_PRIVATE_KEY
);

// GET /api/push/vapid-key — return public key to frontend
router.get('/vapid-key', (req, res) => {
  res.json({ publicKey: env.VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe — save or update a push subscription
router.post('/subscribe', authenticate, async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) throw new AppError('Invalid subscription', 400);

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId: req.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      update: { userId: req.user.id, p256dh: keys.p256dh, auth: keys.auth },
    });

    return success(res, null, 'Subscribed');
  } catch (err) { next(err); }
});

// DELETE /api/push/unsubscribe — remove a push subscription
router.delete('/unsubscribe', authenticate, async (req, res, next) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) throw new AppError('Endpoint required', 400);
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.user.id } });
    return success(res, null, 'Unsubscribed');
  } catch (err) { next(err); }
});

module.exports = router;
