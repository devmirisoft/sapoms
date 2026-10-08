import { listPostgresOrderPage } from "@/lib/postgresOrders";
import type { OrderFilters, OrdersActor } from "@/lib/orderPagination";

export const ORDER_HEADER_SOURCES = new Set(["current", "pending", "staff-status"]);

function normalizedStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_-]/g, "");
}

export function isPendingOrderHeader(order: Record<string, unknown>) {
  const orderStatus = normalizedStatus(order.order_status ?? order.status);
  return orderStatus === "0" || orderStatus === "pending" || orderStatus === "awaiting" || orderStatus === "awaitingacceptance";
}

type LoadOrderHeadersInput = {
  source: string;
  actor: OrdersActor;
  assignedDealerIds?: Array<string | number>;
  filters?: OrderFilters;
  page: number;
  pageSize: number;
};

// One page of order headers; filtering and paging happen in the database.
export async function loadOrderHeaders(input: LoadOrderHeadersInput) {
  const source = ORDER_HEADER_SOURCES.has(input.source) ? input.source : "current";
  const { rows, total } = await listPostgresOrderPage({ ...input, pendingOnly: source === "pending" });

  return {
    rows,
    total,
    truncated: false,
    totalIsExact: true,
    diagnostics: { upstreamCalls: 0, upstreamHeaders: 0, legacyUnavailable: false },
  };
}