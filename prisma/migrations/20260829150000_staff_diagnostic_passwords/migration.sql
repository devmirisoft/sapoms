-- Temporary login passwords now cover staff profiles too, so the dealer-only
-- table becomes a shared one keyed by exactly one owner column.
ALTER TABLE "dealer_diagnostic_passwords" RENAME TO "diagnostic_passwords";

ALTER TABLE "diagnostic_passwords" RENAME CONSTRAINT "dealer_diagnostic_passwords_pkey" TO "diagnostic_passwords_pkey";
ALTER TABLE "diagnostic_passwords" RENAME CONSTRAINT "dealer_diagnostic_passwords_dealer_id_fkey" TO "diagnostic_passwords_dealer_id_fkey";
ALTER TABLE "diagnostic_passwords" RENAME CONSTRAINT "dealer_diagnostic_passwords_created_by_user_id_fkey" TO "diagnostic_passwords_created_by_user_id_fkey";
ALTER TABLE "diagnostic_passwords" RENAME CONSTRAINT "dealer_diagnostic_passwords_revoked_by_user_id_fkey" TO "diagnostic_passwords_revoked_by_user_id_fkey";
ALTER INDEX "dealer_diagnostic_passwords_dealer_id_expires_at_idx" RENAME TO "diagnostic_passwords_dealer_id_expires_at_idx";
ALTER INDEX "dealer_diagnostic_passwords_revoked_at_idx" RENAME TO "diagnostic_passwords_revoked_at_idx";

ALTER TABLE "diagnostic_passwords" ADD COLUMN "staff_id" BIGINT;
ALTER TABLE "diagnostic_passwords" ALTER COLUMN "dealer_id" DROP NOT NULL;

ALTER TABLE "diagnostic_passwords"
  ADD CONSTRAINT "diagnostic_passwords_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "diagnostic_passwords"
  ADD CONSTRAINT "diagnostic_passwords_owner_check"
  CHECK (("dealer_id" IS NULL) <> ("staff_id" IS NULL));

CREATE INDEX "diagnostic_passwords_staff_id_expires_at_idx" ON "diagnostic_passwords"("staff_id", "expires_at");
