CREATE TABLE IF NOT EXISTS "email_otps" (
  "id" TEXT NOT NULL,
  "user_id" BIGINT,
  "code_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "email_otps_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "email_otps"
  ADD COLUMN IF NOT EXISTS "user_id" BIGINT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'email_otps'
      AND column_name = 'email'
  ) THEN
    UPDATE "email_otps" otp
    SET "user_id" = u."id"
    FROM "users" u
    WHERE otp."user_id" IS NULL
      AND lower(otp."email") = u."normalized_email";
  END IF;
END
$$;

DELETE FROM "email_otps"
WHERE "user_id" IS NULL;

ALTER TABLE "email_otps"
  ALTER COLUMN "user_id" SET NOT NULL;

ALTER TABLE "email_otps"
  DROP COLUMN IF EXISTS "email";

CREATE INDEX IF NOT EXISTS "email_otps_user_id_expires_at_idx" ON "email_otps"("user_id", "expires_at");
CREATE INDEX IF NOT EXISTS "email_otps_used_at_idx" ON "email_otps"("used_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'email_otps_user_id_fkey'
  ) THEN
    ALTER TABLE "email_otps"
      ADD CONSTRAINT "email_otps_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
