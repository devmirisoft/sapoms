import "server-only";

import { Prisma, type OrderAcceptanceStatus, type OrderFulfilmentStatus, type OrderStatus } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { AuthActor } from "@/server/auth/session";
import { isStaffLike } from "@/server/auth/sales-scope";

const orderAccessInclude = {
  dealer: { select: { id: true, businessName: true } },
  assignedStaff: { select: { id: true, displayName: true } },
  items: { orderBy: { id: "asc" as const } },
} satisfies Prisma.OrderInclude;

type PgOrder = Prisma.OrderGetPayload<{ include: typeof orderAccessInclude }>;

export class PostgresOrderAnnotationError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "PostgresOrderAnnotationError";
  }
}

export function text(value: unknown, max = 1200) {
  return String(value ?? "").trim().slice(0, max);
}

export function toPaise(value: unknown) {
  if (value === null || value === undefined || value === "") return BigInt(0);
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? BigInt(Math.round(n * 100)) : BigInt(0);
}

export function fromPaise(value: bigint | number | null | undefined) {
  return Math.round(Number(value ?? 0)) / 100;
}

export function normalizeLookup(value: unknown) {
  const raw = text(value, 120);
  const displayIdMatch = raw.match(/(?:^|\/)(\d+)$/);
  return displayIdMatch?.[1] ?? raw;
}

export async function findPostgresOrderByLookup(orderId: unknown) {
  const lookup = normalizeLookup(orderId);
  if (!lookup) return null;
  const id = /^\d+$/.test(lookup) ? BigInt(lookup) : null;
  return prisma.order.findFirst({
    where: { OR: [...(id ? [{ id }] : []), { orderNumber: lookup }, { legacyPhpId: lookup }] },
    include: orderAccessInclude,
  });
}

export async function assertOrderAccess(order: PgOrder, actor: AuthActor) {
  if (actor.role === "ADMIN") return;
  if (actor.role === "ACCOUNTANT") {
    throw new PostgresOrderAnnotationError(403, "forbidden", "Accountant order-note access is not permitted for this order.");
  }
  if (actor.role === "DEALER") {
    if (order.dealerId === actor.dealerId) return;
    throw new PostgresOrderAnnotationError(403, "forbidden", "This order belongs to another Dealer.");
  }
  if (isStaffLike(actor) && actor.staffId) {
    if (order.assignedStaffId === actor.staffId) return;
    const assignment = await prisma.dealerStaffAssignment.findFirst({ where: { dealerId: order.dealerId, staffId: actor.staffId, active: true }, select: { id: true } });
    if (assignment) return;
    // An RSM's scope is its region plus its ASM/executive subtree, so keep note
    // access aligned with the orders the RSM can already see in the list view.
    if (actor.role === "RSM" && actor.userId) {
      const { isOrderInRsmScope } = await import("@/lib/postgresOrders");
      if (await isOrderInRsmScope({ role: "staff", actorId: actor.staffId.toString(), isRsm: true, userId: actor.userId.toString() }, order.id.toString())) return;
    }
  }
  throw new PostgresOrderAnnotationError(403, "forbidden", "This order is outside your assigned order scope.");
}

export async function requirePostgresOrderAccess(orderId: unknown, actor: AuthActor) {
  const order = await findPostgresOrderByLookup(orderId);
  if (!order) return null;
  await assertOrderAccess(order, actor);
  return order;
}

function noteDoc(note: any, order: Pick<PgOrder, "id" | "dealerId" | "dealer">) {
  return {
    id: note.id?.toString?.() ?? "",
    orderId: order.id.toString(),
    order_id: order.id.toString(),
    dealerId: order.dealerId.toString(),
    dealer_id: order.dealerId.toString(),
    dealerName: order.dealer?.businessName ?? "",
    note: note.note,
    actorUserId: note.actorUserId?.toString?.() ?? "",
    actorRole: note.actorRole ?? "",
    createdAt: note.createdAt?.toISOString?.() ?? note.createdAt,
    updatedAt: note.updatedAt?.toISOString?.() ?? note.updatedAt,
    source: "postgres",
  };
}

export async function listOrderNotes(actor: AuthActor, orderIds: string[]) {
  const orders = (await Promise.all(orderIds.map((id) => requirePostgresOrderAccess(id, actor)))).filter(Boolean) as PgOrder[];
  if (!orders.length) return null;
  const notes = await prisma.orderNote.findMany({ where: { orderId: { in: orders.map((o) => o.id) } }, orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }], take: 200 });
  const byOrder = new Map(orders.map((order) => [order.id.toString(), order]));
  return notes.map((note) => noteDoc(note, byOrder.get(note.orderId.toString())!));
}

export async function upsertOrderNote(actor: AuthActor, body: Record<string, unknown>) {
  const order = await requirePostgresOrderAccess(body.orderId || body.order_id, actor);
  if (!order) return null;
  const note = text(body.note);
  if (!note) throw new PostgresOrderAnnotationError(400, "blank_note", "note is required");
  const saved = await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { note } });
    return tx.orderNote.create({ data: { orderId: order.id, note, actorUserId: actor.userId, actorRole: actor.role } });
  });
  return noteDoc(saved, order);
}

function productNoteDoc(note: any, order: PgOrder, item: PgOrder["items"][number]) {
  const sku = item.skuSnapshot || item.catalogueNumberSnapshot || "";
  return {
    id: note.id?.toString?.() ?? "",
    orderId: order.id.toString(),
    order_id: order.id.toString(),
    orderItemId: item.id.toString(),
    order_item_id: item.id.toString(),
    sku,
    normalizedSku: sku.trim().toLowerCase(),
    occurrence: 1,
    dealerId: order.dealerId.toString(),
    dealer_id: order.dealerId.toString(),
    note: note.note,
    source: "postgres",
    createdAt: note.createdAt?.toISOString?.() ?? note.createdAt,
    updatedAt: note.updatedAt?.toISOString?.() ?? note.updatedAt,
  };
}

function findOrderItem(order: PgOrder, input: Record<string, unknown>) {
  const itemId = text(input.orderItemId || input.order_item_id, 80);
  if (itemId && /^\d+$/.test(itemId)) return order.items.find((item) => item.id === BigInt(itemId) || item.legacyPhpOrderItemId === itemId) ?? null;
  const sku = text(input.sku || input.normalizedSku, 200).toLowerCase();
  if (!sku) return null;
  return order.items.find((item) => [item.skuSnapshot, item.catalogueNumberSnapshot, item.productNameSnapshot].some((value) => text(value, 200).toLowerCase() === sku)) ?? null;
}

export async function listProductNotes(actor: AuthActor, input: { orderIds?: string[]; orderId?: string; orderItemId?: string }) {
  let orders: PgOrder[] = [];
  if (input.orderItemId && /^\d+$/.test(input.orderItemId)) {
    const item = await prisma.orderItem.findUnique({ where: { id: BigInt(input.orderItemId) }, include: { order: { include: orderAccessInclude } } });
    if (!item) return null;
    await assertOrderAccess(item.order as PgOrder, actor);
    orders = [item.order as PgOrder];
  } else {
    const ids = input.orderIds?.length ? input.orderIds : input.orderId ? [input.orderId] : [];
    orders = (await Promise.all(ids.map((id) => requirePostgresOrderAccess(id, actor)))).filter(Boolean) as PgOrder[];
  }
  if (!orders.length) return null;
  const where: Prisma.OrderProductNoteWhereInput = { orderId: { in: orders.map((order) => order.id) } };
  if (input.orderItemId && /^\d+$/.test(input.orderItemId)) where.orderItemId = BigInt(input.orderItemId);
  const notes = await prisma.orderProductNote.findMany({ where, orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }], take: 500 });
  const orderById = new Map(orders.map((order) => [order.id.toString(), order]));
  return notes.map((note) => {
    const order = orderById.get(note.orderId.toString())!;
    const item = order.items.find((candidate) => candidate.id === note.orderItemId)!;
    return productNoteDoc(note, order, item);
  });
}

export async function upsertProductNote(actor: AuthActor, body: Record<string, unknown>) {
  const order = await requirePostgresOrderAccess(body.orderId || body.order_id, actor);
  if (!order) return null;
  const item = findOrderItem(order, body);
  if (!item) throw new PostgresOrderAnnotationError(404, "item_not_found", "Order item not found");
  const note = text(body.note, 500);
  if (!note) throw new PostgresOrderAnnotationError(400, "blank_note", "note is required");
  const saved = await prisma.$transaction(async (tx) => {
    await tx.orderItem.update({ where: { id: item.id }, data: { productNote: note } });
    return tx.orderProductNote.upsert({
      where: { orderItemId: item.id },
      create: { orderId: order.id, orderItemId: item.id, note, actorUserId: actor.userId, actorRole: actor.role },
      update: { note, actorUserId: actor.userId, actorRole: actor.role },
    });
  });
  return productNoteDoc(saved, order, item);
}

export function summaryOverrideDoc(row: any, order: PgOrder) {
  const grossAmount = fromPaise(row.grossAmountPaise);
  const discountAmount = fromPaise(row.discountAmountPaise);
  const netPayableAmount = fromPaise(row.finalPayableAmountPaise);
  return {
    id: row.id?.toString?.() ?? "",
    orderId: order.id.toString(),
    order_id: order.id.toString(),
    dealerId: order.dealerId.toString(),
    dealer_id: order.dealerId.toString(),
    order_dealer: order.dealerId.toString(),
    Dealer_Name: order.dealer.businessName,
    order_amount: grossAmount,
    order_discount: netPayableAmount,
    order_discount_amount: discountAmount,
    order_net_amount: netPayableAmount,
    grossAmount,
    discountAmount,
    netPayableAmount,
    discountPercent: Number(row.discountPercent ?? 0),
    reason: row.reason ?? "",
    source: "postgres",
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
  };
}

export async function listSummaryOverrides(actor: AuthActor, orderIds: string[]) {
  const orders = (await Promise.all(orderIds.map((id) => requirePostgresOrderAccess(id, actor)))).filter(Boolean) as PgOrder[];
  if (!orders.length) return null;
  const rows = await prisma.orderSummaryOverride.findMany({ where: { orderId: { in: orders.map((order) => order.id) } }, orderBy: { createdAt: "desc" }, distinct: ["orderId"] });
  const byOrder = new Map(orders.map((order) => [order.id.toString(), order]));
  return rows.map((row) => summaryOverrideDoc(row, byOrder.get(row.orderId.toString())!));
}

export async function createSummaryOverride(actor: AuthActor, body: Record<string, unknown>) {
  const order = await requirePostgresOrderAccess(body.orderId || body.order_id, actor);
  if (!order) return null;
  const grossAmountPaise = toPaise(body.grossAmount ?? body.gross_amount ?? body.order_amount);
  const discountAmountPaise = toPaise(body.discountAmount ?? body.discount_amount ?? body.order_discount_amount);
  const finalPayableAmountPaise = toPaise(body.netPayableAmount ?? body.net_payable_amount ?? body.order_net_amount);
  if (grossAmountPaise < BigInt(0) || finalPayableAmountPaise < BigInt(0)) throw new PostgresOrderAnnotationError(400, "invalid_amount", "Valid summary amounts are required");
  const discountPercent = Number(body.discountPercent ?? body.discount_percent ?? 0) || 0;
  const row = await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { grossAmountPaise, totalDiscountAmountPaise: discountAmountPaise, finalPayableAmountPaise, totalDiscountPercent: new Prisma.Decimal(discountPercent) } });
    return tx.orderSummaryOverride.create({ data: { orderId: order.id, grossAmountPaise, discountAmountPaise, finalPayableAmountPaise, discountPercent: new Prisma.Decimal(discountPercent), reason: text(body.reason, 1000) || null, actorUserId: actor.userId, actorRole: actor.role } });
  });
  return summaryOverrideDoc(row, order);
}

export async function createOrderOverlayRecord(actor: AuthActor, order: PgOrder, input: { type: string; status?: string | null; value?: string | null; reason?: string | null; metadata?: Record<string, unknown> }) {
  return prisma.orderOverlay.create({ data: { orderId: order.id, type: input.type, status: input.status ?? null, value: input.value ?? null, reason: input.reason ?? null, metadata: input.metadata as Prisma.InputJsonValue | undefined, actorUserId: actor.userId, actorRole: actor.role } });
}

export function overlayDoc(row: any, order: PgOrder) {
  const cancellation = row.type === "cancel" || row.status === "cancelled" ? { status: "cancelled", reason: row.reason ?? "", cancelledBy: { id: row.actorUserId?.toString?.() ?? "", role: "admin" }, cancelledAt: row.createdAt?.toISOString?.() ?? row.createdAt } : undefined;
  return {
    id: row.id?.toString?.() ?? "",
    orderId: order.id.toString(),
    dealerId: order.dealerId.toString(),
    dealerName: order.dealer.businessName,
    assignedStaffId: order.assignedStaffId?.toString?.() ?? null,
    status: row.status ?? "active",
    type: row.type,
    value: row.value ?? "",
    reason: row.reason ?? "",
    metadata: row.metadata ?? {},
    cancellation,
    edits: [],
    latestRevision: 0,
    source: "postgres",
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  };
}

export async function listPostgresCancelledOverlays(actor: AuthActor, input: { search?: string; page?: number; limit?: number }) {
  const where: Prisma.OrderOverlayWhereInput = { type: "cancel", status: "cancelled" };
  if (actor.role === "DEALER") where.order = { dealerId: actor.dealerId };
  if (isStaffLike(actor) && actor.staffId) where.order = { OR: [{ assignedStaffId: actor.staffId }, { dealer: { staffAssignments: { some: { staffId: actor.staffId, active: true } } } }] };
  if (input.search) where.OR = [{ reason: { contains: input.search, mode: "insensitive" } }, { order: { orderNumber: { contains: input.search, mode: "insensitive" } } }];
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 10)));
  const [total, rows] = await Promise.all([
    prisma.orderOverlay.count({ where }),
    prisma.orderOverlay.findMany({ where, include: { order: { include: orderAccessInclude } }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * limit, take: limit }),
  ]);
  return { rows: rows.map((row) => overlayDoc(row, row.order as PgOrder)), total, page, limit, totalPages: Math.ceil(total / limit) };
}



