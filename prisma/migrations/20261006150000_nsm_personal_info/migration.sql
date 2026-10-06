-- The NSM lives in admin_profiles; give it the same personal info a staff profile holds.
ALTER TABLE "admin_profiles"
  ADD COLUMN "location" TEXT,
  ADD COLUMN "mobile_no" TEXT,
  ADD COLUMN "alternate_no" TEXT,
  ADD COLUMN "permanent_address" TEXT,
  ADD COLUMN "local_address" TEXT,
  ADD COLUMN "gender" TEXT,
  ADD COLUMN "dob" DATE,
  ADD COLUMN "nationality" TEXT,
  ADD COLUMN "marital_status" TEXT,
  ADD COLUMN "qualification" TEXT,
  ADD COLUMN "emergency_contact_no_1" TEXT,
  ADD COLUMN "emergency_contact_no_2" TEXT;
