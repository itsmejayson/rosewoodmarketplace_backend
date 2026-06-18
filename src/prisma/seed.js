const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding database...');

  // ── Categories ──────────────────────────────────────────────────────────────
  const categories = await Promise.all([
    prisma.category.upsert({
      where: { slug: 'fresh-produce' },
      update: {},
      create: { name: 'Fresh Produce', slug: 'fresh-produce', description: 'Fruits and vegetables' },
    }),
    prisma.category.upsert({
      where: { slug: 'dairy-eggs' },
      update: {},
      create: { name: 'Dairy & Eggs', slug: 'dairy-eggs', description: 'Milk, cheese, eggs, and more' },
    }),
    prisma.category.upsert({
      where: { slug: 'bakery' },
      update: {},
      create: { name: 'Bakery', slug: 'bakery', description: 'Bread, pastries, and baked goods' },
    }),
    prisma.category.upsert({
      where: { slug: 'building-materials' },
      update: {},
      create: { name: 'Building Materials', slug: 'building-materials', description: 'Construction and renovation materials' },
    }),
    prisma.category.upsert({
      where: { slug: 'hardware' },
      update: {},
      create: { name: 'Hardware', slug: 'hardware', description: 'Tools and hardware supplies' },
    }),
    prisma.category.upsert({
      where: { slug: 'packaging' },
      update: {},
      create: { name: 'Packaging', slug: 'packaging', description: 'Boxes, bags, and packaging materials' },
    }),
  ]);

  // ── Admin User ──────────────────────────────────────────────────────────────
  const adminPassword = await bcrypt.hash('Admin@123456', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@rosewood.com' },
    update: {},
    create: {
      fullName: 'Rosewood Admin',
      email: 'admin@rosewood.com',
      passwordHash: adminPassword,
      role: 'ADMIN',
      phone: '+1-555-0100',
    },
  });

  // ── Seller User ─────────────────────────────────────────────────────────────
  const sellerPassword = await bcrypt.hash('Seller@123456', 12);
  const seller = await prisma.user.upsert({
    where: { email: 'seller@rosewood.com' },
    update: {},
    create: {
      fullName: 'Maria Santos',
      email: 'seller@rosewood.com',
      passwordHash: sellerPassword,
      role: 'SELLER',
      phone: '+1-555-0200',
      address: '123 Market St, Commerce City, CA 90001',
    },
  });

  // ── Buyer User ──────────────────────────────────────────────────────────────
  const buyerPassword = await bcrypt.hash('Buyer@123456', 12);
  const buyer = await prisma.user.upsert({
    where: { email: 'buyer@rosewood.com' },
    update: {},
    create: {
      fullName: 'John Reyes',
      email: 'buyer@rosewood.com',
      passwordHash: buyerPassword,
      role: 'BUYER',
      phone: '+1-555-0300',
      address: '456 Elm St, Suburbs, CA 90210',
    },
  });

  // ── Products ─────────────────────────────────────────────────────────────────
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 30);

  await prisma.product.createMany({
    skipDuplicates: true,
    data: [
      {
        name: 'Organic Strawberries',
        slug: 'organic-strawberries',
        description: 'Fresh, sweet organic strawberries. Handpicked daily.',
        price: 4.99,
        stockQty: 200,
        productType: 'FOOD',
        isPerishable: true,
        expirationDate: tomorrow,
        storageInstructions: 'Refrigerate and consume within 3 days.',
        sellerId: seller.id,
        categoryId: categories[0].id,
        salesCount: 145,
        viewCount: 890,
      },
      {
        name: 'Farm Fresh Eggs (12 pack)',
        slug: 'farm-fresh-eggs-12pack',
        description: 'Free-range eggs from happy hens. Rich golden yolks.',
        price: 6.49,
        stockQty: 150,
        productType: 'FOOD',
        isPerishable: true,
        expirationDate: tomorrow,
        storageInstructions: 'Keep refrigerated.',
        sellerId: seller.id,
        categoryId: categories[1].id,
        salesCount: 98,
        viewCount: 540,
      },
      {
        name: 'Sourdough Bread Loaf',
        slug: 'sourdough-bread-loaf',
        description: 'Artisan sourdough made with organic flour and natural starter.',
        price: 8.99,
        stockQty: 50,
        productType: 'FOOD',
        isPerishable: true,
        expirationDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        storageInstructions: 'Store in a cool, dry place. Freeze for longer shelf life.',
        sellerId: seller.id,
        categoryId: categories[2].id,
        salesCount: 67,
        viewCount: 312,
      },
      {
        name: 'Cement Bags (50kg)',
        slug: 'cement-bags-50kg',
        description: 'High-strength Portland cement suitable for all construction purposes.',
        price: 12.50,
        stockQty: 500,
        productType: 'MATERIAL',
        materialType: 'Cement',
        unit: 'bag (50kg)',
        sellerId: seller.id,
        categoryId: categories[3].id,
        salesCount: 230,
        viewCount: 1200,
      },
      {
        name: 'Steel Rebar 10mm x 6m',
        slug: 'steel-rebar-10mm-6m',
        description: 'Deformed steel reinforcement bar for concrete structures.',
        price: 18.75,
        stockQty: 800,
        productType: 'MATERIAL',
        materialType: 'Steel',
        unit: 'piece (6m length)',
        sellerId: seller.id,
        categoryId: categories[3].id,
        salesCount: 188,
        viewCount: 980,
      },
      {
        name: 'Cardboard Boxes (Small, 20-pack)',
        slug: 'cardboard-boxes-small-20pack',
        description: 'Durable single-wall cardboard boxes ideal for shipping and storage.',
        price: 22.00,
        stockQty: 300,
        productType: 'MATERIAL',
        materialType: 'Cardboard',
        unit: 'pack of 20',
        sellerId: seller.id,
        categoryId: categories[5].id,
        salesCount: 72,
        viewCount: 410,
      },
    ],
  });

  // ── Buyer Cart ──────────────────────────────────────────────────────────────
  await prisma.cart.upsert({
    where: { buyerId: buyer.id },
    update: {},
    create: { buyerId: buyer.id },
  });

  console.log('Seed complete.');
  console.log('');
  console.log('Test accounts:');
  console.log('  Admin   → admin@rosewood.com   / Admin@123456');
  console.log('  Seller  → seller@rosewood.com  / Seller@123456');
  console.log('  Buyer   → buyer@rosewood.com   / Buyer@123456');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
