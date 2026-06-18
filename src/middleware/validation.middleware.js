const { z } = require('zod');
const { error } = require('../utils/response');

const validate = (schema) => (req, res, next) => {
  try {
    schema.parse({ body: req.body, query: req.query, params: req.params });
    next();
  } catch (err) {
    if (err instanceof z.ZodError) {
      const errors = err.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return error(res, 'Validation failed', 422, errors);
    }
    next(err);
  }
};

// ── Validation Schemas ────────────────────────────────────────────────────────

const authSchemas = {
  register: z.object({
    body: z.object({
      fullName: z.string().min(2).max(100),
      email: z.string().email(),
      password: z.string().min(8).max(100),
      phone: z.string().optional(),
      role: z.enum(['BUYER', 'SELLER']).optional(),
    }),
  }),
  login: z.object({
    body: z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }),
  }),
};

const productSchemas = {
  create: z.object({
    body: z.object({
      name: z.string().min(2).max(200),
      description: z.string().optional(),
      price: z.coerce.number().positive(),
      stockQty: z.coerce.number().int().min(0),
      productType: z.enum(['FOOD', 'MATERIAL']),
      categoryId: z.string().uuid(),
      isAvailable: z.coerce.boolean().optional(),
      expirationDate: z.string().optional().refine(v => !v || !isNaN(Date.parse(v)), { message: 'Invalid date' }),
      storageInstructions: z.string().optional(),
      isPerishable: z.coerce.boolean().optional(),
      materialType: z.string().optional(),
      unit: z.string().optional(),
    }),
  }),
};

const cartSchemas = {
  addItem: z.object({
    body: z.object({
      productId: z.string().uuid(),
      quantity: z.coerce.number().int().positive(),
    }),
  }),
  updateItem: z.object({
    body: z.object({
      quantity: z.coerce.number().int().positive(),
    }),
    params: z.object({ productId: z.string().uuid() }),
  }),
};

const orderSchemas = {
  checkout: z.object({
    body: z.object({
      shippingName: z.string().min(2),
      shippingPhone: z.string().min(7),
      shippingAddress: z.string().min(5),
      shippingCity: z.string().min(2),
      shippingState: z.string().min(2),
      shippingZip: z.string().min(3),
      shippingCountry: z.string().min(2),
      notes: z.string().optional(),
    }),
  }),
};

module.exports = { validate, authSchemas, productSchemas, cartSchemas, orderSchemas };
