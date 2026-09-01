ALTER TABLE "staff_profiles"
  ADD COLUMN IF NOT EXISTS "mobile_no" TEXT,
  ADD COLUMN IF NOT EXISTS "alternate_no" TEXT,
  ADD COLUMN IF NOT EXISTS "permanent_address" TEXT,
  ADD COLUMN IF NOT EXISTS "local_address" TEXT,
  ADD COLUMN IF NOT EXISTS "gender" TEXT,
  ADD COLUMN IF NOT EXISTS "dob" DATE,
  ADD COLUMN IF NOT EXISTS "nationality" TEXT,
  ADD COLUMN IF NOT EXISTS "marital_status" TEXT,
  ADD COLUMN IF NOT EXISTS "qualification" TEXT,
  ADD COLUMN IF NOT EXISTS "emergency_contact_no_1" TEXT,
  ADD COLUMN IF NOT EXISTS "emergency_contact_no_2" TEXT;
