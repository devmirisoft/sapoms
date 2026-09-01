ALTER TYPE "AuthRole" ADD VALUE IF NOT EXISTS 'NSM';
ALTER TYPE "AuthRole" ADD VALUE IF NOT EXISTS 'RSM';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'NSM';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'RSM';

CREATE TYPE "SalesRegion" AS ENUM ('NORTH', 'SOUTH', 'EAST', 'WEST');

ALTER TABLE "staff_profiles"
  ADD COLUMN "sales_region" "SalesRegion";

ALTER TABLE "dealer_profiles"
  ADD COLUMN "region" "SalesRegion",
  ADD COLUMN "rsm_user_id" BIGINT;

ALTER TABLE "dealer_profiles"
  ADD CONSTRAINT "dealer_profiles_rsm_user_id_fkey"
  FOREIGN KEY ("rsm_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "dealer_requests"
  ADD COLUMN "region" "SalesRegion",
  ADD COLUMN "rsm_user_id" BIGINT;

CREATE INDEX "dealer_profiles_region_idx" ON "dealer_profiles"("region");
CREATE INDEX "dealer_profiles_rsm_user_id_idx" ON "dealer_profiles"("rsm_user_id");
CREATE INDEX "dealer_requests_region_status_updated_at_idx" ON "dealer_requests"("region", "status", "updated_at");
CREATE INDEX "dealer_requests_rsm_user_id_status_updated_at_idx" ON "dealer_requests"("rsm_user_id", "status", "updated_at");
