import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { requireAuth, type AuthActor } from "@/server/auth/session";
import { buildRsmDiscountRequestWhere, isAdminLike, isStaffLike } from "@/server/auth/sales-scope";
import { buildFundRequestScope, STAGE_REQUIRES } from "@/lib/dealerFundRequests";

export const runtime = "nodejs";

/* Every sidebar badge in one round trip. The scoping per key mirrors the page
   each badge links to, so the number in the nav equals the number on arrival.
   Replaces the former per-badge /pending-count endpoints. */

/* Same scope the pending-products report uses: a staff member sees the orders
   assigned to them plus their dealers'; admin/accountant see everything. */
function orderScope(actor: AuthActor): Prisma.OrderWhereInput {
  if (actor.role === "DEALER") return { dealerId: actor.dealerId };
  if (isStaffLike(actor) && actor.staffId) {
    const staffId = actor.staffId;
    return { OR: [{ assignedStaffId: staffId }, { dealer: { staffAssignments: { some: { staffId, active: true } } } }] };
  }
  return {};
}

async function countsFor(actor: AuthActor) {
  const jobs: [string, Promise<number>][] = [];
  const add = (key: string, run: () => Promise<number>) => jobs.push([key, run()]);

  if (actor.role === "DEALER") {
    if (!actor.dealerId) return {};
    const dealerId = actor.dealerId;
    add("drafts", () => prisma.orderDraft.count({ where: { dealerId, status: "ACTIVE" } }));
    add("orders", () => prisma.order.count({ where: { dealerId, acceptanceStatus: "AWAITING", status: { notIn: ["CANCELLED", "DECLINED"] } } }));
    add("fundRequests", () => prisma.dealerFundRequest.count({ where: { dealerId, status: { notIn: ["COMPLETED", "REJECTED"] } } }));
  } else {
    add("pendingOrders", () => prisma.order.count({ where: { ...orderScope(actor), acceptanceStatus: "AWAITING", status: { notIn: ["CANCELLED", "DECLINED"] } } }));

    // Discount approvals: admin reviews the RSM-cleared queue, an RSM their
    // own region's unreviewed one, other staff only their own requests.
    if (actor.role !== "ACCOUNTANT") {
      add("discountRequests", async () => {
        const where: Prisma.CustomDiscountRequestWhereInput = { status: "PENDING" };
        if (isAdminLike(actor)) where.rsmApprovalStatus = "APPROVED";
        else if (actor.role === "RSM") Object.assign(where, await buildRsmDiscountRequestWhere(actor, prisma), { rsmApprovalStatus: "PENDING" });
        else if (isStaffLike(actor)) where.staffId = actor.staffId;
        else return 0;
        return prisma.customDiscountRequest.count({ where });
      });
    }

    // Fund requests: the one status this role can action right now.
    const stage = actor.role === "RSM" ? "rsm"
      : actor.role === "STAFF" || actor.role === "ASM" ? "staff"
      : actor.role === "ACCOUNTANT" ? "accountant"
      : null;
    if (stage) {
      add("fundRequests", async () => {
        const scope = await buildFundRequestScope(actor, prisma);
        return prisma.dealerFundRequest.count({ where: { ...scope, status: STAGE_REQUIRES[stage] } });
      });
    }

    if (isAdminLike(actor) || isStaffLike(actor)) {
      add("dealerRequests", () => prisma.dealerRequest.count({
        where: { status: "pending", ...(isAdminLike(actor) ? {} : { submittedById: actor.staffId?.toString() ?? "" }) },
      }));
    }

    if (actor.role === "ACCOUNTANT") {
      add("settlements", () => prisma.walletSettlement.count({ where: { status: "OPEN" } }));
    }
  }

  // A badge is ancillary: one failing query must not blank the rest.
  const settled = await Promise.allSettled(jobs.map(([, promise]) => promise));
  const counts: Record<string, number> = {};
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") counts[jobs[index][0]] = result.value;
    else console.error(`[GET /api/sidebar-counts] ${jobs[index][0]} failed`, result.reason);
  });
  return counts;
}

export async function GET() {
  try {
    return NextResponse.json({ success: true, counts: await countsFor(await requireAuth()) });
  } catch (error: any) {
    const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : error?.message === "Forbidden" ? 403 : 500);
    return NextResponse.json({ success: false, counts: {}, message: status >= 500 ? "Failed to load counts" : error.message }, { status });
  }
}
