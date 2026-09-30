import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { requireAuth } from "@/server/auth/session";
import { actorWhere } from "@/lib/postgresOrders";
import { fetchStaffAssignedDealerIds, orderActorFromAuth } from "@/lib/orderScopeServer";
import { buildMissedActivity } from "@/lib/missedActivity";

export const runtime = "nodejs";

const FLOW_ROLES = ["RSM", "STAFF", "ASM", "DEALER"];

/* Order-flow activity between the user's previous logout (or previous login,
   when they never signed out) and the login that opened this session. The
   window comes from the LOGIN/LOGOUT rows the audit log already writes. */
export async function GET() {
  try {
    const actor = await requireAuth();
    const orderActor = orderActorFromAuth(actor);
    if (!FLOW_ROLES.includes(actor.role) || !orderActor) return NextResponse.json({ success: true, key: null, items: [] });

    const session = await prisma.authSession.findUnique({ where: { id: actor.sessionId }, select: { createdAt: true } });
    if (!session) return NextResponse.json({ success: true, key: null, items: [] });
    const until = session.createdAt;
    const previous = await prisma.authAuditLog.findFirst({
      where: { actorId: actor.userId, action: { in: ["LOGIN", "LOGOUT"] }, createdAt: { lt: until } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    // First ever login: nothing was "missed".
    if (!previous) return NextResponse.json({ success: true, key: until.toISOString(), items: [] });
    const since = previous.createdAt;

    const window = { gt: since, lte: until };
    const timeWhere: Prisma.OrderWhereInput = actor.role === "RSM"
      ? { createdAt: window }
      : actor.role === "DEALER"
        ? { OR: [{ acceptanceReviewedAt: window }, { dispatchedAt: window }] }
        : { rsmReviewedAt: window };
    const scope = await actorWhere(orderActor, actor.role === "DEALER" ? [] : await fetchStaffAssignedDealerIds(orderActor.actorId));

    const orders = await prisma.order.findMany({
      where: { AND: [scope, timeWhere] },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true, orderNumber: true, createdAt: true,
        rsmApprovalStatus: true, rsmReviewedAt: true, rsmReviewedByName: true,
        acceptanceStatus: true, acceptanceReviewedAt: true, acceptanceReviewedByName: true,
        dispatchedAt: true, dealer: { select: { businessName: true } },
      },
    });

    const items = buildMissedActivity(actor.role, orders.map((order) => ({
      ...order,
      id: order.id.toString(),
      dealerName: order.dealer.businessName,
    })), since, until);
    return NextResponse.json({ success: true, key: until.toISOString(), items });
  } catch (error: any) {
    const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : 500);
    if (status >= 500) console.error("[GET /api/missed-activity]", error);
    return NextResponse.json({ success: false, key: null, items: [] }, { status });
  }
}
