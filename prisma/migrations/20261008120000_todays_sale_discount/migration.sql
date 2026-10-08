-- AlterTable
ALTER TABLE "orders" ADD COLUMN "sale_discount_amount_paise" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "sale_discount_percent" DECIMAL(7,4) NOT NULL DEFAULT 0;
