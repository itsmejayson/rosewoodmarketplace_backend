const prisma = require('../config/db');
const settings = require('../config/settings');
const logger = require('../utils/logger');

// Keys that should be persisted to DB (survive server restarts)
const PERSISTENT_KEYS = ['appName', 'appTagline', 'brandColor', 'logoUrl', 'logoPublicId'];

async function loadFromDb() {
  try {
    const rows = await prisma.systemSetting.findMany();
    rows.forEach(({ key, value }) => {
      if (PERSISTENT_KEYS.includes(key)) {
        settings[key] = value === '' ? null : value;
      }
    });
    logger.info('System settings loaded from DB');
  } catch (err) {
    logger.warn('Could not load system settings from DB', { err: err.message });
  }
}

async function saveToDb(key, value) {
  if (!PERSISTENT_KEYS.includes(key)) return;
  try {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: String(value) },
      update: { value: String(value) },
    });
  } catch (err) {
    logger.warn('Could not persist setting to DB', { key, err: err.message });
  }
}

module.exports = { loadFromDb, saveToDb };
