CREATE TABLE "dealer_diagnostic_passwords" (
  "id" BIGSERIAL NOT NULL,
  "dealer_id" BIGINT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "revoked_at" TIMESTAMPTZ(6),
  "last_used_at" TIMESTAMPTZ(6),
  "created_by_user_id" BIGINT NOT NULL,
  "revoked_by_user_id" BIGINT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dealer_diagnostic_passwords_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dealer_diagnostic_passwords_dealer_id_expires_at_idx" ON "dealer_diagnostic_passwords"("dealer_id", "expires_at");
CREATE INDEX "dealer_diagnostic_passwords_revoked_at_idx" ON "dealer_diagnostic_passwords"("revoked_at");

ALTER TABLE "dealer_diagnostic_passwords"
  ADD CONSTRAINT "dealer_diagnostic_passwords_dealer_id_fkey"
  FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dealer_diagnostic_passwords"
  ADD CONSTRAINT "dealer_diagnostic_passwords_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dealer_diagnostic_passwords"
  ADD CONSTRAINT "dealer_diagnostic_passwords_revoked_by_user_id_fkey"
  FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;