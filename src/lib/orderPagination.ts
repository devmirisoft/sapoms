import { getOriginalOrderDate } from "@/lib/orderDate.js";
import { filterOrdersForActor, resolveOrderDealerId } from "@/lib/staffOrderScope.js";

export type OrdersActor = {
  role: "admin" | "accountant" | "staff" | "dealer";
  actorId: string;
  isRsm?: boolean;
  isAsm?: boolean;
  userId?: string;
};

export type UpstreamOrderPage<T> = {
  rows: T[];
  lastPage?: number;
  total?: number;
};

export type OrderFilters = {
  search?: string;
  accepted?: string;
  orderStatus?: string;
  mtStatus?: string;
  orderId?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: number | null;
  amountMax?: number | null;
  targetDealerId?: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizedMtStatus(value: unknown) {
  const key = text(value).toLowerCase().replace(/[\s_-]/g, "");
  if (key === "completed") return "Completed";
  // Legacy PHP rows carry "InProcess" for a part-dispatched order.
  if (key === "partial" || key === "inprocess") return "Partial";
  return "Pending";
}

function normalizedOrderStatus(value: unknown) {
  const key = text(value).toLowerCase().replace(/[\s_-]/g, "");
  if (key === "0" || key === "pending" || key === "awaiting") return "pending";
  if (key === "1" || key === "approved" || key === "accepted" || key === "completed") return "approved";
  return key;
}

function orderDedupeKey(order: Record<string, unknown>) {
  const orderId = text(order.order_id ?? order.orderId ?? order.orderdata_id ?? order.orderdata_orderid);
  if (!orderId) return "";
  return `${resolveOrderDealerId(order)}:${orderId}`;
}

export async function scanScopedOrders<T extends Record<string, unknown>>(input: {
  actor: OrdersActor;
  assignedDealerIds?: Array<string | number>;
  upstreamActorIds: string[];
  upstreamPageSize: number;
  maxUpstreamPages: number;
  fetchPage: (upstreamActorId: string, page: number, pageSize: number) => Promise<UpstreamOrderPage<T>>;
}) {
  const rows: T[] = [];
  const seenOrderKeys = new Set<string>();
  const pageCalls: Array<{ upstreamActorId: string; page: number }> = [];
  let truncated = false;

  for (const upstreamActorId of input.upstreamActorIds) {
    let exhausted = false;
    const upstreamKeys = new Set<string>();

    for (let page = 1; page <= input.maxUpstreamPages; page += 1) {
      pageCalls.push({ upstreamActorId, page });
      const upstream = await input.fetchPage(upstreamActorId, page, input.upstreamPageSize);
      const pageRows = Array.isArray(upstream.rows) ? upstream.rows : [];
      let newUpstreamRows = 0;
      for (const order of pageRows) {
        const key = orderDedupeKey(order);
        if (!key || upstreamKeys.has(key)) continue;
        upstreamKeys.add(key);
        newUpstreamRows += 1;
      }
      const scopedRows = filterOrdersForActor({
        role: input.actor.role,
        actorId: input.actor.actorId,
        assignedDealerIds: input.assignedDealerIds ?? [],
        orders: pageRows,
      }) as T[];

      for (const order of scopedRows) {
        const key = orderDedupeKey(order);
        if (key && seenOrderKeys.has(key)) continue;
        if (key) seenOrderKeys.add(key);
        rows.push(order);
      }

      const lastPage = Number(upstream.lastPage ?? 0);
      const upstreamTotal = Number(upstream.total ?? 0);
      if (
        pageRows.length === 0 ||
        pageRows.length < input.upstreamPageSize ||
        (Number.isFinite(upstreamTotal) && upstreamTotal > 0 && upstreamKeys.size >= upstreamTotal) ||
        (Number.isFinite(lastPage) && lastPage > 0 && page >= lastPage)
      ) {
        exhausted = true;
        break;
      }

      if (page > 1 && newUpstreamRows === 0) {
        truncated = true;
        exhausted = true;
        break;
      }
    }

    if (!exhausted) truncated = true;
  }

  return { rows, pageCalls, truncated, totalIsExact: !truncated };
}

export function applyOrderFilters<T extends Record<string, unknown>>(rows: T[], filters: OrderFilters = {}) {
  const query = text(filters.search).toLowerCase();
  const orderId = text(filters.orderId).toLowerCase();
  const targetDealerId = text(filters.targetDealerId);

  return rows.filter((row) => {
    if (targetDealerId && resolveOrderDealerId(row) !== targetDealerId) return false;
    if (query && !Object.values(row).some((value) => text(value).toLowerCase().includes(query))) return false;
    const rowOrderId = text(row.order_id ?? row.orderId).toLowerCase();
    if (orderId && !rowOrderId.startsWith(orderId)) return false;
    if (filters.accepted && text(row.accept_order) !== filters.accepted) return false;
    if (filters.orderStatus && normalizedOrderStatus(row.order_status ?? row.status) !== normalizedOrderStatus(filters.orderStatus)) return false;
    if (filters.mtStatus && normalizedMtStatus(row.mtstatus) !== filters.mtStatus) return false;
    const date = getOriginalOrderDate(row) ?? "";
    if (filters.dateFrom && date < filters.dateFrom) return false;
    if (filters.dateTo && date > filters.dateTo) return false;
    const amount = Number(row.grossAmount ?? row.order_amount ?? 0);
    if (filters.amountMin !== null && filters.amountMin !== undefined && amount < filters.amountMin) return false;
    if (filters.amountMax !== null && filters.amountMax !== undefined && amount > filters.amountMax) return false;
    return true;
  });
}

export function buildOrdersPage<T extends Record<string, unknown>>(input: {
  rows: T[];
  page: number;
  pageSize: number;
  filters?: OrderFilters;
}) {
  const filteredRows = applyOrderFilters(input.rows, input.filters);
  const total = filteredRows.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / input.pageSize);
  const start = (input.page - 1) * input.pageSize;
  return { items: filteredRows.slice(start, start + input.pageSize), total, totalPages };
}
