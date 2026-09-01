ALTER TABLE "dealer_profiles"
  ADD COLUMN IF NOT EXISTS "priority_contact" TEXT NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS "secondary_contact_name" TEXT,
  ADD COLUMN IF NOT EXISTS "secondary_contact_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "secondary_contact_email" TEXT,
  ADD COLUMN IF NOT EXISTS "annual_target_paise" BIGINT,
  ADD COLUMN IF NOT EXISTS "notes" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dealer_profiles_priority_contact_check'
  ) THEN
    ALTER TABLE "dealer_profiles"
      ADD CONSTRAINT "dealer_profiles_priority_contact_check"
      CHECK ("priority_contact" IN ('primary', 'secondary'));
  END IF;
END $$;
