const prisma = require('../config/db');
const { success } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');

function isSameOptions(a, b) {
  const noA = !a || (!a.variants?.length && !a.addons?.length);
  const noB = !b || (!b.variants?.length && !b.addons?.length);
  if (noA && noB) return true;
  if (noA !== noB) return false;
  const aVariants = (a.variants || []).map((v) => v.optionId).sort().join(',');
  const bVariants = (b.variants || []).map((v) => v.optionId).sort().join(',');
  if (aVariants !== bVariants) return false;
  const aAddons = (a.addons || []).map((x) => x.addonId).sort().join(',');
  const bAddons = (b.addons || []).map((x) => x.addonId).sort().join(',');
  return aAddons === bAddons;
}

const resolveUnitPrice = (productPrice, opts) => {
  if (!opts) return parseFloat(productPrice);
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
                seller: { select: { id: true, fullName: true, storeName: true } },
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
    const qty = quantity || 1;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new AppError('Product not found', 404);
    if (!product.isAvailable) throw new AppError('Product is not available', 400);
    // stockQty reflects live available inventory (already reduced by other carts)
    if (product.stockQty < qty) {
      throw new AppError(
        product.stockQty === 0 ? 'This product is out of stock' : `Only ${product.stockQty} units available`,
        400
      );
    }

    const cart = await prisma.cart.upsert({
      where: { buyerId: req.user.id },
      create: { buyerId: req.user.id },
      update: {},
    });

    const candidates = await prisma.cartItem.findMany({ where: { cartId: cart.id, productId } });
    const match = candidates.find((c) => isSameOptions(c.selectedOptions, selectedOptions));

    let cartItem;
    if (match) {
      cartItem = await prisma.cartItem.update({
        where: { id: match.id },
        data: { quantity: match.quantity + qty },
      });
    } else {
      cartItem = await prisma.cartItem.create({
        data: { cartId: cart.id, productId, quantity: qty, selectedOptions: selectedOptions ?? undefined },
      });
    }

    // Reserve stock immediately so other buyers see accurate availability
    await prisma.product.update({
      where: { id: productId },
      data: { stockQty: { decrement: qty } },
    });

    return success(res, cartItem, 'Item added to cart');
  } catch (err) { next(err); }
};

const updateItem = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { quantity, itemId } = req.body;

    const cart = await prisma.cart.findUnique({ where: { buyerId: req.user.id } });
    if (!cart) throw new AppError('Cart not found', 404);

    // Find the current cart item to compute quantity diff
    let currentItem;
    if (itemId) {
      currentItem = await prisma.cartItem.findUnique({ where: { id: itemId } });
    } else {
      currentItem = await prisma.cartItem.findFirst({
        where: { cartId: cart.id, productId },
        orderBy: { createdAt: 'desc' },
      });
    }
    if (!currentItem || currentItem.cartId !== cart.id) throw new AppError('Item not found in cart', 404);

    const diff = quantity - currentItem.quantity; // positive = need more stock, negative = releasing stock

    if (diff > 0) {
      // Increasing quantity — check available stock
      const product = await prisma.product.findUnique({ where: { id: productId } });
      if (product && product.stockQty < diff) {
        throw new AppError(
          product.stockQty === 0 ? 'No more stock available' : `Only ${product.stockQty} more units available`,
          400
        );
      }
    }

    const cartItem = await prisma.cartItem.update({
      where: { id: currentItem.id },
      data: { quantity },
    });

    // Adjust reserved stock by the diff
    if (diff !== 0) {
      await prisma.product.update({
        where: { id: productId },
        data: diff > 0
          ? { stockQty: { decrement: diff } }
          : { stockQty: { increment: Math.abs(diff) } },
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

    let item;
    if (itemId) {
      item = await prisma.cartItem.findUnique({ where: { id: itemId } });
      if (!item || item.cartId !== cart.id) throw new AppError('Item not found in cart', 404);
      await prisma.cartItem.delete({ where: { id: itemId } });
    } else {
      item = await prisma.cartItem.findFirst({
        where: { cartId: cart.id, productId },
        orderBy: { createdAt: 'desc' },
      });
      if (!item) throw new AppError('Item not found in cart', 404);
      await prisma.cartItem.delete({ where: { id: item.id } });
    }

    // Release reserved stock back to inventory
    await prisma.product.update({
      where: { id: item.productId },
      data: { stockQty: { increment: item.quantity } },
    });

    return success(res, null, 'Item removed from cart');
  } catch (err) { next(err); }
};

const clearCart = async (req, res, next) => {
  try {
    const cart = await prisma.cart.findUnique({
      where: { buyerId: req.user.id },
      include: { cartItems: true },
    });
    if (cart && cart.cartItems.length > 0) {
      // Release all reserved stock before clearing
      await Promise.all(
        cart.cartItems.map((item) =>
          prisma.product.update({
            where: { id: item.productId },
            data: { stockQty: { increment: item.quantity } },
          })
        )
      );
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    }
    return success(res, null, 'Cart cleared');
  } catch (err) { next(err); }
};

module.exports = { getCart, addItem, updateItem, removeItem, clearCart };
