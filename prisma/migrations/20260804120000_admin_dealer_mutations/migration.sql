ALTER TABLE "dealer_profiles" ADD COLUMN "state" TEXT;
ALTER TABLE "dealer_profiles" ADD COLUMN "credit_limit_paise" BIGINT;
ALTER TABLE "dealer_profiles" ADD COLUMN "image_url" TEXT;
ALTER TABLE "dealer_profiles" ADD COLUMN "created_by_user_id" BIGINT;
ALTER TABLE "dealer_profiles" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "dealer_profiles" ADD COLUMN "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "dealer_profiles" ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "dealer_staff_assignments" (
  "id" BIGSERIAL NOT NULL,
  "dealer_id" BIGINT NOT NULL,
  "staff_id" BIGINT NOT NULL,
  "assigned_by_user_id" BIGINT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dealer_staff_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dealer_profiles_deleted_at_idx" ON "dealer_profiles"("deleted_at");
CREATE UNIQUE INDEX "dealer_staff_assignments_dealer_id_staff_id_key" ON "dealer_staff_assignments"("dealer_id", "staff_id");
CREATE INDEX "dealer_staff_assignments_dealer_id_active_idx" ON "dealer_staff_assignments"("dealer_id", "active");
CREATE INDEX "dealer_staff_assignments_staff_id_active_idx" ON "dealer_staff_assignments"("staff_id", "active");

ALTER TABLE "dealer_profiles" ADD CONSTRAINT "dealer_profiles_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dealer_staff_assignments" ADD CONSTRAINT "dealer_staff_assignments_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dealer_staff_assignments" ADD CONSTRAINT "dealer_staff_assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dealer_staff_assignments" ADD CONSTRAINT "dealer_staff_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;