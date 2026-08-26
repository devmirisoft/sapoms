ALTER TABLE "staff_profiles"
  ADD COLUMN "assigned_cities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "reporting_manager_id" BIGINT;

ALTER TABLE "staff_profiles"
  ADD CONSTRAINT "staff_profiles_reporting_manager_id_fkey"
  FOREIGN KEY ("reporting_manager_id") REFERENCES "admin_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "staff_profiles_reporting_manager_id_idx" ON "staff_profiles"("reporting_manager_id");
