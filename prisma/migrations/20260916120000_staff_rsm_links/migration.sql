-- CreateTable
CREATE TABLE "staff_rsm_links" (
    "staff_id" BIGINT NOT NULL,
    "rsm_id" BIGINT NOT NULL,

    CONSTRAINT "staff_rsm_links_pkey" PRIMARY KEY ("staff_id","rsm_id")
);

-- CreateIndex
CREATE INDEX "staff_rsm_links_rsm_id_idx" ON "staff_rsm_links"("rsm_id");

-- AddForeignKey
ALTER TABLE "staff_rsm_links" ADD CONSTRAINT "staff_rsm_links_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_rsm_links" ADD CONSTRAINT "staff_rsm_links_rsm_id_fkey" FOREIGN KEY ("rsm_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Move each plain Staff member's single RSM into the link table; Staff no
-- longer use parent_rsm_id (ASMs and Sales Managers still do).
INSERT INTO "staff_rsm_links" ("staff_id", "rsm_id")
SELECT "id", "parent_rsm_id" FROM "staff_profiles"
WHERE "staff_role_type" = '2' AND "parent_rsm_id" IS NOT NULL;

UPDATE "staff_profiles" SET "parent_rsm_id" = NULL WHERE "staff_role_type" = '2';
