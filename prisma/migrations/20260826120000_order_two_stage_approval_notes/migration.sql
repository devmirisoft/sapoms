-- Two-stage order approval notes.
--
-- Order acceptance is a two-stage gate: the RSM approves first
-- (rsm_approval_status), then the assigned staff accepts or declines
-- (acceptance_status). Neither stage could record a reason, so a decline
-- arrived at the dealer with no explanation and staff saw no RSM context.
--
-- This mirrors custom_discount_requests, where rsm_note and admin_note are
-- deliberately separate columns so one reviewer's reason never overwrites the
-- other's. acceptance_note is the stage-2 staff field; rsm_note is stage 1.

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "rsm_note" TEXT,
  ADD COLUMN IF NOT EXISTS "acceptance_note" TEXT,
  ADD COLUMN IF NOT EXISTS "acceptance_reviewed_by_user_id" BIGINT,
  ADD COLUMN IF NOT EXISTS "acceptance_reviewed_by_name" TEXT,
  ADD COLUMN IF NOT EXISTS "acceptance_reviewed_at" TIMESTAMPTZ(6);

-- Staff poll for "RSM approved, mine to decide": partial index keeps that queue
-- cheap as declined and completed orders accumulate.
CREATE INDEX IF NOT EXISTS "orders_stage_two_queue_idx"
  ON "orders" ("assigned_staff_id", "created_at")
  WHERE "rsm_approval_status" = 'ACCEPTED' AND "acceptance_status" = 'AWAITING';
