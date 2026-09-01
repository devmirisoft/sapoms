CREATE TYPE "AuthRole" AS ENUM ('ADMIN', 'ACCOUNTANT', 'STAFF', 'DEALER');

CREATE TYPE "LegacyAuthSource" AS ENUM ('PHP', 'MONGODB');

CREATE TABLE "auth_sessions" (
  "id" TEXT NOT NULL,
  "role" "AuthRole" NOT NULL,
  "legacy_source" "LegacyAuthSource" NOT NULL,
  "legacy_actor_id" TEXT NOT NULL,
  "email" TEXT,
  "display_name" TEXT,
  "refresh_token_hash" TEXT NOT NULL,
  "profile_snapshot" JSONB,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_audit_logs" (
  "id" BIGSERIAL NOT NULL,
  "session_id" TEXT,
  "legacy_actor_id" TEXT,
  "role" "AuthRole",
  "event_type" TEXT NOT NULL,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "auth_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_sessions_refresh_token_hash_key" ON "auth_sessions"("refresh_token_hash");
CREATE INDEX "auth_sessions_legacy_source_legacy_actor_id_idx" ON "auth_sessions"("legacy_source", "legacy_actor_id");
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");
CREATE INDEX "auth_sessions_revoked_at_idx" ON "auth_sessions"("revoked_at");
CREATE INDEX "auth_audit_logs_legacy_actor_id_created_at_idx" ON "auth_audit_logs"("legacy_actor_id", "created_at");
