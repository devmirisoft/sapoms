-- Extend the existing audit table into the admin audit trail.
-- Additive only: every column is nullable, so the rows already written by the
-- ~40 existing event types stay valid and no data is rewritten.

-- AlterTable
ALTER TABLE "auth_audit_logs"
  ADD COLUMN "actor_id"    BIGINT,
  ADD COLUMN "actor_name"  TEXT,
  ADD COLUMN "actor_email" TEXT,
  ADD COLUMN "action"      TEXT,
  ADD COLUMN "entity"      TEXT,
  ADD COLUMN "entity_id"   TEXT,
  ADD COLUMN "old_values"  JSONB,
  ADD COLUMN "new_values"  JSONB,
  ADD COLUMN "request_id"  TEXT;

-- CreateIndex
CREATE INDEX "auth_audit_logs_actor_id_idx" ON "auth_audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "auth_audit_logs_role_idx" ON "auth_audit_logs"("role");

-- CreateIndex
CREATE INDEX "auth_audit_logs_action_idx" ON "auth_audit_logs"("action");

-- CreateIndex
CREATE INDEX "auth_audit_logs_entity_idx" ON "auth_audit_logs"("entity");

-- CreateIndex
CREATE INDEX "auth_audit_logs_entity_entity_id_idx" ON "auth_audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "auth_audit_logs_request_id_idx" ON "auth_audit_logs"("request_id");

-- CreateIndex
CREATE INDEX "auth_audit_logs_created_at_idx" ON "auth_audit_logs"("created_at");
