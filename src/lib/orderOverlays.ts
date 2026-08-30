import { randomUUID } from "node:crypto";
import type { Collection, Document, Filter, WithId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { normalizeSku } from "@/lib/orderProductNotes.mjs";
import { resolveOrderAmounts } from "@/lib/orderAmounts";

export const ORDER_OVERLAY_COLLECTION = "order_overlays";
export const ORDER_OVERLAY_VERSION = "order-overlays-v1";

export type OrderOverlayActorRole = "admin" | "staff" | "dealer" | "accountant";

export type OrderOverlayActor = {
  role: OrderOverlayActorRole;
  actorId: string;
  name?: string;
  roletype?: string;
};

export type OrderOverlayItem = Record<string, unknown> & {
  orderdata_id?: string;
  orderdata_orderid?: string;
  orderdata_cat_no?: string;
  orderdata_item_quantity?: string | number;
  orderdata_price?: string | number;
  orderdata_discount?: string | number;
  orderdata_afterDisPrice?: string | number;
  product_name?: string;
  product_discription?: string;
  product_unit?: string;
  readyquantity?: string | number;
  orderdata_status?: string | number;
};

export type OrderOverlayCancellation = {
  status: "cancelled";
  reason: string;
  cancelledBy: {
    id: string;
    role: OrderOverlayActorRole;
    name?: string;
  };
  cancelledAt: string;
};

export type OrderAcceptanceMirror = {
  status: "accepted";
  rawStatus: "1";
  acceptedBy: {
    id: string;
    role: "admin";
    name?: string;
  };
  acceptedAt: string;
};

export type OrderOverlayChange =
  | { type: "removed"; originalLineId: string; original: OrderOverlayItem; summary: string }
  | { type: "replaced"; originalLineId: string; effectiveLineId: string; original: OrderOverlayItem; current: OrderOverlayItem; summary: string }
  | { type: "quantity_changed"; originalLineId: string; original: OrderOverlayItem; current: OrderOverlayItem; fromQuantity: number; toQuantity: number; summary: string };

export type OrderChangeRequest = Record<string, unknown> & {
  id: string;
  type: "cancel_request" | "edit_request";
  status: "pending" | "approved" | "rejected" | string;
  note: string;
  requestedAt: string;
  requestedBy?: { id?: string; role?: OrderOverlayActorRole | string; name?: string };
  revision?: OrderEditRevision;
  originalItems?: OrderOverlayItem[];
  proposedItems?: OrderOverlayItem[];
};

export type OrderEditRevision = {
  revision: number;
  idempotencyKey: string;
  editedBy: {
    id: string;
    role: OrderOverlayActorRole;
    name?: string;
  };
  editedAt: string;
  originalItems: OrderOverlayItem[];
  effectiveItems: OrderOverlayItem[];
  changes: OrderOverlayChange[];
  totals: {
    grossAmount: number;
    discountAmount: number;
    netPayableAmount: number;
  };
};

export type OrderOverlayDocument = {
  orderId: string;
  formattedOrderNumber?: string;
  dealerId: string;
  dealerName?: string;
  assignedStaffId?: string | null;
  status: "active" | "cancelled";
  cancellation?: OrderOverlayCancellation;
  acceptance?: OrderAcceptanceMirror;
  edits: OrderEditRevision[];
  latestRevision: number;
  changeRequests?: OrderChangeRequest[];
  originalOrderRef?: Record<string, unknown>;
  source: typeof ORDER_OVERLAY_VERSION;
  createdAt: string;
  updatedAt: string;
};

export type EffectiveOrderResolution = {
  orderId: string;
  originalOrder: Record<string, unknown> | null;
  originalItems: OrderOverlayItem[];
  effectiveItems: OrderOverlayItem[];
  effectiveTotals: {
    grossAmount: number;
    discountAmount: number;
    netPayableAmount: number;
  };
  cancellation: OrderOverlayCancellation | null;
  isCancelled: boolean;
  isEdited: boolean;
  latestRevision: number;
  changeHistory: OrderOverlayChange[];
  overlay: OrderOverlayDocument | null;
  eligibility: OrderOverlayEligibility;
};

export type OrderOverlayEligibility = {
  canDealerChange: boolean;
  reason: string;
  accepted: boolean;
  declinedOrDeleted: boolean;
  cancelled: boolean;
  dispatchStarted: boolean;
  completed: boolean;
};

export class OrderOverlayError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "OrderOverlayError";
    this.status = status;
    this.code = code;
  }
}

function text(value: unknown, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const valueText = text(value);
    if (valueText) return valueText;
  }
  return "";
}

function scalar(value: unknown, fallback: string | number = ""): string | number {
  return typeof value === "string" || typeof value === "number" ? value : fallback;
}

export function normalizeOverlayOrderId(value: unknown) {
  const raw = text(value, 120);
  const displayIdMatch = raw.match(/(?:^|\/)(\d+)$/);
  return displayIdMatch?.[1] ?? raw;
}

export function resolveOverlayDealerId(order: Record<string, unknown> | null | undefined, item?: Record<string, unknown> | null) {
  return firstNonEmpty(
    order?.order_dealer,
    order?.orderdata_dealerid,
    order?.Dealer_Id,
    order?.dealerId,
    item?.order_dealer,
    item?.orderdata_dealerid,
    item?.Dealer_Id,
    item?.dealerId
  );
}

export function resolveOverlayAssignedStaffId(order: Record<string, unknown> | null | undefined, item?: Record<string, unknown> | null) {
  return firstNonEmpty(order?.assignedstaff, order?.staffid, item?.assignedstaff, item?.staffid) || null;
}

function stableLineId(item: Record<string, unknown>, orderId: string, occurrence: number) {
  return firstNonEmpty(item.orderdata_id, item.orderItemId, item.id)
    || `php:${orderId}:${normalizeSku(item.orderdata_cat_no ?? item.productId ?? item.catNo)}:${occurrence}`;
}

function normalizeItem(item: Record<string, unknown>, orderId: string, index: number): OrderOverlayItem {
  const lineId = stableLineId(item, orderId, index);
  const packSize = Math.max(1, numberValue(item.packSize ?? item.pack_size) || 1);
  const quantityPacks = Math.max(0, numberValue(item.quantityPacks ?? item.quantity_packs ?? item.packs ?? item.orderdata_item_quantity ?? item.quantity));
  const totalPieces = quantityPacks * packSize;
  return {
    ...item,
    orderdata_id: lineId,
    orderdata_orderid: firstNonEmpty(item.orderdata_orderid, item.orderId, orderId),
    orderdata_cat_no: firstNonEmpty(item.orderdata_cat_no, item.catNo, item.productId, item.sku),
    orderdata_item_quantity: String(quantityPacks),
    quantityPacks,
    quantity_packs: quantityPacks,
    packs: quantityPacks,
    packSize,
    pack_size: packSize,
    totalPieces,
    total_pieces: totalPieces,
    pieces: totalPieces,
    orderdata_price: scalar(item.orderdata_price ?? item.unitPrice ?? item.unit_price, 0),
    orderdata_discount: scalar(item.orderdata_discount ?? item.discountAmount ?? item.discount_amount, 0),
    orderdata_afterDisPrice: scalar(item.orderdata_afterDisPrice ?? item.finalPrice ?? item.final_price, 0),
    product_name: firstNonEmpty(item.product_name, item.productName, item.name),
    product_discription: firstNonEmpty(item.product_discription, item.productDescription, item.description),
    product_unit: firstNonEmpty(item.product_unit, item.unit, "Pcs"),
    readyquantity: scalar(item.readyquantity ?? item.readyQuantity, 0),
    orderdata_status: scalar(item.orderdata_status ?? item.status, "0"),
  };
}

export function normalizeOrderItems(rawData: unknown, orderId: string): { meta: Record<string, unknown>; items: OrderOverlayItem[] } {
  const data = rawData && typeof rawData === "object" && "data" in rawData
    ? (rawData as { data?: unknown }).data
    : rawData;
  const meta = Array.isArray(data)
    ? (data[0] && typeof data[0] === "object" ? data[0] as Record<string, unknown> : {})
    : (data && typeof data === "object" ? data as Record<string, unknown> : {});
  let rows: Record<string, unknown>[] = [];

  if (Array.isArray(data)) {
    if (Array.isArray((meta as { items?: unknown[] }).items)) {
      rows = ((meta as { items?: unknown[] }).items ?? []).filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
    } else {
      rows = data.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
    }
  } else if (Array.isArray((meta as { items?: unknown[] }).items)) {
    rows = ((meta as { items?: unknown[] }).items ?? []).filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  }

  const occurrences = new Map<string, number>();
  return {
    meta,
    items: rows.map((item) => {
      const sku = normalizeSku(item.orderdata_cat_no ?? item.productId ?? item.catNo);
      const occurrence = (occurrences.get(sku) ?? 0) + 1;
      occurrences.set(sku, occurrence);
      return normalizeItem(item, orderId, occurrence);
    }),
  };
}

export function hasDispatchStarted(items: Array<Record<string, unknown>>, dispatchRecords: Array<Record<string, unknown>> = []) {
  if ((dispatchRecords ?? []).some((record) => numberValue(record.dispatchedQuantity) > 0 || Array.isArray(record.updates) && record.updates.length > 0)) {
    return true;
  }
  return (items ?? []).some((item) => {
    if (numberValue(item.readyquantity ?? item.readyQuantity) > 0) return true;
    const fulfilmentStatus = text(item.fulfilmentStatus ?? item.fulfilment_status ?? item.orderdata_status).toLowerCase();
    return Boolean(fulfilmentStatus) && !["0", "pending"].includes(fulfilmentStatus);
  });
}

export function resolveOrderOverlayEligibility(input: {
  order: Record<string, unknown> | null;
  items: Array<Record<string, unknown>>;
  overlay?: OrderOverlayDocument | null;
  dispatchRecords?: Array<Record<string, unknown>>;
}): OrderOverlayEligibility {
  const accepted = text(input.order?.accept_order ?? input.items[0]?.accept_order) === "1";
  const statusText = [
    input.order?.order_status,
    input.order?.status,
    input.order?.mtstatus,
    input.order?.reason,
  ].map((value) => text(value).toLowerCase()).join(" ");
  const declinedOrDeleted = text(input.order?.del_status ?? input.items[0]?.del_status) === "1" || /(declin|reject|deleted)/i.test(statusText);
  const cancelled = input.overlay?.status === "cancelled" || /(cancel|cancelled|canceled)/i.test(statusText);
  const completed = /(completed|successful|success)/i.test(statusText) || numberValue(input.order?.mtstatus) >= 2;
  const dispatchStarted = hasDispatchStarted(input.items, input.dispatchRecords);

  let reason = "eligible";
  if (cancelled) reason = "order_already_cancelled";
  else if (declinedOrDeleted) reason = "order_declined_or_deleted";
  else if (accepted) reason = "order_already_accepted";
  else if (dispatchStarted) reason = "dispatch_already_started";
  else if (completed) reason = "order_already_completed";

  return {
    canDealerChange: reason === "eligible",
    reason,
    accepted,
    declinedOrDeleted,
    cancelled,
    dispatchStarted,
    completed,
  };
}

export function computeOverlayTotals(items: Array<Record<string, unknown>>, baseOrder?: Record<string, unknown> | null) {
  const grossAmount = roundMoney(items.reduce((sum, item) => {
    const quantity = numberValue(item.orderdata_item_quantity ?? item.quantityPacks ?? item.quantity);
    const packSize = Math.max(1, numberValue(item.packSize ?? item.pack_size) || 1);
    const unitPrice = numberValue(item.orderdata_price ?? item.unitPrice ?? item.unit_price);
    const explicit = numberValue(item.listPriceTotal ?? item.list_price_total);
    return sum + (explicit > 0 ? explicit : quantity * packSize * unitPrice);
  }, 0));

  const original = resolveOrderAmounts(baseOrder ?? {});
  const originalGross = original.gross || grossAmount;
  const discountRatio = originalGross > 0 ? original.discountAmount / originalGross : 0;
  const discountAmount = roundMoney(Math.max(0, grossAmount * discountRatio));
  return {
    grossAmount,
    discountAmount,
    netPayableAmount: roundMoney(Math.max(0, grossAmount - discountAmount)),
  };
}

const QUANTITY_FIELD = "orderdata_item_quantity";
const QUANTITY_ALIASES = ["quantityPacks", "quantity_packs", "packs", "quantity", "producQuanity"] as const;
const PIECE_ALIASES = ["totalPieces", "total_pieces", "pieces", "producQuanity"] as const;

function itemSummary(item: Record<string, unknown>) {
  const name = firstNonEmpty(item.product_name, item.productName, item.orderdata_cat_no, item.productId, "Item");
  const cat = firstNonEmpty(item.orderdata_cat_no, item.catNo, item.productId);
  return cat ? `${name} - Cat. No. ${cat}` : name;
}

function mergeRequestedItem(original: Record<string, unknown> | undefined, requested: Record<string, unknown>) {
  const merged: Record<string, unknown> = { ...(original ?? {}), ...requested };
  if (!(QUANTITY_FIELD in requested)) return merged;

  // The edit dialog rewrites `orderdata_item_quantity` but echoes the row's other pack-count
  // aliases back untouched. normalizeItem() prefers those aliases, so an edited quantity used to
  // be silently discarded and the edit was rejected as a 422 "no_changes". When the submitted
  // quantity disagrees with the echoed aliases, the explicit field is the dealer's intent.
  const submittedQuantity = numberValue(requested[QUANTITY_FIELD]);
  const aliasQuantity = QUANTITY_ALIASES.map((alias) => requested[alias]).find((value) => value !== undefined);
  if (aliasQuantity === undefined || numberValue(aliasQuantity) === submittedQuantity) return merged;

  for (const alias of QUANTITY_ALIASES) delete merged[alias];
  for (const alias of PIECE_ALIASES) delete merged[alias];
  return merged;
}

export function buildOrderEditRevision(input: {
  orderId: string;
  baseOrder?: Record<string, unknown> | null;
  originalItems: OrderOverlayItem[];
  requestedItems: Array<Record<string, unknown>>;
  expectedRevision: number;
  idempotencyKey?: string;
  actor: OrderOverlayActor;
}): OrderEditRevision {
  const idempotencyKey = text(input.idempotencyKey, 120) || randomUUID();
  const originalsById = new Map(input.originalItems.map((item) => [text(item.orderdata_id), item]));
  const effectiveItems = input.requestedItems.map((item, index) => {
    const originalId = text(item.originalLineId ?? item.orderdata_id ?? item.orderItemId);
    const original = originalsById.get(originalId);
    const normalized = normalizeItem(mergeRequestedItem(original, item), input.orderId, index);
    const lineId = original ? text(original.orderdata_id) : firstNonEmpty(item.orderdata_id, item.orderItemId, `overlay:${input.orderId}:${randomUUID()}`);
    return { ...normalized, orderdata_id: lineId.startsWith("overlay:") || original ? lineId : `overlay:${input.orderId}:${lineId}` };
  });

  if (effectiveItems.length === 0) {
    throw new OrderOverlayError(422, "empty_order", "An edited order must keep at least one item. Cancel the order instead.");
  }

  const seen = new Set<string>();
  for (const item of effectiveItems) {
    const lineId = text(item.orderdata_id);
    if (!lineId || seen.has(lineId)) throw new OrderOverlayError(422, "invalid_item_identity", "Edited items must have stable unique identities.");
    seen.add(lineId);
    if (numberValue(item.orderdata_item_quantity) <= 0) throw new OrderOverlayError(422, "invalid_quantity", "Item quantity must be greater than zero.");
  }

  const effectiveByOriginalId = new Map<string, OrderOverlayItem>();
  for (const item of effectiveItems) {
    const originalLineId = text((item as Record<string, unknown>).originalLineId ?? item.orderdata_id);
    if (originalLineId) effectiveByOriginalId.set(originalLineId, item);
  }

  const changes: OrderOverlayChange[] = [];
  for (const original of input.originalItems) {
    const originalId = text(original.orderdata_id);
    const current = effectiveByOriginalId.get(originalId) ?? effectiveItems.find((item) => text(item.orderdata_id) === originalId);
    if (!current) {
      changes.push({ type: "removed", originalLineId: originalId, original, summary: `Removed: ${itemSummary(original)}` });
      continue;
    }
    const originalSku = normalizeSku(original.orderdata_cat_no);
    const currentSku = normalizeSku(current.orderdata_cat_no);
    if (originalSku && currentSku && originalSku !== currentSku) {
      changes.push({
        type: "replaced",
        originalLineId: originalId,
        effectiveLineId: text(current.orderdata_id),
        original,
        current,
        summary: `Replaced: ${itemSummary(original)} -> ${itemSummary(current)}`,
      });
      continue;
    }
    const fromQuantity = numberValue(original.orderdata_item_quantity);
    const toQuantity = numberValue(current.orderdata_item_quantity);
    if (fromQuantity !== toQuantity) {
      changes.push({
        type: "quantity_changed",
        originalLineId: originalId,
        original,
        current,
        fromQuantity,
        toQuantity,
        summary: `Quantity changed: ${itemSummary(current)} from ${fromQuantity} to ${toQuantity}`,
      });
    }
  }

  if (changes.length === 0) {
    throw new OrderOverlayError(422, "no_changes", "No item changes were submitted.");
  }

  return {
    revision: input.expectedRevision + 1,
    idempotencyKey,
    editedBy: { id: input.actor.actorId, role: input.actor.role, name: input.actor.name },
    editedAt: new Date().toISOString(),
    originalItems: input.originalItems,
    effectiveItems,
    changes,
    totals: computeOverlayTotals(effectiveItems, input.baseOrder),
  };
}

export async function getOrderOverlayCollection(): Promise<Collection<OrderOverlayDocument>> {
  const db = await getDb();
  const collection = db.collection<OrderOverlayDocument>(ORDER_OVERLAY_COLLECTION);
  await collection.createIndex({ orderId: 1 }, { unique: true });
  await collection.createIndex({ dealerId: 1, status: 1, updatedAt: -1 });
  await collection.createIndex({ assignedStaffId: 1, status: 1, updatedAt: -1 });
  await collection.createIndex({ "edits.idempotencyKey": 1 }, { sparse: true });
  return collection;
}

export function toSafeOverlay(doc: WithId<OrderOverlayDocument> | OrderOverlayDocument | null) {
  if (!doc) return null;
  const anyDoc = doc as OrderOverlayDocument & { _id?: { toString(): string } };
  return {
    ...anyDoc,
    id: anyDoc._id?.toString(),
    _id: undefined,
  };
}

export async function findOrderOverlay(orderId: unknown) {
  const collection = await getOrderOverlayCollection();
  return collection.findOne({ orderId: normalizeOverlayOrderId(orderId) });
}

export function resolveEffectiveOrder(input: {
  orderId: string;
  originalOrder?: Record<string, unknown> | null;
  originalItems: OrderOverlayItem[];
  overlay?: OrderOverlayDocument | null;
  dispatchRecords?: Array<Record<string, unknown>>;
}): EffectiveOrderResolution {
  const latestRevision = input.overlay?.edits?.[input.overlay.edits.length - 1] ?? null;
  const effectiveItems = latestRevision?.effectiveItems?.length ? latestRevision.effectiveItems : input.originalItems;
  const effectiveTotals = latestRevision?.totals ?? computeOverlayTotals(effectiveItems, input.originalOrder);
  const eligibility = resolveOrderOverlayEligibility({
    order: input.originalOrder ?? null,
    items: effectiveItems,
    overlay: input.overlay ?? null,
    dispatchRecords: input.dispatchRecords,
  });

  return {
    orderId: input.orderId,
    originalOrder: input.originalOrder ?? null,
    originalItems: input.originalItems,
    effectiveItems,
    effectiveTotals,
    cancellation: input.overlay?.cancellation ?? null,
    isCancelled: input.overlay?.status === "cancelled",
    isEdited: !!latestRevision,
    latestRevision: input.overlay?.latestRevision ?? 0,
    changeHistory: latestRevision?.changes ?? [],
    overlay: input.overlay ?? null,
    eligibility,
  };
}

export async function saveCancellation(input: {
  orderId: string;
  formattedOrderNumber?: string;
  dealerId: string;
  dealerName?: string;
  assignedStaffId?: string | null;
  originalOrderRef?: Record<string, unknown>;
  reason: string;
  actor: OrderOverlayActor;
}) {
  const reason = text(input.reason, 1000);
  if (!reason) throw new OrderOverlayError(400, "blank_reason", "Cancellation reason is required.");
  const now = new Date().toISOString();
  const collection = await getOrderOverlayCollection();
  const cancellation: OrderOverlayCancellation = {
    status: "cancelled",
    reason,
    cancelledBy: { id: input.actor.actorId, role: input.actor.role, name: input.actor.name },
    cancelledAt: now,
  };

  await collection.updateOne(
    { orderId: input.orderId },
    {
      $set: {
        orderId: input.orderId,
        formattedOrderNumber: input.formattedOrderNumber,
        dealerId: input.dealerId,
        dealerName: input.dealerName,
        assignedStaffId: input.assignedStaffId ?? null,
        status: "cancelled",
        cancellation,
        originalOrderRef: input.originalOrderRef,
        source: ORDER_OVERLAY_VERSION,
        updatedAt: now,
      },
      $setOnInsert: {
        edits: [],
        latestRevision: 0,
        createdAt: now,
      },
    },
    { upsert: true }
  );

  return collection.findOne({ orderId: input.orderId });
}

export async function saveAcceptedState(input: {
  orderId: string;
  dealerId?: string;
  assignedStaffId?: string | null;
  actor: OrderOverlayActor;
}) {
  if (input.actor.role !== "admin") {
    throw new OrderOverlayError(403, "forbidden", "Only Admin can mirror an accepted order state.");
  }
  const orderId = normalizeOverlayOrderId(input.orderId);
  const collection = await getOrderOverlayCollection();
  const existing = await collection.findOne({ orderId });
  if (existing?.status === "cancelled") {
    throw new OrderOverlayError(409, "order_already_cancelled", "Cancelled orders cannot be marked accepted.");
  }
  const now = new Date().toISOString();
  const acceptance: OrderAcceptanceMirror = {
    status: "accepted",
    rawStatus: "1",
    acceptedBy: { id: input.actor.actorId, role: "admin", name: input.actor.name },
    acceptedAt: now,
  };
  await collection.updateOne(
    { orderId },
    {
      $set: {
        orderId,
        acceptance,
        source: ORDER_OVERLAY_VERSION,
        updatedAt: now,
        ...(input.dealerId ? { dealerId: input.dealerId } : {}),
        ...(input.assignedStaffId !== undefined ? { assignedStaffId: input.assignedStaffId } : {}),
      },
      $setOnInsert: {
        status: "active",
        edits: [],
        latestRevision: 0,
        createdAt: now,
      },
    },
    { upsert: true }
  );
  return collection.findOne({ orderId });
}

export async function saveEditRevision(input: {
  orderId: string;
  dealerId: string;
  dealerName?: string;
  assignedStaffId?: string | null;
  originalOrderRef?: Record<string, unknown>;
  revision: OrderEditRevision;
  expectedRevision: number;
}) {
  const now = new Date().toISOString();
  const collection = await getOrderOverlayCollection();
  const filter: Filter<OrderOverlayDocument> = {
    orderId: input.orderId,
    status: { $ne: "cancelled" },
    $or: [
      { latestRevision: input.expectedRevision },
      { latestRevision: { $exists: false } },
    ],
  };
  if (input.expectedRevision > 0) {
    delete filter.$or;
    filter.latestRevision = input.expectedRevision;
  }

  const updated = await collection.findOneAndUpdate(
    filter,
    {
      $set: {
        orderId: input.orderId,
        dealerId: input.dealerId,
        dealerName: input.dealerName,
        assignedStaffId: input.assignedStaffId ?? null,
        status: "active",
        latestRevision: input.revision.revision,
        originalOrderRef: input.originalOrderRef,
        source: ORDER_OVERLAY_VERSION,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now, cancellation: undefined },
      $push: { edits: input.revision },
    },
    { upsert: input.expectedRevision === 0, returnDocument: "after" }
  );

  if (!updated) {
    const existing = await collection.findOne({ orderId: input.orderId });
    const duplicate = existing?.edits?.find((edit) => edit.idempotencyKey === input.revision.idempotencyKey);
    if (duplicate) return existing;
    throw new OrderOverlayError(409, "stale_revision", "This order was edited in another session. Reload and try again.");
  }

  return updated;
}

export async function listCancelledOrderOverlays(input: {
  role: OrderOverlayActorRole;
  actorId?: string;
  assignedDealerIds?: string[];
  search?: string;
  page?: number;
  limit?: number;
}) {
  const collection = await getOrderOverlayCollection();
  const query: Filter<OrderOverlayDocument> = { status: "cancelled" };
  if (input.role === "dealer") query.dealerId = input.actorId ?? "";
  if (input.role === "staff") query.dealerId = { $in: input.assignedDealerIds ?? [] } as unknown as string;
  const search = text(input.search, 200);
  if (search) {
    query.$or = [
      { orderId: { $regex: search, $options: "i" } },
      { formattedOrderNumber: { $regex: search, $options: "i" } },
      { dealerName: { $regex: search, $options: "i" } },
      { "cancellation.reason": { $regex: search, $options: "i" } },
    ] as Filter<Document>[];
  }

  const page = Math.max(1, Math.floor(input.page ?? 1));
  const limit = Math.min(5000, Math.max(1, Math.floor(input.limit ?? 10)));
  const total = await collection.countDocuments(query);
  const rows = await collection.find(query).sort({ "cancellation.cancelledAt": -1, updatedAt: -1 }).skip((page - 1) * limit).limit(limit).toArray();
  return { rows, total, page, limit, totalPages: Math.ceil(total / limit) };
}
