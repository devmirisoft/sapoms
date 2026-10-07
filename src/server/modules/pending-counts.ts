import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { AuthActor } from "@/server/auth/session";
import { buildRsmDiscountRequestWhere, coversNsmStage, coversRsmStage, dealerRequestCoverIds, isAdminLike, isStaffLike, orphanRsmDiscountWhere, orphanRsmFundWhere } from "@/server/auth/sales-scope";
import { buildFundRequestScope, STAGE_REQUIRES } from "@/lib/dealerFundRequests";
import { actorWhere } from "@/lib/postgresOrders";
import { fetchStaffAssignedDealerIds, orderActorFromAuth } from "@/lib/orderScopeServer";

// Lifted out of GET /api/sidebar-counts so the assistant's "what's pending for me"
// answers with the same numbers as the sidebar badges.

/* Every sidebar badge in one round trip. The scoping per key mirrors the page
   each badge links to, so the number in the nav equals the number on arrival.
   Replaces the former per-badge /pending-count endpoints. */

/* Same scope the order list uses, so the badge matches the list on arrival:
   Sales Manager chain for ASM/RSM, RSM gate and warehouse for plain Staff. */
async function orderScope(actor: AuthActor): Promise<Prisma.OrderWhereInput> {
  if (actor.role === "DEALER") return { dealerId: actor.dealerId };
  if (isStaffLike(actor)) {
    const orderActor = orderActorFromAuth(actor);
    if (!orderActor) return { id: BigInt(-1) };
    return actorWhere(orderActor, await fetchStaffAssignedDealerIds(orderActor.actorId));
  }
  return {};
}

export async function countsFor(actor: AuthActor) {
  const jobs: [string, Promise<number>][] = [];
  const add = (key: string, run: () => Promise<number>) => jobs.push([key, run()]);

  if (actor.role === "DEALER") {
    if (!actor.dealerId) return {};
    const dealerId = actor.dealerId;
    add("drafts", () => prisma.orderDraft.count({ where: { dealerId, status: "ACTIVE" } }));
    add("orders", () => prisma.order.count({ where: { dealerId, acceptanceStatus: "AWAITING", status: { notIn: ["CANCELLED", "DECLINED"] } } }));
    add("fundRequests", () => prisma.dealerFundRequest.count({ where: { dealerId, status: { notIn: ["COMPLETED", "REJECTED"] } } }));
  } else {
    add("pendingOrders", async () => prisma.order.count({ where: { AND: [await orderScope(actor), { acceptanceStatus: "AWAITING", status: { notIn: ["CANCELLED", "DECLINED"] } }] } }));

    // Discount approvals: the NSM reviews large RSM-cleared asks, admin the
    // RSM-cleared queue once any NSM stage is cleared, an RSM their own
    // region's unreviewed one, other staff only their own requests. The NSM
    // also gets RSM-stage asks with no available RSM; Admin, with no active
    // NSM, gets those and the NSM stage too.
    if (actor.role !== "ACCOUNTANT") {
      add("discountRequests", async () => {
        const where: Prisma.CustomDiscountRequestWhereInput = { status: "PENDING" };
        const [rsmCover, nsmCover] = await Promise.all([coversRsmStage(actor, prisma), coversNsmStage(actor, prisma)]);
        const nsmQueue: Prisma.CustomDiscountRequestWhereInput = { rsmApprovalStatus: "APPROVED", nsmApprovalStatus: "PENDING" };
        const adminQueue: Prisma.CustomDiscountRequestWhereInput = { rsmApprovalStatus: "APPROVED", OR: [{ nsmApprovalStatus: null }, { nsmApprovalStatus: "APPROVED" }] };
        if (actor.role === "NSM") Object.assign(where, { OR: [nsmQueue, ...(rsmCover ? [orphanRsmDiscountWhere] : [])] });
        else if (isAdminLike(actor)) Object.assign(where, { OR: [adminQueue, ...(nsmCover ? [nsmQueue] : []), ...(rsmCover ? [orphanRsmDiscountWhere] : [])] });
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
    } else if (isAdminLike(actor)) {
      // RSM-stage requests the NSM/Admin approve for an unavailable RSM.
      add("fundRequests", async () => (await coversRsmStage(actor, prisma)) ? prisma.dealerFundRequest.count({ where: orphanRsmFundWhere }) : 0);
    }

    // Dealer requests: admin's queue (plus RSM-stage ones with no available RSM),
    // an RSM's team queue, others their own open ones.
    if (isAdminLike(actor) || isStaffLike(actor)) {
      add("dealerRequests", async () => (await prisma.dealerRequest.count({
        where: isAdminLike(actor) ? { status: "pending" }
          : actor.role === "RSM" ? { status: "rsm_pending", rsmUserId: actor.userId }
          : { status: { in: ["pending", "rsm_pending"] }, submittedById: actor.staffId?.toString() ?? "" },
      })) + (isAdminLike(actor) ? (await dealerRequestCoverIds(actor, prisma)).size : 0));
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
    else console.error(`[pending-counts] ${jobs[index][0]} failed`, result.reason);
  });
  return counts;
}
