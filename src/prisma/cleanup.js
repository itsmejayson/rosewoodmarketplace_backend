const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const KEEP_EMAILS = [
  'admin@rosewood.com',
  'seller@rosewood.com',
  'buyer@rosewood.com',
];

async function main() {
  console.log('Starting database cleanup...');

  // Find the 3 users to keep
  const keepUsers = await prisma.user.findMany({
    where: { email: { in: KEEP_EMAILS } },
    select: { id: true, email: true },
  });

  const keepIds = keepUsers.map((u) => u.id);
  console.log(`Keeping ${keepUsers.length} users:`, keepUsers.map((u) => u.email).join(', '));

  // Delete in dependency order
  const messages = await prisma.message.deleteMany({});
  console.log(`Deleted ${messages.count} messages`);

  const txLogs = await prisma.transactionLog.deleteMany({});
  console.log(`Deleted ${txLogs.count} transaction logs`);

  const transactions = await prisma.transaction.deleteMany({});
  console.log(`Deleted ${transactions.count} transactions`);

  // order_items cascade from orders, but delete orders deletes order_items via cascade
  const orders = await prisma.order.deleteMany({});
  console.log(`Deleted ${orders.count} orders`);

  const cartItems = await prisma.cartItem.deleteMany({});
  console.log(`Deleted ${cartItems.count} cart items`);

  const notifications = await prisma.notification.deleteMany({});
  console.log(`Deleted ${notifications.count} notifications`);

  // product_images cascade from products
  const products = await prisma.product.deleteMany({});
  console.log(`Deleted ${products.count} products`);

  // Delete all users NOT in keepIds
  const deletedUsers = await prisma.user.deleteMany({
    where: { id: { notIn: keepIds } },
  });
  console.log(`Deleted ${deletedUsers.count} extra users`);

  // Re-create buyer's cart (was deleted when cart_items were cleared, cart may still exist)
  const buyer = keepUsers.find((u) => u.email === 'buyer@rosewood.com');
  if (buyer) {
    const existingCart = await prisma.cart.findUnique({ where: { buyerId: buyer.id } });
    if (!existingCart) {
      await prisma.cart.create({ data: { buyerId: buyer.id } });
      console.log('Re-created buyer cart');
    } else {
      console.log('Buyer cart already exists');
    }
  }

  console.log('\nCleanup complete! Database is fresh.');
  console.log('Remaining users:');
  const remaining = await prisma.user.findMany({ select: { email: true, role: true } });
  remaining.forEach((u) => console.log(`  ${u.role}: ${u.email}`));
}

main()
  .catch((e) => {
    console.error('Cleanup failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
