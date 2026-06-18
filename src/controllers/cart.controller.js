const prisma = require('../config/db');
const { success } = require('../utils/response');
const { AppError } = require('../middleware/error.middleware');

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

    const subtotal = cart.cartItems.reduce(
      (sum, item) => sum + parseFloat(item.product.price) * item.quantity,
      0
    );
    const itemCount = cart.cartItems.reduce((sum, item) => sum + item.quantity, 0);

    return success(res, { ...cart, subtotal, itemCount });
  } catch (err) { next(err); }
};

const addItem = async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;

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

    const existing = await prisma.cartItem.findUnique({
      where: { cartId_productId: { cartId: cart.id, productId } },
    });

    let cartItem;
    if (existing) {
      const newQty = existing.quantity + quantity;
      if (product.stockQty < newQty) throw new AppError(`Only ${product.stockQty} units available`, 400);
      cartItem = await prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: newQty },
      });
    } else {
      cartItem = await prisma.cartItem.create({
        data: { cartId: cart.id, productId, quantity },
      });
    }

    return success(res, cartItem, 'Item added to cart');
  } catch (err) { next(err); }
};

const updateItem = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { quantity } = req.body;

    const cart = await prisma.cart.findUnique({ where: { buyerId: req.user.id } });
    if (!cart) throw new AppError('Cart not found', 404);

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (product.stockQty < quantity) {
      throw new AppError(`Only ${product.stockQty} units available`, 400);
    }

    const cartItem = await prisma.cartItem.update({
      where: { cartId_productId: { cartId: cart.id, productId } },
      data: { quantity },
    });

    return success(res, cartItem, 'Cart updated');
  } catch (err) { next(err); }
};

const removeItem = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const cart = await prisma.cart.findUnique({ where: { buyerId: req.user.id } });
    if (!cart) throw new AppError('Cart not found', 404);

    await prisma.cartItem.delete({
      where: { cartId_productId: { cartId: cart.id, productId } },
    });

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
