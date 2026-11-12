-- Admin enable/disable toggle per catalogue number. The variant keeps why it was
-- switched off; an open order line zeroed by that disable keeps the same note.
ALTER TABLE "product_variants" ADD COLUMN "disabled_note" TEXT;

ALTER TABLE "order_items" ADD COLUMN "disabled_note" TEXT;
