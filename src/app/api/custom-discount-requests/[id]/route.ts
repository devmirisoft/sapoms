import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireAuth, type AuthActor } from "@/server/auth/session";
import { buildDealerRegionWhere, resolveRsmTeamStaffIds } from "@/server/auth/sales-scope";
import {
  assertDealerScope,
  assertDraftBelongsToDealer,
  assertOrderBelongsToDealer,
  buildCustomDiscountCreate,
  customDiscountInclude,
  jsonValue,
  mapCustomDiscount,
  text,
} from "@/lib/postgresDiscountDrafts";
import { placeOrderForApprovedDiscount } from "@/lib/discountApprovalOrder";

export const runtime = "nodejs";

const DEFAULT_REJECTION_NOTE = "Please revise the discount percentage and resubmit.";

function jsonError(error: any, fallback: string) {
  const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : error?.message === "Forbidden" ? 403 : 500);
  return NextResponse.json({ success: false, message: status >= 500 ? fallback : error.message }, { status });
}

function statusValue(value: string) {
  const status = value.toUpperCase();
  if (["APPROVED", "REJECTED", "PENDING", "CANCELLED"].includes(status)) return status as "APPROVED" | "REJECTED" | "PENDING" | "CANCELLED";
  return null;
}

async function loadRequest(id: string) {
  if (!/^\d+$/.test(id)) return null;
  return prisma.customDiscountRequest.findUnique({ where: { id: BigInt(id) }, include: customDiscountInclude });
}

// Mirrors buildRsmDiscountRequestWhere for a single request: in scope if the
// dealer sits in the RSM's region, or if the request was raised by a staff
// member reporting into them.
async function assertRsmDiscountScope(actor: AuthActor, dealerId: bigint, requestStaffId: bigint | null) {
  if (requestStaffId) {
    const teamStaffIds = await resolveRsmTeamStaffIds(actor, prisma);
    if (teamStaffIds.some((staffId) => staffId === requestStaffId)) return;
  }
  // A team request can hold a dealer whose region is unset or set elsewhere, so
  // an unconfigured region must not fail the whole check on its own.
  const dealerWhere = await buildDealerRegionWhere(actor, undefined, prisma).catch(() => ({} as Record<string, never>));
  if (Object.keys(dealerWhere).length === 0) throw Object.assign(new Error("This request is outside your RSM scope"), { status: 403 });
  const scoped = await prisma.dealerProfile.findFirst({ where: { id: dealerId, ...dealerWhere }, select: { id: true } });
  if (!scoped) throw Object.assign(new Error("This request is outside your RSM scope"), { status: 403 });
}

function rejectionRows(request: any) {
  const products = Array.isArray(request.orderSnapshot?.products) ? request.orderSnapshot.products : [];
  return products.slice(0, 100).map((product: any, index: number) => ({
    key: index + 1,
    productname: text(product.productName || product.catalogueNumber, 200),
    displayName: text(product.productName || product.catalogueNumber, 300),
    variantCode: text(product.catalogueNumber || product.sku, 160),
    producQuanity: Number(product.quantity ?? 1),
    price: Number(product.unitPrice ?? 0),
    packSize: Number(product.packSize ?? 1),
    isPriority: !!product.isPriority,
    productNote: text(product.productNote, 500),
  }));
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireAuth();
    const row = await loadRequest(id);
    if (!row) return NextResponse.json({ success: false, message: "Request not found" }, { status: 404 });
    if (actor?.role === "DEALER") {
      const actorId = actor.dealerId?.toString() || "";
      const ownerId = row.dealerId.toString();
      if (!actorId || actorId !== ownerId) return NextResponse.json({ success: false, message: "Request not found" }, { status: 404 });
    }
    if (actor.role === "RSM") await assertRsmDiscountScope(actor, row.dealerId, row.staffId);
    else assertDealerScope(actor, row.dealerId);
    return NextResponse.json({ success: true, data: mapCustomDiscount(row) });
  } catch (error) {
    console.error("[GET /api/custom-discount-requests/[id]]", error);
    return jsonError(error, "Failed to load custom discount request");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await requireAuth();
    const body = await req.json();
    const existing = await loadRequest(id);
    if (!existing) return NextResponse.json({ success: false, message: "Request not found" }, { status: 404 });
    if (actor?.role === "DEALER") {
      const actorId = actor.dealerId?.toString() || "";
      const ownerId = existing.dealerId.toString();
      if (!actorId || actorId !== ownerId) return NextResponse.json({ success: false, message: "Request not found" }, { status: 404 });
    }
    if (actor.role === "RSM") await assertRsmDiscountScope(actor, existing.dealerId, existing.staffId);
    else assertDealerScope(actor, existing.dealerId);

    const rawStatus = text(body.status, 40);
    const rawRsmStatus = text(body.rsmStatus ?? body.rsmApprovalStatus ?? (actor.role === "RSM" ? body.status : ""), 40);
    const nextStatus = rawStatus && actor.role !== "RSM" ? statusValue(rawStatus) : null;
    const nextRsmStatus = rawRsmStatus ? statusValue(rawRsmStatus) : null;
    const orderId = text(body.orderId || body.order_id, 80);
    const hasOrderLink = !!orderId;
    const reviewUpdate = !!nextStatus;
    const rsmReviewUpdate = !!nextRsmStatus;
    if (rawStatus && actor.role !== "RSM" && !nextStatus) return NextResponse.json({ success: false, message: "Invalid status" }, { status: 400 });
    if (rawRsmStatus && !nextRsmStatus) return NextResponse.json({ success: false, message: "Invalid RSM status" }, { status: 400 });
    const wantsResubmit = text(body.action, 40).toLowerCase() === "resubmit" || body.orderSnapshot !== undefined || body.products !== undefined || body.requestedDiscountPercent !== undefined || body.requestedProductDiscounts !== undefined;
    if (reviewUpdate && actor?.role !== "ADMIN") throw Object.assign(new Error("Only Admin can review custom discounts"), { status: 403 });
    if (rsmReviewUpdate && actor?.role !== "RSM") throw Object.assign(new Error("Only RSM can perform RSM custom discount review"), { status: 403 });
    if (reviewUpdate && existing.rsmApprovalStatus !== "APPROVED") throw Object.assign(new Error("RSM approval is required before Admin review"), { status: 409 });
    if (wantsResubmit && actor?.role === "ADMIN") throw Object.assign(new Error("Admin cannot resubmit dealer custom discounts"), { status: 403 });
    if (wantsResubmit && !["PENDING", "REJECTED"].includes(String(existing.status))) throw Object.assign(new Error("Only pending or rejected requests can be resubmitted"), { status: 409 });
    if (!reviewUpdate && !rsmReviewUpdate && typeof body.allowReorder !== "boolean" && !hasOrderLink && !wantsResubmit) {
      return NextResponse.json({ success: false, message: "No supported update supplied" }, { status: 400 });
    }

    const data: any = { updatedAt: new Date() };
    if (rsmReviewUpdate && nextRsmStatus) {
      if (existing.rsmApprovalStatus !== "PENDING") throw Object.assign(new Error("RSM review is already complete"), { status: 409 });
      data.rsmApprovalStatus = nextRsmStatus;
      data.rsmReviewedByUserId = actor.userId;
      data.rsmReviewedByName = actor.displayName || actor.email;
      data.rsmReviewedAt = new Date();
      // The RSM review UI posts its note as adminNote; keep it in its own column
      // so an RSM reason is never confused with, or overwritten by, an Admin one.
      data.rsmNote = text(body.rsmNote ?? body.rsm_note ?? body.adminNote ?? body.admin_note, 1500) || null;
      if (nextRsmStatus === "REJECTED") {
        data.status = "REJECTED";
        data.allowReorder = false;
      }
    }
    if (reviewUpdate && nextStatus) {
      data.status = nextStatus;
      data.adminNote = text(body.adminNote ?? body.admin_note, 1500) || null;
      data.reviewedByUserId = actor?.userId && actor.userId > BigInt(0) ? actor.userId : null;
      data.reviewedAt = nextStatus === "PENDING" ? null : new Date();
      data.allowReorder = nextStatus === "APPROVED" ? true : nextStatus === "REJECTED" ? false : existing.allowReorder;
    }
    if (typeof body.allowReorder === "boolean") {
      if (actor?.role !== "ADMIN") throw Object.assign(new Error("Only Admin can change reorder permission"), { status: 403 });
      data.allowReorder = body.allowReorder;
    }
    if (hasOrderLink) {
      const linkedOrderId = BigInt(orderId);
      await assertOrderBelongsToDealer(linkedOrderId, existing.dealerId);
      if (existing.status !== "APPROVED") throw Object.assign(new Error("Only approved requests can link to an order"), { status: 409 });
      data.orderId = linkedOrderId;
    }
    if (wantsResubmit) {
      const rebuilt = await buildCustomDiscountCreate({
        ...body,
        orderDraftId: body.orderDraftId ?? body.order_draft_id ?? existing.orderDraftId?.toString(),
      }, existing.dealerId, existing.staffId);
      await assertDraftBelongsToDealer(rebuilt.orderDraftId, existing.dealerId);
      Object.assign(data, rebuilt, { status: "PENDING", rsmApprovalStatus: "PENDING", rsmReviewedByUserId: null, rsmReviewedByName: null, rsmReviewedAt: null, rsmNote: null, adminNote: null, reviewedByUserId: null, reviewedAt: null, allowReorder: false });
    }

    const updated = await prisma.$transaction(async (tx) => {
      let rejectionDraftId: bigint | null = null;
      // A rejection can come from either stage, so the draft carries whichever
      // note was written. Both are surfaced structurally in rejection_notes and
      // flattened into order_note for anything that only reads the text.
      if ((reviewUpdate && nextStatus === "REJECTED") || (rsmReviewUpdate && nextRsmStatus === "REJECTED")) {
        const rejectedByRsm = rsmReviewUpdate && nextRsmStatus === "REJECTED";
        const adminNoteText = rejectedByRsm ? "" : text(data.adminNote, 1500);
        const rsmNoteText = rejectedByRsm ? text(data.rsmNote, 1500) : text(existing.rsmNote, 1500);
        const reasonText = (rejectedByRsm ? rsmNoteText : adminNoteText) || DEFAULT_REJECTION_NOTE;
        const rejectionNotes = {
          rejected_by: rejectedByRsm ? "RSM" : "ADMIN",
          rejected_at: new Date().toISOString(),
          admin_note: adminNoteText || null,
          rsm_note: rsmNoteText || null,
          reason: reasonText,
        };
        const draft = await tx.orderDraft.create({
          data: {
            dealerId: existing.dealerId,
            name: `Disapproved Request: ${new Date().toLocaleString("en-IN")}`,
            snapshot: jsonValue({
              rows: rejectionRows(existing),
              shipto: (existing.orderSnapshot as any)?.shipto ?? null,
              refno: (existing.orderSnapshot as any)?.refno ?? null,
              order_note: [
                text((existing.orderSnapshot as any)?.orderNote),
                `--- ${rejectionNotes.rejected_by} REJECTION NOTE ---`,
                reasonText,
                // An RSM rejection never reached Admin, so there is no second note.
                !rejectedByRsm && rsmNoteText ? `--- RSM NOTE ---\n${rsmNoteText}` : "",
                "Please update your cart and resubmit.",
              ].filter(Boolean).join("\n\n"),
              rejection_notes: rejectionNotes,
              source: "custom_discount_rejection",
              source_request_id: existing.id.toString(),
            }),
            approvalState: jsonValue({ approvalRequestId: existing.id.toString(), status: "rejected", updatedAt: new Date().toISOString() }),
          },
        });
        rejectionDraftId = draft.id;
      }
      let row = await tx.customDiscountRequest.update({ where: { id: existing.id }, data, include: customDiscountInclude });

      // Admin approval places the order straight from the approved snapshot and
      // retires the draft, so the dealer never has to resubmit what was signed off.
      let placedOrder: { id: bigint; orderNumber: string } | null = null;
      if (reviewUpdate && nextStatus === "APPROVED") {
        const created = await placeOrderForApprovedDiscount(tx, row, { userId: actor.userId });
        if (created) {
          placedOrder = { id: created.id, orderNumber: created.orderNumber };
          row = await tx.customDiscountRequest.update({
            where: { id: row.id },
            data: { orderId: created.id },
            include: customDiscountInclude,
          });
        }
      }

      // A converted draft keeps the status set above; only refresh approval
      // state when the draft is still the dealer's to edit.
      if (row.orderDraftId && !placedOrder) {
        await tx.orderDraft.updateMany({
          where: { id: row.orderDraftId, dealerId: row.dealerId },
          data: { approvalState: jsonValue({ approvalRequestId: row.id.toString(), status: String(row.status).toLowerCase(), updatedAt: new Date().toISOString() }) },
        });
      }
      return { row, rejectionDraftId, placedOrder };
    });

    const dto = mapCustomDiscount(updated.row) as any;
    if (updated.rejectionDraftId) dto.rejectionDraftId = updated.rejectionDraftId.toString();
    if (updated.placedOrder) {
      dto.placedOrderId = updated.placedOrder.id.toString();
      dto.placedOrderNumber = updated.placedOrder.orderNumber;
    }
    return NextResponse.json({ success: true, data: dto });
  } catch (error) {
    console.error("[PATCH /api/custom-discount-requests/[id]]", error);
    return jsonError(error, "Failed to update custom discount request");
  }
}
