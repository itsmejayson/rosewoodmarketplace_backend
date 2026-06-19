const prisma = require('../config/db');
const { success } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');

// Resolve the correct unit price for a cart/order item.
// Priority:
//   1. opts.unitPrice  — stamped by the modal at add-to-cart time (most accurate)
//   2. sum of variant priceModifiers + addon prices  — for items added before unitPrice stamping;
//      works because single-select variant priceModifier = full price of that option
//   3. product.price  — plain product with no variants
const resolveUnitPrice = (productPrice, opts = {}) => {
  if (opts.unitPrice != null) return parseFloat(opts.unitPrice);
  const variants = opts.variants || [];
  const addons   = opts.addons   || [];
  if (variants.length > 0) {
    return variants.reduce((s, v) => s + (parseFloat(v.priceModifier) || 0), 0)
         + addons.reduce((s, a)   => s + (parseFloat(a.price)         || 0), 0);
  }
  return parseFloat(productPrice) + addons.reduce((s, a) => s + (parseFloat(a.price) || 0), 0);
};

const getCart = async (req, res, next) => {
  try {
    const cart = await prisma.cart.findUnique({
      where: { buyerId: req.user.id },
      include: {
        cartItems: {
          include: {
            product: {
              include: {
                images: { where: { isPrimary: true }, take: 1 },
                seller: { select: { id: true, fullName: true } },
              },
            },
          },
        },
      },
    });

    if (!cart) {
      return success(res, { cartItems: [], subtotal: 0, itemCount: 0 });
    }

    const subtotal = cart.cartItems.reduce((sum, item) => {
      const unitPrice = resolveUnitPrice(item.product.price, item.selectedOptions);
      return sum + unitPrice * item.quantity;
    }, 0);
    const itemCount = cart.cartItems.reduce((sum, item) => sum + item.quantity, 0);

    return success(res, { ...cart, subtotal, itemCount });
  } catch (err) { next(err); }
};

const addItem = async (req, res, next) => {
  try {
    const { productId, quantity, selectedOptions } = req.body;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new AppError('Product not found', 404);
    if (!product.isAvailable) throw new AppError('Product is not available', 400);
    if (product.stockQty < quantity) {
      throw new AppError(`Only ${product.stockQty} units available`, 400);
    }

    let cart = await prisma.cart.findUnique({
      where: { buyerId: req.user.id },
      include: { cartItems: { include: { product: { select: { sellerId: true } } }, take: 1 } },
    });
    if (!cart) {
      cart = await prisma.cart.create({ data: { buyerId: req.user.id } });
    } else if (cart.cartItems.length > 0) {
      const cartSellerId = cart.cartItems[0].product.sellerId;
      if (cartSellerId !== product.sellerId) {
        throw new AppError(
          'Your cart already has items from a different seller. Please clear your cart first before adding products from another seller.',
          400
        );
      }
    }

    const serialized = JSON.stringify(selectedOptions ?? null);
    const candidates = await prisma.cartItem.findMany({
      where: { cartId: cart.id, productId },
    });
    const match = candidates.find(
      (c) => JSON.stringify(c.selectedOptions ?? null) === serialized
    );
    let cartItem;
    if (match) {
      const newQty = match.quantity + (quantity || 1);
      if (product.stockQty < newQty) throw new AppError(`Only ${product.stockQty} units available`, 400);
      cartItem = await prisma.cartItem.update({
        where: { id: match.id },
        data: { quantity: newQty },
      });
    } else {
      if (product.stockQty < (quantity || 1)) throw new AppError(`Only ${product.stockQty} units available`, 400);
      cartItem = await prisma.cartItem.create({
        data: { cartId: cart.id, productId, quantity: quantity || 1, selectedOptions: selectedOptions ?? undefined },
      });
    }

    return success(res, cartItem, 'Item added to cart');
  } catch (err) { next(err); }
};

const updateItem = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { quantity, itemId } = req.body;

    const cart = await prisma.cart.findUnique({ where: { buyerId: req.user.id } });
    if (!cart) throw new AppError('Cart not found', 404);

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (product && product.stockQty < quantity) {
      throw new AppError(`Only ${product.stockQty} units available`, 400);
    }

    let cartItem;
    if (itemId) {
      cartItem = await prisma.cartItem.update({
        where: { id: itemId },
        data: { quantity },
      });
    } else {
      const item = await prisma.cartItem.findFirst({
        where: { cartId: cart.id, productId },
        orderBy: { createdAt: 'desc' },
      });
      if (!item) throw new AppError('Item not found in cart', 404);
      cartItem = await prisma.cartItem.update({
        where: { id: item.id },
        data: { quantity },
      });
    }

    return success(res, cartItem, 'Cart updated');
  } catch (err) { next(err); }
};

const removeItem = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { itemId } = req.body || {};
    const cart = await prisma.cart.findUnique({ where: { buyerId: req.user.id } });
    if (!cart) throw new AppError('Cart not found', 404);

    if (itemId) {
      // Delete by specific cart item id (supports multiple variants of same product)
      const item = await prisma.cartItem.findUnique({ where: { id: itemId } });
      if (!item || item.cartId !== cart.id) throw new AppError('Item not found in cart', 404);
      await prisma.cartItem.delete({ where: { id: itemId } });
    } else {
      // Delete the most recent item with this productId
      const item = await prisma.cartItem.findFirst({
        where: { cartId: cart.id, productId },
        orderBy: { createdAt: 'desc' },
      });
      if (!item) throw new AppError('Item not found in cart', 404);
      await prisma.cartItem.delete({ where: { id: item.id } });
    }

    return success(res, null, 'Item removed from cart');
  } catch (err) { next(err); }
};

const clearCart = async (req, res, next) => {
  try {
    const cart = await prisma.cart.findUnique({ where: { buyerId: req.user.id } });
    if (cart) {
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    }
    return success(res, null, 'Cart cleared');
  } catch (err) { next(err); }
};

module.exports = { getCart, addItem, updateItem, removeItem, clearCart };
