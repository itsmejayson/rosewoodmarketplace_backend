require('dotenv').config();
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { Readable } = require('stream');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Use memory storage — we upload the buffer directly to Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

// Upload a single buffer to Cloudinary and return { url, public_id }
const uploadBuffer = (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'rosewood-marketplace',
        transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto' }],
        ...options,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({ url: result.secure_url, public_id: result.public_id });
      }
    );
    Readable.from(buffer).pipe(stream);
  });
};

// Express middleware: upload file(s) to Cloudinary after multer puts them in memory
// Attaches { path, filename } to each req.file / req.files entry so existing
// controllers keep working without changes.
const uploadToCloudinary = (field, many = false) => {
  const multerMiddleware = many ? upload.array(field, 5) : upload.single(field);

  return async (req, res, next) => {
    multerMiddleware(req, res, async (err) => {
      if (err) return next(err);

      try {
        if (many) {
          if (!req.files || req.files.length === 0) return next();
          const results = await Promise.all(
            req.files.map((f) => uploadBuffer(f.buffer, { resource_type: 'image' }))
          );
          // Patch each file object so controllers can read file.path and file.filename
          req.files = req.files.map((f, i) => ({
            ...f,
            path: results[i].url,
            filename: results[i].public_id,
          }));
        } else {
          if (!req.file) return next();
          const result = await uploadBuffer(req.file.buffer, { resource_type: 'image' });
          req.file.path = result.url;
          req.file.filename = result.public_id;
        }
        next();
      } catch (uploadErr) {
        next(uploadErr);
      }
    });
  };
};

const deleteImage = (publicId) => cloudinary.uploader.destroy(publicId);

module.exports = {
  // Convenience pre-built middlewares used in routes
  upload: {
    single: (field) => uploadToCloudinary(field, false),
    array: (field, _max) => uploadToCloudinary(field, true),
  },
  uploadBuffer,
  deleteImage,
  cloudinary,
};
