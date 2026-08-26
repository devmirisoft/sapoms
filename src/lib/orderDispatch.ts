import { normalizeSku } from "@/lib/orderProductNotes.mjs";

export type DispatchStatus = "pending" | "packing" | "dispatched" | "not_in_stock" | "successful";
export type DispatchActorRole = "staff" | "admin";
export type DispatchViewerRole = "admin" | "staff" | "dealer" | "unknown";

export type DispatchUserSession = {
  role: DispatchViewerRole;
  id: string;
  name?: string;
  roletype?: string;
};

export type DispatchHistoryEntry = {
  id: string;
  quantity: number;
  remark: string;
  status: DispatchStatus;
  actorId: string;
  actorRole: DispatchActorRole;
  createdAt: Date | string;
};

export type OrderDispatchRecord = {
  id?: string;
  orderId: string;
  orderItemId: string | null;
  sku: string;
  normalizedSku: string;
  occurrence: number;
  dealerId: string;
  assignedStaffId: string | null;
  orderedQuantity: number;
  dispatchedQuantity: number;
  currentStatus: DispatchStatus;
  updates: DispatchHistoryEntry[];
  createdAt?: Date | string;
  updatedAt?: Date | string;
  legacyImported?: boolean;
  legacyImportedAt?: Date | string;
};

export type DispatchSourceItem = {
  orderdata_id?: string;
  orderdata_orderid?: string;
  orderdata_cat_no?: string;
  orderdata_item_quantity?: string | number;
  readyquantity?: string | number;
  orderdata_status?: string | number;
  del_status?: string | number;
  product_name?: string;
  product_discription?: string;
  remark?: string;
  remarks?: string;
  fallbackProductNote?: string;
};

export type MergedDispatchItem = {
  orderItemId: string | null;
  orderedQuantity: number;
  dispatchedQuantity: number;
  remainingQuantity: number;
  dispatchStatus: DispatchStatus;
  dispatchHistory: DispatchHistoryEntry[];
  occurrence: number;
};

export const DISPATCH_MUTATION_STATUSES = [
  "packing",
  "dispatched",
  "not_in_stock",
  "successful",
] as const;

export const DISPATCH_STATUS_LABELS: Record<DispatchStatus, string> = {
  pending: "Pending",
  packing: "Packing",
  dispatched: "Dispatched",
  not_in_stock: "Not in Stock",
  successful: "Successful",
};

export const BULK_DISPATCH_STATUS: DispatchStatus = "dispatched";

// ── Dispatch tracking information (order level) ──────────────────────────────
// Controlled courier list. No courier enum existed before this, so the list
// lives here next to the rest of the shared dispatch vocabulary.
export const DISPATCH_PARTNERS = ["BlueDart", "DTDC", "Delhivery"] as const;

export type DispatchPartner = (typeof DISPATCH_PARTNERS)[number];

export const TRACKING_NUMBER_LIMIT = 120;
export const TRACKING_LINK_LIMIT = 2048;
export const DOCK_LIMIT = 120;

export type DispatchTrackingInfo = {
  dispatchPartner: string | null;
  trackingNumber: string | null;
  trackingLink: string | null;
  dock: string | null;
};

export type DispatchTrackingValidation =
  | { ok: true; value: DispatchTrackingInfo }
  | { ok: false; message: string };

function trackingText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().slice(0, max);
  return text || null;
}

// Tracking number formats differ per courier, so nothing beyond trim/length.
export function normalizeTrackingNumber(value: unknown): string | null {
  return trackingText(value, TRACKING_NUMBER_LIMIT);
}

export function normalizeDock(value: unknown): string | null {
  return trackingText(value, DOCK_LIMIT);
}

// Matches a known partner case-insensitively and returns the canonical label.
export function normalizeDispatchPartner(value: unknown): string | null {
  const text = trackingText(value, 60);
  if (!text) return null;
  return DISPATCH_PARTNERS.find((partner) => partner.toLowerCase() === text.toLowerCase()) ?? null;
}

export function isValidDispatchPartner(value: unknown): boolean {
  const text = trackingText(value, 60);
  return !text || normalizeDispatchPartner(text) !== null;
}

export function normalizeTrackingLink(value: unknown): string | null {
  const text = trackingText(value, TRACKING_LINK_LIMIT);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? text : null;
  } catch {
    return null;
  }
}

export function isValidTrackingLink(value: unknown): boolean {
  const text = trackingText(value, TRACKING_LINK_LIMIT);
  return !text || normalizeTrackingLink(text) !== null;
}

// Shared by the dispatch API and the dispatch details form so both reject the
// same values. Absent keys are treated as "clear this field" by the caller.
export function normalizeDispatchTrackingInput(input: {
  dispatchPartner?: unknown;
  trackingNumber?: unknown;
  trackingLink?: unknown;
  dock?: unknown;
}): DispatchTrackingValidation {
  if (!isValidDispatchPartner(input.dispatchPartner)) {
    return { ok: false, message: `Dispatched By must be one of: ${DISPATCH_PARTNERS.join(", ")}.` };
  }
  if (!isValidTrackingLink(input.trackingLink)) {
    return { ok: false, message: "Tracking Link must be a valid http(s) URL." };
  }
  return {
    ok: true,
    value: {
      dispatchPartner: normalizeDispatchPartner(input.dispatchPartner),
      trackingNumber: normalizeTrackingNumber(input.trackingNumber),
      trackingLink: normalizeTrackingLink(input.trackingLink),
      dock: normalizeDock(input.dock),
    },
  };
}

// Reads tracking info off any order-shaped record (PostgreSQL row, legacy
// PHP row, or the merged order meta used by the order details page).
export function readDispatchTrackingInfo(source: Record<string, unknown> | null | undefined): DispatchTrackingInfo {
  const record = source ?? {};
  return {
    dispatchPartner: normalizeDispatchPartner(record.dispatchPartner ?? record.dispatch_partner),
    trackingNumber: normalizeTrackingNumber(record.trackingNumber ?? record.tracking_number),
    trackingLink: normalizeTrackingLink(record.trackingLink ?? record.tracking_link),
    dock: normalizeDock(record.dock),
  };
}

// Dealers read tracking information; only dispatch staff and admins write it.
export function canUserEditDispatchTracking(user: DispatchUserSession | null, context: {
  dealerId?: string | null;
  assignedStaffId?: string | null;
  acceptOrder?: string | number | null;
  delStatus?: string | number | null;
}): boolean {
  return (user?.role === "staff" || user?.role === "admin") && canUserEditDispatch(user, context);
}

export type NormalizedAcceptance = "accepted" | "unaccepted" | "missing";

export function normalizeOrderAcceptance(value: unknown): NormalizedAcceptance {
  if (value === null || value === undefined) return "missing";
  const text = String(value).trim().toLowerCase();
  if (!text) return "missing";
  if (text === "1" || text === "accepted" || text === "approved" || text === "true") return "accepted";
  if (text === "0" || text === "unaccepted" || text === "pending" || text === "false") return "unaccepted";
  return "missing";
}

export function hasTerminalOrderStatus(...values: unknown[]): boolean {
  return values.some((value) => /(?:cancel|reject|declin|deleted)/i.test(String(value ?? "").trim()));
}

export function resolveOrderAcceptance(input: {
  phpValues: unknown[];
  mongoAccepted?: unknown;
  terminalValues?: unknown[];
  deleted?: unknown;
}): "1" | "0" | "" {
  if (isDeletedOrderForDispatch(input.deleted) || hasTerminalOrderStatus(...(input.terminalValues ?? []))) return "0";
  for (const value of input.phpValues) {
    const normalized = normalizeOrderAcceptance(value);
    if (normalized === "accepted") return "1";
    if (normalized === "unaccepted") return "0";
  }
  return normalizeOrderAcceptance(input.mongoAccepted) === "accepted" ? "1" : "";
}

function normalizeDispatchFlag(value: unknown, truthy = "1"): boolean {
  return String(value ?? "").trim() === truthy;
}

export function safeDispatchInteger(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

export function normalizeDispatchStatus(value: unknown, fallback: DispatchStatus = "pending"): DispatchStatus {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return fallback;

  if (text === "1" || text === "packing") return "packing";
  if (text === "2" || text === "dispatch" || text === "dispatched") return "dispatched";
  if (text === "3" || text === "notinstock" || text === "not_in_stock" || text === "not in stock") return "not_in_stock";
  if (text === "4" || text === "successful" || text === "success") return "successful";
  if (text === "0" || text === "pending" || text === "inprocess" || text === "in process") return "pending";

  return fallback;
}

export function normalizeDispatchRemark(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function computeRemainingQuantity(orderedQuantity: number, dispatchedQuantity: number): number {
  return Math.max(0, safeDispatchInteger(orderedQuantity) - safeDispatchInteger(dispatchedQuantity));
}

export function normalizeDispatchOrderItemId(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

export function buildDispatchFallbackKey(orderId: string, normalizedSku: string, occurrence: number): string {
  return [String(orderId ?? "").trim(), normalizedSku, String(Math.max(1, safeDispatchInteger(occurrence) || 1))].join("::");
}

export function buildDispatchIdentity(input: {
  orderId: string;
  orderItemId?: string | null;
  sku?: string;
  normalizedSku?: string;
  occurrence?: number;
}) {
  const orderItemId = normalizeDispatchOrderItemId(input.orderItemId);
  if (orderItemId) return { orderItemId };

  const normalizedSku = normalizeSku(input.normalizedSku ?? input.sku);
  return {
    orderId: String(input.orderId ?? "").trim(),
    normalizedSku,
    occurrence: Math.max(1, safeDispatchInteger(input.occurrence) || 1),
  };
}

export function canUserViewDispatch(user: DispatchUserSession | null, context: {
  dealerId?: string | null;
  assignedStaffId?: string | null;
}): boolean {
  if (!user?.id) return false;
  if (user.role === "admin") return true;
  if (user.role === "staff") return String(context.assignedStaffId ?? "").trim() === user.id;
  if (user.role === "dealer") return String(context.dealerId ?? "").trim() === user.id;
  return false;
}

export function isAcceptedOrderForDispatch(value: unknown): boolean {
  return normalizeOrderAcceptance(value) === "accepted";
}

export function isDeletedOrderForDispatch(value: unknown): boolean {
  return normalizeDispatchFlag(value, "1");
}

export function canUpdateOrderDispatch(input: {
  role: DispatchViewerRole;
  isAssignedStaff: boolean;
  isAccepted: boolean;
  isDeleted: boolean;
}): boolean {
  if (input.role === "dealer" || input.isDeleted || !input.isAccepted) return false;
  if (input.role === "admin") return true;
  if (input.role === "staff") return input.isAssignedStaff;
  return false;
}

export function canUserEditDispatch(user: DispatchUserSession | null, context: {
  dealerId?: string | null;
  assignedStaffId?: string | null;
  acceptOrder?: string | number | null;
  delStatus?: string | number | null;
}): boolean {
  if (!canUserViewDispatch(user, context)) return false;
  const viewer = user as DispatchUserSession;
  return canUpdateOrderDispatch({
    role: viewer.role,
    isAssignedStaff: String(context.assignedStaffId ?? "").trim() === viewer.id,
    isAccepted: isAcceptedOrderForDispatch(context.acceptOrder),
    isDeleted: isDeletedOrderForDispatch(context.delStatus),
  });
}

export function canUserBulkDispatch(user: DispatchUserSession | null, context: {
  dealerId?: string | null;
  assignedStaffId?: string | null;
  acceptOrder?: string | number | null;
  delStatus?: string | number | null;
}): boolean {
  return (user?.role === "staff" || user?.role === "admin") && canUserEditDispatch(user, context);
}

export function mergeOrderItemsWithDispatchRecords<T extends DispatchSourceItem>(
  items: T[],
  dispatchRecords: Array<Partial<OrderDispatchRecord>>
): Array<T & MergedDispatchItem> {
  const byOrderItemId = new Map<string, Partial<OrderDispatchRecord>>();
  const byFallback = new Map<string, Partial<OrderDispatchRecord>>();

  for (const record of dispatchRecords ?? []) {
    const orderItemId = normalizeDispatchOrderItemId(record.orderItemId);
    if (orderItemId) byOrderItemId.set(orderItemId, record);

    const orderId = String(record.orderId ?? "").trim();
    const normalizedSku = normalizeSku(record.normalizedSku ?? record.sku);
    const occurrence = Math.max(1, safeDispatchInteger(record.occurrence) || 1);
    if (orderId && normalizedSku) {
      byFallback.set(buildDispatchFallbackKey(orderId, normalizedSku, occurrence), record);
    }
  }

  const occurrenceCounts = new Map<string, number>();

  return (items ?? []).map((item) => {
    const normalizedSku = normalizeSku(item.orderdata_cat_no ?? item.product_name ?? "");
    const occurrence = normalizedSku
      ? (occurrenceCounts.get(normalizedSku) ?? 0) + 1
      : 1;
    if (normalizedSku) occurrenceCounts.set(normalizedSku, occurrence);

    const orderId = String(item.orderdata_orderid ?? "").trim();
    const orderItemId = normalizeDispatchOrderItemId(item.orderdata_id);
    const matchedRecord = orderItemId && byOrderItemId.has(orderItemId)
      ? byOrderItemId.get(orderItemId)
      : byFallback.get(buildDispatchFallbackKey(orderId, normalizedSku, occurrence));

    const orderedQuantity = safeDispatchInteger(
      matchedRecord?.orderedQuantity ?? item.orderdata_item_quantity
    );
    const legacyDispatched = safeDispatchInteger(item.readyquantity);
    const dispatchedQuantity = safeDispatchInteger(
      matchedRecord?.dispatchedQuantity ?? legacyDispatched
    );
    const remainingQuantity = computeRemainingQuantity(orderedQuantity, dispatchedQuantity);
    const dispatchStatus = normalizeDispatchStatus(
      matchedRecord?.currentStatus ?? item.orderdata_status,
      dispatchedQuantity > 0 ? "dispatched" : "pending"
    );

    return {
      ...item,
      orderItemId,
      orderedQuantity,
      dispatchedQuantity,
      remainingQuantity,
      dispatchStatus,
      dispatchHistory: Array.isArray(matchedRecord?.updates)
        ? (matchedRecord?.updates as DispatchHistoryEntry[])
        : [],
      occurrence,
    };
  });
}

export type BulkDispatchLine = {
  orderItemId: string | null;
  sku: string;
  normalizedSku: string;
  occurrence: number;
  productName: string;
  orderedQuantity: number;
  dispatchedQuantity: number;
  remainingQuantity: number;
  currentStatus: DispatchStatus;
};

export type BulkDispatchSkippedLine = {
  orderItemId: string | null;
  sku: string;
  occurrence: number;
  productName: string;
  reason: string;
};

export function buildBulkDispatchPlan<T extends DispatchSourceItem & Partial<MergedDispatchItem>>(
  items: T[]
): {
  lines: BulkDispatchLine[];
  skipped: BulkDispatchSkippedLine[];
  totalQuantity: number;
} {
  const lines: BulkDispatchLine[] = [];
  const skipped: BulkDispatchSkippedLine[] = [];

  for (const item of items ?? []) {
    const orderItemId = normalizeDispatchOrderItemId(item.orderItemId ?? item.orderdata_id);
    const sku = String(item.orderdata_cat_no ?? "").trim();
    const normalizedSku = normalizeSku(sku);
    const occurrence = Math.max(1, safeDispatchInteger(item.occurrence) || 1);
    const productName = String(item.product_name ?? sku ?? "Product line").trim();
    const remainingQuantity = safeDispatchInteger(item.remainingQuantity);
    const dispatchStatus = normalizeDispatchStatus(item.dispatchStatus ?? item.orderdata_status);
    const line = { orderItemId, sku, occurrence, productName };

    if (isDeletedOrderForDispatch(item.del_status)) {
      skipped.push({ ...line, reason: "Deleted product line" });
      continue;
    }

    if (!orderItemId && !normalizedSku) {
      skipped.push({ ...line, reason: "Missing dispatch identity" });
      continue;
    }

    if (dispatchStatus === "not_in_stock") {
      skipped.push({ ...line, reason: "Not in Stock" });
      continue;
    }

    if (dispatchStatus === "successful" || remainingQuantity <= 0) {
      skipped.push({ ...line, reason: "Already fully dispatched" });
      continue;
    }

    lines.push({
      ...line,
      normalizedSku,
      orderedQuantity: safeDispatchInteger(item.orderedQuantity ?? item.orderdata_item_quantity),
      dispatchedQuantity: safeDispatchInteger(item.dispatchedQuantity ?? item.readyquantity),
      remainingQuantity,
      currentStatus: dispatchStatus,
    });
  }

  return {
    lines,
    skipped,
    totalQuantity: lines.reduce((sum, line) => sum + line.remainingQuantity, 0),
  };
}

export function buildBulkDispatchLineKey(line: {
  orderItemId?: string | null;
  normalizedSku?: string;
  sku?: string;
  occurrence?: number;
}): string {
  const orderItemId = normalizeDispatchOrderItemId(line.orderItemId);
  if (orderItemId) return `item:${orderItemId}`;
  const normalizedSku = normalizeSku(line.normalizedSku ?? line.sku);
  if (!normalizedSku) return "";
  return `sku:${normalizedSku}:${Math.max(1, safeDispatchInteger(line.occurrence) || 1)}`;
}

export function buildLegacyDispatchSeed(input: {
  orderId: string;
  orderItemId?: string | null;
  sku: string;
  occurrence: number;
  dealerId: string;
  assignedStaffId?: string | null;
  orderedQuantity: number;
  legacyReadyQuantity?: number;
  legacyStatus?: unknown;
  now?: Date;
}) {
  const orderedQuantity = safeDispatchInteger(input.orderedQuantity);
  const dispatchedQuantity = Math.min(
    orderedQuantity,
    safeDispatchInteger(input.legacyReadyQuantity)
  );
  const currentStatus = normalizeDispatchStatus(
    input.legacyStatus,
    dispatchedQuantity > 0 ? "dispatched" : "pending"
  );
  const now = input.now ?? new Date();

  return {
    orderId: String(input.orderId ?? "").trim(),
    orderItemId: normalizeDispatchOrderItemId(input.orderItemId),
    sku: String(input.sku ?? "").trim(),
    normalizedSku: normalizeSku(input.sku),
    occurrence: Math.max(1, safeDispatchInteger(input.occurrence) || 1),
    dealerId: String(input.dealerId ?? "").trim(),
    assignedStaffId: normalizeDispatchOrderItemId(input.assignedStaffId),
    orderedQuantity,
    dispatchedQuantity,
    currentStatus,
    updates: [] as DispatchHistoryEntry[],
    legacyImported: dispatchedQuantity > 0,
    ...(dispatchedQuantity > 0 ? { legacyImportedAt: now } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

export function applyDispatchUpdateSnapshot(
  record: OrderDispatchRecord,
  input: {
    dispatchQuantity: number;
    status: DispatchStatus;
    remark: string;
    actorId: string;
    actorRole: DispatchActorRole;
    updateId: string;
    createdAt: Date;
  }
): OrderDispatchRecord {
  const dispatchQuantity = safeDispatchInteger(input.dispatchQuantity);
  if (dispatchQuantity <= 0) {
    throw new Error("Dispatch quantity must be greater than zero");
  }

  const remainingBefore = computeRemainingQuantity(record.orderedQuantity, record.dispatchedQuantity);
  if (dispatchQuantity > remainingBefore) {
    throw new Error("Dispatch quantity exceeds remaining quantity");
  }

  const dispatchedQuantity = record.dispatchedQuantity + dispatchQuantity;
  const remainingAfter = computeRemainingQuantity(record.orderedQuantity, dispatchedQuantity);
  const requestedStatus = normalizeDispatchStatus(input.status, "packing");
  const currentStatus = remainingAfter === 0 && requestedStatus !== "not_in_stock"
    ? "successful"
    : requestedStatus;

  return {
    ...record,
    dispatchedQuantity,
    currentStatus,
    updatedAt: input.createdAt,
    updates: [
      ...(record.updates ?? []),
      {
        id: input.updateId,
        quantity: dispatchQuantity,
        remark: normalizeDispatchRemark(input.remark),
        status: currentStatus,
        actorId: String(input.actorId ?? "").trim(),
        actorRole: input.actorRole,
        createdAt: input.createdAt,
      },
    ],
  };
}
