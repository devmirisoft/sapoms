ALTER TABLE "order_summary_overrides"
  ADD COLUMN IF NOT EXISTS "actor_role" "UserRole";

ALTER TABLE "order_overlays"
  ADD COLUMN IF NOT EXISTS "actor_role" "UserRole",
  ADD COLUMN IF NOT EXISTS "legacy_source" TEXT,
  ADD COLUMN IF NOT EXISTS "legacy_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "order_overlays_legacy_source_legacy_id_key"
  ON "order_overlays"("legacy_source", "legacy_id");

ALTER TABLE "order_notes"
  ADD COLUMN IF NOT EXISTS "legacy_source" TEXT,
  ADD COLUMN IF NOT EXISTS "legacy_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "order_notes_legacy_source_legacy_id_key"
  ON "order_notes"("legacy_source", "legacy_id");