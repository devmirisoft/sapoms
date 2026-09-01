CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'ACCOUNTANT', 'STAFF', 'DEALER');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

CREATE TABLE "users" (
  "id" BIGSERIAL NOT NULL,
  "email" TEXT NOT NULL,
  "normalized_email" TEXT NOT NULL,
  "username" TEXT,
  "normalized_username" TEXT,
  "password_hash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "token_version" INTEGER NOT NULL DEFAULT 1,
  "last_login_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_profiles" (
  "id" BIGSERIAL NOT NULL,
  "user_id" BIGINT NOT NULL,
  "display_name" TEXT NOT NULL,
  "phone" TEXT,
  "image_url" TEXT,
  CONSTRAINT "admin_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accountant_profiles" (
  "id" BIGSERIAL NOT NULL,
  "user_id" BIGINT NOT NULL,
  "display_name" TEXT NOT NULL,
  "designation" TEXT,
  CONSTRAINT "accountant_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "staff_profiles" (
  "id" BIGSERIAL NOT NULL,
  "user_id" BIGINT NOT NULL,
  "display_name" TEXT NOT NULL,
  "designation" TEXT,
  "location" TEXT,
  "staff_role_type" TEXT,
  CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dealer_profiles" (
  "id" BIGSERIAL NOT NULL,
  "user_id" BIGINT NOT NULL,
  "dealer_code" TEXT,
  "business_name" TEXT NOT NULL,
  "phone" TEXT,
  "city" TEXT,
  "address" TEXT,
  "pincode" TEXT,
  "gstin" TEXT,
  "discount_percent" DECIMAL(9,4),
  "credit_days" INTEGER,
  CONSTRAINT "dealer_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_normalized_email_key" ON "users"("normalized_email");
CREATE UNIQUE INDEX "users_normalized_username_key" ON "users"("normalized_username");
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");
CREATE UNIQUE INDEX "admin_profiles_user_id_key" ON "admin_profiles"("user_id");
CREATE UNIQUE INDEX "accountant_profiles_user_id_key" ON "accountant_profiles"("user_id");
CREATE UNIQUE INDEX "staff_profiles_user_id_key" ON "staff_profiles"("user_id");
CREATE UNIQUE INDEX "dealer_profiles_user_id_key" ON "dealer_profiles"("user_id");
CREATE UNIQUE INDEX "dealer_profiles_dealer_code_key" ON "dealer_profiles"("dealer_code");

TRUNCATE TABLE "auth_sessions";
DROP INDEX IF EXISTS "auth_sessions_legacy_source_legacy_actor_id_idx";
ALTER TABLE "auth_sessions" DROP COLUMN IF EXISTS "role";
ALTER TABLE "auth_sessions" DROP COLUMN IF EXISTS "legacy_source";
ALTER TABLE "auth_sessions" DROP COLUMN IF EXISTS "legacy_actor_id";
ALTER TABLE "auth_sessions" DROP COLUMN IF EXISTS "email";
ALTER TABLE "auth_sessions" DROP COLUMN IF EXISTS "display_name";
ALTER TABLE "auth_sessions" DROP COLUMN IF EXISTS "profile_snapshot";
ALTER TABLE "auth_sessions" ADD COLUMN "user_id" BIGINT NOT NULL;
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "admin_profiles" ADD CONSTRAINT "admin_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountant_profiles" ADD CONSTRAINT "accountant_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dealer_profiles" ADD CONSTRAINT "dealer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TYPE IF EXISTS "LegacyAuthSource";