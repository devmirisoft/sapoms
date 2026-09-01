CREATE TABLE "order_notes" (
  "id" BIGSERIAL PRIMARY KEY,
  "order_id" BIGINT NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "note" TEXT NOT NULL,
  "actor_user_id" BIGINT REFERENCES "users"("id") ON DELETE SET NULL,
  "actor_role" "UserRole",
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE INDEX "order_notes_order_id_updated_at_idx" ON "order_notes"("order_id", "updated_at");

CREATE TABLE "order_product_notes" (
  "id" BIGSERIAL PRIMARY KEY,
  "order_id" BIGINT NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "order_item_id" BIGINT NOT NULL REFERENCES "order_items"("id") ON DELETE CASCADE,
  "note" TEXT NOT NULL,
  "actor_user_id" BIGINT REFERENCES "users"("id") ON DELETE SET NULL,
  "actor_role" "UserRole",
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX "order_product_notes_order_item_id_key" ON "order_product_notes"("order_item_id");
CREATE INDEX "order_product_notes_order_id_updated_at_idx" ON "order_product_notes"("order_id", "updated_at");

CREATE TABLE "order_summary_overrides" (
  "id" BIGSERIAL PRIMARY KEY,
  "order_id" BIGINT NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "gross_amount_paise" BIGINT NOT NULL,
  "discount_amount_paise" BIGINT NOT NULL,
  "final_payable_amount_paise" BIGINT NOT NULL,
  "discount_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
  "reason" TEXT,
  "actor_user_id" BIGINT REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE INDEX "order_summary_overrides_order_id_created_at_idx" ON "order_summary_overrides"("order_id", "created_at");

CREATE TABLE "order_overlays" (
  "id" BIGSERIAL PRIMARY KEY,
  "order_id" BIGINT NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "type" TEXT NOT NULL,
  "status" TEXT,
  "value" TEXT,
  "reason" TEXT,
  "metadata" JSONB,
  "actor_user_id" BIGINT REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE INDEX "order_overlays_order_id_created_at_idx" ON "order_overlays"("order_id", "created_at");
CREATE INDEX "order_overlays_type_status_updated_at_idx" ON "order_overlays"("type", "status", "updated_at");


