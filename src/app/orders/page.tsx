"use client";

import { useState, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import moment from "moment";
import { exportOrdersToCloud, downloadPDFDirectly } from "@/lib/Exporttopdf";
import { InvoiceModal } from "@/components/InvoiceModel";
import { downloadOrderInvoice, uploadOrderInvoice, generateOrderInvoicePDF, listInvoices } from "@/lib/invoicegenerator";
import { formatAdditionalDiscountBadge, withDisplayOrderAmounts } from "@/lib/orderAmounts";
import { formatDisplayOrderNumber } from '@/lib/orderDisplay';
import { useAuthSession } from "@/hooks/useAuthSession";
import type { AppRole } from "@/lib/roleAccess";

// ─── Types ────────────────────────────────────────────────────────────────────
type Order = {
  order_id: string;
  order_date: string;
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
};
type ApiResponse = { msg: string; count: number; status: boolean; data: Order[] };
type OrderNoteOverlay = {
  note?: string;
};
type OrderSummaryOverride = {
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



function formatMoney(amount: number) {
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function extractOrderNote(order: Order, overlayNote?: string) {
  if (overlayNote) return overlayNote;
  const direct = order.order_note || order.note;
  if (direct?.trim()) return direct.trim();
  const remarks = [order.remark, order.remarks].filter(Boolean).join(" | ");
  return remarks.match(/Order note:\s*([^|]+)/i)?.[1]?.trim() || "";
}

type OrderFilters = {
  orderId: string;
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
  orderStatus: string;
};

const EMPTY_FILTERS: OrderFilters = { orderId: "", dateFrom: "", dateTo: "", amountMin: "", amountMax: "", orderStatus: "" };

function hasActiveFilters(f: OrderFilters) {
  return Object.values(f).some(v => v !== "");
}

async function fetchOrders(page: number, pageSize: number, search: string, filters: OrderFilters, role: AppRole, actorId: string): Promise<ApiResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(pageSize), search });
  if (filters.orderId)     params.set("order_id",   filters.orderId);
  if (filters.dateFrom)    params.set("date_from",  filters.dateFrom);
  if (filters.dateTo)      params.set("date_to",    filters.dateTo);
  if (filters.amountMin)   params.set("amount_min", filters.amountMin);
  if (filters.amountMax)   params.set("amount_max", filters.amountMax);
  if (filters.orderStatus) params.set("order_status", filters.orderStatus);

  const url = `/api/orders-data?${params.toString()}`;
  const r = await fetch(url, { cache: "no-store" });

  if (!r.ok) {
    const errorBody = parseResponseText(await r.text());
    console.error("[orders-data] request failed", { url, page, pageSize, search, filters, role, actorId, errorBody });
    throw new Error("Failed");
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

/** Wallet settlement applied to this order by the Accountant, if any. */
function SettlementBadge({ settlement }: { settlement?: { status?: string } | null }) {
  const status = settlement?.status;
  if (status !== "settled" && status !== "part_settled") return null;
  const settled = status === "settled";
  return (
    <span
      title={settled ? "Fully settled from wallet advance" : "Partly settled from wallet advance"}
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
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
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {s.label}
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

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100">
      {[60, 120, 90, 80, 80, 90, 80, 100, 80, 160].map((w, i) => (
        <td key={i} className="px-4 py-4">
          <div className="h-3.5 bg-gray-100 rounded animate-pulse" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

// ─── Per-row Actions Menu — View / Invoice / Delete behind one 3-dot button ────
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

function RowActionsMenu({ order, role, actorId, isDeleted, onView, onDelete }: {
  order: Order;
  role: AppRole | null;
  actorId: string;
  isDeleted: boolean;
  onView: () => void;
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

  const accepted = (order as any).accept_order === "1" || Number(order.orderdata_status ?? 0) >= 4 || Number(order.mtstatus ?? 0) >= 2 || String(order.mtstatus ?? "").toLowerCase().includes("completed");

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
              className="w-full text-left px-4 py-2.5 text-[12px] text-gray-700 hover:bg-indigo-50 flex items-center gap-3 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span className="font-semibold">View order</span>
            </button>

            <div className="my-1 border-t border-gray-100" />

            <button
              role="menuitem"
              onClick={handleDownload}
              className="w-full text-left px-4 py-2.5 text-[12px] text-gray-700 hover:bg-blue-50 flex items-center gap-3 transition-colors"
            >
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
            <button
              role="menuitem"
              onClick={handleUpload}
              className="w-full text-left px-4 py-2.5 text-[12px] text-gray-700 hover:bg-emerald-50 flex items-center gap-3 transition-colors"
            >
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

            {!isDeleted && (
              <>
                <div className="my-1 border-t border-gray-100" />
                <button
                  role="menuitem"
                  onClick={() => { setMenuPos(null); onDelete(); }}
                  className="w-full text-left px-4 py-2.5 text-[12px] text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
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
}

function ExportButton({ orders, dealerName, dealerId, isLoading = false }: ExportButtonProps) {
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
            <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Export</>
          )}
        </button>
        {showMenu && (
          <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden">
            <button onClick={() => handleExport(false)} disabled={isExporting} className="w-full text-left px-4 py-3 text-[13px] text-gray-700 hover:bg-blue-50 disabled:opacity-50 border-b border-gray-100 transition-colors flex items-center gap-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <div><p className="font-medium">Download to Device</p><p className="text-[11px] text-gray-500 mt-0.5">Save PDF locally</p></div>
            </button>
            <button onClick={() => handleExport(true)} disabled={isExporting} className="w-full text-left px-4 py-3 text-[13px] text-gray-700 hover:bg-emerald-50 disabled:opacity-50 transition-colors flex items-center gap-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="1"/><path d="M12 1v6m0 6v6M4.22 4.22l4.24 4.24m0 5.08l-4.24 4.24M19.78 4.22l-4.24 4.24m0 5.08l4.24 4.24M1 12a11 11 0 0 1 22 0 11 11 0 0 1-22 0"/></svg>
              <div><p className="font-medium">Save to cloud</p><p className="text-[11px] text-gray-500 mt-0.5">Stored for later download</p></div>
            </button>
          </div>
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

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function OrderHistoryPage() {
  const router = useRouter();
  const auth = useAuthSession();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<OrderFilters>(EMPTY_FILTERS);
  const [year] = useState(new Date().getFullYear());
  const [deleteOrderId, setDeleteOrderId] = useState<string | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [orderNotes, setOrderNotes] = useState<Record<string, OrderNoteOverlay>>({});
  const [summaryOverrides, setSummaryOverrides] = useState<Record<string, OrderSummaryOverride>>({});
  const [selectedBillingOrderIds, setSelectedBillingOrderIds] = useState<Set<string>>(new Set());
  const [bulkBilling, setBulkBilling] = useState(false);
  const [bulkBillingToast, setBulkBillingToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const actorRole = !auth.loading && auth.session.status === "authenticated"
    ? auth.session.role
    : null;
  const actorId = !auth.loading && auth.session.status === "authenticated"
    ? actorRole === "dealer"
      ? String(auth.session.user.Dealer_Id ?? "").trim()
      : actorRole === "staff"
        ? String(auth.session.user.staff_id ?? "").trim()
        : String(auth.session.user.id ?? auth.session.user.admin_id ?? auth.session.user.Admin_Id ?? "").trim()
    : "";
  const dealerId = actorRole === "dealer" ? actorId : "";
  const actorReady = actorRole === "admin" || actorRole === "accountant" || Boolean(actorId);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["orders", actorRole, actorId, page, pageSize, query, filters],
    queryFn: () => fetchOrders(page, pageSize, query, filters, actorRole as AppRole, actorId),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled: !auth.loading && auth.session.status === "authenticated" && actorReady,
  });

  const orders = data?.data ?? [];
  const selectedOrdersForBilling = orders
    .map((order) => withDisplayOrderAmounts(order, summaryOverrides[order.order_id]))
    .filter((order) => selectedBillingOrderIds.has(String(order.order_id ?? "")));
  const selectedBillingTotal = selectedOrdersForBilling.reduce((sum, order) => sum + Number((order as any).netPayableAmount ?? 0), 0);
  const selectedDealerIds = Array.from(new Set(selectedOrdersForBilling.map((order) => String((order as any).order_dealer ?? (order as any).Dealer_Id ?? "").trim()).filter(Boolean)));

  const showBulkBillingToast = (type: "success" | "error", text: string) => {
    setBulkBillingToast({ type, text });
    window.setTimeout(() => setBulkBillingToast(null), 4000);
  };

  const isBillingEligible = (order: Order) => String((order as any).accept_order ?? "") === "1" || Number(order.orderdata_status ?? 0) >= 4 || String(order.mtstatus ?? "").toLowerCase().includes("completed");

  const toggleBillingOrder = (order: Order, checked: boolean) => {
    const oid = String((order as any).order_id ?? (order as any).orderId ?? "").trim();
    if (!oid || !isBillingEligible(order)) return;
    const orderDealerId = String((order as any).order_dealer ?? (order as any).Dealer_Id ?? "").trim();
    if (checked && selectedDealerIds.length === 1 && orderDealerId && selectedDealerIds[0] !== orderDealerId) {
      showBulkBillingToast("error", "Bulk billing supports one dealer at a time.");
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
      showBulkBillingToast("error", "Select orders from one dealer only.");
      return;
    }
    setBulkBilling(true);
    try {
      const existing = await listInvoices(selectedDealerIds[0] || dealerId || "", 500);
      const existingNumbers = new Set(Array.isArray(existing.data) ? existing.data.map((invoice: any) => String(invoice.invoiceNumber ?? "")) : []);
      const duplicates = selectedOrdersForBilling.filter((order) => existingNumbers.has(formatDisplayOrderNumber(order.order_id)));
      if (duplicates.length > 0) {
        showBulkBillingToast("error", `Already billed: ${duplicates.map((order) => order.order_id).join(", ")}`);
        return;
      }
      for (const order of selectedOrdersForBilling) {
        const blob = await generateOrderInvoicePDF(order as any, { normalizedRole: actorRole, actorId });
        const result = await uploadOrderInvoice(blob, order as any, { normalizedRole: actorRole, actorId });
        if (!result.success) throw new Error(result.error || result.message || `Failed to bill ${order.order_id}`);
      }
      setSelectedBillingOrderIds(new Set());
      showBulkBillingToast("success", `${selectedOrdersForBilling.length} invoice${selectedOrdersForBilling.length === 1 ? "" : "s"} saved.`);
    } catch (error) {
      showBulkBillingToast("error", error instanceof Error ? error.message : "Bulk billing failed");
    } finally {
      setBulkBilling(false);
    }
  };
  const ordersForExport = orders.map(order => withDisplayOrderAmounts(order, summaryOverrides[order.order_id]));
  const totalCount = data?.count ?? 0;
  const totalPages = Math.ceil(totalCount / pageSize);
  const orderIdsKey = orders.map((o) => (o as any).order_id ?? (o as any).orderId ?? "").filter(Boolean).join(",");

  useEffect(() => {
    if (!dealerId || !orderIdsKey) { setOrderNotes({}); return; }
    fetch(`/api/order-notes?dealer_id=${encodeURIComponent(dealerId)}&order_ids=${encodeURIComponent(orderIdsKey)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) return;
        const next: Record<string, OrderNoteOverlay> = {};
        (json.data ?? []).forEach((item: any) => {
          if (item.orderId) next[item.orderId] = item;
        });
        setOrderNotes(next);
      })
      .catch(() => {});
  }, [dealerId, orderIdsKey]);

  useEffect(() => {
    if (!dealerId || !orderIdsKey) { setSummaryOverrides({}); return; }
    fetch(`/api/order-summary-overrides?dealer_id=${encodeURIComponent(dealerId)}&order_ids=${encodeURIComponent(orderIdsKey)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) return;
        const next: Record<string, OrderSummaryOverride> = {};
        (json.data ?? []).forEach((item: any) => {
          if (item.orderId) next[item.orderId] = item;
        });
        setSummaryOverrides(next);
      })
      .catch(() => {});
  }, [dealerId, orderIdsKey]);

  const setFilter = (key: keyof OrderFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setPage(1); };
  const filtersActive = hasActiveFilters(filters);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setQuery(search); setPage(1); };

  const handleDelete = async (reason: string) => {
    if (!deleteOrderId) return;
    const response = await fetch(`/api/order-overlays/${encodeURIComponent(deleteOrderId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled", reason }),
    });

    if (!response.ok) throw new Error("Failed to delete order");
    setDeleteOrderId(null);
    refetch();
  };

  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce<(number | "…")[]>((acc, p, i, arr) => {
      if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("…");
      acc.push(p); return acc;
    }, []);

  return (
    <>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(12px) scale(0.97); opacity: 0; }
          to   { transform: translateY(0) scale(1); opacity: 1; }
        }
      `}</style>

      <div className="min-h-screen bg-gray-50" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>

        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.back()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] text-[12.5px] font-medium text-[#374151] cursor-pointer transition-all hover:bg-[#f1f5f9] hover:-translate-x-px"
            >
              back
            </button>
            <h1 className="text-xl font-bold text-gray-900">Order History</h1>
            <p className="text-sm text-gray-600 mt-0.5">
              {isLoading ? "Loading…" : `${totalCount} ${filtersActive ? "matching" : "total"} orders`}
              {isFetching && !isLoading && (
                <span className="ml-2 inline-flex items-center gap-1 text-indigo-600 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping inline-block" />
                  refreshing
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <form onSubmit={handleSearch} className="flex items-center gap-2">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                </svg>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search orders…"
                  className="pl-9 pr-4 py-2 text-[13px] text-gray-900 border border-gray-200 rounded-xl bg-gray-50 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all w-52 placeholder:text-gray-400" />
              </div>
              <button type="submit" className="px-4 py-2 bg-gray-900 text-white text-[13px] font-semibold rounded-xl hover:bg-gray-700 transition-colors">Search</button>
              {query && (
                <button type="button" onClick={() => { setSearch(""); setQuery(""); setPage(1); }}
                  className="px-3 py-2 text-[13px] text-gray-600 hover:text-gray-900 border border-gray-200 rounded-xl transition-colors">Clear</button>
              )}
            </form>

            <button
              onClick={() => setShowInvoiceModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold rounded-xl transition-colors"
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
            />
          </div>
        </div>

        <div className="px-8 py-6 max-w-[1840px] mx-auto">
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
              <button type="button" onClick={clearFilters} className="text-[11px] text-gray-500 underline hover:text-gray-800">
                Clear all
              </button>
            </div>
          )}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">

            {isError && (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
                </svg>
                <p className="text-sm text-gray-600">Failed to load orders. Please try again.</p>
              </div>
            )}

            {!isError && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 align-top">
                      {["Bill", "#"].map(h => (
                        <th key={h} className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 whitespace-nowrap">{h}</th>
                      ))}
                      <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 whitespace-nowrap">
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
                      <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 whitespace-nowrap">
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
                      <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 whitespace-nowrap">
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
                        <th key={h} className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 whitespace-nowrap">{h}</th>
                      ))}
                      <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 whitespace-nowrap">
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
                      {["Outstanding", "Actions"].map(h => (
                        <th key={h} className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {isLoading
                      ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                      : orders.length === 0
                        ? (
                          <tr><td colSpan={11}>
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
                          const oid = (order as any).order_id ?? (order as any).orderId ?? "";
                          const noteOverlay = orderNotes[oid];
                          const summaryOverride = summaryOverrides[oid];
                          const historyNote = extractOrderNote(order, noteOverlay?.note);
                          const displayOrder = withDisplayOrderAmounts(order, summaryOverride);
                          const discountBadge = formatAdditionalDiscountBadge(displayOrder);

                          return (
                            <tr key={oid || idx} className={`hover:bg-blue-50/30 transition-colors ${isDeleted ? "opacity-60" : ""}`}>
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
                                  <span className="font-mono text-[13px] font-bold text-indigo-700">
                                    {formatDisplayOrderNumber(oid)}
                                  </span>
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
                              <td className="px-4 py-3.5">
                                <p className="text-[13px] text-gray-900 font-medium">{moment(order.order_date).format("DD MMM YYYY")}</p>
                                <p className="text-[11px] text-gray-600 font-mono mt-0.5">{moment(order.order_date).format("hh:mm A")}</p>
                              </td>
                              <td className="px-4 py-3.5 font-mono text-[14px] font-bold text-gray-900">
                                {formatMoney(displayOrder.grossAmount)}
                              </td>
                              <td className="px-4 py-3.5 font-mono text-[13px] text-amber-700">
                                {displayOrder.discountAmount > 0 ? `−${formatMoney(displayOrder.discountAmount)}` : "—"}
                                {discountBadge && (
                                  <p className="mt-1 text-[11px] font-semibold text-indigo-600">{discountBadge}</p>
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
                              <td className="px-4 py-3.5 font-mono text-[12px] text-gray-700">
                                {order.outstandingDate ? moment(order.outstandingDate).format("DD MMM YYYY") : "—"}
                              </td>

                              {/* Actions — collapsed into a single 3-dot menu */}
                              <td className="px-4 py-3.5 w-px whitespace-nowrap">
                                <div className="flex items-center justify-end">
                                  <RowActionsMenu
                                    order={displayOrder}
                                    role={actorRole}
                                    actorId={actorId}
                                    isDeleted={isDeleted}
                                    onView={() => router.push(`/orders/${oid}`)}
                                    onDelete={() => setDeleteOrderId(oid)}
                                  />
                                </div>
                              </td>
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

      {bulkBillingToast && (
        <div className={`fixed bottom-4 left-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-medium shadow-lg border ${
          bulkBillingToast.type === "success" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"
        }`}>
          {bulkBillingToast.text}
        </div>
      )}
      {deleteOrderId && (
        <DeleteModal orderId={deleteOrderId} onConfirm={handleDelete} onClose={() => setDeleteOrderId(null)} />
      )}

      <InvoiceModal
        dealerId={dealerId}
        isOpen={showInvoiceModal}
        onClose={() => setShowInvoiceModal(false)}
      />
    </>
  );
}
