const nodemailer = require('nodemailer');

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return null; // Email not configured — skip silently
  }

  transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,  // your Brevo account email
      pass: process.env.EMAIL_PASS,  // Brevo SMTP key
    },
  });

  return transporter;
};

const FROM = process.env.EMAIL_FROM || `Rosewood Marketplace <${process.env.EMAIL_USER}>`;

// ── HTML wrapper ──────────────────────────────────────────────────────────────

const wrap = (title, bodyHtml) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#8B2E2E;padding:24px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">
              🏪 Rosewood Marketplace
            </h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            ${bodyHtml}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f9f9f9;padding:16px 32px;border-top:1px solid #eeeeee;">
            <p style="margin:0;font-size:12px;color:#999999;text-align:center;">
              This is an automated message from Rosewood Marketplace. Please do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const btn = (text, href, color = '#8B2E2E') =>
  `<a href="${href}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:14px;">${text}</a>`;

const send = async ({ to, subject, html }) => {
  const t = getTransporter();
  if (!t) return; // silently skip if not configured
  try {
    await t.sendMail({ from: FROM, to, subject, html });
  } catch (err) {
    console.error('[email] Failed to send to', to, err.message);
  }
};

// ── Templates ─────────────────────────────────────────────────────────────────

/**
 * Notify admin(s) that a new seller has registered and needs approval.
 */
const sendNewSellerNotification = async ({ adminEmails, sellerName, sellerEmail, storeName, approveUrl }) => {
  const html = wrap('New Seller Registration', `
    <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:20px;">New Seller Needs Approval</h2>
    <p style="color:#555;line-height:1.6;">A new seller has registered on Rosewood Marketplace and is waiting for your review.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f9f9;border-radius:6px;padding:16px;margin:16px 0;">
      <tr><td style="padding:6px 0;font-size:14px;color:#555;">
        <strong>Name:</strong> ${sellerName}
      </td></tr>
      <tr><td style="padding:6px 0;font-size:14px;color:#555;">
        <strong>Email:</strong> ${sellerEmail}
      </td></tr>
      <tr><td style="padding:6px 0;font-size:14px;color:#555;">
        <strong>Store Name:</strong> ${storeName || '—'}
      </td></tr>
    </table>

    <p style="color:#555;line-height:1.6;">Log in to the admin panel to approve or reject this application.</p>
    <p style="margin-top:24px;">
      ${btn('Review Application', approveUrl || 'http://localhost:5173/admin/pending-sellers')}
    </p>
  `);

  for (const email of adminEmails) {
    await send({ to: email, subject: `[Rosewood] New Seller Registration — ${sellerName}`, html });
  }
};

/**
 * Notify the seller that their account has been approved.
 */
const sendSellerApproved = async ({ sellerEmail, sellerName, loginUrl }) => {
  const html = wrap('Account Approved', `
    <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:20px;">Your Account Has Been Approved!</h2>
    <p style="color:#555;line-height:1.6;">Hi <strong>${sellerName}</strong>,</p>
    <p style="color:#555;line-height:1.6;">
      Great news! Your seller account on <strong>Rosewood Marketplace</strong> has been reviewed and approved.
      You can now log in and start listing your products.
    </p>
    <p style="margin-top:24px;">
      ${btn('Log In Now', loginUrl || 'http://localhost:5173/login')}
    </p>
    <p style="color:#888;font-size:13px;margin-top:24px;">
      If you have any questions, feel free to contact our support team.
    </p>
  `);

  await send({ to: sellerEmail, subject: '[Rosewood] Your seller account has been approved!', html });
};

/**
 * Notify the seller that their account was rejected.
 */
const sendSellerRejected = async ({ sellerEmail, sellerName }) => {
  const html = wrap('Account Application Update', `
    <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:20px;">Application Not Approved</h2>
    <p style="color:#555;line-height:1.6;">Hi <strong>${sellerName}</strong>,</p>
    <p style="color:#555;line-height:1.6;">
      Thank you for your interest in selling on Rosewood Marketplace. After reviewing your application,
      we were unable to approve your seller account at this time.
    </p>
    <p style="color:#555;line-height:1.6;">
      If you believe this was a mistake or would like more information, please contact our support team.
    </p>
  `);

  await send({ to: sellerEmail, subject: '[Rosewood] Update on your seller application', html });
};

/**
 * Notify the seller that a new order has been placed on their store.
 */
const sendNewOrderToSeller = async ({ sellerEmail, sellerName, orderNumber, buyerName, items, totalAmount, ordersUrl }) => {
  const itemRows = items.map((item) =>
    `<tr>
      <td style="padding:8px 0;font-size:14px;color:#333;border-bottom:1px solid #eee;">${item.name}</td>
      <td style="padding:8px 0;font-size:14px;color:#333;border-bottom:1px solid #eee;text-align:center;">${item.quantity}</td>
      <td style="padding:8px 0;font-size:14px;color:#333;border-bottom:1px solid #eee;text-align:right;">₱${parseFloat(item.totalPrice).toFixed(2)}</td>
    </tr>`
  ).join('');

  const html = wrap('New Order Received', `
    <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:20px;">You Have a New Order!</h2>
    <p style="color:#555;line-height:1.6;">Hi <strong>${sellerName}</strong>,</p>
    <p style="color:#555;line-height:1.6;">
      A new order <strong>#${orderNumber}</strong> has been placed by <strong>${buyerName}</strong>.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
      <tr>
        <th style="text-align:left;font-size:13px;color:#888;padding-bottom:8px;border-bottom:2px solid #eee;">Product</th>
        <th style="text-align:center;font-size:13px;color:#888;padding-bottom:8px;border-bottom:2px solid #eee;">Qty</th>
        <th style="text-align:right;font-size:13px;color:#888;padding-bottom:8px;border-bottom:2px solid #eee;">Amount</th>
      </tr>
      ${itemRows}
      <tr>
        <td colspan="2" style="padding:10px 0 0;font-weight:700;font-size:14px;">Total</td>
        <td style="padding:10px 0 0;font-weight:700;font-size:14px;text-align:right;color:#8B2E2E;">₱${parseFloat(totalAmount).toFixed(2)}</td>
      </tr>
    </table>

    <p style="margin-top:24px;">
      ${btn('View Order', ordersUrl || 'http://localhost:5173/seller/orders')}
    </p>
  `);

  await send({ to: sellerEmail, subject: `[Rosewood] New Order #${orderNumber} from ${buyerName}`, html });
};

/**
 * Notify the buyer that their order was placed successfully.
 */
const sendOrderConfirmationToBuyer = async ({ buyerEmail, buyerName, orderNumber, items, totalAmount, ordersUrl }) => {
  const itemRows = items.map((item) =>
    `<tr>
      <td style="padding:8px 0;font-size:14px;color:#333;border-bottom:1px solid #eee;">${item.name}</td>
      <td style="padding:8px 0;font-size:14px;color:#333;border-bottom:1px solid #eee;text-align:center;">${item.quantity}</td>
      <td style="padding:8px 0;font-size:14px;color:#333;border-bottom:1px solid #eee;text-align:right;">₱${parseFloat(item.totalPrice).toFixed(2)}</td>
    </tr>`
  ).join('');

  const html = wrap('Order Confirmation', `
    <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:20px;">Order Confirmed!</h2>
    <p style="color:#555;line-height:1.6;">Hi <strong>${buyerName}</strong>,</p>
    <p style="color:#555;line-height:1.6;">
      Thank you for your order! We have received your order <strong>#${orderNumber}</strong>
      and the seller will be processing it shortly.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
      <tr>
        <th style="text-align:left;font-size:13px;color:#888;padding-bottom:8px;border-bottom:2px solid #eee;">Product</th>
        <th style="text-align:center;font-size:13px;color:#888;padding-bottom:8px;border-bottom:2px solid #eee;">Qty</th>
        <th style="text-align:right;font-size:13px;color:#888;padding-bottom:8px;border-bottom:2px solid #eee;">Amount</th>
      </tr>
      ${itemRows}
      <tr>
        <td colspan="2" style="padding:10px 0 0;font-weight:700;font-size:14px;">Total</td>
        <td style="padding:10px 0 0;font-weight:700;font-size:14px;text-align:right;color:#8B2E2E;">₱${parseFloat(totalAmount).toFixed(2)}</td>
      </tr>
    </table>

    <p style="margin-top:24px;">
      ${btn('Track Your Order', ordersUrl || 'http://localhost:5173/orders')}
    </p>
  `);

  await send({ to: buyerEmail, subject: `[Rosewood] Order Confirmed — #${orderNumber}`, html });
};

module.exports = {
  sendNewSellerNotification,
  sendSellerApproved,
  sendSellerRejected,
  sendNewOrderToSeller,
  sendOrderConfirmationToBuyer,
};
