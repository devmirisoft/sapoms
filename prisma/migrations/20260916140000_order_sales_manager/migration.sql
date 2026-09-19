-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "sales_manager_id" BIGINT;

-- CreateIndex
CREATE INDEX "orders_sales_manager_id_created_at_idx" ON "orders"("sales_manager_id", "created_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_sales_manager_id_fkey" FOREIGN KEY ("sales_manager_id") REFERENCES "staff_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Stamp existing orders with their dealer's current Sales Manager (staff type
-- '1'), so RSM/ASM visibility, which now flows through it, covers old orders.
UPDATE "orders" o
SET "sales_manager_id" = a."staff_id"
FROM (
  SELECT DISTINCT ON (dsa."dealer_id") dsa."dealer_id", dsa."staff_id"
  FROM "dealer_staff_assignments" dsa
  JOIN "staff_profiles" sp ON sp."id" = dsa."staff_id"
  WHERE dsa."active" AND sp."staff_role_type" = '1'
  ORDER BY dsa."dealer_id", dsa."assigned_at"
) a
WHERE o."dealer_id" = a."dealer_id";

-- assigned_staff_id used to be whichever assignment came back first (often the
-- RSM/ASM). Point it at the dealer's Staff member (type '2') where there is one,
-- since that member's warehouse decides the order list's warehouse tab.
UPDATE "orders" o
SET "assigned_staff_id" = a."staff_id"
FROM (
  SELECT DISTINCT ON (dsa."dealer_id") dsa."dealer_id", dsa."staff_id"
  FROM "dealer_staff_assignments" dsa
  JOIN "staff_profiles" sp ON sp."id" = dsa."staff_id"
  WHERE dsa."active" AND sp."staff_role_type" = '2'
  ORDER BY dsa."dealer_id", dsa."assigned_at"
) a
WHERE o."dealer_id" = a."dealer_id";
