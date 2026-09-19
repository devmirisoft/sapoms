import type { Prisma } from "@prisma/client";

/**
 * Who an order belongs to, read off the dealer's active assignments.
 *
 * Orders travel a reverse waterfall: the dealer's Sales Manager (staff type
 * "1") sees it first, its ASM and RSM see it through that Sales Manager, and
 * only after RSM approval does it reach the Staff member (type "2"), whose
 * warehouse decides which warehouse tab it lands in.
 */
export async function resolveOrderStaffStamp(tx: Prisma.TransactionClient, dealerId: bigint) {
  const assignments = await tx.dealerStaffAssignment.findMany({
    where: { dealerId, active: true },
    orderBy: { assignedAt: "asc" },
    select: { staffId: true, staff: { select: { staffRoleType: true } } },
  });
  const firstOfType = (type: string) => assignments.find((row) => row.staff.staffRoleType === type)?.staffId ?? null;
  return {
    salesManagerId: firstOfType("1"),
    // ponytail: a dealer with no Staff member keeps the old fallback (first
    // assignment), so its orders stay reachable; give every dealer a Staff member to drop it.
    assignedStaffId: firstOfType("2") ?? assignments[0]?.staffId ?? null,
  };
}

/**
 * After a dealer's assignments change, orders still waiting on the RSM move to
 * the new Sales Manager / Staff member. Reviewed orders keep their history.
 */
export async function restampPendingOrders(tx: Prisma.TransactionClient, dealerId: bigint) {
  const stamp = await resolveOrderStaffStamp(tx, dealerId);
  await tx.order.updateMany({
    where: { dealerId, rsmApprovalStatus: "AWAITING", status: { notIn: ["CANCELLED", "DECLINED"] } },
    data: stamp,
  });
}
