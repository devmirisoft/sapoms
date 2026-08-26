import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { invalidatePendingProductsCache } from "@/lib/pendingProducts";
import { requireAuth } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { serializePrismaValue } from "@/server/db/prisma-serialize";
import { findPostgresOrderByLookup } from "@/lib/postgresOrderAnnotations";
import { mapPostgresOrderItemToLegacy, mapPostgresOrderToLegacy, type PostgresOrderRecord } from "@/lib/postgresOrders";
import { mapPostgresOrderDispatchRecords } from "@/lib/postgresOrderDispatch";
import {
  buildOrderEditRevision,
  ORDER_OVERLAY_VERSION,
  OrderOverlayError,
  resolveEffectiveOrder,
  toSafeOverlay,
  type OrderChangeRequest,
  type OrderEditRevision,
  type OrderOverlayDocument,
} from "@/lib/orderOverlays";
import {
  cancelPostgresOrder,
  normalizeFulfilmentStatus,
  PostgresOrderStatusError,
  updatePostgresOrderAcceptance,
  updatePostgresOrderFulfilment,
  revivePostgresOrderAcceptance,
} from "@/lib/postgresOrderStatus";

export const runtime = "nodejs";

function safeText(value: unknown, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function actorRole(role: string | null | undefined): "admin" | "staff" | "dealer" | "accountant" {
  if (role === "STAFF" || role === "RSM" || role === "ASM" || role === "NSM") return "staff";
  if (role === "DEALER") return "dealer";
  if (role === "ACCOUNTANT") return "accountant";
  return "admin";
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function overlayDoc(rows: Awaited<ReturnType<typeof prisma.orderOverlay.findMany>>, order: Awaited<ReturnType<typeof findPostgresOrderByLookup>>): OrderOverlayDocument | null {
  if (!order || rows.length === 0) return null;
  const cancelRow = [...rows].reverse().find((row) => row.type === "cancel" || row.status === "cancelled");
  const status = cancelRow ? "cancelled" : "active";
  const firstRow = rows[0];
  const latestRow = rows[rows.length - 1];
  const edits = rows
    .filter((row) => row.type === "edit")
    .map((row) => metadataRecord(row.metadata).revision)
    .filter((revision): revision is OrderEditRevision => Boolean(revision && typeof revision === "object"));
  const changeRequests: OrderChangeRequest[] = rows
    .filter((row) => row.type === "cancel_request" || row.type === "edit_request")
    .map((row) => ({
      id: row.id.toString(),
      type: row.type as "cancel_request" | "edit_request",
      status: row.status ?? "pending",
      note: row.reason ?? "",
      requestedAt: row.createdAt.toISOString(),
      requestedBy: { id: row.actorUserId?.toString() ?? "", role: actorRole(row.actorRole) },
      ...metadataRecord(row.metadata).request as Record<string, unknown>,
    }));
  return {
    orderId: order.legacyPhpId || order.id.toString(),
    dealerId: order.dealerId.toString(),
    dealerName: order.dealer.businessName,
    assignedStaffId: order.assignedStaffId?.toString() ?? null,
    status,
    cancellation: cancelRow ? {
      status: "cancelled",
      reason: cancelRow.reason ?? "",
      cancelledBy: { id: cancelRow.actorUserId?.toString() ?? "", role: actorRole(cancelRow.actorRole) },
      cancelledAt: cancelRow.createdAt.toISOString(),
    } : undefined,
    edits,
    latestRevision: edits.at(-1)?.revision ?? 0,
    changeRequests,
    source: ORDER_OVERLAY_VERSION,
    createdAt: firstRow.createdAt.toISOString(),
    updatedAt: latestRow.updatedAt.toISOString(),
  };
}

async function loadPostgresEffectiveContext(orderIdInput: string) {
  const order = await findPostgresOrderByLookup(orderIdInput);
  if (!order) return null;
  const orderId = order.legacyPhpId || order.id.toString();
  const [overlayRows, dispatchOrder] = await Promise.all([
    prisma.orderOverlay.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } }),
    prisma.order.findUnique({
      where: { id: order.id },
      include: {
        dealer: { select: { id: true, businessName: true, dealerCode: true, phone: true, city: true, address: true, pincode: true, gstin: true, discountPercent: true } },
        assignedStaff: { select: { id: true, displayName: true } },
        items: { orderBy: { id: "asc" }, include: { dispatches: { orderBy: { createdAt: "asc" } } } },
      },
    }),
  ]);
  const originalOrder = mapPostgresOrderToLegacy(order as unknown as PostgresOrderRecord);
  const originalItems = order.items.map((item) => mapPostgresOrderItemToLegacy(item, order as unknown as PostgresOrderRecord));
  const overlay = overlayDoc(overlayRows, order);
  const dispatchRecords = dispatchOrder ? mapPostgresOrderDispatchRecords(dispatchOrder as any) : [];
  const effective = resolveEffectiveOrder({ orderId, originalOrder, originalItems, overlay, dispatchRecords });
  return { effective, overlay, order };
}

function errorResponse(error: unknown) {
  if (error instanceof PostgresOrderStatusError || error instanceof OrderOverlayError) {
    return NextResponse.json({ success: false, code: error.code, message: error.message }, { status: error.status });
  }
  return NextResponse.json({ success: false, code: "unexpected", message: String((error as Error)?.message ?? "Unable to process order overlay.") }, { status: 500 });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await loadPostgresEffectiveContext(id);
    if (!context) {
      return NextResponse.json({ success: false, message: "Order overlays are available only for PostgreSQL orders." }, { status: 404 });
    }
    return NextResponse.json(serializePrismaValue({ success: true, data: { ...context.effective, itemContract: "complete", overlay: toSafeOverlay(context.overlay) } }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/order-overlays/[id]]", error);
    return errorResponse(error);
  }
}


function canApproveChangeRequest(role: string) {
  return role === "ADMIN" || role === "NSM";
}

async function createAcceptedOrderChangeRequest(input: {
  orderId: bigint;
  type: "cancel_request" | "edit_request";
  note: string;
  actorUserId: bigint;
  actorRole: "DEALER";
  request: Record<string, unknown>;
}) {
  const note = safeText(input.note, 1000);
  if (!note) return null;
  return prisma.orderOverlay.create({
    data: {
      orderId: input.orderId,
      type: input.type,
      status: "pending",
      reason: note,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      metadata: { source: "dealer_accepted_order_change_request", request: input.request } as Prisma.InputJsonValue,
    },
  });
}

async function loadRequestRow(requestId: unknown) {
  const raw = safeText(requestId, 40);
  if (!/^\d+$/.test(raw)) return null;
  return prisma.orderOverlay.findUnique({ where: { id: BigInt(raw) } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authActor = await requireAuth();
    const { id } = await params;
    const body = await req.json();
    const action = safeText(body.action, 40);

    if (action === "mirror_acceptance") {
      const updated = await updatePostgresOrderAcceptance(id, authActor, "ACCEPTED", body.note ?? body.acceptanceNote ?? body.rsmNote);
      if (!updated) return NextResponse.json({ success: false, message: "Historical PHP orders are read-only for PostgreSQL status updates." }, { status: 409 });
      invalidatePendingProductsCache();
      return NextResponse.json(serializePrismaValue({ success: true, data: updated }));
    }

    if (action === "status") {
      const fulfilmentStatus = normalizeFulfilmentStatus(body.fulfilmentStatus ?? body.fulfilment_status ?? body.status);
      if (!fulfilmentStatus) return NextResponse.json({ success: false, message: "A valid fulfilment status is required." }, { status: 400 });
      const updated = await updatePostgresOrderFulfilment(id, authActor, fulfilmentStatus);
      if (!updated) return NextResponse.json({ success: false, message: "Historical PHP orders are read-only for PostgreSQL status updates." }, { status: 409 });
      invalidatePendingProductsCache();
      return NextResponse.json(serializePrismaValue({ success: true, data: updated }));
    }

    if (action === "decline") {
      const updated = await updatePostgresOrderAcceptance(id, authActor, "DECLINED", body.note ?? body.acceptanceNote ?? body.rsmNote);
      if (!updated) return NextResponse.json({ success: false, message: "Historical PHP orders are read-only for PostgreSQL status updates." }, { status: 409 });
      invalidatePendingProductsCache();
      return NextResponse.json(serializePrismaValue({ success: true, data: updated }));
    }

    if (action === "revive") {
      const updated = await revivePostgresOrderAcceptance(id, authActor, body.note);
      if (!updated) return NextResponse.json({ success: false, message: "Historical PHP orders are read-only for PostgreSQL status updates." }, { status: 409 });
      invalidatePendingProductsCache();
      return NextResponse.json(serializePrismaValue({ success: true, data: updated }));
    }

    if (action === "cancel") {
      const context = await loadPostgresEffectiveContext(id);
      if (!context) return NextResponse.json({ success: false, message: "Historical PHP orders are read-only for PostgreSQL cancellation." }, { status: 409 });
      if (authActor.role === "DEALER" && context.order.acceptanceStatus === "ACCEPTED") {
        const request = await createAcceptedOrderChangeRequest({
          orderId: context.order.id,
          type: "cancel_request",
          note: body.reason,
          actorUserId: authActor.userId,
          actorRole: "DEALER",
          request: { kind: "cancel", note: safeText(body.reason, 1000), originalOrder: context.effective.originalOrder, originalItems: context.effective.effectiveItems },
        });
        if (!request) return NextResponse.json({ success: false, message: "Cancellation request note is required." }, { status: 400 });
        const updatedContext = await loadPostgresEffectiveContext(id);
        return NextResponse.json(serializePrismaValue({ success: true, requested: true, data: { ...updatedContext?.effective, itemContract: "complete", overlay: toSafeOverlay(updatedContext?.overlay ?? null) } }));
      }
      const updated = await cancelPostgresOrder(id, authActor, body.reason);
      if (!updated) return NextResponse.json({ success: false, message: "Historical PHP orders are read-only for PostgreSQL cancellation." }, { status: 409 });
      invalidatePendingProductsCache();
      return NextResponse.json(serializePrismaValue({ success: true, data: { ...updated, cancellation: { reason: updated.cancellationReason, cancelledAt: updated.cancelledAt?.toISOString(), cancelledBy: { id: authActor.profileId.toString(), role: actorRole(authActor.role), name: authActor.displayName } } } }));
    }

    if (action === "edit") {
      if (authActor.role !== "DEALER" || !authActor.dealerId) {
        return NextResponse.json({ success: false, message: "Only the Dealer who owns this order can edit it." }, { status: 403 });
      }
      const context = await loadPostgresEffectiveContext(id);
      if (!context) return NextResponse.json({ success: false, message: "Order overlays are available only for PostgreSQL orders." }, { status: 404 });
      if (context.order.dealerId !== authActor.dealerId) {
        return NextResponse.json({ success: false, message: "Only the Dealer who owns this order can edit it." }, { status: 403 });
      }
      const acceptedChangeRequest = context.order.acceptanceStatus === "ACCEPTED";
      if (!context.effective.eligibility.canDealerChange && !acceptedChangeRequest) {
        return NextResponse.json({ success: false, code: context.effective.eligibility.reason, message: "This order can no longer be edited." }, { status: 409 });
      }
      const expectedRevision = Number(body.expectedRevision ?? 0);
      if (expectedRevision !== context.effective.latestRevision) {
        return NextResponse.json({ success: false, code: "stale_revision", message: "This order was edited in another session. Reload and try again." }, { status: 409 });
      }
      const revision = buildOrderEditRevision({
        orderId: context.effective.orderId,
        baseOrder: context.effective.originalOrder,
        originalItems: context.effective.effectiveItems,
        requestedItems: Array.isArray(body.items) ? body.items : [],
        expectedRevision,
        idempotencyKey: body.idempotencyKey,
        actor: { actorId: authActor.dealerId.toString(), role: "dealer", name: authActor.displayName },
      });
      if (acceptedChangeRequest) {
        const note = safeText(body.note ?? body.reason, 1000);
        const request = await createAcceptedOrderChangeRequest({
          orderId: context.order.id,
          type: "edit_request",
          note,
          actorUserId: authActor.userId,
          actorRole: "DEALER",
          request: { kind: "edit", note, revision, originalItems: context.effective.effectiveItems, proposedItems: revision.effectiveItems },
        });
        if (!request) return NextResponse.json({ success: false, message: "Edit request note is required." }, { status: 400 });
        const updatedContext = await loadPostgresEffectiveContext(id);
        return NextResponse.json(serializePrismaValue({ success: true, requested: true, data: { ...updatedContext?.effective, itemContract: "complete", overlay: toSafeOverlay(updatedContext?.overlay ?? null) } }));
      }
      await prisma.orderOverlay.create({
        data: {
          orderId: context.order.id,
          type: "edit",
          status: "active",
          value: String(revision.revision),
          actorUserId: authActor.userId,
          actorRole: authActor.role,
          metadata: { source: "postgres_order_edit", revision } as Prisma.InputJsonValue,
        },
      });
      const updatedContext = await loadPostgresEffectiveContext(id);
      return NextResponse.json(serializePrismaValue({ success: true, data: { ...updatedContext?.effective, itemContract: "complete", overlay: toSafeOverlay(updatedContext?.overlay ?? null) } }));
    }


    if (action === "approve_change_request" || action === "reject_change_request") {
      if (!canApproveChangeRequest(authActor.role)) {
        return NextResponse.json({ success: false, message: "Only Admin or NSM can review order change requests." }, { status: 403 });
      }
      const requestRow = await loadRequestRow(body.requestId);
      if (!requestRow || requestRow.status !== "pending" || (requestRow.type !== "cancel_request" && requestRow.type !== "edit_request")) {
        return NextResponse.json({ success: false, message: "Pending order change request was not found." }, { status: 404 });
      }
      if (action === "reject_change_request") {
        await prisma.orderOverlay.update({
          where: { id: requestRow.id },
          data: { status: "rejected", metadata: { ...metadataRecord(requestRow.metadata), reviewedBy: authActor.userId.toString(), reviewedAt: new Date().toISOString(), decisionNote: safeText(body.decisionNote, 1000) } as Prisma.InputJsonValue },
        });
      } else if (requestRow.type === "edit_request") {
        const revision = metadataRecord(metadataRecord(requestRow.metadata).request).revision as OrderEditRevision | undefined;
        if (!revision) return NextResponse.json({ success: false, message: "Edit request payload is missing." }, { status: 409 });
        await prisma.$transaction(async (tx) => {
          await tx.orderOverlay.create({ data: { orderId: requestRow.orderId, type: "edit", status: "active", value: String(revision.revision), actorUserId: authActor.userId, actorRole: authActor.role, metadata: { source: "approved_order_edit_request", requestId: requestRow.id.toString(), revision } as Prisma.InputJsonValue } });
          await tx.orderOverlay.update({ where: { id: requestRow.id }, data: { status: "approved", metadata: { ...metadataRecord(requestRow.metadata), reviewedBy: authActor.userId.toString(), reviewedAt: new Date().toISOString(), decisionNote: safeText(body.decisionNote, 1000) } as Prisma.InputJsonValue } });
        });
      } else {
        const reason = requestRow.reason || "Approved dealer cancellation request";
        await prisma.$transaction(async (tx) => {
          const order = await tx.order.update({ where: { id: requestRow.orderId }, data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: reason } });
          await tx.orderOverlay.create({ data: { orderId: requestRow.orderId, type: "cancel", status: "cancelled", reason, actorUserId: authActor.userId, actorRole: authActor.role, metadata: { source: "approved_order_cancel_request", requestId: requestRow.id.toString() } as Prisma.InputJsonValue } });
          await tx.orderOverlay.update({ where: { id: requestRow.id }, data: { status: "approved", metadata: { ...metadataRecord(requestRow.metadata), reviewedBy: authActor.userId.toString(), reviewedAt: new Date().toISOString(), decisionNote: safeText(body.decisionNote, 1000), appliedOrderStatus: order.status } as Prisma.InputJsonValue } });
        });
        invalidatePendingProductsCache();
      }
      const updatedContext = await loadPostgresEffectiveContext(id);
      return NextResponse.json(serializePrismaValue({ success: true, data: { ...updatedContext?.effective, itemContract: "complete", overlay: toSafeOverlay(updatedContext?.overlay ?? null) } }));
    }

    return NextResponse.json({ success: false, message: "Unsupported PostgreSQL overlay action." }, { status: 400 });
  } catch (error) {
    console.error("[POST /api/order-overlays/[id]]", error);
    return errorResponse(error);
  }
}