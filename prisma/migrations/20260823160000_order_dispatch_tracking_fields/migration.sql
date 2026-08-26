ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "dispatch_partner" TEXT,
  ADD COLUMN IF NOT EXISTS "tracking_number" TEXT,
  ADD COLUMN IF NOT EXISTS "tracking_link" TEXT,
  ADD COLUMN IF NOT EXISTS "dock" TEXT;
