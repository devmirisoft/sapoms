"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { formatDisplayOrderNumber } from "@/lib/orderDisplay";

export type ReportPeriod = "all" | "day" | "month" | "quarter" | "half_year" | "year";

/**
 * Rolling windows counted back from now, not calendar periods — "Month" means
 * the last 30 days, not the current calendar month. Labels spell this out so the
 * distinction is visible at the point of choosing.
 */
const PERIOD_OPTIONS: Array<{ value: ReportPeriod; label: string }> = [
  { value: "all", label: "All time" },
  { value: "day", label: "Day — last 24 hours" },
  { value: "month", label: "Month — last 30 days" },
  { value: "quarter", label: "Quarter — last 90 days" },
  { value: "half_year", label: "Half year — last 180 days" },
  { value: "year", label: "Year — last 365 days" },
];

type ReportProduct = {
  productKey: string;
  catalogueNumber: string;
  productName: string;
  specification: string;
  category: string;
  orderedQuantity: number;
  dispatchedQuantity: number;
  pendingQuantity: number;
  fulfillmentPercent: number;
  pendingOrders: number;
  dealersAffected: number;
  oldestPendingDate: string;
};

type ReportLine = {
  productKey: string;
  catalogueNumber: string;
  productName: string;
  specification: string;
  category: string;
  orderId: string;
  orderDate: string;
  dealerId: string;
  dealerName: string;
  assignedStaffNames: string[];
  orderedQuantity: number;
  dispatchedQuantity: number;
  pendingQuantity: number;
  productUnit: string;
  packSize: number;
  dispatchStatus: string;
  mtstatus: string;
};

type ReportPayload = {
  products: ReportProduct[];
  lines: ReportLine[];
  summary: {
    productsPending: number;
    totalPendingUnits: number;
    ordersWithPendingItems: number;
    dealersAffected: number;
  };
  period: ReportPeriod;
  generatedAt: string;
  warnings: string[];
};

export type ReportScopeParams = {
  search: string;
  category: string;
  dealerId: string;
  assignedStaffId: string;
  sort: string;
};

function isoDay(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function safeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "report";
}

/** Widths are in characters; xlsx has no auto-fit, so long text needs help. */
function withColumnWidths(sheet: XLSX.WorkSheet, widths: number[]) {
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  return sheet;
}

function productSheetRows(products: ReportProduct[]) {
  return products.map((product, index) => ({
    "S.No.": index + 1,
    "Catalogue No.": product.catalogueNumber,
    "Product": product.productName,
    "Specification": product.specification,
    "Category": product.category,
    "Ordered Qty": product.orderedQuantity,
    "Dispatched Qty": product.dispatchedQuantity,
    "Pending Qty": product.pendingQuantity,
    "Fulfilled %": Number(product.fulfillmentPercent.toFixed(1)),
    "Pending Orders": product.pendingOrders,
    "Dealers Affected": product.dealersAffected,
    "Oldest Pending": isoDay(product.oldestPendingDate),
  }));
}

function lineSheetRows(lines: ReportLine[]) {
  return lines.map((line, index) => ({
    "S.No.": index + 1,
    "Catalogue No.": line.catalogueNumber,
    "Product": line.productName,
    "Category": line.category,
    "Order No.": formatDisplayOrderNumber(line.orderId),
    "Order Date": isoDay(line.orderDate),
    "Dealer": line.dealerName,
    "Dealer ID": line.dealerId,
    "Assigned Staff": (line.assignedStaffNames ?? []).join(", "),
    "Ordered Qty": line.orderedQuantity,
    "Dispatched Qty": line.dispatchedQuantity,
    "Pending Qty": line.pendingQuantity,
    "Unit": line.productUnit,
    "Pack Size": line.packSize,
    "Dispatch Status": line.dispatchStatus,
    "Order Status": line.mtstatus,
  }));
}

const PRODUCT_WIDTHS = [6, 16, 34, 26, 18, 12, 14, 12, 11, 14, 16, 14];
const LINE_WIDTHS = [6, 16, 34, 18, 14, 12, 26, 10, 22, 12, 14, 12, 10, 10, 16, 14];

export function PendingProductsReportModal({
  open,
  onClose,
  scope,
  enabled,
}: {
  open: boolean;
  onClose: () => void;
  scope: ReportScopeParams;
  enabled: boolean;
}) {
  const [period, setPeriod] = useState<ReportPeriod>("all");
  const [mode, setMode] = useState<"all" | "product">("all");
  const [productKey, setProductKey] = useState("");
  const [error, setError] = useState("");

  const reportQuery = useQuery<ReportPayload>({
    queryKey: ["pending-products-report", period, scope.search, scope.category, scope.dealerId, scope.assignedStaffId, scope.sort],
    enabled: open && enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const params = new URLSearchParams({ report: "1", period, sort: scope.sort });
      if (scope.search) params.set("search", scope.search);
      if (scope.category) params.set("category", scope.category);
      if (scope.dealerId) params.set("dealerId", scope.dealerId);
      if (scope.assignedStaffId) params.set("assignedStaffId", scope.assignedStaffId);

      const response = await fetch(`/api/pending-products?${params.toString()}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json?.success) throw new Error(json?.message || "Failed to build the report.");
      return json.data as ReportPayload;
    },
  });

  const payload = reportQuery.data;
  const selectedProduct = useMemo(
    () => payload?.products.find((product) => product.productKey === productKey) ?? null,
    [payload, productKey]
  );

  const rowCount = mode === "all"
    ? payload?.products.length ?? 0
    : payload?.lines.filter((line) => line.productKey === productKey).length ?? 0;

  const download = () => {
    if (!payload) return;
    setError("");

    const periodLabel = PERIOD_OPTIONS.find((option) => option.value === period)?.value ?? "all";
    const today = new Date().toISOString().slice(0, 10);
    const workbook = XLSX.utils.book_new();

    if (mode === "all") {
      if (payload.products.length === 0) {
        setError("Nothing to export for this period.");
        return;
      }
      XLSX.utils.book_append_sheet(
        workbook,
        withColumnWidths(XLSX.utils.json_to_sheet(productSheetRows(payload.products)), PRODUCT_WIDTHS),
        "Pending Products"
      );
      XLSX.utils.book_append_sheet(
        workbook,
        withColumnWidths(XLSX.utils.json_to_sheet(lineSheetRows(payload.lines)), LINE_WIDTHS),
        "Order Breakdown"
      );
      XLSX.writeFile(workbook, `pending-products_${periodLabel}_${today}.xlsx`);
      onClose();
      return;
    }

    if (!selectedProduct) {
      setError("Pick a product first.");
      return;
    }
    const productLines = payload.lines.filter((line) => line.productKey === productKey);
    if (productLines.length === 0) {
      setError("This product has no pending orders in the selected period.");
      return;
    }
    XLSX.utils.book_append_sheet(
      workbook,
      withColumnWidths(XLSX.utils.json_to_sheet(lineSheetRows(productLines)), LINE_WIDTHS),
      "Orders"
    );
    XLSX.writeFile(
      workbook,
      `pending-product_${safeFilePart(selectedProduct.catalogueNumber || selectedProduct.productName)}_${periodLabel}_${today}.xlsx`
    );
    onClose();
  };

  if (!open) return null;

  const scopeNotes = [
    scope.search && `search "${scope.search}"`,
    scope.category && `category ${scope.category}`,
    scope.dealerId && "the selected dealer",
    scope.assignedStaffId && "the selected staff",
  ].filter(Boolean) as string[];

  const selectCls =
    "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-900 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: "blur(8px)", background: "rgba(15,23,42,0.45)" }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="report-modal-title">
        <div className="border-b border-slate-100 px-6 pb-4 pt-6">
          <h3 id="report-modal-title" className="text-[15px] font-bold text-slate-900">Download Excel report</h3>
          <p className="mt-1 text-[13px] text-slate-500">
            {scopeNotes.length > 0
              ? `Follows the filters on this page: ${scopeNotes.join(", ")}.`
              : "Covers every pending product in your scope."}
          </p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Report</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("all")}
                className={`rounded-xl border px-3 py-2.5 text-left text-[13px] font-semibold transition ${
                  mode === "all" ? "border-indigo-300 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                All pending products
                <span className="mt-0.5 block text-[11px] font-medium text-slate-500">Summary + order breakdown</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("product")}
                className={`rounded-xl border px-3 py-2.5 text-left text-[13px] font-semibold transition ${
                  mode === "product" ? "border-indigo-300 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Single product
                <span className="mt-0.5 block text-[11px] font-medium text-slate-500">Its orders and quantities</span>
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="report-period" className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
              Period <span className="font-medium normal-case tracking-normal text-slate-400">(by order date)</span>
            </label>
            <select id="report-period" value={period} onChange={(event) => setPeriod(event.target.value as ReportPeriod)} className={selectCls}>
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          {mode === "product" && (
            <div>
              <label htmlFor="report-product" className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                Product
              </label>
              <select
                id="report-product"
                value={productKey}
                onChange={(event) => { setProductKey(event.target.value); setError(""); }}
                disabled={reportQuery.isLoading || !payload}
                className={`${selectCls} disabled:opacity-50`}
              >
                <option value="">
                  {reportQuery.isLoading ? "Loading products…" : `Select one of ${payload?.products.length ?? 0} products`}
                </option>
                {(payload?.products ?? []).map((product) => (
                  <option key={product.productKey} value={product.productKey}>
                    {product.catalogueNumber ? `${product.catalogueNumber} — ` : ""}{product.productName} ({product.pendingQuantity} pending)
                  </option>
                ))}
              </select>
            </div>
          )}

          {reportQuery.isError && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
              {(reportQuery.error as Error)?.message || "Failed to build the report."}
            </p>
          )}
          {payload?.warnings?.[0] && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">{payload.warnings[0]}</p>
          )}
          {error && <p className="text-[12px] font-medium text-rose-600">{error}</p>}

          {payload && !reportQuery.isFetching && (
            <p className="text-[12px] text-slate-500">
              {mode === "all"
                ? `${payload.products.length.toLocaleString()} products · ${payload.lines.length.toLocaleString()} order lines · ${payload.summary.totalPendingUnits.toLocaleString()} units pending`
                : selectedProduct
                  ? `${rowCount.toLocaleString()} order${rowCount === 1 ? "" : "s"} · ${selectedProduct.pendingQuantity.toLocaleString()} units pending`
                  : "Pick a product to see its order count."}
            </p>
          )}
        </div>

        <div className="flex gap-2 px-6 pb-6">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 py-2.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={download}
            disabled={reportQuery.isFetching || !payload || (mode === "product" && !productKey)}
            className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {reportQuery.isFetching ? "Preparing…" : "Download .xlsx"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PendingProductsReportModal;
