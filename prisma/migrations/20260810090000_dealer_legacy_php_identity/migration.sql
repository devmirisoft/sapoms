ALTER TABLE "dealer_profiles"
  ADD COLUMN "legacy_php_id" TEXT;

CREATE UNIQUE INDEX "dealer_profiles_legacy_php_id_key"
  ON "dealer_profiles"("legacy_php_id");