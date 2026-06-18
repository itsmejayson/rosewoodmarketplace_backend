const stripe = require('../config/stripe');
const env = require('../config/env');
const { AppError } = require('../middleware/error.middleware');

const createCheckoutSession = async ({ order, cartItems, buyer }) => {
  const lineItems = cartItems.map((item) => ({
    price_data: {
      currency: 'usd',
      product_data: {
        name: item.product.name,
        description: item.product.description || undefined,
        images: item.product.images?.[0]?.url ? [item.product.images[0].url] : [],
      },
      unit_amount: Math.round(parseFloat(item.product.price) * 100),
    },
    quantity: item.quantity,
  }));

  // Add shipping fee line item if applicable
  if (parseFloat(order.shippingFee) > 0) {
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: { name: 'Shipping Fee' },
        unit_amount: Math.round(parseFloat(order.shippingFee) * 100),
      },
      quantity: 1,
    });
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: lineItems,
    mode: 'payment',
    customer_email: buyer.email,
    success_url: `${env.FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}`,
    cancel_url: `${env.FRONTEND_URL}/checkout/cancel?order_id=${order.id}`,
    metadata: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      buyerId: buyer.id,
    },
  });

  return session;
};

const constructWebhookEvent = (payload, sig) => {
  try {
    return stripe.webhooks.constructEvent(payload, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    throw new AppError(`Webhook signature verification failed: ${err.message}`, 400);
  }
};

const retrieveSession = async (sessionId) => {
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent'],
  });
};

const createRefund = async (paymentIntentId, amount) => {
  return stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount: amount ? Math.round(amount * 100) : undefined,
  });
};

module.exports = { createCheckoutSession, constructWebhookEvent, retrieveSession, createRefund };
