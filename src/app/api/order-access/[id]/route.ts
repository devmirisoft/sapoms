import { NextResponse } from "next/server";
import { resolveOrderAccess } from "@/lib/orderAccess";
import { fetchStaffAssignedDealerIds, orderActorFromAuth } from "@/lib/orderScopeServer";
import { serializePrismaValue } from "@/server/db/prisma-serialize";
import { requireAuth } from "@/server/auth/session";
import { isAdminLike } from "@/server/auth/sales-scope";
import { coversOrderRsmStep } from "@/lib/postgresOrderStatus";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const authActor = await requireAuth();
    const actor = orderActorFromAuth(authActor);
    if (!actor) {
      return NextResponse.json({ success: false, message: "Order scope is not available for this session." }, { status: 403 });
    }
    let assignmentLookupFailed = false;
    let access = await resolveOrderAccess(id, {
      actor,
      assignedDealerIds: [],
    });
    if (!access.visible && actor.role === "staff") {
      const assignedDealerIds = await fetchStaffAssignedDealerIds(actor.actorId).catch((error) => {
        assignmentLookupFailed = true;
        console.warn("[GET /api/order-access/[id]] staff assignment lookup failed", error);
        return [];
      });
      access = await resolveOrderAccess(id, {
        actor,
        assignedDealerIds,
      });
    }
    if (!access.visible) {
      const reason = assignmentLookupFailed && access.reason === "forbidden"
        ? "legacy_unavailable"
        : access.reason;
      const status = reason === "forbidden" ? 403 : 404;
      const message = assignmentLookupFailed && access.reason === "forbidden"
        ? "Order verification is temporarily unavailable."
        : access.message;
      return NextResponse.json({ success: false, reason, message }, { status });
    }
    // The NSM (or Admin with no NSM) approves for an unavailable RSM.
    const rsmCover = isAdminLike(authActor) && await coversOrderRsmStep(authActor, id);
    return NextResponse.json(serializePrismaValue({ success: true, data: { ...access.order, rsm_cover: rsmCover } }));
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthenticated") {
      return NextResponse.json({ success: false, message: "Authentication required." }, { status: 401 });
    }
    console.error("[GET /api/order-access/[id]]", error);
    return NextResponse.json({ success: false, message: "Unable to verify order access" }, { status: 502 });
  }
}

