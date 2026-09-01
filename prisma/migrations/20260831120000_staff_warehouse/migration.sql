-- Staff members are pinned to a dispatch warehouse; order visibility for a
-- warehouse-pinned staff member follows the warehouse of the order's assigned
-- staff. Nullable so existing staff keep their current (unrestricted) scope.
CREATE TYPE "Warehouse" AS ENUM ('AHMEDABAD', 'AMBALA');

ALTER TABLE "staff_profiles" ADD COLUMN "warehouse" "Warehouse";

CREATE INDEX "staff_profiles_warehouse_idx" ON "staff_profiles"("warehouse");
