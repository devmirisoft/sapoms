ALTER TABLE order_notes
  ADD COLUMN IF NOT EXISTS legacy_source TEXT,
  ADD COLUMN IF NOT EXISTS legacy_id TEXT;

ALTER TABLE order_overlays
  ADD COLUMN IF NOT EXISTS legacy_source TEXT,
  ADD COLUMN IF NOT EXISTS legacy_id TEXT;

ALTER TABLE order_item_dispatches
  ADD COLUMN IF NOT EXISTS legacy_source TEXT,
  ADD COLUMN IF NOT EXISTS legacy_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS order_notes_legacy_source_legacy_id_key
  ON order_notes(legacy_source, legacy_id)
  WHERE legacy_source IS NOT NULL AND legacy_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS order_overlays_legacy_source_legacy_id_key
  ON order_overlays(legacy_source, legacy_id)
  WHERE legacy_source IS NOT NULL AND legacy_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS order_item_dispatches_legacy_source_legacy_id_key
  ON order_item_dispatches(legacy_source, legacy_id)
  WHERE legacy_source IS NOT NULL AND legacy_id IS NOT NULL;