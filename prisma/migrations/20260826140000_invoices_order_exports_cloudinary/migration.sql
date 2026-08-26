-- Invoice and order-export PDF storage moved from Supabase to Cloudinary.
-- Supabase held both the file (storage bucket) and the metadata (its own
-- `invoices` / `order_exports` tables). Cloudinary replaces only the file half,
-- so the metadata lands here next to the orders and dealers it references.
--
-- PDFs are stored in Cloudinary as extension-less raw blobs (the account blocks
-- PDF-format delivery, returning 401), so "cloudinary_url" is never handed to
-- the browser directly -- the authenticated download route streams it with the
-- application/pdf content type.

CREATE TABLE IF NOT EXISTS "invoices" (
  "id"                    BIGSERIAL PRIMARY KEY,
  "dealer_id"             BIGINT NOT NULL,
  "order_id"              BIGINT,
  "invoice_number"        TEXT NOT NULL,
  "order_number"          TEXT NOT NULL,
  "buyer_name"            TEXT NOT NULL,
  "total_amount_paise"    BIGINT NOT NULL DEFAULT 0,
  "invoice_date"          DATE NOT NULL,
  "cloudinary_url"        TEXT NOT NULL,
  "cloudinary_public_id"  TEXT,
  "file_name"             TEXT NOT NULL,
  "file_bytes"            INTEGER,
  "created_by_user_id"    BIGINT,
  "deleted_at"            TIMESTAMPTZ(6),
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "order_exports" (
  "id"                    BIGSERIAL PRIMARY KEY,
  "dealer_id"             BIGINT NOT NULL,
  "file_name"             TEXT NOT NULL,
  "cloudinary_url"        TEXT NOT NULL,
  "cloudinary_public_id"  TEXT,
  "file_bytes"            INTEGER,
  "order_count"           INTEGER NOT NULL DEFAULT 0,
  "created_by_user_id"    BIGINT,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

-- One invoice number per dealer. The orders page previously enforced this by
-- listing every invoice and comparing in the browser, which raced against
-- concurrent bulk billing; the constraint makes the database the arbiter.
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_dealer_id_invoice_number_key"
  ON "invoices" ("dealer_id", "invoice_number");
CREATE INDEX IF NOT EXISTS "invoices_dealer_id_created_at_idx"
  ON "invoices" ("dealer_id", "created_at");
CREATE INDEX IF NOT EXISTS "invoices_order_id_idx"
  ON "invoices" ("order_id");

CREATE INDEX IF NOT EXISTS "order_exports_dealer_id_created_at_idx"
  ON "order_exports" ("dealer_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_dealer_id_fkey') THEN
    ALTER TABLE "invoices"
      ADD CONSTRAINT "invoices_dealer_id_fkey"
      FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_order_id_fkey') THEN
    ALTER TABLE "invoices"
      ADD CONSTRAINT "invoices_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_created_by_user_id_fkey') THEN
    ALTER TABLE "invoices"
      ADD CONSTRAINT "invoices_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_exports_dealer_id_fkey') THEN
    ALTER TABLE "order_exports"
      ADD CONSTRAINT "order_exports_dealer_id_fkey"
      FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_exports_created_by_user_id_fkey') THEN
    ALTER TABLE "order_exports"
      ADD CONSTRAINT "order_exports_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
