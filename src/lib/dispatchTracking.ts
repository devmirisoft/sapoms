import type { PendingProductLine } from "@/lib/pendingProducts";

// Order-first dispatch tracking for the Accountant. Pure: the route loads the
// orders, prices each line and hands the lines in; this rolls them up.

const ZERO = BigInt(0);

export type DispatchEntry = {
  at: string;
  quantity: number;
  shipmentId: string | null;
  shipment: string;
  trackingLink: string | null;
  remark: string;
};

export type DispatchShipmentMeta = {
  id: string;
  dispatchPartner: string | null;
  trackingNumber: string | null;
  trackingLink: string | null;
  createdAt: string;
};

/** A pending-products line plus what the route knows about its price and dispatches. */
export type TrackedLineInput = PendingProductLine & {
  // The line's value net of its own discount, for its ordered quantity.
  // null when neither the order nor the catalogue has a price.
  valuePaise: bigint | null;
  dispatches: DispatchEntry[];
};

export type DispatchOrderMeta = {
  finalPayablePaise: bigint;
  shipments: DispatchShipmentMeta[];
};

export type DispatchTrackingLine = {
  orderItemId: string | null;
  catalogueNumber: string;
  productName: string;
  specification: string;
  category: string;
  packSize: number;
  productUnit: string;
  orderedQuantity: number;
  dispatchedQuantity: number;
  leftQuantity: number;
  priced: boolean;
  dispatchedValue: number;
  leftValue: number;
  dispatches: DispatchEntry[];
};

export type DispatchTrackingShipment = DispatchShipmentMeta & {
  items: Array<{ catalogueNumber: string; productName: string; quantity: number }>;
};

export type DispatchTrackingOrder = {
  orderId: string;
  orderNumber: string;
  orderDate: string;
  orderDateMs: number | null;
  dealerId: string;
  dealerName: string;
  dealerCode: string;
  orderedQuantity: number;
  dispatchedQuantity: number;
  leftQuantity: number;
  fulfillmentPercent: number;
  dispatchedValue: number;
  leftValue: number;
  status: "partial" | "complete";
  lastDispatchAt: string;
  lastDispatchMs: number | null;
  lines: DispatchTrackingLine[];
  shipments: DispatchTrackingShipment[];
};

export type DispatchTrackingStatus = "in_progress" | "complete" | "all";
export type DispatchTrackingSort = "latest_dispatch" | "most_left" | "newest_order" | "oldest_order";

export function parseDispatchTrackingStatus(value: unknown): DispatchTrackingStatus {
  return value === "complete" || value === "all" ? value : "in_progress";
}

export function parseDispatchTrackingSort(value: unknown): DispatchTrackingSort {
  return value === "most_left" || value === "newest_order" || value === "oldest_order" ? value : "latest_dispatch";
}

/**
 * Spreads an order's net payable over its lines in proportion to their value, so
 * order-level discounts (base, coupon, slab, custom) land on every line and the
 * lines add up to the net exactly. The rounding remainder goes on the last priced
 * line. Without a stored net (legacy orders) the line values stand as they are.
 */
export function allocateOrderValue(lineValuesPaise: bigint[], orderNetPaise: bigint): bigint[] {
  const total = lineValuesPaise.reduce((sum, value) => sum + value, ZERO);
  if (total <= ZERO || orderNetPaise <= ZERO) return [...lineValuesPaise];

  const shares = lineValuesPaise.map((value) => (value * orderNetPaise) / total);
  let last = shares.length - 1;
  while (last > 0 && lineValuesPaise[last] <= ZERO) last -= 1;
  shares[last] += orderNetPaise - shares.reduce((sum, value) => sum + value, ZERO);
  return shares;
}

/** The dispatched share of a line's net, rounded half up; the rest is what is left. */
export function splitLineValue(lineNetPaise: bigint, orderedQuantity: number, dispatchedQuantity: number) {
  if (orderedQuantity <= 0) return { dispatchedPaise: ZERO, leftPaise: lineNetPaise };
  const ordered = BigInt(orderedQuantity);
  const dispatched = BigInt(Math.min(Math.max(0, dispatchedQuantity), orderedQuantity));
  const two = BigInt(2);
  const dispatchedPaise = (lineNetPaise * dispatched * two + ordered) / (two * ordered);
  return { dispatchedPaise, leftPaise: lineNetPaise - dispatchedPaise };
}

const rupees = (paise: bigint) => Number(paise) / 100;

function latestMs(entries: DispatchEntry[]) {
  return entries.reduce<number | null>((latest, entry) => {
    const ms = Date.parse(entry.at);
    if (!Number.isFinite(ms)) return latest;
    return latest === null || ms > latest ? ms : latest;
  }, null);
}

function buildShipments(lines: TrackedLineInput[], shipments: DispatchShipmentMeta[]): DispatchTrackingShipment[] {
  const known = new Set(shipments.map((shipment) => shipment.id));
  const groups = new Map<string, Map<string, { catalogueNumber: string; productName: string; quantity: number }>>();
  const unlinkedAt: number[] = [];

  for (const line of lines) {
    const lineKey = line.orderItemId || line.productKey;
    for (const entry of line.dispatches) {
      const groupId = entry.shipmentId && known.has(entry.shipmentId) ? entry.shipmentId : "";
      if (!groupId) unlinkedAt.push(Date.parse(entry.at));
      const items = groups.get(groupId) ?? new Map();
      const item = items.get(lineKey) ?? { catalogueNumber: line.catalogueNumber, productName: line.productName, quantity: 0 };
      item.quantity += entry.quantity;
      items.set(lineKey, item);
      groups.set(groupId, items);
    }
  }

  const result: DispatchTrackingShipment[] = shipments
    .filter((shipment) => groups.has(shipment.id))
    .map((shipment) => ({ ...shipment, items: Array.from(groups.get(shipment.id)!.values()) }));

  const unlinked = groups.get("");
  if (unlinked) {
    const firstMs = Math.min(...unlinkedAt.filter(Number.isFinite));
    result.push({
      id: "",
      dispatchPartner: null,
      trackingNumber: null,
      trackingLink: null,
      createdAt: Number.isFinite(firstMs) ? new Date(firstMs).toISOString() : "",
      items: Array.from(unlinked.values()),
    });
  }
  return result;
}

export function buildDispatchTrackingOrders(
  lines: TrackedLineInput[],
  metaByOrderId: Map<string, DispatchOrderMeta>
): DispatchTrackingOrder[] {
  const linesByOrder = new Map<string, TrackedLineInput[]>();
  for (const line of lines) {
    const group = linesByOrder.get(line.orderId) ?? [];
    group.push(line);
    linesByOrder.set(line.orderId, group);
  }

  const orders: DispatchTrackingOrder[] = [];
  for (const [orderId, orderLines] of linesByOrder) {
    const meta = metaByOrderId.get(orderId) ?? { finalPayablePaise: ZERO, shipments: [] };
    const lineNets = allocateOrderValue(
      orderLines.map((line) => line.valuePaise ?? ZERO),
      meta.finalPayablePaise
    );

    let dispatchedPaise = ZERO;
    let leftPaise = ZERO;
    const trackedLines = orderLines.map((line, index): DispatchTrackingLine => {
      const split = splitLineValue(lineNets[index], line.orderedQuantity, line.dispatchedQuantity);
      dispatchedPaise += split.dispatchedPaise;
      leftPaise += split.leftPaise;
      return {
        orderItemId: line.orderItemId,
        catalogueNumber: line.catalogueNumber,
        productName: line.productName,
        specification: line.specification,
        category: line.category,
        packSize: line.packSize,
        productUnit: line.productUnit,
        orderedQuantity: line.orderedQuantity,
        dispatchedQuantity: line.dispatchedQuantity,
        leftQuantity: line.pendingQuantity,
        priced: line.valuePaise !== null,
        dispatchedValue: rupees(split.dispatchedPaise),
        leftValue: rupees(split.leftPaise),
        dispatches: line.dispatches,
      };
    });

    const orderedQuantity = trackedLines.reduce((sum, line) => sum + line.orderedQuantity, 0);
    const dispatchedQuantity = trackedLines.reduce((sum, line) => sum + line.dispatchedQuantity, 0);
    const leftQuantity = trackedLines.reduce((sum, line) => sum + line.leftQuantity, 0);
    const lastDispatchMs = latestMs(orderLines.flatMap((line) => line.dispatches));
    const first = orderLines[0];

    orders.push({
      orderId,
      orderNumber: first.orderNumber,
      orderDate: first.orderDate,
      orderDateMs: first.orderDateMs,
      dealerId: first.dealerId,
      dealerName: first.dealerName,
      dealerCode: first.dealerCode,
      orderedQuantity,
      dispatchedQuantity,
      leftQuantity,
      fulfillmentPercent: orderedQuantity > 0 ? Math.min(100, (dispatchedQuantity / orderedQuantity) * 100) : 0,
      dispatchedValue: rupees(dispatchedPaise),
      leftValue: rupees(leftPaise),
      status: leftQuantity === 0 ? "complete" : "partial",
      lastDispatchAt: lastDispatchMs === null ? "" : new Date(lastDispatchMs).toISOString(),
      lastDispatchMs,
      lines: trackedLines,
      shipments: buildShipments(orderLines, meta.shipments),
    });
  }
  return orders;
}

export function filterDispatchTrackingOrders(
  orders: DispatchTrackingOrder[],
  filters: { search?: string; category?: string; status?: DispatchTrackingStatus }
): DispatchTrackingOrder[] {
  const query = String(filters.search ?? "").trim().toLowerCase();
  const category = String(filters.category ?? "").trim();
  const status = filters.status ?? "in_progress";

  return orders.filter((order) => {
    if (status === "in_progress" && order.status !== "partial") return false;
    if (status === "complete" && order.status !== "complete") return false;
    if (category && !order.lines.some((line) => line.category === category)) return false;
    if (!query) return true;
    return [order.orderNumber, order.dealerName, order.dealerCode, ...order.lines.flatMap((line) => [line.productName, line.catalogueNumber])]
      .some((value) => value.toLowerCase().includes(query));
  });
}

export function sortDispatchTrackingOrders(orders: DispatchTrackingOrder[], sort: DispatchTrackingSort): DispatchTrackingOrder[] {
  const byMs = (ms: number | null) => ms ?? 0;
  const sorted = [...orders];
  if (sort === "most_left") sorted.sort((a, b) => b.leftQuantity - a.leftQuantity);
  else if (sort === "newest_order") sorted.sort((a, b) => byMs(b.orderDateMs) - byMs(a.orderDateMs));
  else if (sort === "oldest_order") sorted.sort((a, b) => byMs(a.orderDateMs) - byMs(b.orderDateMs));
  else sorted.sort((a, b) => byMs(b.lastDispatchMs) - byMs(a.lastDispatchMs));
  return sorted;
}

export function summarizeDispatchTrackingOrders(orders: DispatchTrackingOrder[]) {
  return orders.reduce(
    (summary, order) => ({
      orders: summary.orders + 1,
      fullyDispatched: summary.fullyDispatched + (order.status === "complete" ? 1 : 0),
      unitsDispatched: summary.unitsDispatched + order.dispatchedQuantity,
      unitsLeft: summary.unitsLeft + order.leftQuantity,
      // Rounded to paise: summing many rupee floats drifts by fractions otherwise.
      valueDispatched: Math.round((summary.valueDispatched + order.dispatchedValue) * 100) / 100,
      valueLeft: Math.round((summary.valueLeft + order.leftValue) * 100) / 100,
    }),
    { orders: 0, fullyDispatched: 0, unitsDispatched: 0, unitsLeft: 0, valueDispatched: 0, valueLeft: 0 }
  );
}
