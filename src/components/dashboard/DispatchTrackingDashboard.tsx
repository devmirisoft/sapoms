"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { formatDisplayOrderNumber } from "@/lib/orderDisplay";
import type {
  DispatchTrackingOrder,
  DispatchTrackingSort,
  DispatchTrackingStatus,
} from "@/lib/dispatchTracking";
import { ProductMetric, clampPercent, formatDate, formatNumber } from "./PendingProductsDashboard";
import {
  PERIOD_OPTIONS,
  isoDay,
  withColumnWidths,
  withHeaderFilter,
  type ReportPeriod,
} from "./PendingProductsReportModal";

type Summary = {
  orders: number;
  fullyDispatched: number;
  unitsDispatched: number;
  unitsLeft: number;
  valueDispatched: number;
  valueLeft: number;
};

type ListPayload = {
  items: DispatchTrackingOrder[];
  summary: Summary;
  filters: { categories: string[]; dealers: Array<{ id: string; name: string }> };
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  warnings: string[];
};

type ReportPayload = { orders: DispatchTrackingOrder[]; warnings: string[] };

type Filters = {
  search: string;
  category: string;
  dealerId: string;
  status: DispatchTrackingStatus;
  sort: DispatchTrackingSort;
  period: ReportPeriod;
};

const selectCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100";
const labelCls = "mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400";

function formatMoney(value: number) {
  return value.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
}

function orderLabel(order: DispatchTrackingOrder) {
  return order.orderNumber || formatDisplayOrderNumber(order.orderId, order.orderDate);
}

async function fetchTracking<T>(filters: Filters, extra: Record<string, string>): Promise<T> {
  const params = new URLSearchParams({ status: filters.status, sort: filters.sort, period: filters.period, ...extra });
  if (filters.search) params.set("search", filters.search);
  if (filters.category) params.set("category", filters.category);
  if (filters.dealerId) params.set("dealerId", filters.dealerId);
  const response = await fetch(`/api/dispatch-tracking?${params.toString()}`, { cache: "no-store" });
  const json = await response.json();
  if (!response.ok || !json?.success) throw new Error(json?.message || "Failed to load dispatch tracking.");
  return json.data as T;
}

function downloadWorkbook(orders: DispatchTrackingOrder[], period: ReportPeriod) {
  const orderRows = orders.map((order) => ({
    "SO No.": orderLabel(order),
    "SO Date": isoDay(order.orderDate),
    "Customer Code": order.dealerCode,
    "Customer Name": order.dealerName,
    "Ordered Qty": order.orderedQuantity,
    "Dispatched Qty": order.dispatchedQuantity,
    "Left Qty": order.leftQuantity,
    "Dispatched %": Number(order.fulfillmentPercent.toFixed(1)),
    "Dispatched Value": order.dispatchedValue,
    "Left Value": order.leftValue,
    "Last Dispatch": isoDay(order.lastDispatchAt),
    "Status": order.status === "complete" ? "Fully dispatched" : "Partially dispatched",
  }));
  const lineRows = orders.flatMap((order) =>
    order.lines.map((line) => ({
      "SO No.": orderLabel(order),
      "Customer Name": order.dealerName,
      "Catalog No.": line.catalogueNumber,
      "Item Name": line.productName,
      "Description": line.specification,
      "Category": line.category,
      "Ordered Qty": line.orderedQuantity,
      "Dispatched Qty": line.dispatchedQuantity,
      "Left Qty": line.leftQuantity,
      "Dispatched Value": line.priced ? line.dispatchedValue : "",
      "Left Value": line.priced ? line.leftValue : "",
    }))
  );
  const dispatchRows = orders.flatMap((order) =>
    order.lines.flatMap((line) =>
      line.dispatches.map((entry) => ({
        "Dispatch Date": isoDay(entry.at),
        "SO No.": orderLabel(order),
        "Customer Name": order.dealerName,
        "Catalog No.": line.catalogueNumber,
        "Item Name": line.productName,
        "Qty": entry.quantity,
        "Courier · AWB": entry.shipment,
        "Tracking Link": entry.trackingLink ?? "",
        "Remark": entry.remark,
      }))
    )
  ).sort((a, b) => b["Dispatch Date"].localeCompare(a["Dispatch Date"]));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, withHeaderFilter(withColumnWidths(XLSX.utils.json_to_sheet(orderRows), [20, 12, 16, 30, 12, 14, 10, 13, 16, 14, 13, 20])), "Orders");
  XLSX.utils.book_append_sheet(workbook, withHeaderFilter(withColumnWidths(XLSX.utils.json_to_sheet(lineRows), [20, 30, 16, 40, 40, 18, 12, 14, 10, 16, 14])), "Lines");
  XLSX.utils.book_append_sheet(workbook, withHeaderFilter(withColumnWidths(XLSX.utils.json_to_sheet(dispatchRows), [13, 20, 30, 16, 40, 8, 30, 40, 40])), "Dispatches");
  XLSX.writeFile(workbook, `dispatch-tracking_${period}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function StatusPill({ status }: { status: DispatchTrackingOrder["status"] }) {
  return status === "complete" ? (
    <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">Fully dispatched</span>
  ) : (
    <span className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700">Partially dispatched</span>
  );
}

function OrderDetail({ order }: { order: DispatchTrackingOrder }) {
  // null = all closed; "" is the "No shipment linked" group's id.
  const [openShipment, setOpenShipment] = useState<string | null>(null);

  return (
    <div className="mt-3 rounded-2xl bg-slate-50 p-3">
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Shipments</p>
        <div className="space-y-2">
          {order.shipments.map((shipment) => {
            const open = openShipment === shipment.id;
            const units = shipment.items.reduce((sum, item) => sum + item.quantity, 0);
            return (
              <div key={shipment.id || "unlinked"} className="rounded-xl border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setOpenShipment(open ? null : shipment.id)}
                  aria-expanded={open}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={`flex-shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span className="flex-1 text-[13px] font-semibold text-slate-900">
                    {shipment.id
                      ? [shipment.dispatchPartner, shipment.trackingNumber].filter(Boolean).join(" · ") || "Shipment"
                      : "No shipment linked"}
                  </span>
                  <span className="text-[12px] text-slate-500">
                    {shipment.items.length} product{shipment.items.length === 1 ? "" : "s"} · {formatNumber(units)} units
                  </span>
                  <span className="text-[11px] text-slate-500">{formatDate(shipment.createdAt)}</span>
                </button>
                {open && (
                  <div className="border-t border-slate-100 px-4 py-3">
                    {shipment.trackingLink && (
                      <a href={shipment.trackingLink} target="_blank" rel="noopener noreferrer" className="text-[12px] text-brand-600 hover:underline">
                        Track shipment
                      </a>
                    )}
                    <ul className="mt-1.5 space-y-0.5 text-[12px] text-slate-600">
                      {shipment.items.map((item, index) => (
                        <li key={index}>
                          {item.catalogueNumber ? `${item.catalogueNumber} — ` : ""}{item.productName} × {formatNumber(item.quantity)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function DispatchTrackingDashboard() {
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState<Filters>({
    search: "",
    category: "",
    dealerId: "",
    status: "in_progress",
    sort: "latest_dispatch",
    period: "all",
  });
  const [page, setPage] = useState(1);
  const [expandedOrderId, setExpandedOrderId] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [reportError, setReportError] = useState("");

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setFilters((current) => ({ ...current, search: searchInput.trim() }));
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const listQuery = useQuery<ListPayload>({
    queryKey: ["dispatch-tracking", filters, page],
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: () => fetchTracking<ListPayload>(filters, { page: String(page), pageSize: "12" }),
  });

  const payload = listQuery.data;
  const summary = payload?.summary;

  const downloadReport = async () => {
    setDownloading(true);
    setReportError("");
    try {
      const report = await fetchTracking<ReportPayload>(filters, { report: "1" });
      if (report.orders.length === 0) setReportError("Nothing to export for these filters.");
      else downloadWorkbook(report.orders, filters.period);
    } catch (error) {
      setReportError((error as Error)?.message || "Failed to build the report.");
    } finally {
      setDownloading(false);
    }
  };

  const cards = summary
    ? [
        { label: "Orders In Dispatch", value: formatNumber(summary.orders), accent: "text-slate-900" },
        { label: "Fully Dispatched", value: formatNumber(summary.fullyDispatched), accent: "text-emerald-700" },
        { label: "Units Dispatched", value: formatNumber(summary.unitsDispatched), accent: "text-emerald-700" },
        { label: "Units Left", value: formatNumber(summary.unitsLeft), accent: "text-rose-600" },
        { label: "Value Dispatched", value: formatMoney(summary.valueDispatched), accent: "text-emerald-700" },
        { label: "Value Left", value: formatMoney(summary.valueLeft), accent: "text-rose-600" },
      ]
    : [];

  return (
    <div className="mx-auto max-w-[1840px] px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-slate-900">Dispatch Tracking</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            How much of each order has been dispatched and how much is left. Values split each order&apos;s net payable across its lines.
          </p>
        </div>
        <div className="text-right">
          <button
            type="button"
            onClick={downloadReport}
            disabled={downloading}
            className="rounded-xl bg-brand-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloading ? "Preparing…" : "Download Report"}
          </button>
          {reportError && <p className="mt-1.5 text-[12px] font-medium text-rose-600">{reportError}</p>}
        </div>
      </div>

      {payload?.warnings?.[0] && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-[13px] text-amber-800 shadow-sm">
          {payload.warnings[0]}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => (
          <ProductMetric key={card.label} label={card.label} value={card.value} accent={card.accent} />
        ))}
      </div>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_repeat(5,minmax(0,1fr))]">
          <div>
            <label htmlFor="dt-search" className={labelCls}>Search</label>
            <input
              id="dt-search"
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Order no., dealer, product, catalogue no..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] text-slate-900 outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div>
            <label htmlFor="dt-status" className={labelCls}>Status</label>
            <select id="dt-status" value={filters.status} onChange={(event) => setFilter("status", event.target.value as DispatchTrackingStatus)} className={selectCls}>
              <option value="in_progress">In progress</option>
              <option value="complete">Fully dispatched</option>
              <option value="all">All</option>
            </select>
          </div>
          <div>
            <label htmlFor="dt-period" className={labelCls}>Period <span className="font-medium normal-case tracking-normal">(by dispatch date)</span></label>
            <select id="dt-period" value={filters.period} onChange={(event) => setFilter("period", event.target.value as ReportPeriod)} className={selectCls}>
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dt-category" className={labelCls}>Category</label>
            <select id="dt-category" value={filters.category} onChange={(event) => setFilter("category", event.target.value)} className={selectCls}>
              <option value="">All categories</option>
              {(payload?.filters.categories ?? []).map((entry) => (
                <option key={entry} value={entry}>{entry}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dt-dealer" className={labelCls}>Dealer</label>
            <select id="dt-dealer" value={filters.dealerId} onChange={(event) => setFilter("dealerId", event.target.value)} className={selectCls}>
              <option value="">All dealers</option>
              {(payload?.filters.dealers ?? []).map((dealer) => (
                <option key={dealer.id} value={dealer.id}>{dealer.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="dt-sort" className={labelCls}>Sort</label>
            <select id="dt-sort" value={filters.sort} onChange={(event) => setFilter("sort", event.target.value as DispatchTrackingSort)} className={selectCls}>
              <option value="latest_dispatch">Latest dispatch</option>
              <option value="most_left">Most left</option>
              <option value="newest_order">Newest order</option>
              <option value="oldest_order">Oldest order</option>
            </select>
          </div>
        </div>
      </div>

      {listQuery.isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-[13px] text-rose-700 shadow-sm">
          {(listQuery.error as Error)?.message || "Failed to load dispatch tracking."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-[15px] font-bold text-slate-900">Orders</h2>
            <p className="mt-1 text-[12px] text-slate-500">
              {payload ? `${formatNumber(payload.total)} matching orders` : "Loading dispatch tracking..."}
            </p>
          </div>

          {!payload ? (
            <div className="space-y-3 px-5 py-5">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
          ) : payload.items.length === 0 ? (
            <p className="px-5 py-16 text-center text-[15px] font-semibold text-slate-900">No dispatched orders match these filters.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {payload.items.map((order) => {
                const expanded = expandedOrderId === order.orderId;
                return (
                  <div key={order.orderId} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                      <button
                        type="button"
                        onClick={() => setExpandedOrderId(expanded ? "" : order.orderId)}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Collapse" : "Expand"} order ${orderLabel(order)}`}
                        className="flex-shrink-0 text-slate-400"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${expanded ? "rotate-90" : ""}`}>
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                      <div className="min-w-[200px] flex-1">
                        <Link href={`/orders/${encodeURIComponent(order.orderId)}`} className="font-mono text-[13.5px] font-semibold text-brand-600 hover:underline">
                          {orderLabel(order)}
                        </Link>
                        <p className="mt-0.5 truncate text-[12px] text-slate-500">
                          {formatDate(order.orderDate)} · {order.dealerName}
                        </p>
                      </div>
                      <div className="w-44">
                        <p className="text-[12px] text-slate-600">
                          <span className="font-mono font-semibold tabular-nums text-emerald-700">{formatNumber(order.dispatchedQuantity)}</span>
                          {" / "}
                          {formatNumber(order.orderedQuantity)} dispatched
                        </p>
                        <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                          <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${clampPercent(order.fulfillmentPercent)}%` }} />
                        </div>
                        <p className="mt-1 text-[11px] text-rose-600">{formatNumber(order.leftQuantity)} left</p>
                      </div>
                      <div className="w-36 text-right">
                        <p className="font-mono text-[13px] font-semibold tabular-nums text-emerald-700">{formatMoney(order.dispatchedValue)}</p>
                        <p className="font-mono text-[12px] tabular-nums text-rose-600">{formatMoney(order.leftValue)} left</p>
                      </div>
                      <div className="w-28 text-right">
                        <p className="text-[12px] font-medium text-slate-700">{formatDate(order.lastDispatchAt)}</p>
                        <p className="text-[11px] text-slate-500">last dispatch</p>
                      </div>
                      <StatusPill status={order.status} />
                    </div>
                    {expanded && <OrderDetail order={order} />}
                  </div>
                );
              })}
            </div>
          )}

          {payload && payload.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-[12px] text-slate-500">
              <span>Page {payload.page} of {payload.totalPages}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={payload.page <= 1}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(payload.totalPages, current + 1))}
                  disabled={payload.page >= payload.totalPages}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
