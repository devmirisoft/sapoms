ALTER TABLE "staff_profiles"
  ADD COLUMN "parent_rsm_id" BIGINT,
  ADD COLUMN "parent_asm_id" BIGINT,
  ADD COLUMN "assigned_states" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "staff_profiles"
  ADD CONSTRAINT "staff_profiles_parent_rsm_id_fkey"
  FOREIGN KEY ("parent_rsm_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "staff_profiles"
  ADD CONSTRAINT "staff_profiles_parent_asm_id_fkey"
  FOREIGN KEY ("parent_asm_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "staff_profiles_parent_rsm_id_idx" ON "staff_profiles"("parent_rsm_id");
CREATE INDEX "staff_profiles_parent_asm_id_idx" ON "staff_profiles"("parent_asm_id");
