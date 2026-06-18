-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'DELIVERY_FEE_ADDED';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deliveryFee" DECIMAL(10,2),
ADD COLUMN     "deliveryFeeStatus" TEXT NOT NULL DEFAULT 'NOT_SET';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "storeName" TEXT;
