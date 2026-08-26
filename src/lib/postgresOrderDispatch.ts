import "server-only";

import { randomUUID } from "node:crypto";
import type { OrderFulfilmentStatus, OrderStatus, Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { AuthActor } from "@/server/auth/session";
import { isStaffLike } from "@/server/auth/sales-scope";
import { normalizeSku } from "@/lib/orderProductNotes.mjs";
import { PostgresOrderStatusError, findPostgresStatusOrder } from "@/lib/postgresOrderStatus";
import { mapPostgresOrderItemToLegacy, mapPostgresOrderToLegacy, type PostgresOrderRecord } from "@/lib/postgresOrders";
import { normalizeDispatchOrderItemId, normalizeDispatchRemark, normalizeDispatchStatus, normalizeDispatchTrackingInput, safeDispatchInteger, type DispatchStatus, type DispatchTrackingInfo, type OrderDispatchRecord } from "@/lib/orderDispatch";

const postgresDispatchOrderInclude = {
  dealer: { select: { id: true, businessName: true, dealerCode: true, phone: true, city: true, address: true, pincode: true, gstin: true, discountPercent: true } },
  assignedStaff: { select: { id: true, displayName: true } },
  items: { orderBy: { id: "asc" as const }, include: { dispatches: { orderBy: { createdAt: "asc" as const } } } },
  // The dispatch response re-maps the order through mapPostgresOrderToLegacy,
  // which reads bills to report the settled position.
  ledgerBills: { orderBy: { billDate: "desc" as const } },
} satisfies Prisma.OrderInclude;

type PostgresDispatchOrder = Prisma.OrderGetPayload<{ include: typeof postgresDispatchOrderInclude }>;

type DispatchLineInput = {
  orderItemId?: unknown;
  sku?: unknown;
  occurrence?: unknown;
  dispatchQuantity?: unknown;
  status?: unknown;
};

function lookupText(value: unknown) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/(?:^|\/)(\d+)$/);
  return match?.[1] ?? raw;
}

function orderStatusForFulfilment(status: OrderFulfilmentStatus): OrderStatus {
  if (status === "PENDING") return "ACCEPTED";
  if (status === "IN_PROCESS") return "PROCESSING";
  if (status === "PARTIALLY_READY") return "PARTIALLY_READY";
  if (status === "READY") return "READY";
  if (status === "DISPATCHED") return "DISPATCHED";
  return "COMPLETED";
}

function fulfilmentFromTotals(totalOrdered: number, totalDispatched: number): OrderFulfilmentStatus {
  if (totalDispatched <= 0) return "PENDING";
  if (totalDispatched < totalOrdered) return "IN_PROCESS";
  return "DISPATCHED";
}

function legacyOrderId(order: Pick<PostgresDispatchOrder, "id" | "legacyPhpId">) {
  return order.legacyPhpId || order.id.toString();
}

function legacyItemId(item: { id: bigint; legacyPhpOrderItemId?: string | null }) {
  return item.legacyPhpOrderItemId || item.id.toString();
}

function isAssignedDispatchStaffRole(actor: AuthActor) {
  return isStaffLike(actor);
}

function isGlobalDispatchRole(actor: AuthActor) {
  return actor.role === "ADMIN" || actor.role === "NSM";
}

async function hasActiveStaffDealerAssignment(actor: AuthActor, order: Pick<PostgresDispatchOrder, "dealerId">) {
  if (!isAssignedDispatchStaffRole(actor) || !actor.staffId) return false;
  const assignment = await prisma.dealerStaffAssignment.findFirst({
    where: { dealerId: order.dealerId, staffId: actor.staffId, active: true },
    select: { id: true },
  });
  return !!assignment;
}

async function canRead(actor: AuthActor, order: Pick<PostgresDispatchOrder, "dealerId" | "assignedStaffId">) {
  if (isGlobalDispatchRole(actor) || actor.role === "ACCOUNTANT") return true;
  if (actor.role === "DEALER") return order.dealerId === actor.dealerId;
  if (isAssignedDispatchStaffRole(actor)) return order.assignedStaffId === actor.staffId || await hasActiveStaffDealerAssignment(actor, order);
  return false;
}

async function canWrite(actor: AuthActor, order: Pick<PostgresDispatchOrder, "dealerId" | "assignedStaffId">) {
  if (isGlobalDispatchRole(actor)) return true;
  if (isAssignedDispatchStaffRole(actor)) return order.assignedStaffId === actor.staffId || await hasActiveStaffDealerAssignment(actor, order);
  return false;
}

async function loadPostgresDispatchOrder(orderId: unknown) {
  const lookup = lookupText(orderId);
  if (!lookup) return null;
  const id = /^\d+$/.test(lookup) ? BigInt(lookup) : null;
  return prisma.order.findFirst({
    where: { OR: [...(id ? [{ id }] : []), { orderNumber: lookup }, { legacyPhpId: lookup }] },
    include: postgresDispatchOrderInclude,
  });
}

export async function findPostgresOrderDispatchPayload(orderId: unknown, actor: AuthActor) {
  const order = await loadPostgresDispatchOrder(orderId);
  if (!order) return null;
  if (!await canRead(actor, order)) throw new PostgresOrderStatusError(403, "forbidden", "Unauthorized dispatch access");
  return { order, records: mapPostgresOrderDispatchRecords(order), tracking: mapPostgresDispatchTracking(order) };
}

export function mapPostgresDispatchTracking(order: Pick<PostgresDispatchOrder, "dispatchPartner" | "trackingNumber" | "trackingLink" | "dock">): DispatchTrackingInfo {
  return {
    dispatchPartner: order.dispatchPartner || null,
    trackingNumber: order.trackingNumber || null,
    trackingLink: order.trackingLink || null,
    dock: order.dock || null,
  };
}

// Order-level dispatch tracking information. Writers are the same roles that
// may record a dispatch update; dealers are read-only via canWrite().
export async function applyPostgresOrderDispatchTracking(orderId: unknown, actor: AuthActor, input: {
  dispatchPartner?: unknown;
  trackingNumber?: unknown;
  trackingLink?: unknown;
  dock?: unknown;
}) {
  const order = await loadPostgresDispatchOrder(orderId);
  if (!order) return null;
  if (!await canWrite(actor, order)) throw new PostgresOrderStatusError(403, "forbidden", "Unauthorized or unassigned dispatch update");
  if (order.acceptanceStatus !== "ACCEPTED") throw new PostgresOrderStatusError(409, "not_accepted", "Order must be accepted before dispatch.");
  if (order.status === "CANCELLED" || order.status === "DECLINED") throw new PostgresOrderStatusError(409, "terminal_order", "Terminal orders cannot be dispatched.");

  const validated = normalizeDispatchTrackingInput(input);
  if (!validated.ok) throw new PostgresOrderStatusError(400, "invalid_tracking", validated.message);

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: validated.value,
    include: postgresDispatchOrderInclude,
  });

  return {
    order: mapPostgresOrderToLegacy(updated as unknown as PostgresOrderRecord),
    tracking: mapPostgresDispatchTracking(updated),
    records: mapPostgresOrderDispatchRecords(updated).map(mapPostgresDispatchRecordForResponse),
  };
}

export async function getPostgresPendingProductParts(orders: Array<Record<string, unknown>>) {
  const pgOrders = orders.filter((order) => order.__source === "postgres");
  const orderItemsByOrderId: Record<string, ReturnType<typeof mapPostgresOrderItemToLegacy>[]> = {};
  const dispatchRecordsByOrderId: Record<string, OrderDispatchRecord[]> = {};

  const ids = pgOrders.map((order) => lookupText(order.id ?? order.orderId ?? order.order_id)).filter(Boolean);
  if (ids.length === 0) return { orderItemsByOrderId, dispatchRecordsByOrderId };

  const bigintIds = ids.filter((id) => /^\d+$/.test(id)).map((id) => BigInt(id));
  const loaded = await prisma.order.findMany({
    where: { OR: [{ id: { in: bigintIds } }, { legacyPhpId: { in: ids } }, { orderNumber: { in: ids } }] },
    include: postgresDispatchOrderInclude,
  });

  for (const order of loaded) {
    const key = legacyOrderId(order);
    orderItemsByOrderId[key] = order.items.map((item) => mapPostgresOrderItemToLegacy(item, order as unknown as PostgresOrderRecord));
    dispatchRecordsByOrderId[key] = mapPostgresOrderDispatchRecords(order);
  }

  return { orderItemsByOrderId, dispatchRecordsByOrderId };
}

export function mapPostgresOrderDispatchRecords(order: PostgresDispatchOrder): OrderDispatchRecord[] {
  const orderId = legacyOrderId(order);
  return order.items.map((item) => {
    const dispatchedQuantity = item.dispatches.reduce((sum, dispatch) => sum + dispatch.quantity, 0);
    const updates = item.dispatches.map((dispatch) => ({
      id: dispatch.id.toString(),
      quantity: dispatch.quantity,
      remark: dispatch.remark || "",
      status: normalizeDispatchStatus(dispatch.status),
      actorId: dispatch.actorUserId?.toString() || "",
      actorRole: dispatch.actorRole === "ADMIN" || dispatch.actorRole === "NSM" ? "admin" as const : "staff" as const,
      createdAt: dispatch.createdAt,
    }));
    const currentStatus: DispatchStatus = dispatchedQuantity >= item.quantityPacks ? "successful" : dispatchedQuantity > 0 ? "dispatched" : "pending";
    return {
      id: `pg:${item.id.toString()}`,
      orderId,
      orderItemId: legacyItemId(item),
      sku: item.catalogueNumberSnapshot,
      normalizedSku: normalizeSku(item.catalogueNumberSnapshot),
      occurrence: 1,
      dealerId: order.dealerId.toString(),
      assignedStaffId: order.assignedStaffId?.toString() || null,
      orderedQuantity: item.quantityPacks,
      dispatchedQuantity,
      currentStatus,
      updates,
      createdAt: item.createdAt,
      updatedAt: updates.at(-1)?.createdAt ?? item.updatedAt,
    };
  });
}

export function mapPostgresDispatchRecordForResponse(record: OrderDispatchRecord) {
  return {
    ...record,
    remainingQuantity: Math.max(0, record.orderedQuantity - record.dispatchedQuantity),
    source: "postgres",
    __source: "postgres",
  };
}

function resolveRequestedItem(order: PostgresDispatchOrder, input: DispatchLineInput) {
  const orderItemId = normalizeDispatchOrderItemId(input.orderItemId);
  if (orderItemId) {
    return order.items.find((item) => legacyItemId(item) === orderItemId || item.id.toString() === orderItemId) ?? null;
  }
  const normalizedSku = normalizeSku(input.sku);
  const occurrence = Math.max(1, safeDispatchInteger(input.occurrence) || 1);
  let seen = 0;
  for (const item of order.items) {
    if (normalizeSku(item.catalogueNumberSnapshot) !== normalizedSku) continue;
    seen += 1;
    if (seen === occurrence) return item;
  }
  return null;
}

export async function applyPostgresOrderDispatch(orderId: unknown, actor: AuthActor, input: { items?: unknown[]; dispatchQuantity?: unknown; status?: unknown; remark?: unknown; orderItemId?: unknown; sku?: unknown; occurrence?: unknown; dispatchPartner?: unknown; trackingNumber?: unknown; trackingLink?: unknown; dock?: unknown; }) {
  const order = await loadPostgresDispatchOrder(orderId);
  if (!order) return null;
  if (!await canWrite(actor, order)) throw new PostgresOrderStatusError(403, "forbidden", "Unauthorized or unassigned dispatch update");
  if (order.acceptanceStatus !== "ACCEPTED") throw new PostgresOrderStatusError(409, "not_accepted", "Order must be accepted before dispatch.");
  if (order.status === "CANCELLED" || order.status === "DECLINED") throw new PostgresOrderStatusError(409, "terminal_order", "Terminal orders cannot be dispatched.");

  const remark = normalizeDispatchRemark(input.remark, 500);
  if (!remark) throw new PostgresOrderStatusError(400, "blank_remark", "Operational remark is required");

  // Tracking information is optional here; when the dispatching staff member
  // supplies it with the update it is saved on the same order record.
  const trackingKeys = ["dispatchPartner", "trackingNumber", "trackingLink", "dock"] as const;
  const hasTrackingInput = trackingKeys.some((key) => input[key] !== undefined);
  const validatedTracking = hasTrackingInput ? normalizeDispatchTrackingInput(input) : null;
  if (validatedTracking && !validatedTracking.ok) {
    throw new PostgresOrderStatusError(400, "invalid_tracking", validatedTracking.message);
  }

  const rawLines = Array.isArray(input.items) && input.items.length > 0 ? input.items : [input];
  const lines = rawLines.map((line) => line && typeof line === "object" ? line as DispatchLineInput : null);
  if (lines.some((line) => !line)) throw new PostgresOrderStatusError(400, "invalid_items", "Each selected product must have a valid identity");

  const currentTotals = new Map(order.items.map((item) => [item.id.toString(), item.dispatches.reduce((sum, dispatch) => sum + dispatch.quantity, 0)]));
  const creates: Array<{ orderId: bigint; orderItemId: bigint; quantity: number; status: OrderFulfilmentStatus; remark: string; actorUserId: bigint; actorRole: UserRole }> = [];

  for (const line of lines as DispatchLineInput[]) {
    const item = resolveRequestedItem(order, line);
    if (!item) throw new PostgresOrderStatusError(404, "item_not_found", "Order product not found");
    const quantity = safeDispatchInteger(line.dispatchQuantity);
    if (quantity <= 0) throw new PostgresOrderStatusError(400, "invalid_quantity", "Dispatch Quantity must be greater than zero");
    const alreadyDispatched = currentTotals.get(item.id.toString()) ?? 0;
    if (alreadyDispatched + quantity > item.quantityPacks) {
      throw new PostgresOrderStatusError(
        409,
        "over_dispatch",
        "Dispatch quantity exceeds the remaining quantity",
      );
    }
    currentTotals.set(item.id.toString(), alreadyDispatched + quantity);
    const status = normalizeDispatchStatus(line.status, "dispatched") === "not_in_stock" ? "IN_PROCESS" : "DISPATCHED";
    creates.push({ orderId: order.id, orderItemId: item.id, quantity, status, remark, actorUserId: actor.userId, actorRole: actor.role as UserRole });
  }

  const totalOrdered = order.items.reduce((sum, item) => sum + item.quantityPacks, 0);
  const totalDispatched = Array.from(currentTotals.values()).reduce((sum, quantity) => sum + quantity, 0);
  const nextFulfilment = fulfilmentFromTotals(totalOrdered, totalDispatched);
  const now = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    await tx.orderItemDispatch.createMany({ data: creates });
    return tx.order.update({
      where: { id: order.id },
      data: {
        fulfilmentStatus: nextFulfilment,
        status: orderStatusForFulfilment(nextFulfilment),
        dispatchedAt: nextFulfilment === "DISPATCHED" ? now : order.dispatchedAt,
        ...(validatedTracking?.ok ? validatedTracking.value : {}),
      },
      include: postgresDispatchOrderInclude,
    });
  });

  return {
    order: mapPostgresOrderToLegacy(updated as unknown as PostgresOrderRecord),
    tracking: mapPostgresDispatchTracking(updated),
    records: mapPostgresOrderDispatchRecords(updated).map(mapPostgresDispatchRecordForResponse),
  };
}
