import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireAuth } from "@/server/auth/session";
import {
  assertDealerScope,
  assertDraftBelongsToDealer,
  buildCustomDiscountCreate,
  customDiscountInclude,
  dealerExists,
  mapCustomDiscount,
  text,
  updateDraftApprovalState,
} from "@/lib/postgresDiscountDrafts";
import { buildPendingRequestLookup } from "@/lib/customDiscountRequests";
import { buildRsmDiscountRequestWhere, isStaffLike } from "@/server/auth/sales-scope";

export const runtime = "nodejs";

function jsonError(error: any, fallback: string) {
  const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : error?.message === "Forbidden" ? 403 : 500);
  return NextResponse.json({ success: false, message: status >= 500 ? fallback : error.message }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth();
    const sp = req.nextUrl.searchParams;
    const dealerParam = text(sp.get("dealer_id") || sp.get("dealerId"), 80);
    const staffParam = text(sp.get("staff_id") || sp.get("assignedStaffId") || sp.get("assigned_staff_id"), 80);
    const status = text(sp.get("status"), 40).toUpperCase();
    const rsmStatus = text(sp.get("rsm_status") || sp.get("rsmStatus"), 40).toUpperCase();
    const orderId = text(sp.get("order_id") || sp.get("orderId"), 80);
    const orderDraftId = text(sp.get("order_draft_id") || sp.get("orderDraftId"), 80);
    const reorderable = sp.get("reorderable") === "true";
    const limit = Math.min(500, Math.max(1, Number(sp.get("limit") || 100) || 100));

    const where: any = {};
    if (actor?.role === "DEALER") where.dealerId = actor.dealerId;
    else if (dealerParam) where.dealerId = BigInt(dealerParam);
    // An RSM reviews their whole region plus everything raised by the staff
    // reporting into them; other staff only ever see their own requests.
    if (actor?.role === "RSM") Object.assign(where, await buildRsmDiscountRequestWhere(actor, prisma));
    else if (actor && isStaffLike(actor)) where.staffId = actor.staffId;
    else if (staffParam) where.staffId = BigInt(staffParam);
    if (["PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(rsmStatus)) where.rsmApprovalStatus = rsmStatus;
    if (["PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(status)) where.status = status;
    if (orderId) where.orderId = BigInt(orderId);
    if (orderDraftId) where.orderDraftId = BigInt(orderDraftId);
    if (reorderable) {
      where.status = "APPROVED";
      where.allowReorder = true;
    }

    const rows = await prisma.customDiscountRequest.findMany({ where, include: customDiscountInclude, orderBy: { createdAt: "desc" }, take: limit });
    return NextResponse.json({ success: true, data: rows.map(mapCustomDiscount) });
  } catch (error) {
    console.error("custom-discount-requests GET failed", error);
    return jsonError(error, "Failed to load custom discount requests");
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAuth();
    const body = await req.json();
    const dealerId = actor?.role === "DEALER" && actor.dealerId
      ? actor.dealerId
      : BigInt(text(body.dealerId || body.dealer_id, 80));
    assertDealerScope(actor, dealerId);
    const dealer = await dealerExists(dealerId);
    const orderDraftId = text(body.orderDraftId || body.order_draft_id, 120);
    if (!orderDraftId) return NextResponse.json({ success: false, message: "orderDraftId is required" }, { status: 400 });
    const staffId = dealer.staffAssignments[0]?.staffId ?? null;
    const data = await buildCustomDiscountCreate(body, dealerId, staffId);
    await assertDraftBelongsToDealer(data.orderDraftId, dealerId);

    const pendingLookup = buildPendingRequestLookup(dealerId.toString(), data.orderDraftId.toString());
    const existing = await prisma.customDiscountRequest.findFirst({ where: { dealerId: BigInt(pendingLookup.dealerId), orderDraftId: BigInt(pendingLookup.orderDraftId), status: "PENDING" }, include: customDiscountInclude });
    if (existing) return NextResponse.json({ success: true, data: mapCustomDiscount(existing) });

    const created = await prisma.customDiscountRequest.create({ data, include: customDiscountInclude });
    await updateDraftApprovalState(created.orderDraftId, dealerId, {
      approvalRequestId: created.id.toString(),
      status: "pending",
      requestedOrderDiscountPercent: created.requestedOrderDiscountPercent === null ? null : Number(created.requestedOrderDiscountPercent),
      requestedProductDiscounts: (created.requestedProductDiscounts ?? {}) as Record<string, number>,
    });
    return NextResponse.json({ success: true, data: mapCustomDiscount(created) }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/custom-discount-requests]", error);
    return jsonError(error, "Failed to create custom discount request");
  }
}
