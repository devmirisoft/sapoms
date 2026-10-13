import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireAuth, type AuthActor } from "@/server/auth/session";
import { buildDealerRegionWhere, discountCovers, onBehalfName, resolveRsmTeamStaffIds } from "@/server/auth/sales-scope";
import {
  assertDealerScope,
  assertDraftBelongsToDealer,
  assertOrderBelongsToDealer,
  buildCustomDiscountCreate,
  customDiscountInclude,
  jsonValue,
  mapCustomDiscount,
  paise,
  rejectionRows,
  text,
} from "@/lib/postgresDiscountDrafts";
import { normalizeApprovalProductKey, requiresNsmReview, splitApprovalSnapshot, type ApprovalSnapshotProduct } from "@/lib/customDiscountRequests";
import { placeOrderForApprovedDiscount } from "@/lib/discountApprovalOrder";
import { AUDIT_ACTION, AUDIT_ENTITY } from "@/lib/auditActions";
import { createAuditLog } from "@/server/audit/audit-log";
import { diffValues } from "@/server/audit/audit-sanitize";

export const runtime = "nodejs";

const DEFAULT_REJECTION_NOTE = "Please revise the discount percentage and resubmit.";

function jsonError(error: any, fallback: string) {
  const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : error?.message === "Forbidden" ? 403 : 500);
  return NextResponse.json({ success: false, message: status >= 500 ? fallback : error.message }, { status });
}

function statusValue(value: string) {
  const status = value.toUpperCase();
  if (["APPROVED", "REJECTED", "PENDING"].includes(status)) return status as "APPROVED" | "REJECTED" | "PENDING";
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

    // An NSM covers an unavailable RSM's stage; Admin covers it too, and the NSM
    // stage, when there is no active NSM.
    const cover = (await discountCovers(actor, prisma, existing.id)).get(existing.id.toString()) ?? null;
    const rsmStage = actor.role === "RSM" || cover === "rsm";
    const nsmStage = cover === "nsm" || (actor.role === "NSM" && !cover);
    // RSM and NSM (or whoever covers them) post their decision as `status` too; it lands on their own stage.
    const stageRole = rsmStage || nsmStage;
    const rawStatus = text(body.status, 40);
    const rawRsmStatus = text(body.rsmStatus ?? body.rsmApprovalStatus ?? (rsmStage ? body.status : ""), 40);
    const rawNsmStatus = text(body.nsmStatus ?? body.nsmApprovalStatus ?? (nsmStage ? body.status : ""), 40);
    // Admin only covers when there is no active NSM, so Admin is the next and last
    // reviewer anyway: approving on behalf of the missing stages is also the final approval.
    const adminAlone = actor.role === "ADMIN" && !!cover && statusValue(rawStatus) === "APPROVED";
    const nextStatus = rawStatus && (!stageRole || adminAlone) ? statusValue(rawStatus) : null;
    const nextRsmStatus = rawRsmStatus ? statusValue(rawRsmStatus) : null;
    const nextNsmStatus = rawNsmStatus ? statusValue(rawNsmStatus) : null;
    const orderId = text(body.orderId || body.order_id, 80);
    const hasOrderLink = !!orderId;
    const reviewUpdate = !!nextStatus;
    const rsmReviewUpdate = !!nextRsmStatus;
    const nsmReviewUpdate = !!nextNsmStatus;
    if (rawStatus && !stageRole && !nextStatus) return NextResponse.json({ success: false, message: "Invalid status" }, { status: 400 });
    if (rawRsmStatus && !nextRsmStatus) return NextResponse.json({ success: false, message: "Invalid RSM status" }, { status: 400 });
    if (rawNsmStatus && !nextNsmStatus) return NextResponse.json({ success: false, message: "Invalid NSM status" }, { status: 400 });
    const wantsResubmit = text(body.action, 40).toLowerCase() === "resubmit" || body.orderSnapshot !== undefined || body.products !== undefined || body.requestedDiscountPercent !== undefined || body.requestedProductDiscounts !== undefined;
    if (reviewUpdate && actor?.role !== "ADMIN") throw Object.assign(new Error("Only Admin can review custom discounts"), { status: 403 });
    if (rsmReviewUpdate && !rsmStage) throw Object.assign(new Error("Only RSM can perform RSM custom discount review"), { status: 403 });
    if (nsmReviewUpdate && !nsmStage) throw Object.assign(new Error("Only NSM can perform NSM custom discount review"), { status: 403 });
    if (reviewUpdate && !adminAlone && existing.rsmApprovalStatus !== "APPROVED") throw Object.assign(new Error("RSM approval is required before Admin review"), { status: 409 });
    if (reviewUpdate && !adminAlone && existing.nsmApprovalStatus !== null && existing.nsmApprovalStatus !== "APPROVED") throw Object.assign(new Error("NSM approval is required before Admin review"), { status: 409 });
    if (nsmReviewUpdate && existing.nsmApprovalStatus === null) throw Object.assign(new Error("This request does not need NSM review"), { status: 409 });
    if (nsmReviewUpdate && existing.rsmApprovalStatus !== "APPROVED") throw Object.assign(new Error("RSM approval is required before NSM review"), { status: 409 });
    if (wantsResubmit && actor?.role === "ADMIN") throw Object.assign(new Error("Admin cannot resubmit dealer custom discounts"), { status: 403 });
    if (wantsResubmit && !["PENDING", "REJECTED"].includes(String(existing.status))) throw Object.assign(new Error("Only pending or rejected requests can be resubmitted"), { status: 409 });
    if (!reviewUpdate && !rsmReviewUpdate && !nsmReviewUpdate && typeof body.allowReorder !== "boolean" && !hasOrderLink && !wantsResubmit) {
      return NextResponse.json({ success: false, message: "No supported update supplied" }, { status: 400 });
    }

    const data: any = { updatedAt: new Date() };
    if (rsmReviewUpdate && nextRsmStatus) {
      if (existing.rsmApprovalStatus !== "PENDING") throw Object.assign(new Error("RSM review is already complete"), { status: 409 });
      // A covering Admin with the NSM stage also pending stands in for both.
      const coversBoth = cover === "rsm" && actor.role === "ADMIN" && existing.nsmApprovalStatus === "PENDING";
      data.rsmApprovalStatus = nextRsmStatus;
      data.rsmReviewedByUserId = actor.userId;
      data.rsmReviewedByName = cover === "rsm" ? onBehalfName(actor, coversBoth ? "RSM and NSM" : "RSM") : actor.displayName || actor.email;
      data.rsmReviewedAt = new Date();
      // The RSM review UI posts its note as adminNote; keep it in its own column
      // so an RSM reason is never confused with, or overwritten by, an Admin one.
      data.rsmNote = text(body.rsmNote ?? body.rsm_note ?? body.adminNote ?? body.admin_note, 1500) || null;
      // Every decision, approve or reject, at every stage must carry a remark.
      if (!data.rsmNote) throw Object.assign(new Error("A remark is required to approve or reject a discount request"), { status: 400 });
      if (nextRsmStatus === "REJECTED") {
        data.status = "REJECTED";
        data.allowReorder = false;
      }
      // One click clears both stages: the NSM covering the RSM is the NSM, and a
      // covering Admin stands in for both. Admin's final review stays separate.
      if (cover === "rsm" && nextRsmStatus === "APPROVED" && existing.nsmApprovalStatus === "PENDING") {
        data.nsmApprovalStatus = "APPROVED";
        data.nsmReviewedByUserId = actor.userId;
        data.nsmReviewedByName = coversBoth ? data.rsmReviewedByName : actor.displayName || actor.email;
        data.nsmReviewedAt = data.rsmReviewedAt;
        data.nsmNote = data.rsmNote;
      }
    }
    if (nsmReviewUpdate && nextNsmStatus) {
      if (existing.nsmApprovalStatus !== "PENDING") throw Object.assign(new Error("NSM review is already complete"), { status: 409 });
      data.nsmApprovalStatus = nextNsmStatus;
      data.nsmReviewedByUserId = actor.userId;
      data.nsmReviewedByName = cover === "nsm" ? onBehalfName(actor, "NSM") : actor.displayName || actor.email;
      data.nsmReviewedAt = new Date();
      data.nsmNote = text(body.nsmNote ?? body.adminNote ?? body.admin_note, 1500) || null;
      if (!data.nsmNote) throw Object.assign(new Error("A remark is required to approve or reject a discount request"), { status: 400 });
      if (nextNsmStatus === "REJECTED") {
        data.status = "REJECTED";
        data.allowReorder = false;
      }
    }
    if (reviewUpdate && nextStatus) {
      data.status = nextStatus;
      data.adminNote = text(body.adminNote ?? body.admin_note, 1500) || null;
      if (nextStatus !== "PENDING" && !data.adminNote) throw Object.assign(new Error("A remark is required to approve or reject a discount request"), { status: 400 });
      data.reviewedByUserId = actor?.userId && actor.userId > BigInt(0) ? actor.userId : null;
      data.reviewedAt = nextStatus === "PENDING" ? null : new Date();
      data.allowReorder = nextStatus === "APPROVED" ? true : nextStatus === "REJECTED" ? false : existing.allowReorder;
    }
    // Selective approval, at any stage: the approved lines carry on (and become
    // the order at Admin), the rejected ones go back to the dealer as a fresh draft (below).
    let partialRejected: ApprovalSnapshotProduct[] = [];
    // Every custom line rejected: no discount is approved, and the standard
    // lines go ahead as a normal order through the normal order approval flow.
    let standardOnly = false;
    // The final decision wins when one call carries several (Admin approving alone).
    const partialStage = reviewUpdate ? "ADMIN" : nsmReviewUpdate ? "NSM" : "RSM";
    const partialNote = text(partialStage === "ADMIN" ? data.adminNote : partialStage === "NSM" ? data.nsmNote : data.rsmNote, 1500);
    if (body.rejectedLines !== undefined) {
      const decisions = [reviewUpdate && nextStatus, rsmReviewUpdate && nextRsmStatus, nsmReviewUpdate && nextNsmStatus].filter(Boolean);
      if (!decisions.length || decisions.some((decision) => decision !== "APPROVED")) throw Object.assign(new Error("Lines can only be rejected while approving"), { status: 400 });
      if (!Array.isArray(body.rejectedLines)) throw Object.assign(new Error("rejectedLines must be a list"), { status: 400 });
      if (!partialNote) throw Object.assign(new Error("A disapproval note is required when rejecting a discount request"), { status: 400 });
      const snapshot = (existing.orderSnapshot ?? {}) as Record<string, unknown>;
      const split = splitApprovalSnapshot(
        { ...snapshot, products: (Array.isArray(snapshot.products) ? snapshot.products : []) as ApprovalSnapshotProduct[] },
        body.rejectedLines.map(Number),
      );
      const { approved, rejected } = split;
      partialRejected = rejected;
      standardOnly = split.standardOnly;
      if (standardOnly) {
        // The discount itself is disapproved at this stage. next*Status stay as
        // sent, so the full-rejection draft below does not also fire.
        data.status = "REJECTED";
        data.allowReorder = false;
        if (partialStage === "RSM") {
          data.rsmApprovalStatus = "REJECTED";
          // A covering approval would have cleared the NSM stage too; a rejection does not.
          for (const key of ["nsmApprovalStatus", "nsmReviewedByUserId", "nsmReviewedByName", "nsmReviewedAt", "nsmNote"]) delete data[key];
        }
        if (partialStage === "NSM") data.nsmApprovalStatus = "REJECTED";
      }
      const keptKeys = new Set(approved.products.map((product) => normalizeApprovalProductKey(product.productKey)));
      const rejectedKeys = new Set(rejected.map((product) => normalizeApprovalProductKey(product.productKey)).filter((key) => !keptKeys.has(key)));
      const productDiscounts = (existing.requestedProductDiscounts ?? {}) as Record<string, unknown>;
      // Earlier stages may already have rejected lines; keep the whole history.
      const earlier = Array.isArray(snapshot.rejectedProducts) ? snapshot.rejectedProducts : [];
      data.orderSnapshot = jsonValue({
        ...approved,
        rejectedProducts: [...earlier, ...rejected.map((product) => ({ ...product, rejectedBy: partialStage, rejectedNote: partialNote }))],
      });
      // The NSM stage exists only for large asks; if the RSM rejected the large
      // lines, what is left may no longer need it.
      if (!standardOnly && partialStage === "RSM" && existing.nsmApprovalStatus === "PENDING" && data.nsmApprovalStatus === undefined) {
        const base = Number(existing.currentDiscountPercent ?? 0);
        const stillLarge = requiresNsmReview(base, approved.products.map((product) => base + (product.requestedCustomDiscountPercent ?? 0)));
        if (!stillLarge) data.nsmApprovalStatus = null;
      }
      data.requestedProductDiscounts = jsonValue(Object.fromEntries(Object.entries(productDiscounts).filter(([key]) => !rejectedKeys.has(normalizeApprovalProductKey(key)))));
      data.grossAmountPaise = paise(approved.grossAmount);
      data.requestedDiscountAmountPaise = paise(approved.requestedAdditionalDiscountAmount);
      data.requestedNetPayableAmountPaise = paise(approved.requestedNetPayableAmount);
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
      Object.assign(data, rebuilt, { status: "PENDING", rsmApprovalStatus: "PENDING", rsmReviewedByUserId: null, rsmReviewedByName: null, rsmReviewedAt: null, rsmNote: null, nsmReviewedByUserId: null, nsmReviewedByName: null, nsmReviewedAt: null, nsmNote: null, adminNote: null, reviewedByUserId: null, reviewedAt: null, allowReorder: false });
    }

    const updated = await prisma.$transaction(async (tx) => {
      let rejectionDraftId: bigint | null = null;
      // A rejection can come from either stage, so the draft carries whichever
      // note was written. Both are surfaced structurally in rejection_notes and
      // flattened into order_note for anything that only reads the text.
      const rejectedBy = rsmReviewUpdate && nextRsmStatus === "REJECTED" ? "RSM"
        : nsmReviewUpdate && nextNsmStatus === "REJECTED" ? "NSM"
          : reviewUpdate && nextStatus === "REJECTED" ? "ADMIN"
            : null;
      if (rejectedBy) {
        const rejectedByRsm = rejectedBy === "RSM";
        const adminNoteText = rejectedBy === "ADMIN" ? text(data.adminNote, 1500) : "";
        const rsmNoteText = rejectedByRsm ? text(data.rsmNote, 1500) : text(existing.rsmNote, 1500);
        const nsmNoteText = rejectedBy === "NSM" ? text(data.nsmNote, 1500) : rejectedBy === "ADMIN" ? text(existing.nsmNote, 1500) : "";
        const reasonText = (rejectedBy === "RSM" ? rsmNoteText : rejectedBy === "NSM" ? nsmNoteText : adminNoteText) || DEFAULT_REJECTION_NOTE;
        const rejectionNotes = {
          rejected_by: rejectedBy,
          rejected_at: new Date().toISOString(),
          admin_note: adminNoteText || null,
          rsm_note: rsmNoteText || null,
          nsm_note: nsmNoteText || null,
          reason: reasonText,
        };
        const draft = await tx.orderDraft.create({
          data: {
            dealerId: existing.dealerId,
            name: `Disapproved Request: ${new Date().toLocaleString("en-IN")}`,
            snapshot: jsonValue({
              rows: rejectionRows(Array.isArray((existing.orderSnapshot as any)?.products) ? (existing.orderSnapshot as any).products : []),
              shipto: (existing.orderSnapshot as any)?.shipto ?? null,
              refno: (existing.orderSnapshot as any)?.refno ?? null,
              order_note: [
                text((existing.orderSnapshot as any)?.orderNote),
                `--- ${rejectionNotes.rejected_by} REJECTION NOTE ---`,
                reasonText,
                // An RSM rejection never reached a later stage, so there is no earlier note.
                !rejectedByRsm && rsmNoteText ? `--- RSM NOTE ---\n${rsmNoteText}` : "",
                rejectedBy === "ADMIN" && nsmNoteText ? `--- NSM NOTE ---\n${nsmNoteText}` : "",
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
      // A standard-only result is placed at any stage, as a normal order.
      let placedOrder: { id: bigint; orderNumber: string } | null = null;
      if (standardOnly || (reviewUpdate && nextStatus === "APPROVED")) {
        const created = await placeOrderForApprovedDiscount(tx, row, { userId: actor.userId }, { normalOrder: standardOnly });
        if (created) {
          placedOrder = { id: created.id, orderNumber: created.orderNumber };
          row = await tx.customDiscountRequest.update({
            where: { id: row.id },
            data: { orderId: created.id },
            include: customDiscountInclude,
          });
        }
      }

      // The rejected lines return as a plain, unlinked draft: requesting them
      // again is a new request and, once approved, a new order number.
      if (partialRejected.length) {
        // An order exists after Admin approval or a standard-only result; otherwise name the request.
        const orderNumber = placedOrder?.orderNumber ?? row.order?.orderNumber ?? "";
        const where = orderNumber ? `order ${orderNumber}` : `discount request #${row.id}`;
        const snapshot = (row.orderSnapshot ?? {}) as any;
        const draft = await tx.orderDraft.create({
          data: {
            dealerId: row.dealerId,
            name: `Rejected lines from ${where}`,
            snapshot: jsonValue({
              rows: rejectionRows(partialRejected),
              shipto: snapshot.shipto ?? null,
              refno: snapshot.refno ?? null,
              order_note: [
                `--- ${partialStage} PARTIAL REJECTION ---`,
                `Rejected by ${partialStage} on ${where}`,
                partialNote,
                "Request the discount again to place these as a new order.",
              ].join("\n\n"),
              rejection_notes: {
                rejected_by: partialStage,
                rejected_at: new Date().toISOString(),
                [`${partialStage.toLowerCase()}_note`]: partialNote,
                reason: `Rejected by ${partialStage} on ${where}: ${partialNote}`,
              },
              source: "custom_discount_rejection",
              source_request_id: row.id.toString(),
            }),
          },
        });
        rejectionDraftId = draft.id;
        row = await tx.customDiscountRequest.update({
          where: { id: row.id },
          data: { orderSnapshot: jsonValue({ ...snapshot, rejectionDraftId: draft.id.toString() }) },
          include: customDiscountInclude,
        });
      }

      // A converted draft keeps the status set above; only refresh approval
      // state when the draft is still the dealer's to edit.
      if (row.orderDraftId && !placedOrder) {
        await tx.orderDraft.updateMany({
          where: { id: row.orderDraftId, dealerId: row.dealerId },
          data: { approvalState: jsonValue({ approvalRequestId: row.id.toString(), status: String(row.status).toLowerCase(), updatedAt: new Date().toISOString() }) },
        });
      }

      // Two review stages write to the same row, so the action names whichever
      // decision this call carried; a dealer edit is a change, not a review.
      const action = standardOnly
        ? AUDIT_ACTION.REJECT
        : reviewUpdate
        ? nextStatus === "APPROVED" ? AUDIT_ACTION.APPROVE : nextStatus === "REJECTED" ? AUDIT_ACTION.REJECT : AUDIT_ACTION.STATUS_CHANGE
        : rsmReviewUpdate || nsmReviewUpdate
          ? (nextRsmStatus ?? nextNsmStatus) === "APPROVED" ? AUDIT_ACTION.APPROVE : AUDIT_ACTION.REJECT
          : wantsResubmit
            ? AUDIT_ACTION.DISCOUNT_CHANGED
            : AUDIT_ACTION.UPDATE;

      const changes = diffValues(
        {
          status: existing.status,
          rsmApprovalStatus: existing.rsmApprovalStatus,
          nsmApprovalStatus: existing.nsmApprovalStatus,
          requestedDiscountPercent: existing.requestedDiscountPercent?.toString() ?? null,
          allowReorder: existing.allowReorder,
        },
        {
          status: row.status,
          rsmApprovalStatus: row.rsmApprovalStatus,
          nsmApprovalStatus: row.nsmApprovalStatus,
          requestedDiscountPercent: row.requestedDiscountPercent?.toString() ?? null,
          allowReorder: row.allowReorder,
        },
      );

      await createAuditLog({
        tx,
        actor,
        action,
        entity: AUDIT_ENTITY.DISCOUNT_REQUEST,
        entityId: row.id.toString(),
        ...changes,
        metadata: {
          dealerId: row.dealerId.toString(),
          stage: adminAlone ? "admin" : rsmReviewUpdate ? "rsm" : nsmReviewUpdate ? "nsm" : reviewUpdate ? "admin" : "dealer",
          ...(row.adminNote ? { adminNote: row.adminNote } : {}),
          ...(row.rsmNote ? { rsmNote: row.rsmNote } : {}),
          ...(row.nsmNote ? { nsmNote: row.nsmNote } : {}),
          ...(placedOrder ? { placedOrderNumber: placedOrder.orderNumber } : {}),
          ...(partialRejected.length ? { rejectedLineCount: partialRejected.length, partialRejectionDraftId: rejectionDraftId?.toString() } : {}),
          ...(standardOnly ? { standardOnlyOrder: true } : {}),
        },
      });

      return { row, rejectionDraftId, placedOrder };
    });

    const dto = mapCustomDiscount(updated.row) as any;
    if (updated.rejectionDraftId) dto.rejectionDraftId = updated.rejectionDraftId.toString();
    if (partialRejected.length) dto.rejectedLineCount = partialRejected.length;
    if (standardOnly) dto.standardOnlyOrder = true;
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
