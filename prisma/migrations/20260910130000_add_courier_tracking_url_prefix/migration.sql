-- AlterTable
ALTER TABLE "couriers" ADD COLUMN "tracking_url_prefix" TEXT;

-- Seed the prefixes for the couriers shipped in the initial courier seed.
UPDATE "couriers" SET "tracking_url_prefix" = 'https://www.delhivery.com/track-v2/package/' WHERE "name" = 'Delhivery' AND "tracking_url_prefix" IS NULL;
UPDATE "couriers" SET "tracking_url_prefix" = 'https://www.bluedart.com/web/guest/trackdartresult?trackFor=0&trackNo=' WHERE "name" = 'BlueDart' AND "tracking_url_prefix" IS NULL;
UPDATE "couriers" SET "tracking_url_prefix" = 'https://www.dtdc.in/tracking/shipment-tracking?ref=' WHERE "name" = 'DTDC' AND "tracking_url_prefix" IS NULL;
