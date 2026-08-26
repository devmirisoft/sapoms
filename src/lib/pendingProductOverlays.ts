import type { OrderDispatchRecord } from "./orderDispatch";
import type { PendingProductsItemRow } from "./pendingProducts";

// Accepted orders can be edited or cancelled after the fact. Those revisions live in
// order_overlays rather than on order_items, so any product-first view has to resolve
// the effective item list the same way /api/order-overlays/[id] does, otherwise it
// keeps reporting the pre-edit snapshot: removed lines stay pending forever and lines
// added by an edit never appear at all.

export type PendingOverlayRow = {
  orderId: bigint | string | number;
  type: string;
  status: string | null;
  metadata: unknown;
};

export type PendingOverlayState = {
  cancelled: boolean;
  effectiveItems: PendingProductsItemRow[] | null;
};

function safeText(value: unknown, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function safeQuantity(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function overlayItemAlias(rawItem: unknown, orderId: string): PendingProductsItemRow | null {
  const item = jsonRecord(rawItem);
  const catalogueNumber = safeText(item.orderdata_cat_no ?? item.catNo ?? item.catalogueNumber, 120);
  const productName = safeText(item.product_name ?? item.productName ?? item.name, 200);
  if (!catalogueNumber && !productName) return null;

  const packSize = Math.max(1, safeQuantity(item.packSize ?? item.pack_size) || 1);
  const quantityPacks = safeQuantity(item.orderdata_item_quantity ?? item.quantityPacks ?? item.quantity_packs);
  const totalPieces = safeQuantity(item.totalPieces ?? item.total_pieces) || quantityPacks * packSize;
  const remarks = safeText(item.remarks ?? item.remark, 300);

  return {
    orderdata_id: safeText(item.orderdata_id, 200),
    orderdata_orderid: orderId,
    orderdata_cat_no: catalogueNumber,
    product_name: productName,
    product_discription: safeText(item.product_discription ?? item.productDescription, 300),
    product_unit: safeText(item.product_unit, 40) || "Units",
    orderdata_item_quantity: quantityPacks,
    // Dispatch totals are re-derived from the dispatch records; an overlay snapshot
    // records what was ordered, never what has since been dispatched.
    readyquantity: 0,
    orderdata_status: safeText(item.orderdata_status, 40) || "0",
    remark: remarks,
    remarks,
    packSize,
    totalPieces,
    quantityPacks,
    category: safeText(item.category ?? item.categorySnapshot, 120),
  };
}

/**
 * Collapses the overlay rows of a set of orders into one state per order, keyed by the
 * same legacy-or-database order id the pending aggregation uses.
 */
export function resolvePendingOverlayStates(
  rows: PendingOverlayRow[],
  orderKeyByOrderId: Map<string, string>
): Map<string, PendingOverlayState> {
  const states = new Map<string, PendingOverlayState>();

  for (const row of rows ?? []) {
    const orderKey = orderKeyByOrderId.get(String(row.orderId));
    if (!orderKey) continue;

    const state = states.get(orderKey) ?? { cancelled: false, effectiveItems: null };
    if (row.type === "cancel" || row.status === "cancelled") state.cancelled = true;

    // Only approved edits carry metadata.revision. A pending edit_request keeps its
    // proposal under metadata.request and must not move pending numbers yet.
    if (row.type === "edit") {
      const rawItems = jsonRecord(jsonRecord(row.metadata).revision).effectiveItems;
      if (Array.isArray(rawItems)) {
        const items = rawItems
          .map((rawItem) => overlayItemAlias(rawItem, orderKey))
          .filter((item): item is PendingProductsItemRow => item !== null);
        if (items.length > 0) state.effectiveItems = items;
      }
    }

    states.set(orderKey, state);
  }

  return states;
}

/**
 * On an edited order the overlay line ids are authoritative, so dispatch records are
 * matched by order-item id only. Leaving the SKU/occurrence fallback in place would let
 * a removed line's dispatches re-attach to a newly added line sharing its catalogue
 * number, and would keep the pre-edit ordered quantity, which wins over the item row
 * inside mergeOrderItemsWithDispatchRecords.
 */
export function alignDispatchRecordsToOverlayItems(
  records: OrderDispatchRecord[],
  items: PendingProductsItemRow[]
): OrderDispatchRecord[] {
  const orderedByLineId = new Map(
    items.map((item) => [safeText(item.orderdata_id, 200), safeQuantity(item.orderdata_item_quantity)])
  );

  return (records ?? [])
    .filter((record) => orderedByLineId.has(safeText(record.orderItemId, 200)))
    .map((record) => ({
      ...record,
      sku: "",
      normalizedSku: "",
      orderedQuantity: orderedByLineId.get(safeText(record.orderItemId, 200)) ?? record.orderedQuantity,
    }));
}
