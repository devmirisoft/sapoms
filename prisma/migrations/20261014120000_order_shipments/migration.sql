-- An order can go out in several courier shipments. Tracking moves from
-- single columns on orders to order_shipments, and each dispatch row records
-- the shipment it went out with.
CREATE TABLE "order_shipments" (
    "id" BIGSERIAL NOT NULL,
    "order_id" BIGINT NOT NULL,
    "dispatch_partner" TEXT NOT NULL,
    "tracking_number" TEXT,
    "tracking_link" TEXT,
    "created_by_user_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "order_shipments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_shipments_order_id_created_at_idx" ON "order_shipments"("order_id", "created_at");

ALTER TABLE "order_shipments" ADD CONSTRAINT "order_shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_item_dispatches" ADD COLUMN "shipment_id" BIGINT;

CREATE INDEX "order_item_dispatches_shipment_id_idx" ON "order_item_dispatches"("shipment_id");

ALTER TABLE "order_item_dispatches" ADD CONSTRAINT "order_item_dispatches_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "order_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: each order's one existing tracking record becomes its first shipment.
INSERT INTO "order_shipments" ("order_id", "dispatch_partner", "tracking_number", "tracking_link", "created_at", "updated_at")
SELECT "id",
       COALESCE(NULLIF(TRIM("dispatch_partner"), ''), 'Unknown'),
       NULLIF(TRIM("tracking_number"), ''),
       NULLIF(TRIM("tracking_link"), ''),
       COALESCE("dispatched_at", "updated_at"),
       "updated_at"
FROM "orders"
WHERE NULLIF(TRIM("dispatch_partner"), '') IS NOT NULL
   OR NULLIF(TRIM("tracking_number"), '') IS NOT NULL
   OR NULLIF(TRIM("tracking_link"), '') IS NOT NULL;

-- Until now an order had only one shipment, so all its dispatches went with it.
UPDATE "order_item_dispatches" d
SET "shipment_id" = s."id"
FROM "order_shipments" s
WHERE s."order_id" = d."order_id"
  AND d."status" <> 'IN_PROCESS';

ALTER TABLE "orders" DROP COLUMN "dispatch_partner",
DROP COLUMN "tracking_number",
DROP COLUMN "tracking_link";
