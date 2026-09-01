CREATE TABLE "product_categories" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "products" (
    "id" BIGSERIAL NOT NULL,
    "product_code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "category_id" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_variants" (
    "id" BIGSERIAL NOT NULL,
    "product_id" BIGINT NOT NULL,
    "sku" TEXT,
    "catalogue_number" TEXT,
    "unit_name" TEXT,
    "pack_size" INTEGER,
    "unit_price_paise" BIGINT NOT NULL DEFAULT 0,
    "pack_price_paise" BIGINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_categories_slug_key" ON "product_categories"("slug");
CREATE INDEX "product_categories_name_idx" ON "product_categories"("name");
CREATE UNIQUE INDEX "products_product_code_key" ON "products"("product_code");
CREATE INDEX "products_name_idx" ON "products"("name");
CREATE INDEX "products_category_id_idx" ON "products"("category_id");
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");
CREATE INDEX "product_variants_catalogue_number_idx" ON "product_variants"("catalogue_number");

CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'AWAITING_ACCEPTANCE', 'ACCEPTED', 'DECLINED', 'PROCESSING', 'PARTIALLY_READY', 'DISPATCHED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "OrderAcceptanceStatus" AS ENUM ('AWAITING', 'ACCEPTED', 'DECLINED');
CREATE TYPE "OrderFulfilmentStatus" AS ENUM ('PENDING', 'IN_PROCESS', 'PARTIALLY_READY', 'READY', 'DISPATCHED', 'COMPLETED', 'NO_ACTION_TAKEN');

CREATE TABLE "orders" (
    "id" BIGSERIAL NOT NULL,
    "legacy_php_id" TEXT,
    "order_number" TEXT NOT NULL,
    "dealer_id" BIGINT NOT NULL,
    "assigned_staff_id" BIGINT,
    "created_by_user_id" BIGINT,
    "order_date" TIMESTAMPTZ(6) NOT NULL,
    "gross_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "base_discount_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "additional_discount_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "coupon_discount_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "final_payable_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "status" "OrderStatus" NOT NULL DEFAULT 'AWAITING_ACCEPTANCE',
    "acceptance_status" "OrderAcceptanceStatus" NOT NULL DEFAULT 'AWAITING',
    "fulfilment_status" "OrderFulfilmentStatus" NOT NULL DEFAULT 'PENDING',
    "cancelled_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_items" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "legacy_php_order_item_id" TEXT,
    "product_variant_id" BIGINT,
    "product_name_snapshot" TEXT NOT NULL,
    "catalogue_number_snapshot" TEXT NOT NULL,
    "category_snapshot" TEXT,
    "quantity_packs" INTEGER NOT NULL,
    "pack_size" INTEGER NOT NULL,
    "total_pieces" INTEGER NOT NULL,
    "unit_price_paise" BIGINT NOT NULL DEFAULT 0,
    "pack_price_paise" BIGINT NOT NULL DEFAULT 0,
    "list_price_total_paise" BIGINT NOT NULL DEFAULT 0,
    "discount_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "final_amount_paise" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orders_legacy_php_id_key" ON "orders"("legacy_php_id");
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");
CREATE INDEX "orders_dealer_id_order_date_idx" ON "orders"("dealer_id", "order_date");
CREATE INDEX "orders_assigned_staff_id_order_date_idx" ON "orders"("assigned_staff_id", "order_date");
CREATE INDEX "orders_status_order_date_idx" ON "orders"("status", "order_date");
CREATE INDEX "orders_order_date_idx" ON "orders"("order_date");
CREATE UNIQUE INDEX "order_items_legacy_php_order_item_id_key" ON "order_items"("legacy_php_order_item_id");
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");
CREATE INDEX "order_items_product_variant_id_idx" ON "order_items"("product_variant_id");
CREATE INDEX "order_items_catalogue_number_snapshot_idx" ON "order_items"("catalogue_number_snapshot");
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_assigned_staff_id_fkey" FOREIGN KEY ("assigned_staff_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;