-- CreateTable
CREATE TABLE "couriers" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "couriers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "couriers_name_key" ON "couriers"("name");

-- CreateIndex
CREATE INDEX "couriers_is_active_position_idx" ON "couriers"("is_active", "position");

-- Seed the couriers that were hardcoded as DISPATCH_PARTNERS, so existing
-- orders keep resolving their dispatch partner in the dropdown.
INSERT INTO "couriers" ("name", "position", "updated_at") VALUES
    ('BlueDart', 0, CURRENT_TIMESTAMP),
    ('DTDC', 1, CURRENT_TIMESTAMP),
    ('Delhivery', 2, CURRENT_TIMESTAMP);
