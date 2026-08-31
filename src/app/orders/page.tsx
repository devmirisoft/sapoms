/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import moment from "moment";
import { exportOrdersToCloud, downloadPDFDirectly } from "@/lib/Exporttopdf";
import { InvoiceModal } from "@/components/InvoiceModel";
import { downloadOrderInvoice, uploadOrderInvoice, generateOrderInvoicePDF, listInvoices } from "@/lib/invoicegenerator";
import { formatAdditionalDiscountBadge, getCompactOrderDiscountRows, withDisplayOrderAmounts } from "@/lib/orderAmounts";
import { formatDisplayOrderNumber } from '@/lib/orderDisplay';
import { STAFF_ORDER_SCOPE_VERSION } from "@/lib/staffOrderScope.js";
import {
  buildCustomDiscountProgressMap,
  getCustomDiscountProgressKeyForOrder,
  type CustomDiscountProgress,
} from "@/lib/customDiscountProgress";
import { SegmentedTabs, type SegItem } from "@/components/SegmentedTabs";
import { WAREHOUSE_OPTIONS } from "@/lib/warehouses";
import { useAuthSession } from "@/hooks/useAuthSession";
import type { AppRole } from "@/lib/roleAccess";

// ─── Types ────────────────────────────────────────────────────────────────────
type Order = {
  order_id: string;
  order_date: string;
  orderDate?: string;
  order_amount: string;
  order_discount: string;
  Dealer_Name: string;
  orderdata_item_quantity: string;
  orderdata_status: string | number;
  mtstatus: string;
  outstandingDate: string;
  order_note?: string;
  note?: string;
  remark?: string;
  remarks?: string;
  reason?: string;
  order_dealer?: string | number;
  accept_order?: string;
  del_status?: string;
  readyquantity?: string;
  staffid?: string;
  rsmApprovalStatus?: string;
  rsm_approval_status?: string;
  rsmReviewedBy?: string;
  rsm_reviewed_by?: string;
};
type ApiResponse = { msg: string; count: number; status: boolean; data: Order[]; total?: number; last_page?: number };
type OrderNoteOverlay = {
  note?: string;
};
type OrderSummaryOverride = {
  orderId?: string | number;
  order_id?: string | number;
  grossAmount?: number | string;
  discountAmount?: number | string;
  netPayableAmount?: number | string;
  discountPercent?: number | string;
  gross_amount?: number | string;
  discount_amount?: number | string;
  net_payable_amount?: number | string;
  order_amount?: number | string;
  order_discount?: number | string;
  order_discount_amount?: number | string;
  order_net_amount?: number | string;
};
type CustomDiscountRequest = {
  id: string;
  status?: string | null;
  orderId?: string | null;
  order_id?: string | null;
  orderNumber?: string | null;
  order_number?: string | null;
  lastReorderedOrderId?: string | null;
};
type CancelledOrderOverlay = {
  id?: string;
  orderId: string;
  formattedOrderNumber?: string;
  dealerId: string;
  dealerName?: string;
  assignedStaffId?: string | null;
  outcome?: 'cancelled' | 'declined';
  cancellation?: {
    reason?: string;
    cancelledAt?: string;
    cancelledBy?: { id?: string; role?: string; name?: string };
  };
  decline?: {
    stage?: 'staff' | 'rsm';
    note?: string;
    declinedAt?: string;
    declinedBy?: { id?: string; role?: string; name?: string };
  };
  originalOrderRef?: Record<string, unknown>;
};
type DispatchOrderProduct = {
  orderdata_id: string;
  orderdata_orderid: string;
  orderdata_cat_no: string;
  orderdata_item_quantity: string;
  orderdata_status: string;
  readyquantity: string;
  product_name?: string;
  product_discription?: string;
  remark?: string;
  remarks?: string;
};
type DispatchRemark = {
  remark?: string;
  readyquantity?: string;
  status?: string;
  datetime?: string;
};

const ORDER_PAGE_SIZE_OPTIONS = [10, 20, 30, 40] as const;
const DEFAULT_PAGE_SIZE = 10;


function parseResponseText(text: string): unknown {
  if (!text.trim()) return "";

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}



function formatMoney(amount: number, minimumFractionDigits = 0) {
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits, maximumFractionDigits: 2 })}`;
}

function safeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractOrderNote(order: Order, overlayNote?: string) {
  if (overlayNote) return overlayNote;
  const direct = order.order_note || order.note;
  if (direct?.trim()) return direct.trim();
  const remarks = [order.remark, order.remarks].filter(Boolean).join(" | ");
  return remarks.match(/Order note:\s*([^|]+)/i)?.[1]?.trim() || "";
}

/** Normalised order-id key, so an override keyed "45" still matches "SAP-0045". */
function orderLookupKey(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const trailing = text.match(/(\d+)(?!.*\d)/)?.[1];
  if (!trailing) return text;
  const normalized = String(Number(trailing));
  return normalized === "NaN" ? trailing : normalized;
}

function rememberSummaryOverride(target: Record<string, OrderSummaryOverride>, item: OrderSummaryOverride) {
  const ids = [
    item.orderId,
    item.order_id,
    (item as Record<string, unknown>).orderNumber,
    (item as Record<string, unknown>).order_number,
  ];
  ids.forEach(id => {
    const raw = String(id ?? "").trim();
    const normalized = orderLookupKey(id);
    if (raw) target[raw] = item;
    if (normalized) target[normalized] = item;
  });
}

function rsmApprovalValue(order: Order) {
  return String(order.rsmApprovalStatus || order.rsm_approval_status || "").toUpperCase();
}

function mtStatusValue(s: string) {
  const key = (s || "").trim().toLowerCase().replace(/[\s_-]/g, "");
  if (key === "completed") return "Completed";
  // Legacy PHP rows carry "InProcess" for a part-dispatched order.
  if (key === "partial" || key === "inprocess") return "Partial";
  return "Pending";
}

const mtConf: Record<string, { label: string; dot: string; text: string; bg: string }> = {
  Completed: { label: "Completed", dot: "bg-emerald-400", text: "text-emerald-800", bg: "bg-emerald-50 border-emerald-200" },
  Partial:   { label: "Partial",   dot: "bg-blue-400",    text: "text-blue-800",    bg: "bg-blue-50 border-blue-200" },
  Pending:   { label: "Pending",   dot: "bg-amber-400",   text: "text-amber-800",   bg: "bg-amber-50 border-amber-200" },
};

/** Highlights the matched slice of a cell against the active filter text. */
function highlight(text: string, query: string) {
  if (!query || !text) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    text.slice(0, idx) +
    `<mark class="bg-yellow-200 text-inherit rounded-sm px-0.5">${text.slice(idx, idx + query.length)}</mark>` +
    text.slice(idx + query.length)
  );
}

/** "Custom ₹1,200" / "Slab 5% ₹800" shown beneath the base discount. */
function resolveAdditionalDiscountDisplay(amounts: {
  additionalDiscountType?: string | null;
  customDiscountAmount?: number;
  slabDiscountAmount?: number;
  slabDiscountPercent?: number;
}) {
  if (amounts.additionalDiscountType === "custom" && safeNumber(amounts.customDiscountAmount) > 0) {
    return { label: "Custom", amountText: formatMoney(safeNumber(amounts.customDiscountAmount), 2) };
  }
  if (amounts.additionalDiscountType === "slab" && safeNumber(amounts.slabDiscountAmount) > 0) {
    const slabPercent = safeNumber(amounts.slabDiscountPercent);
    return {
      label: slabPercent > 0 ? `Slab ${slabPercent}%` : "Slab",
      amountText: formatMoney(safeNumber(amounts.slabDiscountAmount), 2),
    };
  }
  return null;
}

// ─── Dispatch helpers ─────────────────────────────────────────────────────────
function dispatchStatusOptionLabel(status: string) {
  switch (String(status || "").trim()) {
    case "1": return "Packing";
    case "2": return "Dispatched";
    case "3": return "Not in Stock";
    case "4": return "Successful";
    default:  return "Unknown";
  }
}

function getDispatchLeftQuantity(item: DispatchOrderProduct): number {
  return Math.max(0, safeNumber(item.orderdata_item_quantity) - safeNumber(item.readyquantity));
}

function getOriginalProductRemarks(item: DispatchOrderProduct): string {
  return [item.remark, item.remarks].filter(Boolean).join(" | ");
}

function dispatchProductFromRecord(record: Record<string, unknown>): DispatchOrderProduct {
  const orderedQuantity = String(record.orderedQuantity ?? record.orderdata_item_quantity ?? "0");
  const dispatchedQuantity = String(record.dispatchedQuantity ?? record.readyquantity ?? "0");
  const updates = Array.isArray(record.updates) ? record.updates as Array<Record<string, unknown>> : [];
  const latestUpdate = updates[updates.length - 1] ?? {};
  return {
    orderdata_id: String(record.orderItemId ?? record.orderdata_id ?? record.id ?? ""),
    orderdata_orderid: String(record.orderId ?? record.orderdata_orderid ?? ""),
    orderdata_cat_no: String(record.sku ?? record.orderdata_cat_no ?? ""),
    orderdata_item_quantity: orderedQuantity,
    orderdata_status: String(record.currentStatus ?? record.orderdata_status ?? ""),
    readyquantity: dispatchedQuantity,
    product_name: String(record.productName ?? record.product_name ?? record.sku ?? record.orderdata_cat_no ?? ""),
    product_discription: String(record.productDescription ?? record.product_discription ?? ""),
    remark: String(latestUpdate.remark ?? record.remark ?? ""),
    remarks: String(record.remarks ?? ""),
  };
}

function dispatchHistoryFromRecord(record: Record<string, unknown> | null): DispatchRemark[] {
  const updates = Array.isArray(record?.updates) ? record.updates as Array<Record<string, unknown>> : [];
  return updates.slice().reverse().map(update => ({
    remark: String(update.remark ?? ""),
    readyquantity: String(update.quantity ?? ""),
    status: String(update.status ?? ""),
    datetime: String(update.createdAt ?? ""),
  }));
}

function dispatchStatusForApi(status: string) {
  switch (String(status || "").trim()) {
    case "1": return "dispatched";
    case "2": return "dispatched";
    case "3": return "not_in_stock";
    case "4": return "successful";
    default:  return status;
  }
}

type OrderFilters = {
  orderId: string;
  dealer: string;
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
  orderStatus: string;
  accepted: string;
  mtStatus: string;
};

const EMPTY_FILTERS: OrderFilters = {
  orderId: "", dealer: "", dateFrom: "", dateTo: "",
  amountMin: "", amountMax: "", orderStatus: "", accepted: "", mtStatus: "",
};

function hasActiveFilters(f: OrderFilters) {
  return Object.values(f).some(v => v !== "");
}

class OrdersRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OrdersRequestError";
    this.status = status;
  }
}

async function fetchOrders(page: number, pageSize: number, search: string, filters: OrderFilters, role: AppRole, actorId: string, warehouse: string): Promise<ApiResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(pageSize), search });
  if (warehouse)           params.set("warehouse",  warehouse);
  if (filters.orderId)     params.set("order_id",   filters.orderId);
  if (filters.dateFrom)    params.set("date_from",  filters.dateFrom);
  if (filters.dateTo)      params.set("date_to",    filters.dateTo);
  if (filters.amountMin)   params.set("amount_min", filters.amountMin);
  if (filters.amountMax)   params.set("amount_max", filters.amountMax);
  if (filters.orderStatus) params.set("order_status", filters.orderStatus);
  if (filters.accepted)    params.set("accepted",   filters.accepted);
  if (filters.mtStatus)    params.set("mt_status",  filters.mtStatus);

  const url = `/api/orders-data?${params.toString()}`;
  const r = await fetch(url, { cache: "no-store" });

  if (!r.ok) {
    const errorBody = parseResponseText(await r.text());
    const serverMessage =
      errorBody && typeof errorBody === "object" && "message" in errorBody
        ? String((errorBody as { message?: unknown }).message ?? "")
        : typeof errorBody === "string"
          ? errorBody
          : "";
    console.error(
      `[orders-data] request failed (${r.status}): ${serverMessage || r.statusText}`,
      JSON.stringify({ url, page, pageSize, search, filters, role, actorId, errorBody }),
    );
    throw new OrdersRequestError(r.status, serverMessage || `Request failed with status ${r.status}`);
  }

  return r.json();
}

// Status mapping from reference: 0=In process, 1=Packing, 2=Dispatch, 3=Not in stock, 4=Successful
const statusConf: Record<number, { label: string; dot: string; text: string; bg: string }> = {
  0: { label: "In Process",   dot: "bg-amber-400",   text: "text-amber-800",   bg: "bg-amber-50 border-amber-200" },
  1: { label: "Packing",      dot: "bg-blue-400",    text: "text-blue-800",    bg: "bg-blue-50 border-blue-200" },
  2: { label: "Dispatch",     dot: "bg-indigo-400",  text: "text-indigo-800",  bg: "bg-indigo-50 border-indigo-200" },
  3: { label: "Not in Stock", dot: "bg-red-400",     text: "text-red-800",     bg: "bg-red-50 border-red-200" },
  4: { label: "Successful",   dot: "bg-emerald-400", text: "text-emerald-800", bg: "bg-emerald-50 border-emerald-200" },
};

const pillCls = "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border";

/** Wallet settlement applied to this order by the Accountant, if any. */
function SettlementBadge({ settlement }: { settlement?: { status?: string } | null }) {
  const status = settlement?.status;
  if (status !== "settled" && status !== "part_settled") return null;
  const settled = status === "settled";
  return (
    <span
      title={settled ? "Fully settled from wallet advance" : "Partly settled from wallet advance"}
      className={`${pillCls} ${
        settled
          ? "bg-emerald-50 text-emerald-700 border-emerald-100"
          : "bg-amber-50 text-amber-700 border-amber-100"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${settled ? "bg-emerald-500" : "bg-amber-500"}`} />
      {settled ? "Settled" : "Part settled"}
    </span>
  );
}

function OrderStatusBadge({ status }: { status: string | number }) {
  const num = Number(status);
  const s = statusConf[num] ?? { label: "Pending", dot: "bg-slate-400", text: "text-slate-700", bg: "bg-slate-50 border-slate-200" };
  return (
    <span className={`${pillCls} ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {s.label}
    </span>
  );
}

/** Dealer-side confirmation: has the order been accepted yet. */
function AcceptBadge({ accepted }: { accepted?: string }) {
  const ok = accepted === "1";
  return (
    <span className={`${pillCls} ${ok ? "bg-blue-50 text-blue-800 border-blue-200" : "bg-amber-50 text-amber-800 border-amber-200"}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${ok ? "bg-blue-600" : "bg-amber-500"}`} />
      {ok ? "Accepted" : "Awaiting"}
    </span>
  );
}

function MtStatusBadge({ status }: { status: string }) {
  const s = mtConf[mtStatusValue(status)];
  return (
    <span className={`${pillCls} ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {s.label}
    </span>
  );
}

function CustomDiscountBadge({ progress }: { progress: CustomDiscountProgress | null | undefined }) {
  if (progress !== "completely" && progress !== "partially") return <span className="font-mono text-[12px] text-gray-500">—</span>;
  const done = progress === "completely";
  return (
    <span className={`${pillCls} ${done ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-amber-50 text-amber-800 border-amber-200"}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${done ? "bg-emerald-500" : "bg-amber-500"}`} />
      {done ? "Completely" : "Partially"}
    </span>
  );
}

/** Removable chip summarising one active filter. */
function FilterTag({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 text-[11px] font-semibold">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove filter ${label}`} className="opacity-70 hover:opacity-100">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}

const filterInputCls = (active: boolean) =>
  `mt-1.5 block px-2 py-1 text-[11px] font-medium normal-case tracking-normal rounded-md border outline-none transition-colors ${
    active ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-gray-200 bg-white text-gray-700"
  } focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100`;

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr className="border-b border-gray-100">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-4">
          <div className="h-3.5 bg-gray-100 rounded animate-pulse" style={{ width: i === 2 ? 120 : 80 }} />
        </td>
      ))}
    </tr>
  );
}

// ─── Per-row Actions Menu — View / Accept / Decline / Invoice / Delete ────────
/**
 * The menu is positioned `fixed` off the button rect rather than absolutely
 * inside the cell, so the table's horizontal overflow cannot clip it.
 */
function menuPositionFor(button: HTMLElement) {
  const rect = button.getBoundingClientRect();
  const menuWidth = 224;
  const gutter = 12;
  return {
    top: Math.min(rect.bottom + 6, window.innerHeight - gutter),
    left: Math.max(gutter, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - gutter)),
  };
}

function RowActionsMenu({
  order, role, actorId, isDeleted,
  showAccept, showDelete, showDispatch, dispatchDisabled, rsmMode,
  onView, onAccept, onDecline, onDispatch, onDelete,
}: {
  order: Order;
  role: AppRole | null;
  actorId: string;
  isDeleted: boolean;
  showAccept: boolean;
  showDelete: boolean;
  showDispatch: boolean;
  dispatchDisabled: boolean;
  rsmMode: boolean;
  onView: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onDispatch: () => void;
  onDelete: () => void;
}) {
  const [loading,  setLoading ] = useState(false);
  const [menuPos,  setMenuPos ] = useState<{ top: number; left: number } | null>(null);
  const [toast,    setToast   ] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // A fixed menu would drift away from its button on scroll/resize, so close it.
  useEffect(() => {
    if (!menuPos) return;
    const close = () => setMenuPos(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menuPos]);

  const showToast = (type: "success" | "error", text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDownload = async () => {
    setLoading(true); setMenuPos(null);
    const res = await downloadOrderInvoice(order, { normalizedRole: role, actorId });
    setLoading(false);
    showToast(res.success ? "success" : "error", res.success ? "PDF downloaded" : (res.error || "Download failed"));
  };

  const handleUpload = async () => {
    setLoading(true); setMenuPos(null);
    try {
      const options = { normalizedRole: role, actorId };
      const blob = await generateOrderInvoicePDF(order, options);
      const res  = await uploadOrderInvoice(blob, order, options);
      showToast(res.success ? "success" : "error", res.success ? "Invoice saved to cloud" : (res.error || "Upload failed"));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed";
      showToast("error", message);
    } finally {
      setLoading(false);
    }
  };

  const accepted = order.accept_order === "1" || Number(order.orderdata_status ?? 0) >= 4 || Number(order.mtstatus ?? 0) >= 2 || String(order.mtstatus ?? "").toLowerCase().includes("completed");
  const itemCls = (hover: string, color = "text-gray-700") =>
    `w-full text-left px-4 py-2.5 text-[12px] ${color} ${hover} flex items-center gap-3 transition-colors`;

  return (
    <>
      <button
        onClick={e => { const pos = menuPositionFor(e.currentTarget); setMenuPos(prev => prev ? null : pos); }}
        disabled={loading}
        title="Order actions"
        aria-label="Order actions"
        aria-haspopup="menu"
        aria-expanded={!!menuPos}
        className="flex items-center justify-center w-8 h-8 bg-white border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-700 rounded-lg transition-all shadow-sm disabled:opacity-50"
      >
        {loading
          ? <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5"  r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="12" cy="19" r="1.8" />
            </svg>
        }
      </button>

      {menuPos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuPos(null)} />
          <div
            role="menu"
            style={{ top: menuPos.top, left: menuPos.left }}
            className="fixed w-56 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden py-1"
          >
            <button
              role="menuitem"
              onClick={() => { setMenuPos(null); onView(); }}
              className={itemCls("hover:bg-indigo-50")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span className="font-semibold">View order</span>
            </button>

            {showDispatch && (
              <button
                role="menuitem"
                onClick={dispatchDisabled ? undefined : () => { setMenuPos(null); onDispatch(); }}
                disabled={dispatchDisabled}
                className={`${itemCls("hover:bg-indigo-50", "text-indigo-700")} disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M9 12h6M12 9v6" />
                  <path d="M4 7h16M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
                </svg>
                <div>
                  <p className="font-semibold">Dispatch details</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{dispatchDisabled ? "Accept order first" : "Update dispatch"}</p>
                </div>
              </button>
            )}

            {showAccept && !rsmMode && order.accept_order === "0" && (
              <button role="menuitem" onClick={() => { setMenuPos(null); onAccept(); }} className={itemCls("hover:bg-emerald-50", "text-emerald-700")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
                <div>
                  <p className="font-semibold">Accept order</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Mark as confirmed</p>
                </div>
              </button>
            )}

            {showAccept && rsmMode && (
              <>
                <button role="menuitem" onClick={() => { setMenuPos(null); onAccept(); }} className={itemCls("hover:bg-emerald-50", "text-emerald-700")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>
                  <div>
                    <p className="font-semibold">Approve order</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Clear for staff acceptance</p>
                  </div>
                </button>
                <button role="menuitem" onClick={() => { setMenuPos(null); onDecline(); }} className={itemCls("hover:bg-rose-50", "text-rose-700")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  <div>
                    <p className="font-semibold">Disapprove order</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Requires a reason</p>
                  </div>
                </button>
              </>
            )}

            {showAccept && !rsmMode && order.accept_order === "1" && (
              <button role="menuitem" onClick={() => { setMenuPos(null); onDecline(); }} className={itemCls("hover:bg-rose-50", "text-rose-700")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                <div>
                  <p className="font-semibold">Decline</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Revert acceptance</p>
                </div>
              </button>
            )}

            <div className="my-1 border-t border-gray-100" />

            <button role="menuitem" onClick={handleDownload} className={itemCls("hover:bg-blue-50")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <div>
                <p className="font-semibold">{accepted ? "Download Invoice" : "Download Purchase Order"}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Save to device</p>
              </div>
            </button>
            <button role="menuitem" onClick={handleUpload} className={itemCls("hover:bg-emerald-50")}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 14 12 9 17 14"/>
                <line x1="12" y1="9" x2="12" y2="21"/>
              </svg>
              <div>
                <p className="font-semibold">{accepted ? "Save to Cloud" : "Save PO to Cloud"}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Save to cloud</p>
              </div>
            </button>

            {!isDeleted && showDelete && (
              <>
                <div className="my-1 border-t border-gray-100" />
                <button
                  role="menuitem"
                  onClick={() => { setMenuPos(null); onDelete(); }}
                  className={itemCls("hover:bg-red-50", "text-red-600")}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14H6L5 6m5 0V4h4v2" />
                  </svg>
                  <span className="font-semibold">Delete order</span>
                </button>
              </>
            )}
          </div>
        </>
      )}

      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-medium shadow-lg border ${
          toast.type === "success" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"
        }`}>
          {toast.type === "success"
            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/></svg>
          }
          {toast.text}
        </div>
      )}
    </>
  );
}

// ─── Export Button ─────────────────────────────────────────────────────────────
interface ExportButtonProps {
  orders: Order[];
  dealerName: string;
  dealerId: string;
  isLoading?: boolean;
  onExportCsv: () => void;
}

function ExportButton({ orders, dealerName, dealerId, isLoading = false, onExportCsv }: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [showNotification, setShowNotification] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  const handleExport = async (uploadToCloud: boolean) => {
    if (orders.length === 0) { setShowNotification({ type: "error", message: "No orders to export" }); setShowMenu(false); return; }
    setIsExporting(true); setShowMenu(false);
    try {
      if (uploadToCloud) {
        const result = await exportOrdersToCloud({ orders, dealerName, dealerId, title: `Order History - ${dealerName}`, fileName: `orders_${moment().format("YYYY-MM-DD")}` });
        setShowNotification({ type: result.success ? "success" : "error", message: result.success ? "PDF saved to cloud storage! 🎉" : (result.error || "Failed") });
      } else {
        const result = await downloadPDFDirectly({ orders, dealerName, title: `Order History - ${dealerName}`, fileName: `orders_${moment().format("YYYY-MM-DD")}.pdf` });
        setShowNotification({ type: result.success ? "success" : "error", message: result.success ? "PDF downloaded successfully! 📥" : (result.error || "Failed") });
      }
    } catch (error) {
      setShowNotification({ type: "error", message: error instanceof Error ? error.message : "Export failed" });
    } finally {
      setIsExporting(false);
      setTimeout(() => setShowNotification(null), 4000);
    }
  };

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          disabled={isLoading || isExporting || orders.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-xl transition-colors"
        >
          {isExporting ? (
            <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />Exporting…</>
          ) : (
            <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Export<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className={`transition-transform ${showMenu ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6"/></svg></>
          )}
        </button>
        {showMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
            <div className="absolute right-0 mt-2 w-60 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden py-1">
              <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">PDF</p>
              <button onClick={() => handleExport(false)} disabled={isExporting} className="w-full text-left px-4 py-2.5 text-[13px] text-gray-700 hover:bg-indigo-50 disabled:opacity-50 transition-colors flex items-center gap-3">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <div><p className="font-semibold">Download to device</p><p className="text-[11px] text-gray-500 mt-0.5">Save PDF locally</p></div>
              </button>
              <button onClick={() => handleExport(true)} disabled={isExporting} className="w-full text-left px-4 py-2.5 text-[13px] text-gray-700 hover:bg-indigo-50 disabled:opacity-50 transition-colors flex items-center gap-3">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="1"/><path d="M12 1v6m0 6v6M4.22 4.22l4.24 4.24m0 5.08l-4.24 4.24M19.78 4.22l-4.24 4.24m0 5.08l4.24 4.24M1 12a11 11 0 0 1 22 0 11 11 0 0 1-22 0"/></svg>
                <div><p className="font-semibold">Save to cloud</p><p className="text-[11px] text-gray-500 mt-0.5">Stored for later download</p></div>
              </button>
              <div className="my-1 border-t border-gray-100" />
              <p className="px-4 pt-1 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">Spreadsheet</p>
              <button onClick={() => { setShowMenu(false); onExportCsv(); }} disabled={isExporting} className="w-full text-left px-4 py-2.5 text-[13px] text-gray-700 hover:bg-indigo-50 disabled:opacity-50 transition-colors flex items-center gap-3">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="m9 13 2 3-2 3M15 13l-2 3 2 3"/></svg>
                <div><p className="font-semibold">Export CSV</p><p className="text-[11px] text-gray-500 mt-0.5">{orders.length} row{orders.length === 1 ? "" : "s"} on this page</p></div>
              </button>
            </div>
          </>
        )}
      </div>
      {showNotification && (
        <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg text-[13px] font-medium shadow-lg animate-in fade-in slide-in-from-bottom z-50 flex items-center gap-2 ${
          showNotification.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"
        }`}>
          {showNotification.type === "success"
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          }
          {showNotification.message}
        </div>
      )}
    </>
  );
}

// ─── Delete Modal ─────────────────────────────────────────────────────────────
function DeleteModal({ orderId, onConfirm, onClose }: { orderId: string; onConfirm: (reason: string) => Promise<void>; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!reason.trim()) { setErr("A reason is required."); return; }
    setDeleting(true);
    await onConfirm(reason.trim());
    setDeleting(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: "blur(8px)", background: "rgba(15,23,42,0.45)" }}
      onClick={e => { if (e.target === e.currentTarget && !deleting) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" style={{ animation: "slideUp 0.2s ease" }}>
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="w-10 h-10 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mb-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6m5 0V4h4v2"/>
            </svg>
          </div>
          <h3 className="text-[15px] font-bold text-gray-900">Delete Order #{orderId}?</h3>
          <p className="text-[13px] text-gray-600 mt-1">Order stays in history with your reason. This cannot be undone.</p>
        </div>
        <div className="px-6 py-4">
          <label className="text-[11px] font-bold text-gray-600 uppercase tracking-widest block mb-2">
            Reason <span className="text-red-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={e => { setReason(e.target.value); setErr(""); }}
            placeholder="e.g. Duplicate order, wrong items, customer cancelled…"
            rows={3}
            disabled={deleting}
            className={`w-full px-4 py-3 text-[13px] text-gray-900 border rounded-xl outline-none resize-none transition-all placeholder:text-gray-400 ${
              err ? "border-red-300 bg-red-50/30 focus:ring-2 focus:ring-red-100" : "border-gray-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            }`}
          />
          {err && <p className="text-[11px] text-red-600 mt-1.5">{err}</p>}
        </div>
        <div className="px-6 pb-6 flex gap-2">
          <button onClick={onClose} disabled={deleting} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors">Cancel</button>
          <button onClick={submit} disabled={deleting || !reason.trim()} className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-[13px] font-semibold transition-colors flex items-center justify-center gap-2">
            {deleting && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {deleting ? "Deleting…" : "Delete Order"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Decline Modal ────────────────────────────────────────────────────────────
/** A decline must carry a reason — the backend rejects a note-less decline, and
 *  the dealer plus the other review stage only ever see this note. */
function DeclineModal({ note, saving, onNoteChange, onConfirm, onClose }: {
  note: string; saving: boolean;
  onNoteChange: (value: string) => void; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: "blur(8px)", background: "rgba(15,23,42,0.45)" }}
      onClick={e => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" role="dialog" aria-modal="true" aria-labelledby="decline-modal-title" style={{ animation: "slideUp 0.2s ease" }}>
        <h3 id="decline-modal-title" className="text-[15px] font-bold text-gray-900">Decline order</h3>
        <p className="text-[13px] text-gray-600 mt-1">
          This reason is shown to the dealer and to the other reviewer in Cancelled &amp; Declined.
        </p>
        <textarea
          value={note}
          autoFocus
          maxLength={1500}
          rows={4}
          placeholder="Why is this order being declined?"
          onChange={e => onNoteChange(e.target.value)}
          className="mt-4 w-full px-4 py-3 text-[13px] text-gray-900 border border-gray-200 rounded-xl outline-none resize-y transition-all placeholder:text-gray-400 focus:border-red-400 focus:ring-2 focus:ring-red-100"
        />
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} disabled={saving} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors">Cancel</button>
          <button onClick={onConfirm} disabled={!note.trim() || saving} className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-[13px] font-semibold transition-colors">
            {saving ? "Declining…" : "Decline order"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dispatch Details Drawer ──────────────────────────────────────────────────
function DispatchDetailsDrawer({
  order,
  products,
  loadingProducts,
  productsError,
  selectedProductId,
  onSelectProduct,
  history,
  historyLoading,
  historyError,
  form,
  formError,
  submitting,
  onFormChange,
  onSubmit,
  onClose,
}: {
  order: Order | null;
  products: DispatchOrderProduct[];
  loadingProducts: boolean;
  productsError: string;
  selectedProductId: string;
  onSelectProduct: (productId: string) => void;
  history: DispatchRemark[];
  historyLoading: boolean;
  historyError: string;
  form: { readyQuantity: string; status: string; remark: string };
  formError: string;
  submitting: boolean;
  onFormChange: (field: 'readyQuantity' | 'status' | 'remark', value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  if (!order) return null;

  const selectedProduct = products.find(item => item.orderdata_id === selectedProductId) ?? null;
  const availableLeftQuantity = selectedProduct ? getDispatchLeftQuantity(selectedProduct) : 0;

  return (
    <div className="dispatch-overlay" onClick={onClose}>
      <div className="dispatch-drawer" onClick={event => event.stopPropagation()}>
        <div className="dispatch-header">
          <div>
            <p className="dispatch-kicker">Dispatch Details</p>
            <h2 className="dispatch-title">Order No: {formatDisplayOrderNumber(order.order_id)}</h2>
            <p className="dispatch-subtitle">Dealer: {order.Dealer_Name || '—'}</p>
          </div>
          <button type="button" className="dispatch-close" onClick={onClose} aria-label="Close dispatch details">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="dispatch-layout">
          <div className="dispatch-products">
            <div className="dispatch-section-head">
              <h3>Order Products</h3>
              {!loadingProducts && <span>{products.length} line{products.length !== 1 ? 's' : ''}</span>}
            </div>

            {loadingProducts && <div className="dispatch-empty">Loading order products…</div>}
            {!loadingProducts && productsError && <div className="dispatch-error">{productsError}</div>}
            {!loadingProducts && !productsError && products.length === 0 && (
              <div className="dispatch-empty">No products returned for this order.</div>
            )}

            {!loadingProducts && !productsError && products.length > 0 && (
              <div className="dispatch-product-list">
                {products.map((item, index) => {
                  const selected = item.orderdata_id === selectedProductId;
                  return (
                    <div key={item.orderdata_id} className={`dispatch-product-card${selected ? ' is-selected' : ''}`}>
                      <div className="dispatch-product-top">
                        <span className="dispatch-product-index">{String(index + 1).padStart(2, '0')}</span>
                        <span className="dispatch-cat-pill">{item.orderdata_cat_no || '—'}</span>
                        <span className="dispatch-line-id">#{item.orderdata_id}</span>
                      </div>
                      <p className="dispatch-product-name">{item.product_name || item.orderdata_cat_no || '—'}</p>
                      <p className="dispatch-product-desc">{item.product_discription || 'No description available.'}</p>
                      <div className="dispatch-product-grid">
                        <span>Ordered: {safeNumber(item.orderdata_item_quantity)}</span>
                        <span>Dispatched: {safeNumber(item.readyquantity)}</span>
                        <span>Left: {getDispatchLeftQuantity(item)}</span>
                        <span>Status: {dispatchStatusOptionLabel(item.orderdata_status)}</span>
                      </div>
                      <div className="dispatch-original-note">
                        <span className="dispatch-original-note-label">Product Note / Original Remarks</span>
                        <p>{getOriginalProductRemarks(item) || '—'}</p>
                      </div>
                      <button type="button" className="dispatch-select-btn" onClick={() => onSelectProduct(item.orderdata_id)}>
                        Update Dispatch
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="dispatch-editor">
            <div className="dispatch-section-head">
              <h3>Dispatch Update</h3>
              {selectedProduct && <span>Line #{selectedProduct.orderdata_id}</span>}
            </div>

            {!selectedProduct && <div className="dispatch-empty">Choose a product line to update its dispatch details.</div>}

            {selectedProduct && (
              <>
                <div className="dispatch-form-card">
                  <div className="dispatch-form-row">
                    <label htmlFor="dispatch-ready">Ready Quantity</label>
                    <input
                      id="dispatch-ready"
                      type="number"
                      min="1"
                      value={form.readyQuantity}
                      onChange={event => onFormChange('readyQuantity', event.target.value)}
                      disabled={submitting}
                    />
                  </div>

                  <div className="dispatch-form-row">
                    <label htmlFor="dispatch-left">Left Quantity</label>
                    <input id="dispatch-left" type="text" value={String(availableLeftQuantity)} readOnly disabled />
                  </div>

                  <div className="dispatch-form-row">
                    <label htmlFor="dispatch-status">Current Status</label>
                    <select
                      id="dispatch-status"
                      value={form.status}
                      onChange={event => onFormChange('status', event.target.value)}
                      disabled={submitting}
                    >
                      <option value="">Select status</option>
                      <option value="1">Packing</option>
                      <option value="2">Dispatched</option>
                      <option value="3">Not in Stock</option>
                      <option value="4">Successful</option>
                    </select>
                  </div>

                  <div className="dispatch-form-row">
                    <label htmlFor="dispatch-remark">Remark</label>
                    <textarea
                      id="dispatch-remark"
                      value={form.remark}
                      onChange={event => onFormChange('remark', event.target.value)}
                      placeholder="Add dispatch remark"
                      rows={4}
                      disabled={submitting}
                    />
                  </div>

                  {formError && <div className="dispatch-error">{formError}</div>}

                  <button type="button" className="dispatch-submit-btn" onClick={onSubmit} disabled={submitting}>
                    {submitting ? 'Saving…' : 'Save Dispatch Update'}
                  </button>
                </div>

                <div className="dispatch-history-card">
                  <div className="dispatch-section-head">
                    <h3>Dispatch History</h3>
                    {!historyLoading && <span>{history.length} update{history.length !== 1 ? 's' : ''}</span>}
                  </div>

                  {historyLoading && <div className="dispatch-empty">Loading remark history…</div>}
                  {!historyLoading && historyError && <div className="dispatch-error">{historyError}</div>}
                  {!historyLoading && !historyError && history.length === 0 && (
                    <div className="dispatch-empty">No dispatch history found for this product line.</div>
                  )}
                  {!historyLoading && !historyError && history.length > 0 && (
                    <div className="dispatch-history-list">
                      {history.map((entry, index) => (
                        <div key={`${selectedProduct.orderdata_id}-${index}`} className="dispatch-history-item">
                          <div className="dispatch-history-top">
                            <span className="dispatch-product-index">{String(index + 1).padStart(2, '0')}</span>
                            <span className="dispatch-history-status">{dispatchStatusOptionLabel(String(entry.status || ''))}</span>
                          </div>
                          <p className="dispatch-history-remark">{entry.remark || '—'}</p>
                          <div className="dispatch-history-meta">
                            <span>Ready Qty: {safeNumber(entry.readyquantity)}</span>
                            <span>{entry.datetime || '—'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function OrderHistoryPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const auth = useAuthSession();
  const [section, setSection] = useState<"active" | "cancelled">("active");
  // "" = every warehouse. Kept out of `filters` so it reads as a tab, not a
  // removable filter chip.
  const [warehouse, setWarehouse] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<OrderFilters>(EMPTY_FILTERS);
  const [isRsm, setIsRsm] = useState(false);
  const [rsmOnlyAwaiting, setRsmOnlyAwaiting] = useState(false);
  const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState("");
  const [declineSaving, setDeclineSaving] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [orderNotes, setOrderNotes] = useState<Record<string, OrderNoteOverlay>>({});
  const [summaryOverrides, setSummaryOverrides] = useState<Record<string, OrderSummaryOverride>>({});
  const [selectedBillingOrderIds, setSelectedBillingOrderIds] = useState<Set<string>>(new Set());
  const [bulkBilling, setBulkBilling] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [dispatchOrder, setDispatchOrder] = useState<Order | null>(null);
  const [dispatchProducts, setDispatchProducts] = useState<DispatchOrderProduct[]>([]);
  const [dispatchProductsLoading, setDispatchProductsLoading] = useState(false);
  const [dispatchProductsError, setDispatchProductsError] = useState("");
  const [selectedDispatchProductId, setSelectedDispatchProductId] = useState("");
  const [dispatchHistory, setDispatchHistory] = useState<DispatchRemark[]>([]);
  const [dispatchHistoryLoading, setDispatchHistoryLoading] = useState(false);
  const [dispatchHistoryError, setDispatchHistoryError] = useState("");
  const [dispatchSubmitting, setDispatchSubmitting] = useState(false);
  const [dispatchFormError, setDispatchFormError] = useState("");
  const [dispatchForm, setDispatchForm] = useState({ readyQuantity: "", status: "", remark: "" });

  const actorRole = !auth.loading && auth.session.status === "authenticated"
    ? auth.session.role
    : null;
  const roletype = !auth.loading && auth.session.status === "authenticated" ? auth.session.roletype : "";
  const actorId = !auth.loading && auth.session.status === "authenticated"
    ? actorRole === "dealer"
      ? String(auth.session.user.Dealer_Id ?? "").trim()
      : actorRole === "staff"
        ? String(auth.session.user.staff_id ?? "").trim()
        : String(auth.session.user.id ?? auth.session.user.admin_id ?? auth.session.user.Admin_Id ?? "").trim()
    : "";
  const dealerId = actorRole === "dealer" ? actorId : "";
  const actorReady = actorRole === "admin" || actorRole === "accountant" || Boolean(actorId);

  // Role gates carried over from the old Order Management page's ROLE_CONFIG.
  const showDealerCol        = actorRole !== "dealer";
  const showCustomDiscount   = actorRole !== "dealer";
  const showActions          = actorRole !== "accountant";
  const canDeleteOrder       = (o: Order) => (actorRole === "admin" || actorRole === "dealer") && o.accept_order === "0" && o.del_status === "0";
  const canAcceptOrder       = (o: Order) => actorRole === "staff" && roletype !== "2" && o.del_status === "0";

  // `useAuthSession` normalises rsm→staff, so the raw role is read separately.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
      .then(res => (res.ok ? res.json() : null))
      .then(json => {
        if (cancelled) return;
        const rsm = String(json?.data?.role ?? "").toLowerCase() === "rsm";
        setIsRsm(rsm);
        setRsmOnlyAwaiting(rsm);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);

  const showToast = (type: "success" | "error", text: string) => setToast({ type, text });

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["orders", STAFF_ORDER_SCOPE_VERSION, actorRole, actorId, page, pageSize, query, filters, warehouse],
    queryFn: () => fetchOrders(page, pageSize, query, filters, actorRole as AppRole, actorId, warehouse),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled: !auth.loading && auth.session.status === "authenticated" && actorReady && section === "active",
    retry: (failureCount, err) =>
      err instanceof OrdersRequestError && (err.status === 401 || err.status === 403) ? false : failureCount < 3,
  });

  const { data: cancelledResponse, isLoading: cancelledLoading, isError: cancelledError } = useQuery<{ data: CancelledOrderOverlay[]; total?: number; count?: number; totalPages?: number; last_page?: number }>({
    queryKey: ["cancelled-orders", actorRole, actorId, page, pageSize, query],
    queryFn: async () => {
      const res = await fetch(`/api/order-overlays/cancelled?page=${page}&limit=${pageSize}&search=${encodeURIComponent(query)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Unable to load cancelled orders");
      return json;
    },
    enabled: !auth.loading && auth.session.status === "authenticated" && actorReady && section === "cancelled",
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const { data: customDiscountRequests = [] } = useQuery<CustomDiscountRequest[]>({
    queryKey: ["custom-discount-requests", actorRole, actorId],
    queryFn: async () => {
      const actorScope = actorRole === "staff" ? `&staff_id=${encodeURIComponent(actorId)}` : "";
      const res = await fetch(`/api/custom-discount-requests?limit=500${actorScope}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Failed to load custom discount requests");
      return Array.isArray(json.data) ? json.data : [];
    },
    enabled: !auth.loading && auth.session.status === "authenticated" && actorReady && showCustomDiscount,
    staleTime: 60_000,
  });

  const customDiscountProgressMap = buildCustomDiscountProgressMap(customDiscountRequests);
  const sessionExpired = error instanceof OrdersRequestError && (error.status === 401 || error.status === 403);

  const allOrders = data?.data ?? [];
  // The RSM "awaiting my approval" tab is a client-side view of the fetched
  // page; the server has no rsm_approval filter.
  const orders = isRsm && rsmOnlyAwaiting ? allOrders.filter(o => rsmApprovalValue(o) === "AWAITING") : allOrders;
  const awaitingApprovalCount = isRsm ? allOrders.filter(o => rsmApprovalValue(o) === "AWAITING").length : 0;
  const cancelledData = cancelledResponse?.data ?? [];

  const overrideFor = (order: Order) =>
    summaryOverrides[String(order.order_id)] ?? summaryOverrides[orderLookupKey(order.order_id)];

  const selectedOrdersForBilling = orders
    .map(order => withDisplayOrderAmounts(order, overrideFor(order)))
    .filter(order => selectedBillingOrderIds.has(String(order.order_id ?? "")));
  const selectedBillingTotal = selectedOrdersForBilling.reduce((sum, order) => sum + Number((order as any).netPayableAmount ?? 0), 0);
  const selectedDealerIds = Array.from(new Set(selectedOrdersForBilling.map((order) => String((order as any).order_dealer ?? (order as any).Dealer_Id ?? "").trim()).filter(Boolean)));

  const isBillingEligible = (order: Order) => String(order.accept_order ?? "") === "1" || Number(order.orderdata_status ?? 0) >= 4 || String(order.mtstatus ?? "").toLowerCase().includes("completed");

  const toggleBillingOrder = (order: Order, checked: boolean) => {
    const oid = String((order as any).order_id ?? (order as any).orderId ?? "").trim();
    if (!oid || !isBillingEligible(order)) return;
    const orderDealerId = String((order as any).order_dealer ?? (order as any).Dealer_Id ?? "").trim();
    if (checked && selectedDealerIds.length === 1 && orderDealerId && selectedDealerIds[0] !== orderDealerId) {
      showToast("error", "Bulk billing supports one dealer at a time.");
      return;
    }
    setSelectedBillingOrderIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(oid); else next.delete(oid);
      return next;
    });
  };

  const handleBulkBillingUpload = async () => {
    if (selectedOrdersForBilling.length === 0 || bulkBilling) return;
    if (selectedDealerIds.length > 1) {
      showToast("error", "Select orders from one dealer only.");
      return;
    }
    setBulkBilling(true);
    try {
      const existing = await listInvoices(selectedDealerIds[0] || dealerId || "", 500);
      const existingNumbers = new Set(Array.isArray(existing.data) ? existing.data.map((invoice: any) => String(invoice.invoiceNumber ?? "")) : []);
      const duplicates = selectedOrdersForBilling.filter((order) => existingNumbers.has(formatDisplayOrderNumber(order.order_id)));
      if (duplicates.length > 0) {
        showToast("error", `Already billed: ${duplicates.map((order) => order.order_id).join(", ")}`);
        return;
      }
      for (const order of selectedOrdersForBilling) {
        const blob = await generateOrderInvoicePDF(order as any, { normalizedRole: actorRole, actorId });
        const result = await uploadOrderInvoice(blob, order as any, { normalizedRole: actorRole, actorId });
        if (!result.success) throw new Error(result.error || result.message || `Failed to bill ${order.order_id}`);
      }
      setSelectedBillingOrderIds(new Set());
      showToast("success", `${selectedOrdersForBilling.length} invoice${selectedOrdersForBilling.length === 1 ? "" : "s"} saved.`);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Bulk billing failed");
    } finally {
      setBulkBilling(false);
    }
  };

  const ordersForExport = orders.map(order => withDisplayOrderAmounts(order, overrideFor(order)));
  const totalCount = section === "cancelled"
    ? (cancelledResponse?.total ?? cancelledResponse?.count ?? cancelledData.length)
    : (data?.count ?? 0);
  const totalPages = section === "cancelled"
    ? (cancelledResponse?.last_page ?? cancelledResponse?.totalPages ?? Math.max(1, Math.ceil(totalCount / pageSize)))
    : Math.ceil(totalCount / pageSize);
  const orderIdsKey = orders.map(o => o.order_id ?? "").filter(Boolean).join(",");

  // Both overlay endpoints key purely on order_ids, so every role gets the
  // note / amount overlays — not just a signed-in Dealer.
  useEffect(() => {
    if (!orderIdsKey) { setOrderNotes({}); return; }
    fetch(`/api/order-notes?order_ids=${encodeURIComponent(orderIdsKey)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(json => {
        if (!json.success) return;
        const next: Record<string, OrderNoteOverlay> = {};
        (json.data ?? []).forEach((item: any) => {
          if (item.orderId) next[item.orderId] = item;
        });
        setOrderNotes(next);
      })
      .catch(() => {});
  }, [orderIdsKey]);

  useEffect(() => {
    if (!orderIdsKey) { setSummaryOverrides({}); return; }
    fetch(`/api/order-summary-overrides?order_ids=${encodeURIComponent(orderIdsKey)}`, { cache: "no-store" })
      .then(r => r.json())
      .then(json => {
        if (!json.success) return;
        const next: Record<string, OrderSummaryOverride> = {};
        (json.data ?? []).forEach((item: OrderSummaryOverride) => rememberSummaryOverride(next, item));
        setSummaryOverrides(next);
      })
      .catch(() => {});
  }, [orderIdsKey]);

  const setFilter = (key: keyof OrderFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };
  // The Dealer column filter and the top search box both drive the server-side
  // `search` param, so they share one value rather than fighting over it.
  const setDealerFilter = (value: string) => {
    setFilters(prev => ({ ...prev, dealer: value }));
    setSearch(value);
    setQuery(value);
    setPage(1);
  };
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setSearch(""); setQuery(""); setPage(1); };
  const filtersActive = hasActiveFilters(filters) || !!query;

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setQuery(search); setFilters(prev => ({ ...prev, dealer: search })); setPage(1); };

  const handleDelete = async (reason: string) => {
    if (!deleteOrderId) return;
    if (actorRole !== "dealer" && actorRole !== "admin") {
      showToast("error", "Only Dealers or Admin can cancel orders.");
      return;
    }
    const response = await fetch(`/api/order-overlays/${encodeURIComponent(deleteOrderId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "cancel",
        reason,
        formattedOrderNumber: formatDisplayOrderNumber(deleteOrderId),
      }),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || json?.success === false) {
      showToast("error", json?.message || "Cancellation could not be recorded.");
      return;
    }
    setDeleteOrderId(null);
    showToast("success", json?.message || "Order cancelled.");
    refetch();
    queryClient.invalidateQueries({ queryKey: ["cancelled-orders"] });
  };

  const handleAccept = useCallback(async (id: string, status: 0 | 1, note?: string) => {
    try {
      const currentRes = await fetch(`/api/order-overlays/${encodeURIComponent(id)}`, { cache: "no-store" });
      const currentJson = await currentRes.json().catch(() => null);
      if (currentRes.ok && currentJson?.data?.isCancelled) {
        showToast("error", "Cancelled orders cannot be accepted or declined.");
        queryClient.invalidateQueries({ queryKey: ["orders"] });
        return;
      }
      const res = await fetch(`/api/order-overlays/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: status === 1 ? "mirror_acceptance" : "decline",
          acceptOrder: status === 1 ? "1" : "2",
          ...(note ? { note } : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.success === false) throw new Error(json?.message || "Acceptance update failed");
      showToast("success", isRsm ? (status === 1 ? "Order approved." : "Order disapproved.") : "Status updated.");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      // A decline now shows up in the Cancelled tab, so refresh that list too.
      if (status === 0) queryClient.invalidateQueries({ queryKey: ["cancelled-orders"] });
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Action failed.");
      throw error;
    }
  }, [queryClient, isRsm]);

  const submitDecline = useCallback(async () => {
    const trimmed = declineNote.trim();
    if (!declineTarget || !trimmed || declineSaving) return;
    setDeclineSaving(true);
    try {
      await handleAccept(declineTarget, 0, trimmed);
      setDeclineTarget(null);
      setDeclineNote("");
    } catch {
      // handleAccept already surfaced the reason; keep the modal open so the
      // note is not lost and can be retried.
    } finally {
      setDeclineSaving(false);
    }
  }, [declineNote, declineTarget, declineSaving, handleAccept]);

  // ── Dispatch drawer ─────────────────────────────────────────────────────────
  const loadDispatchProducts = useCallback(async (orderId: string, preferredProductId?: string) => {
    setDispatchProductsLoading(true);
    setDispatchProductsError("");
    try {
      const res = await fetch(`/api/order-dispatch?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json?.success === false) throw new Error(json?.message || "Failed to load order products.");
      const nextProducts: DispatchOrderProduct[] = Array.isArray(json?.data)
        ? json.data.map((item: Record<string, unknown>) => dispatchProductFromRecord(item))
        : [];
      setDispatchProducts(nextProducts);
      const resolvedProductId = preferredProductId && nextProducts.some(item => item.orderdata_id === preferredProductId)
        ? preferredProductId
        : nextProducts[0]?.orderdata_id ?? "";
      setSelectedDispatchProductId(resolvedProductId);
      setDispatchFormError("");
    } catch {
      setDispatchProducts([]);
      setSelectedDispatchProductId("");
      setDispatchProductsError("Failed to load order products. Please try again.");
    } finally {
      setDispatchProductsLoading(false);
    }
  }, []);

  const loadDispatchHistory = useCallback(async (productId: string) => {
    if (!productId) {
      setDispatchHistory([]);
      setDispatchHistoryError("");
      return;
    }
    setDispatchHistoryLoading(true);
    setDispatchHistoryError("");
    try {
      const product = dispatchProducts.find(item => item.orderdata_id === productId);
      const orderId = product?.orderdata_orderid || dispatchOrder?.order_id || "";
      if (!orderId) throw new Error("Missing order id");
      const res = await fetch(`/api/order-dispatch?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json?.success === false) throw new Error(json?.message || "Failed to load dispatch history.");
      const record = Array.isArray(json?.data)
        ? json.data.find((item: Record<string, unknown>) => String(item.orderItemId ?? item.orderdata_id ?? item.id ?? "") === productId) ?? null
        : null;
      setDispatchHistory(dispatchHistoryFromRecord(record));
    } catch {
      setDispatchHistory([]);
      setDispatchHistoryError("Failed to load dispatch history. Please try again.");
    } finally {
      setDispatchHistoryLoading(false);
    }
  }, [dispatchOrder, dispatchProducts]);

  const openDispatchDetails = useCallback((order: Order) => {
    setDispatchOrder(order);
    setDispatchProducts([]);
    setDispatchProductsError("");
    setDispatchHistory([]);
    setDispatchHistoryError("");
    setSelectedDispatchProductId("");
    setDispatchFormError("");
    setDispatchForm({ readyQuantity: "", status: "", remark: "" });
    loadDispatchProducts(order.order_id);
  }, [loadDispatchProducts]);

  const closeDispatchDetails = useCallback(() => {
    setDispatchOrder(null);
    setDispatchProducts([]);
    setDispatchProductsError("");
    setDispatchHistory([]);
    setDispatchHistoryError("");
    setSelectedDispatchProductId("");
    setDispatchFormError("");
    setDispatchForm({ readyQuantity: "", status: "", remark: "" });
  }, []);

  useEffect(() => {
    const selectedProduct = dispatchProducts.find(item => item.orderdata_id === selectedDispatchProductId) ?? null;
    if (!selectedProduct) {
      setDispatchHistory([]);
      setDispatchHistoryError("");
      setDispatchForm({ readyQuantity: "", status: "", remark: "" });
      return;
    }

    setDispatchForm({
      readyQuantity: "",
      status: ["1", "2", "3", "4"].includes(String(selectedProduct.orderdata_status || ""))
        ? String(selectedProduct.orderdata_status)
        : "",
      remark: "",
    });
    setDispatchFormError("");
    loadDispatchHistory(selectedProduct.orderdata_id);
  }, [selectedDispatchProductId, dispatchProducts, loadDispatchHistory]);

  const selectedDispatchProduct = dispatchProducts.find(item => item.orderdata_id === selectedDispatchProductId) ?? null;

  const handleDispatchFormChange = useCallback((field: "readyQuantity" | "status" | "remark", value: string) => {
    setDispatchForm(previous => ({ ...previous, [field]: value }));
    setDispatchFormError("");
  }, []);

  const handleDispatchSubmit = useCallback(async () => {
    if (!dispatchOrder || !selectedDispatchProduct) return;

    const enteredReadyQuantity = Number(dispatchForm.readyQuantity);
    const availableLeftQuantity = getDispatchLeftQuantity(selectedDispatchProduct);
    const trimmedRemark = dispatchForm.remark.trim();

    if (!dispatchForm.readyQuantity.trim() || !Number.isFinite(enteredReadyQuantity)) {
      setDispatchFormError("Ready quantity is required.");
      return;
    }
    if (enteredReadyQuantity <= 0) {
      setDispatchFormError("Ready quantity must be greater than zero.");
      return;
    }
    if (enteredReadyQuantity > availableLeftQuantity) {
      setDispatchFormError("Ready quantity cannot exceed the currently available left quantity.");
      return;
    }
    if (!dispatchForm.status) {
      setDispatchFormError("Please select a status.");
      return;
    }
    if (!trimmedRemark) {
      setDispatchFormError("Remark is required.");
      return;
    }

    setDispatchSubmitting(true);
    setDispatchFormError("");
    try {
      const res = await fetch("/api/order-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: dispatchOrder.order_id,
          orderItemId: selectedDispatchProduct.orderdata_id,
          sku: selectedDispatchProduct.orderdata_cat_no,
          dispatchQuantity: enteredReadyQuantity,
          status: dispatchStatusForApi(dispatchForm.status),
          remark: trimmedRemark,
          dealerId: dispatchOrder.order_dealer,
          assignedStaffId: dispatchOrder.staffid,
          delStatus: dispatchOrder.del_status,
          orderedQuantity: selectedDispatchProduct.orderdata_item_quantity,
          legacyReadyQuantity: selectedDispatchProduct.readyquantity,
          legacyStatus: selectedDispatchProduct.orderdata_status,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.success === false) throw new Error(json?.message || "Failed to save dispatch update.");
      showToast("success", "Dispatch details updated.");
      setDispatchForm(previous => ({ ...previous, readyQuantity: "", remark: "" }));
      await Promise.all([
        loadDispatchProducts(dispatchOrder.order_id, selectedDispatchProduct.orderdata_id),
        loadDispatchHistory(selectedDispatchProduct.orderdata_id),
      ]);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    } catch (error) {
      setDispatchFormError(error instanceof Error ? error.message : "Failed to save dispatch update. Please try again.");
    } finally {
      setDispatchSubmitting(false);
    }
  }, [
    dispatchForm.readyQuantity,
    dispatchForm.remark,
    dispatchForm.status,
    dispatchOrder,
    loadDispatchHistory,
    loadDispatchProducts,
    queryClient,
    selectedDispatchProduct,
  ]);

  // ── CSV export ──────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const rows = orders.map((o, i) => {
      const amounts = withDisplayOrderAmounts(o, overrideFor(o));
      const customDiscountSummary = customDiscountProgressMap[getCustomDiscountProgressKeyForOrder(o.order_id)];
      const base: Record<string, string | number> = {
        "S.No.":        (page - 1) * pageSize + i + 1,
        "Order No":     formatDisplayOrderNumber(o.order_id),
        "Date":         (o.orderDate || o.order_date || "").slice(0, 10),
        "Due Date":     o.outstandingDate || "",
        "Amount (₹)":   amounts.grossAmount,
        "Discount (₹)": amounts.discountAmount,
        "Net (₹)":      amounts.netPayableAmount,
        "Qty":          o.orderdata_item_quantity || "",
        "Confirmation": o.accept_order === "1" ? "Accepted" : "Awaiting",
        "Status":       statusConf[Number(o.orderdata_status)]?.label ?? "Pending",
        "MT Status":    mtConf[mtStatusValue(o.mtstatus)].label,
      };
      if (showCustomDiscount) {
        base["Custom Discount Status"] = customDiscountSummary?.customDiscountStatus === "completely"
          ? "Completely"
          : customDiscountSummary?.customDiscountStatus === "partially"
            ? "Partially"
            : "—";
      }
      base["Discount Breakdown"] = getCompactOrderDiscountRows(amounts)
        .map(row => row.amount === undefined ? row.label : `${row.label} - ${formatMoney(row.amount, 2)}`)
        .join(" | ");
      if (showDealerCol) base["Dealer"] = o.Dealer_Name || "";
      return base;
    });
    if (!rows.length) return;

    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(","),
      ...rows.map(r => headers.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;

    const parts = ["orders"];
    if (filters.dealer)     parts.push(`dealer-${filters.dealer.replace(/\s+/g, "-")}`);
    if (filters.orderId)    parts.push(`id-${filters.orderId}`);
    if (filters.dateFrom || filters.dateTo) parts.push(`${filters.dateFrom || "start"}-to-${filters.dateTo || "now"}`);
    if (filters.accepted)   parts.push(filters.accepted === "1" ? "accepted" : "awaiting");
    if (filters.orderStatus) parts.push((statusConf[Number(filters.orderStatus)]?.label ?? filters.orderStatus).toLowerCase().replace(/\s+/g, "-"));
    if (filters.mtStatus)   parts.push(mtConf[filters.mtStatus]?.label.toLowerCase().replace(/\s+/g, "-") ?? filters.mtStatus);
    if (filters.amountMin || filters.amountMax) parts.push(`amt-${filters.amountMin || "0"}-${filters.amountMax || "max"}`);
    parts.push(new Date().toISOString().slice(0, 10));

    a.download = `${parts.join("_")}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast("success", `Exported ${rows.length} order${rows.length !== 1 ? "s" : ""}.`);
  };

  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce<(number | "…")[]>((acc, p, i, arr) => {
      if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("…");
      acc.push(p); return acc;
    }, []);

  const colCount = 12 + (showDealerCol ? 1 : 0) + (showCustomDiscount ? 1 : 0) + (showActions ? 1 : 0);
  const cancelledColCount = showDealerCol ? 8 : 7;
  const thCls = "px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 whitespace-nowrap";
  // Only the selected tab carries a count — the other section's query is
  // disabled, so its total isn't loaded.

  return (
    <>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(12px) scale(0.97); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }
        .dispatch-overlay { position: fixed; inset: 0; z-index: 80; background: rgba(15, 23, 42, 0.28); backdrop-filter: blur(5px); display: flex; justify-content: flex-end; }
        .dispatch-drawer { width: min(1120px, 100%); height: 100%; background: #f8fafc; box-shadow: -18px 0 40px rgba(15, 23, 42, 0.16); display: flex; flex-direction: column; }
        .dispatch-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 24px 28px 20px; border-bottom: 1px solid #e2e8f0; background: #fff; }
        .dispatch-kicker { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #64748b; margin-bottom: 8px; }
        .dispatch-title { font-size: 22px; font-weight: 700; color: #0f172a; line-height: 1.15; }
        .dispatch-subtitle { font-size: 13px; color: #64748b; margin-top: 4px; }
        .dispatch-close { width: 38px; height: 38px; border-radius: 12px; border: 1px solid #e2e8f0; background: #fff; color: #475569; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s; }
        .dispatch-close:hover { background: #f8fafc; color: #0f172a; border-color: #cbd5e1; }
        .dispatch-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(340px, 0.92fr); gap: 20px; padding: 20px 28px 28px; overflow: hidden; }
        .dispatch-products, .dispatch-editor { min-height: 0; display: flex; flex-direction: column; gap: 14px; }
        .dispatch-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .dispatch-section-head h3 { font-size: 15px; font-weight: 700; color: #0f172a; }
        .dispatch-section-head span { font-size: 11px; color: #64748b; font-family: 'JetBrains Mono', monospace; }
        .dispatch-product-list, .dispatch-history-list { overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding-right: 4px; }
        .dispatch-product-card, .dispatch-form-card, .dispatch-history-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 18px; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04); }
        .dispatch-product-card { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
        .dispatch-product-card.is-selected { border-color: #818cf8; box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.14); }
        .dispatch-product-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
        .dispatch-product-index { display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 24px; border-radius: 999px; background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
        .dispatch-cat-pill, .dispatch-line-id, .dispatch-history-status { display: inline-flex; align-items: center; padding: 4px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
        .dispatch-cat-pill { background: #fef3c7; color: #92400e; }
        .dispatch-line-id { background: #eef2ff; color: #4338ca; font-family: 'JetBrains Mono', monospace; }
        .dispatch-history-status { background: #eff6ff; color: #1d4ed8; }
        .dispatch-product-name { font-size: 14px; font-weight: 700; color: #111827; }
        .dispatch-product-desc { font-size: 12px; color: #64748b; margin-top: 4px; line-height: 1.5; }
        .dispatch-product-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
        .dispatch-product-grid span, .dispatch-history-meta span { font-size: 11px; color: #475569; font-family: 'JetBrains Mono', monospace; }
        .dispatch-original-note { margin-top: 12px; padding: 12px; border-radius: 14px; background: #f8fafc; border: 1px solid #e2e8f0; }
        .dispatch-original-note-label { display: block; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; margin-bottom: 6px; }
        .dispatch-original-note p { font-size: 12px; color: #334155; line-height: 1.5; }
        .dispatch-select-btn, .dispatch-submit-btn { border: none; cursor: pointer; font-family: inherit; font-weight: 600; transition: all 0.15s; }
        .dispatch-select-btn { align-self: flex-start; padding: 9px 14px; border-radius: 12px; background: #eef2ff; color: #4338ca; }
        .dispatch-select-btn:hover { background: #e0e7ff; }
        .dispatch-form-card, .dispatch-history-card { padding: 16px; }
        .dispatch-form-card { display: flex; flex-direction: column; gap: 14px; }
        .dispatch-form-row { display: flex; flex-direction: column; gap: 6px; }
        .dispatch-form-row label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; }
        .dispatch-form-row input, .dispatch-form-row select, .dispatch-form-row textarea { width: 100%; border-radius: 12px; border: 1px solid #dbe2ee; background: #fff; padding: 11px 12px; font-size: 13px; font-family: inherit; color: #0f172a; outline: none; transition: border-color 0.15s, box-shadow 0.15s; }
        .dispatch-form-row input:focus, .dispatch-form-row select:focus, .dispatch-form-row textarea:focus { border-color: #818cf8; box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.14); }
        .dispatch-form-row input[disabled], .dispatch-form-row select[disabled], .dispatch-form-row textarea[disabled] { background: #f8fafc; color: #64748b; cursor: not-allowed; }
        .dispatch-submit-btn { padding: 11px 16px; border-radius: 12px; background: #1d4ed8; color: #fff; }
        .dispatch-submit-btn:hover:not(:disabled) { background: #1e40af; }
        .dispatch-submit-btn:disabled { opacity: 0.55; cursor: wait; }
        .dispatch-history-card { display: flex; flex-direction: column; gap: 14px; min-height: 0; }
        .dispatch-history-item { padding: 12px; border-radius: 14px; background: #f8fafc; border: 1px solid #e2e8f0; }
        .dispatch-history-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
        .dispatch-history-remark { font-size: 12px; color: #1f2937; line-height: 1.5; }
        .dispatch-history-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; flex-wrap: wrap; }
        .dispatch-empty, .dispatch-error { padding: 16px; border-radius: 14px; font-size: 12.5px; }
        .dispatch-empty { background: #fff; border: 1px dashed #dbe2ee; color: #64748b; }
        .dispatch-error { background: #fff1f2; border: 1px solid #fecdd3; color: #be123c; }
        @media (max-width: 1100px) {
          .dispatch-layout { grid-template-columns: 1fr; overflow-y: auto; }
          .dispatch-drawer { width: 100%; }
        }
      `}</style>

      <div className="min-h-screen bg-gray-50" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>

        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between gap-6 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.back()}
              aria-label="Go back"
              className="flex items-center justify-center w-8 h-8 shrink-0 rounded-lg border border-gray-200 bg-gray-50 text-gray-600 transition-all hover:bg-gray-100 hover:text-gray-900"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </button>
            <div className="min-w-0">
              <h1 className="text-[19px] font-bold text-gray-900 leading-tight">Order History</h1>
              <p className="text-[12.5px] text-gray-500 mt-0.5 flex items-center gap-2">
                {isLoading ? "Loading…" : `${totalCount.toLocaleString()} ${filtersActive ? "matching" : "total"} order${totalCount === 1 ? "" : "s"}`}
                {isFetching && !isLoading && (
                  <span className="inline-flex items-center gap-1 text-indigo-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping inline-block" />
                    refreshing
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <form onSubmit={handleSearch} className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search orders…"
                aria-label="Search orders"
                className="pl-9 pr-8 py-2 text-[13px] text-gray-900 border border-gray-200 rounded-xl bg-gray-50 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all w-56 placeholder:text-gray-400"
              />
              {(search || query) && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => { setSearch(""); setQuery(""); setFilters(prev => ({ ...prev, dealer: "" })); setPage(1); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-4 rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-colors"
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              )}
            </form>

            <button
              onClick={() => setShowInvoiceModal(true)}
              className="flex items-center gap-2 px-3.5 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-[13px] font-semibold rounded-xl transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              Invoices
            </button>

            <ExportButton
              orders={ordersForExport}
              dealerName={data?.data?.[0]?.Dealer_Name || "Unknown"}
              dealerId={dealerId}
              isLoading={isLoading}
              onExportCsv={exportCSV}
            />
          </div>
        </div>

        <div className="px-8 py-6 max-w-[1840px] mx-auto">

          {/* Section tabs + RSM approval scope */}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <SegmentedTabs
              label="Order section"
              value={section}
              onChange={next => { setSection(next as "active" | "cancelled"); setPage(1); }}
              items={[
                {
                  value: "active",
                  label: "Active Orders",
                  tone: "emerald",
                  title: "Orders currently in the pipeline",
                  count: section === "active" && !isLoading && !isError ? totalCount : null,
                  icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 7h18M3 12h18M3 17h11" /></svg>,
                },
                {
                  value: "cancelled",
                  label: "Cancelled & Declined",
                  tone: "rose",
                  title: "Orders that have been cancelled or declined",
                  count: section === "cancelled" && !cancelledLoading && !cancelledError ? totalCount : null,
                  icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></svg>,
                },
              ]}
            />

            {actorRole === "admin" && section === "active" && (
              <SegmentedTabs
                label="Warehouse"
                value={warehouse}
                onChange={next => { setWarehouse(next); setPage(1); }}
                items={[{ value: "", label: "All" }, ...WAREHOUSE_OPTIONS].map(option => ({
                  value: option.value,
                  label: option.label,
                  tone: option.value ? "amber" : "neutral",
                  title: option.value ? `Orders dispatched from ${option.label}` : "Orders from every warehouse",
                  count: warehouse === option.value && !isLoading && !isError ? totalCount : null,
                  icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21V9l9-5 9 5v12" /><path d="M9 21v-6h6v6" /></svg>,
                } satisfies SegItem))}
              />
            )}

            {isRsm && section === "active" && (
              <SegmentedTabs
                label="Approval scope"
                value={rsmOnlyAwaiting ? "awaiting" : "all"}
                onChange={next => { setRsmOnlyAwaiting(next === "awaiting"); setPage(1); }}
                items={[
                  {
                    value: "awaiting",
                    label: "Awaiting my approval",
                    tone: "amber",
                    title: "Only orders waiting on your approval",
                    count: awaitingApprovalCount > 0 ? awaitingApprovalCount : null,
                    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
                  },
                  {
                    value: "all",
                    label: "All team orders",
                    tone: "neutral",
                    title: "Every order across your team",
                    icon: (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M16 19v-1.5a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3V19" /><circle cx="9.5" cy="7.5" r="3" /><path d="M21 19v-1.5a3 3 0 0 0-2.25-2.9M16 4.6a3 3 0 0 1 0 5.8" />
                      </svg>
                    ),
                  },
                ]}
              />
            )}

            {/* Acceptance split for the rows actually on screen */}
            {section === "active" && !isLoading && !isError && orders.length > 0 && (
              <div className="ml-auto flex items-center gap-3 text-[12px] text-gray-500">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                  {orders.filter(o => o.accept_order === "1").length} accepted
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  {orders.filter(o => o.accept_order === "0").length} awaiting
                </span>
                <span className="text-gray-400">on this page</span>
              </div>
            )}
          </div>

          {selectedOrdersForBilling.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
              <div className="text-[13px] font-semibold text-blue-900">
                Selected Orders: {selectedOrdersForBilling.length}
                <span className="ml-3 font-mono">Selected Total: {formatMoney(selectedBillingTotal)}</span>
              </div>
              <button
                type="button"
                onClick={handleBulkBillingUpload}
                disabled={bulkBilling}
                className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {bulkBilling ? "Saving..." : `Save ${selectedOrdersForBilling.length} Invoice${selectedOrdersForBilling.length === 1 ? "" : "s"}`}
              </button>
            </div>
          )}
          {filtersActive && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Filters</span>
              {filters.orderId && <FilterTag label={`Order: ${filters.orderId}…`} onRemove={() => setFilter("orderId", "")} />}
              {filters.dealer && <FilterTag label={`Dealer: ${filters.dealer}`} onRemove={() => setDealerFilter("")} />}
              {(filters.dateFrom || filters.dateTo) && (
                <FilterTag
                  label={`${filters.dateFrom || "start"} → ${filters.dateTo || "now"}`}
                  onRemove={() => { setFilters(prev => ({ ...prev, dateFrom: "", dateTo: "" })); setPage(1); }}
                />
              )}
              {(filters.amountMin || filters.amountMax) && (
                <FilterTag
                  label={`₹${filters.amountMin || "0"}–₹${filters.amountMax || "∞"}`}
                  onRemove={() => { setFilters(prev => ({ ...prev, amountMin: "", amountMax: "" })); setPage(1); }}
                />
              )}
              {filters.orderStatus && (
                <FilterTag
                  label={statusConf[Number(filters.orderStatus)]?.label ?? filters.orderStatus}
                  onRemove={() => setFilter("orderStatus", "")}
                />
              )}
              {filters.accepted && (
                <FilterTag label={filters.accepted === "1" ? "Accepted" : "Awaiting"} onRemove={() => setFilter("accepted", "")} />
              )}
              {filters.mtStatus && (
                <FilterTag label={mtConf[filters.mtStatus]?.label ?? filters.mtStatus} onRemove={() => setFilter("mtStatus", "")} />
              )}
              <button type="button" onClick={clearFilters} className="text-[11px] text-gray-500 underline hover:text-gray-800">
                Clear all
              </button>
            </div>
          )}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">

            {section === "active" && isError && (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
                </svg>
                <p className="text-sm text-gray-600">
                  {sessionExpired
                    ? "Your session has expired. Please sign in again."
                    : "Failed to load orders. Please try again."}
                </p>
                {sessionExpired ? (
                  <button
                    type="button"
                    onClick={() => router.push("/auth/login")}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
                  >
                    Sign in
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => refetch()}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}

            {section === "cancelled" && cancelledError && (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
                </svg>
                <p className="text-sm text-gray-600">Failed to load cancelled orders. Please try again.</p>
              </div>
            )}

            {/* ── Cancelled & Declined table ── */}
            {section === "cancelled" && !cancelledError && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className={thCls}>#</th>
                      <th className={thCls}>Order No.</th>
                      {showDealerCol && <th className={thCls}>Dealer</th>}
                      <th className={thCls}>Date</th>
                      <th className={thCls}>Reason / Note</th>
                      <th className={thCls}>Actioned By</th>
                      <th className={thCls}>Status</th>
                      <th className={thCls}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cancelledLoading
                      ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={cancelledColCount} />)
                      : cancelledData.length === 0
                        ? (
                          <tr><td colSpan={cancelledColCount}>
                            <div className="flex flex-col items-center justify-center py-16 gap-3">
                              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.2" strokeLinecap="round">
                                <circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" />
                              </svg>
                              <p className="text-sm text-gray-600">No cancelled or declined orders found</p>
                            </div>
                          </td></tr>
                        )
                        : cancelledData.map((order, i) => (
                          <tr key={order.id || order.orderId} className="odd:bg-white even:bg-gray-50/50 hover:bg-blue-50/40 transition-colors">
                            <td className="px-4 py-3.5 text-gray-700 font-medium">{String((page - 1) * pageSize + i + 1).padStart(2, "0")}</td>
                            <td className="px-4 py-3.5">
                              <span className="font-mono text-[13px] font-bold text-indigo-700">
                                {order.formattedOrderNumber || formatDisplayOrderNumber(order.orderId)}
                              </span>
                            </td>
                            {showDealerCol && (
                              <td className="px-4 py-3.5">
                                <p className="text-[13px] font-medium text-gray-900">{order.dealerName || (order.originalOrderRef?.Dealer_Name as string) || "Dealer"}</p>
                                <p className="text-[11px] text-gray-500 font-mono mt-0.5">ID: {order.dealerId}</p>
                              </td>
                            )}
                            <td className="px-4 py-3.5 font-mono text-[12px] text-gray-700">
                              {((order.decline?.declinedAt || order.cancellation?.cancelledAt) || "").slice(0, 10) || "—"}
                            </td>
                            <td className="px-4 py-3.5 max-w-[360px] text-[13px] text-gray-700">
                              {order.outcome === "declined" ? (order.decline?.note || "—") : (order.cancellation?.reason || "—")}
                              {order.outcome === "declined" && (
                                <p className="mt-1 text-[11px] text-red-700">Declined at {order.decline?.stage === "rsm" ? "RSM" : "staff"} stage</p>
                              )}
                            </td>
                            <td className="px-4 py-3.5 font-mono text-[12px] text-gray-700">
                              {order.outcome === "declined"
                                ? (order.decline?.declinedBy?.name || order.decline?.declinedBy?.role || "Reviewer")
                                : (order.cancellation?.cancelledBy?.name || order.cancellation?.cancelledBy?.id || "Dealer")}
                            </td>
                            <td className="px-4 py-3.5">
                              <span className={`${pillCls} bg-red-50 text-red-700 border-red-200`}>
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-500" />
                                {order.outcome === "declined" ? "Declined" : "Cancelled"}
                              </span>
                            </td>
                            <td className="px-4 py-3.5">
                              <button
                                onClick={() => router.push(`/orders/${order.orderId}`)}
                                className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 text-[12px] font-semibold hover:bg-gray-50 transition-colors"
                              >
                                View order
                              </button>
                            </td>
                          </tr>
                        ))
                    }
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Active orders table ── */}
            {section === "active" && !isError && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 align-top">
                      <th className={`${thCls} w-px`} title="Select for bulk invoicing">Bill</th>
                      <th className={`${thCls} w-px`}>#</th>
                      <th className={thCls}>
                        Order No.
                        <input
                          type="text"
                          value={filters.orderId}
                          onChange={e => setFilter("orderId", e.target.value)}
                          placeholder="e.g. 45…"
                          maxLength={12}
                          autoComplete="off"
                          aria-label="Filter by order number"
                          className={`w-[96px] ${filterInputCls(!!filters.orderId)}`}
                        />
                      </th>
                      {showDealerCol && (
                        <th className={thCls}>
                          Dealer
                          <input
                            type="text"
                            value={filters.dealer}
                            onChange={e => setDealerFilter(e.target.value)}
                            placeholder="Search…"
                            autoComplete="off"
                            aria-label="Filter by dealer"
                            className={`w-[130px] ${filterInputCls(!!filters.dealer)}`}
                          />
                        </th>
                      )}
                      <th className={thCls}>
                        Date
                        <div className="flex gap-1">
                          <input
                            type="date"
                            value={filters.dateFrom}
                            onChange={e => setFilter("dateFrom", e.target.value)}
                            aria-label="Filter orders from date"
                            className={`w-[124px] ${filterInputCls(!!filters.dateFrom)}`}
                          />
                          <input
                            type="date"
                            value={filters.dateTo}
                            onChange={e => setFilter("dateTo", e.target.value)}
                            aria-label="Filter orders up to date"
                            className={`w-[124px] ${filterInputCls(!!filters.dateTo)}`}
                          />
                        </div>
                      </th>
                      <th className={thCls}>
                        Gross
                        <div className="flex gap-1">
                          <input
                            type="number"
                            value={filters.amountMin}
                            onChange={e => setFilter("amountMin", e.target.value)}
                            placeholder="Min"
                            aria-label="Filter by minimum gross amount"
                            className={`w-[64px] ${filterInputCls(!!filters.amountMin)}`}
                          />
                          <input
                            type="number"
                            value={filters.amountMax}
                            onChange={e => setFilter("amountMax", e.target.value)}
                            placeholder="Max"
                            aria-label="Filter by maximum gross amount"
                            className={`w-[64px] ${filterInputCls(!!filters.amountMax)}`}
                          />
                        </div>
                      </th>
                      {["Discount", "Net Payable", "Units"].map(h => (
                        <th key={h} className={thCls}>{h}</th>
                      ))}
                      <th className={thCls}>
                        Status
                        <select
                          value={filters.orderStatus}
                          onChange={e => setFilter("orderStatus", e.target.value)}
                          aria-label="Filter by order status"
                          className={`w-[124px] ${filterInputCls(!!filters.orderStatus)}`}
                        >
                          <option value="">Any</option>
                          {Object.entries(statusConf).map(([value, conf]) => (
                            <option key={value} value={value}>{conf.label}</option>
                          ))}
                        </select>
                      </th>
                      <th className={thCls}>
                        Confirmation
                        <select
                          value={filters.accepted}
                          onChange={e => setFilter("accepted", e.target.value)}
                          aria-label="Filter by confirmation"
                          className={`w-[110px] ${filterInputCls(!!filters.accepted)}`}
                        >
                          <option value="">Any</option>
                          <option value="1">Accepted</option>
                          <option value="0">Awaiting</option>
                        </select>
                      </th>
                      <th className={thCls}>
                        MT Status
                        <select
                          value={filters.mtStatus}
                          onChange={e => setFilter("mtStatus", e.target.value)}
                          aria-label="Filter by MT status"
                          className={`w-[130px] ${filterInputCls(!!filters.mtStatus)}`}
                        >
                          <option value="">Any</option>
                          <option value="Pending">Pending</option>
                          <option value="Partial">Partial</option>
                          <option value="Completed">Completed</option>
                        </select>
                      </th>
                      {showCustomDiscount && <th className={thCls}>Custom Discount</th>}
                      <th className={thCls}>Outstanding</th>
                      {showActions && <th className={thCls}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading
                      ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={colCount} />)
                      : orders.length === 0
                        ? (
                          <tr><td colSpan={colCount}>
                            <div className="flex flex-col items-center justify-center py-16 gap-3">
                              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.2" strokeLinecap="round">
                                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                                <rect x="9" y="3" width="6" height="4" rx="1" />
                              </svg>
                              <p className="text-sm text-gray-600">{filtersActive ? "No orders match the current filters" : "No orders found"}</p>
                            </div>
                          </td></tr>
                        )
                        : orders.map((order, idx) => {
                          const isDeleted = !!(order.reason);
                          const oid = order.order_id ?? "";
                          const noteOverlay = orderNotes[oid];
                          const historyNote = extractOrderNote(order, noteOverlay?.note);
                          const displayOrder = withDisplayOrderAmounts(order, overrideFor(order));
                          const discountBadge = formatAdditionalDiscountBadge(displayOrder);
                          const additionalDiscount = resolveAdditionalDiscountDisplay(displayOrder);
                          const rsmStatus = rsmApprovalValue(order);
                          const reviewedBy = order.rsmReviewedBy || order.rsm_reviewed_by;
                          const customDiscountSummary = customDiscountProgressMap[getCustomDiscountProgressKeyForOrder(oid)];
                          // An RSM reviews the order first; assigned staff can only accept
                          // once that review has cleared, matching the server-side gate.
                          const showAccept = isRsm
                            ? rsmStatus === "AWAITING" || rsmStatus === ""
                            : canAcceptOrder(order) && (actorRole !== "staff" || rsmStatus === "ACCEPTED");

                          return (
                            <tr key={oid || idx} className={`odd:bg-white even:bg-gray-50/50 hover:bg-blue-50/40 transition-colors ${isDeleted ? "opacity-60" : ""} ${selectedBillingOrderIds.has(String(oid)) ? "!bg-blue-50/70" : ""}`}>
                              <td className="px-4 py-3.5">
                                <input
                                  type="checkbox"
                                  checked={selectedBillingOrderIds.has(String(oid))}
                                  disabled={isDeleted || !isBillingEligible(order) || bulkBilling}
                                  onChange={(event) => toggleBillingOrder(order, event.target.checked)}
                                  aria-label={`Select order ${oid} for billing`}
                                  className="h-4 w-4 rounded border-gray-300 text-blue-600 disabled:opacity-30"
                                />
                              </td>
                              <td className="px-4 py-3.5 text-gray-700 font-medium">
                                {String((page - 1) * pageSize + idx + 1).padStart(2, "0")}
                              </td>
                              <td className="px-4 py-3.5">
                                <div className="flex items-center gap-2">
                                  <span
                                    className="font-mono text-[13px] font-bold text-indigo-700"
                                    dangerouslySetInnerHTML={{ __html: formatDisplayOrderNumber(highlight(String(oid), filters.orderId)) }}
                                  />
                                  {isDeleted && (
                                    <span className="px-1.5 py-0.5 bg-red-50 border border-red-200 text-red-700 rounded text-[10px] font-bold">DELETED</span>
                                  )}
                                </div>
                                {historyNote && (
                                  <p className="mt-1 max-w-[320px] truncate text-[11px] text-gray-500" title={historyNote}>
                                    Note: {historyNote}
                                  </p>
                                )}
                              </td>
                              {showDealerCol && (
                                <td className="px-4 py-3.5">
                                  <p
                                    className="text-[13px] font-medium text-gray-900"
                                    dangerouslySetInnerHTML={{ __html: highlight(order.Dealer_Name || "—", filters.dealer) }}
                                  />
                                  <p className="text-[11px] text-gray-500 font-mono mt-0.5">ID: {order.order_dealer}</p>
                                </td>
                              )}
                              <td className="px-4 py-3.5">
                                <p className="text-[13px] text-gray-900 font-medium">{moment(order.order_date).format("DD MMM YYYY")}</p>
                                <p className="text-[11px] text-gray-600 font-mono mt-0.5">{moment(order.order_date).format("hh:mm A")}</p>
                              </td>
                              <td className="px-4 py-3.5 font-mono text-[14px] font-bold text-gray-900">
                                {formatMoney(displayOrder.grossAmount)}
                              </td>
                              <td className="px-4 py-3.5 font-mono text-[13px] text-amber-700">
                                {displayOrder.discountAmount > 0 ? `−${formatMoney(displayOrder.discountAmount)}` : "—"}
                                {additionalDiscount ? (
                                  <>
                                    <p className="mt-1 text-[11px] font-semibold text-indigo-600">{additionalDiscount.label}</p>
                                    <p className="text-[11px] text-indigo-600">{additionalDiscount.amountText}</p>
                                  </>
                                ) : (
                                  discountBadge && <p className="mt-1 text-[11px] font-semibold text-indigo-600">{discountBadge}</p>
                                )}
                              </td>
                              <td className="px-4 py-3.5 font-mono text-[14px] font-bold text-emerald-700">
                                {formatMoney(displayOrder.netPayableAmount)}
                              </td>
                              <td className="px-4 py-3.5">
                                <span className="px-2 py-0.5 bg-gray-100 text-gray-800 rounded-lg text-[12px] font-mono font-semibold">
                                  {order.orderdata_item_quantity} units
                                </span>
                              </td>
                              <td className="px-4 py-3.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <OrderStatusBadge status={order.orderdata_status} />
                                  <SettlementBadge settlement={(order as any).settlement} />
                                </div>
                              </td>
                              <td className="px-4 py-3.5">
                                <AcceptBadge accepted={order.accept_order} />
                                {rsmStatus === "ACCEPTED" && (
                                  <p className="mt-1 text-[11px] font-semibold text-emerald-700">RSM Approved{reviewedBy ? ` by ${reviewedBy}` : ""}</p>
                                )}
                                {rsmStatus === "DECLINED" && (
                                  <p className="mt-1 text-[11px] font-semibold text-rose-700">RSM Disapproved{reviewedBy ? ` by ${reviewedBy}` : ""}</p>
                                )}
                                {rsmStatus === "AWAITING" && (
                                  <p className="mt-1 text-[11px] font-semibold text-amber-700">Awaiting RSM approval</p>
                                )}
                              </td>
                              <td className="px-4 py-3.5">
                                <MtStatusBadge status={order.mtstatus} />
                                <p className="mt-1 text-[11px] text-gray-500 font-mono">
                                  Total: {order.orderdata_item_quantity} · Dispatch: {order.readyquantity ?? 0}
                                </p>
                                {order.reason && <p className="mt-1 text-[11px] font-semibold text-red-700">⚠ {order.reason}</p>}
                              </td>
                              {showCustomDiscount && (
                                <td className="px-4 py-3.5">
                                  <CustomDiscountBadge progress={customDiscountSummary?.customDiscountStatus ?? null} />
                                </td>
                              )}
                              <td className="px-4 py-3.5 font-mono text-[12px] text-gray-700">
                                {order.outstandingDate ? moment(order.outstandingDate).format("DD MMM YYYY") : "—"}
                              </td>

                              {/* Actions — collapsed into a single 3-dot menu */}
                              {showActions && (
                                <td className="px-4 py-3.5 w-px whitespace-nowrap">
                                  <div className="flex items-center justify-end">
                                    <RowActionsMenu
                                      order={displayOrder}
                                      role={actorRole}
                                      actorId={actorId}
                                      isDeleted={isDeleted}
                                      showAccept={showAccept}
                                      showDelete={canDeleteOrder(order)}
                                      // ponytail: dispatch drawer stays wired off, exactly as it was on
                                      // the old page. Flip both flags to enable it.
                                      showDispatch={false}
                                      dispatchDisabled={true}
                                      rsmMode={isRsm}
                                      onView={() => router.push(`/orders/${oid}`)}
                                      onAccept={() => handleAccept(oid, 1)}
                                      onDecline={() => { setDeclineTarget(oid); setDeclineNote(""); }}
                                      onDispatch={() => openDispatchDetails(order)}
                                      onDelete={() => setDeleteOrderId(oid)}
                                    />
                                  </div>
                                </td>
                              )}
                            </tr>
                          );
                        })
                    }
                  </tbody>
                </table>
              </div>
            )}

            {!isLoading && !isError && totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50">
                <div className="flex items-center gap-4 flex-wrap">
                  <p className="text-[13px] text-gray-700 font-medium">
                    Page {page} of {totalPages} · <span className="text-gray-600">{totalCount} orders</span>
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold text-gray-500">Show</span>
                    {ORDER_PAGE_SIZE_OPTIONS.map(size => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => { setPageSize(size); setPage(1); }}
                        className={`h-8 min-w-9 px-2.5 rounded-lg border text-[12px] font-semibold transition-all ${pageSize === size ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"}`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all font-medium">‹</button>
                  {pageNums.map((p, i) => p === "…"
                    ? <span key={`d${i}`} className="w-8 h-8 flex items-center justify-center text-gray-500 text-[13px]">…</span>
                    : <button key={p} onClick={() => setPage(p as number)}
                      className={`w-8 h-8 flex items-center justify-center rounded-lg text-[13px] font-semibold border transition-all ${page === p ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 text-gray-700 hover:bg-white"}`}>{p}</button>
                  )}
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all font-medium">›</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div className={`fixed bottom-4 left-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-medium shadow-lg border ${
          toast.type === "success" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"
        }`}>
          {toast.text}
        </div>
      )}
      {deleteOrderId && (
        <DeleteModal orderId={deleteOrderId} onConfirm={handleDelete} onClose={() => setDeleteOrderId(null)} />
      )}
      {declineTarget && (
        <DeclineModal
          note={declineNote}
          saving={declineSaving}
          onNoteChange={setDeclineNote}
          onConfirm={submitDecline}
          onClose={() => { setDeclineTarget(null); setDeclineNote(""); }}
        />
      )}

      <DispatchDetailsDrawer
        order={dispatchOrder}
        products={dispatchProducts}
        loadingProducts={dispatchProductsLoading}
        productsError={dispatchProductsError}
        selectedProductId={selectedDispatchProductId}
        onSelectProduct={setSelectedDispatchProductId}
        history={dispatchHistory}
        historyLoading={dispatchHistoryLoading}
        historyError={dispatchHistoryError}
        form={dispatchForm}
        formError={dispatchFormError}
        submitting={dispatchSubmitting}
        onFormChange={handleDispatchFormChange}
        onSubmit={handleDispatchSubmit}
        onClose={closeDispatchDetails}
      />

      <InvoiceModal
        dealerId={dealerId}
        isOpen={showInvoiceModal}
        onClose={() => setShowInvoiceModal(false)}
      />
    </>
  );
}
