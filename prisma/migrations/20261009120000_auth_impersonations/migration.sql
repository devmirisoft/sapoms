-- Admin -> dealer impersonation. Additive only: auth_sessions is not altered and no
-- existing session is touched. The restoration token is stored only as a peppered hash.
CREATE TABLE "auth_impersonations" (
    "id" TEXT NOT NULL,
    "admin_session_id" TEXT NOT NULL,
    "dealer_session_id" TEXT NOT NULL,
    "admin_token_version" INTEGER NOT NULL,
    "restoration_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_impersonations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_impersonations_dealer_session_id_key" ON "auth_impersonations"("dealer_session_id");

CREATE UNIQUE INDEX "auth_impersonations_restoration_token_hash_key" ON "auth_impersonations"("restoration_token_hash");

CREATE INDEX "auth_impersonations_admin_session_id_ended_at_idx" ON "auth_impersonations"("admin_session_id", "ended_at");

ALTER TABLE "auth_impersonations" ADD CONSTRAINT "auth_impersonations_admin_session_id_fkey" FOREIGN KEY ("admin_session_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_impersonations" ADD CONSTRAINT "auth_impersonations_dealer_session_id_fkey" FOREIGN KEY ("dealer_session_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
