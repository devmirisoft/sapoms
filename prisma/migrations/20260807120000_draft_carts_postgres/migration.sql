CREATE TABLE IF NOT EXISTS "draft_carts" (
  "id" BIGSERIAL PRIMARY KEY,
  "dealer_id" BIGINT NOT NULL,
  "items" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "draft_carts_dealer_id_key" ON "draft_carts"("dealer_id");

ALTER TABLE "draft_carts"
  ADD CONSTRAINT "draft_carts_dealer_id_fkey"
  FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;