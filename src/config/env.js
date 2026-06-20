require('dotenv').config();

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT) || 5000,

  DATABASE_URL: process.env.DATABASE_URL,

  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '30d',

  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,

  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',

  // GCash merchant number shown on QR instructions (optional)
  GCASH_MERCHANT_NUMBER: process.env.GCASH_MERCHANT_NUMBER || '',
  GCASH_MERCHANT_NAME: process.env.GCASH_MERCHANT_NAME || 'Rosewood Marketplace',

  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  VAPID_EMAIL: process.env.VAPID_EMAIL || 'mailto:admin@rosewoodmarketplace.com',

  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
};

const required = ['DATABASE_URL', 'JWT_SECRET'];
for (const key of required) {
  if (!env[key]) throw new Error(`Missing required environment variable: ${key}`);
}

module.exports = env;
