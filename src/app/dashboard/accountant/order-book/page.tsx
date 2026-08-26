"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import moment from "moment";
import {
  BookOpen, ChevronDown, ChevronRight,
  FileSpreadsheet, Receipt, RefreshCw, X,
} from "lucide-react";
import { isAuthenticated } from "@/lib/accountantauth";
import { downloadOrderInvoice, type OrderInvoiceData } from "@/lib/invoicegenerator";
import { OrderAmountSource, withDisplayOrderAmounts } from "@/lib/orderAmounts";
import { formatDisplayOrderNumber } from '@/lib/orderDisplay';

// ─── Constants ────────────────────────────────────────────────────────────────
const YEAR = new Date().getFullYear();
const PAGE_SIZE = 20;
const TODAY = moment().startOf("day");

// ─── Types ────────────────────────────────────────────────────────────────────
type RawOrder = {
  order_id: string; order_date: string; order_amount: string | number;
  order_discount: string | number; Dealer_Name: string;
  orderdata_item_quantity: string; mtstatus: string;
  outstandingDate: string; reason?: string;
  product_name?: string;
  order_dealer?: string | number;
  order_discount_amount?: string | number;
  order_net_amount?: string | number;
  grossAmount?: string | number;
  discountAmount?: string | number;
  netPayableAmount?: string | number;
};

type OrderSummaryOverride = OrderAmountSource & {
  orderId?: string;
  order_id?: string;
};

type PayStatus   = "Paid" | "Partial" | "Unpaid" | "Overdue";
type InvoiceType = "All" | "Tax Invoice" | "Bill of Supply";

type Filters = {
  from: string; to: string; dealer: string;
  invoiceType: InvoiceType; payStatus: "All" | PayStatus;
};

// ─── Derived helpers ──────────────────────────────────────────────────────────
function getPayStatus(o: RawOrder): PayStatus {
  const ms = Number(o.mtstatus ?? 0);
  if (ms >= 2) return "Paid";
  if (o.outstandingDate && moment(o.outstandingDate, "YYYY-MM-DD", true).isValid() &&
      moment(o.outstandingDate).isBefore(TODAY)) return "Overdue";
  if (ms === 1) return "Partial";
  return "Unpaid";
}

function gst(net: number) {
  const taxable = net / 1.18;
  const cgst    = taxable * 0.09;
  return { taxable, cgst, sgst: cgst, igst: 0 };
}

function fmt(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtShort(n: number) {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: PayStatus }) {
  const cls: Record<PayStatus, string> = {
    Paid:    "bg-emerald-50 border-emerald-200 text-emerald-700",
    Partial: "bg-blue-50 border-blue-200 text-blue-700",
    Unpaid:  "bg-amber-50 border-amber-200 text-amber-700",
    Overdue: "bg-red-50 border-red-200 text-red-700",
  };
  const dot: Record<PayStatus, string> = {
    Paid: "bg-emerald-400", Partial: "bg-blue-400", Unpaid: "bg-amber-400", Overdue: "bg-red-500",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-bold border whitespace-nowrap ${cls[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot[status]}`} />
      {status}
    </span>
  );
}

// ─── Per-row invoice button ───────────────────────────────────────────────────
function InvoiceBtn({ order }: { order: RawOrder }) {
  const [loading, setLoading] = useState(false);
  const handle = async () => {
    setLoading(true);
    await downloadOrderInvoice(order as OrderInvoiceData);
    setLoading(false);
  };
  return (
    <button onClick={handle} disabled={loading}
      className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold bg-white border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-700 rounded-lg transition-all shadow-sm disabled:opacity-50 whitespace-nowrap">
      {loading
        ? <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
        : <Receipt size={10} />}
      PDF
    </button>
  );
}

// ─── Aging Analysis panel ─────────────────────────────────────────────────────
function AgingPanel({ orders }: { orders: RawOrder[] }) {
  const [open, setOpen] = useState(false);

  const outstanding = useMemo(() => {
    const unpaid = orders.filter(o => {
      const ps = getPayStatus(o);
      return ps === "Unpaid" || ps === "Partial" || ps === "Overdue";
    });

    type Bucket = { current: number; d31: number; d61: number; d90: number };
    const byDealer: Record<string, Bucket & { name: string }> = {};

    for (const o of unpaid) {
      const net  = Number(o.order_amount) - Number(o.order_discount);
      const ref  = o.outstandingDate || o.order_date;
      const days = ref ? TODAY.diff(moment(ref).startOf("day"), "days") : 0;
      const name = o.Dealer_Name || "Unknown";

      if (!byDealer[name]) byDealer[name] = { name, current: 0, d31: 0, d61: 0, d90: 0 };
      const b = byDealer[name];
      if      (days <= 30) b.current += net;
      else if (days <= 60) b.d31     += net;
      else if (days <= 90) b.d61     += net;
      else                 b.d90     += net;
    }

    return Object.values(byDealer).sort((a, b) => (b.current + b.d31 + b.d61 + b.d90) - (a.current + a.d31 + a.d61 + a.d90));
  }, [orders]);

  const bucketTotal = (key: keyof Omit<typeof outstanding[0], "name">) =>
    outstanding.reduce((s, r) => s + r[key], 0);

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm mb-5">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 border-b border-gray-100 hover:bg-gray-50/60 transition-colors"
      >
        <div className="flex items-center gap-2 text-[13.5px] font-semibold text-gray-900">
          {open ? <ChevronDown size={15} className="text-indigo-500" /> : <ChevronRight size={15} className="text-indigo-500" />}
          Aging Analysis
          <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-bold">
            {outstanding.length} dealer{outstanding.length !== 1 ? "s" : ""} with outstanding
          </span>
        </div>
        <span className="text-[11.5px] text-gray-400">Dealer-wise outstanding breakdown</span>
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {["Dealer", "0–30 Days", "31–60 Days", "61–90 Days", "90+ (Overdue)", "Total"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10.5px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {outstanding.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-[13px] text-gray-400">No outstanding amounts</td></tr>
              ) : outstanding.map(row => {
                const total = row.current + row.d31 + row.d61 + row.d90;
                return (
                  <tr key={row.name} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-[12.5px] font-medium text-gray-800">{row.name}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-emerald-700">{row.current > 0 ? fmt(row.current) : "—"}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-amber-600">{row.d31 > 0 ? fmt(row.d31) : "—"}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-orange-600">{row.d61 > 0 ? fmt(row.d61) : "—"}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-red-600 font-semibold">{row.d90 > 0 ? fmt(row.d90) : "—"}</td>
                    <td className="px-4 py-3 font-mono text-[13px] font-bold text-gray-900">{fmt(total)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t border-gray-200">
                <td className="px-4 py-3 text-[10.5px] font-bold text-gray-500 uppercase tracking-wider">Total</td>
                <td className="px-4 py-3 font-mono text-[12px] font-bold text-emerald-700">{fmt(bucketTotal("current"))}</td>
                <td className="px-4 py-3 font-mono text-[12px] font-bold text-amber-600">{fmt(bucketTotal("d31"))}</td>
                <td className="px-4 py-3 font-mono text-[12px] font-bold text-orange-600">{fmt(bucketTotal("d61"))}</td>
                <td className="px-4 py-3 font-mono text-[12px] font-bold text-red-600">{fmt(bucketTotal("d90"))}</td>
                <td className="px-4 py-3 font-mono text-[13px] font-bold text-gray-900">
                  {fmt(bucketTotal("current") + bucketTotal("d31") + bucketTotal("d61") + bucketTotal("d90"))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <>{Array.from({ length: 5 }).map((_, i) => (
      <tr key={i} className="border-b border-gray-50">
        {Array.from({ length: 12 }).map((_, j) => (
          <td key={j} className="px-3 py-3">
            <div className="h-3 bg-gray-100 rounded animate-pulse" style={{ width: j === 3 ? 100 : j === 0 ? 24 : 60 }} />
          </td>
        ))}
      </tr>
    ))}</>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function OrderBookPage() {
  const router = useRouter();

  const [orders,  setOrders]  = useState<RawOrder[]>([]);
  const [summaryOverrides, setSummaryOverrides] = useState<Record<string, OrderSummaryOverride>>({});
  const [loading, setLoading] = useState(true);
  const [page,    setPage]    = useState(1);
  const [filters, setFilters] = useState<Filters>({
    from: "", to: "", dealer: "", invoiceType: "All", payStatus: "All",
  });

  // Auth guard
  useEffect(() => {
    if (!isAuthenticated()) router.replace("/auth/accountant-login");
  }, [router]);

  // Fetch all orders
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/orders-data?page=1&limit=1000&search=`);
      const json = await res.json();
      setOrders(Array.isArray(json.data) ? json.data : []);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const orderIds = Array.from(new Set(orders.map(o => String(o.order_id || "").trim()).filter(Boolean)));
    if (orderIds.length === 0) {
      setSummaryOverrides({});
      return;
    }

    let active = true;
    fetch(`/api/order-summary-overrides?order_ids=${encodeURIComponent(orderIds.join(","))}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(json => {
        if (!active) return;
        const map: Record<string, OrderSummaryOverride> = {};
        for (const row of Array.isArray(json.data) ? json.data : []) {
          const id = String(row.orderId || row.order_id || "").trim();
          if (id) map[id] = row;
        }
        setSummaryOverrides(map);
      })
      .catch(() => {
        if (active) setSummaryOverrides({});
      });

    return () => { active = false; };
  }, [orders]);

  const displayOrders = useMemo(() => {
    return orders.map(order => withDisplayOrderAmounts(order, summaryOverrides[order.order_id]));
  }, [orders, summaryOverrides]);

  // Derived: filtered + sorted (newest first)
  const filtered = useMemo(() => {
    return displayOrders
      .filter(o => {
        const date = moment(o.order_date);
        if (filters.from && date.isBefore(moment(filters.from), "day")) return false;
        if (filters.to   && date.isAfter(moment(filters.to),   "day")) return false;
        if (filters.dealer && !o.Dealer_Name?.toLowerCase().includes(filters.dealer.toLowerCase())) return false;
        if (filters.payStatus !== "All" && getPayStatus(o) !== filters.payStatus) return false;
        return true;
      })
      .sort((a, b) => moment(b.order_date).valueOf() - moment(a.order_date).valueOf());
  }, [displayOrders, filters]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const slice      = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Totals across all filtered rows
  const totals = useMemo(() => {
    let taxable = 0, cgstSum = 0, sgstSum = 0, grand = 0;
    const igstSum = 0;
    for (const o of filtered) {
      const net = Number(o.order_amount) - Number(o.order_discount);
      grand += net;
      if (filters.invoiceType !== "Bill of Supply") {
        const g = gst(net);
        taxable  += g.taxable;
        cgstSum  += g.cgst;
        sgstSum  += g.sgst;
      } else {
        taxable += net;
      }
    }
    return { taxable, cgst: cgstSum, sgst: sgstSum, igst: igstSum, grand };
  }, [filtered, filters.invoiceType]);

  // Reset filters
  const resetFilters = () => {
    setFilters({ from: "", to: "", dealer: "", invoiceType: "All", payStatus: "All" });
    setPage(1);
  };

  // Update a single filter field
  function setF<K extends keyof Filters>(k: K, v: Filters[K]) {
    setFilters(f => ({ ...f, [k]: v }));
    setPage(1);
  }

  // Excel export
  const exportXlsx = async () => {
    const XLSX = await import("xlsx");
    const rows = filtered.map((o, i) => {
      const net = Number(o.order_amount) - Number(o.order_discount);
      const isBos = filters.invoiceType === "Bill of Supply";
      const g     = isBos ? null : gst(net);
      return {
        "#":              i + 1,
        "Order No":       formatDisplayOrderNumber(o.order_id),
        "Date":           moment(o.order_date).format("DD MMM YYYY"),
        "Dealer":         o.Dealer_Name,
        "Invoice Type":   filters.invoiceType === "All" ? "Tax Invoice" : filters.invoiceType,
        "Taxable Value":  g ? Number(g.taxable.toFixed(2)) : Number(net.toFixed(2)),
        "CGST (9%)":      g ? Number(g.cgst.toFixed(2)) : "—",
        "SGST (9%)":      g ? Number(g.sgst.toFixed(2)) : "—",
        "IGST (0%)":      g ? 0 : "—",
        "Grand Total":    Number(net.toFixed(2)),
        "Payment Status": getPayStatus(o),
        "Due Date":       o.outstandingDate || "—",
      };
    });
    const ws  = XLSX.utils.json_to_sheet(rows);
    const wb  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Order Book");
    const fromStr = filters.from || "all";
    const toStr   = filters.to   || "all";
    XLSX.writeFile(wb, `order-book-${fromStr}-to-${toStr}.xlsx`);
  };

  const isBos = filters.invoiceType === "Bill of Supply";

  return (
    <div className="px-6 py-6 max-w-[1840px] mx-auto" style={{ fontFamily: "'DM Sans', sans-serif" }}>

      {/* ── Page header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
              <BookOpen size={16} className="text-indigo-600" />
            </div>
            <h1 className="text-[22px] font-bold text-gray-900 tracking-tight">Order Book</h1>
          </div>
          <p className="text-[12.5px] text-gray-400 ml-11">
            GST-level financial view of all orders · {filtered.length} of {displayOrders.length} record{displayOrders.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-lg transition-colors"
          >
            <RefreshCw size={12} /> Refresh
          </button>
          <button
            onClick={exportXlsx}
            disabled={loading || filtered.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            <FileSpreadsheet size={12} /> Export XLSX
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">

          <div className="flex flex-col gap-1">
            <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">From</label>
            <input type="date" value={filters.from} onChange={e => setF("from", e.target.value)}
              className="px-3 py-1.5 text-[12.5px] border border-gray-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 text-gray-700 bg-white" />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">To</label>
            <input type="date" value={filters.to} onChange={e => setF("to", e.target.value)}
              className="px-3 py-1.5 text-[12.5px] border border-gray-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 text-gray-700 bg-white" />
          </div>

          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Dealer</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search dealer…"
                value={filters.dealer}
                onChange={e => setF("dealer", e.target.value)}
                className="w-full pl-3 pr-7 py-1.5 text-[12.5px] border border-gray-200 rounded-lg outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 text-gray-700 bg-white"
              />
              {filters.dealer && (
                <button onClick={() => setF("dealer", "")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Invoice Type</label>
            <select
              value={filters.invoiceType}
              onChange={e => setF("invoiceType", e.target.value as InvoiceType)}
              className="px-3 py-1.5 text-[12.5px] border border-gray-200 rounded-lg outline-none focus:border-indigo-400 text-gray-700 bg-white"
            >
              {(["All", "Tax Invoice", "Bill of Supply"] as InvoiceType[]).map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider">Payment Status</label>
            <select
              value={filters.payStatus}
              onChange={e => setF("payStatus", e.target.value as Filters["payStatus"])}
              className="px-3 py-1.5 text-[12.5px] border border-gray-200 rounded-lg outline-none focus:border-indigo-400 text-gray-700 bg-white"
            >
              {(["All", "Paid", "Partial", "Unpaid", "Overdue"] as const).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <button
            onClick={resetFilters}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-colors"
          >
            <X size={11} /> Reset
          </button>
        </div>
      </div>

      {/* ── Aging Analysis ── */}
      <AgingPanel orders={displayOrders} />

      {/* ── Order Book Table ── */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold text-gray-900">
            <BookOpen size={14} className="text-indigo-500" />
            Ledger
            <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-bold">
              {filtered.length} row{filtered.length !== 1 ? "s" : ""}
            </span>
            {isBos && (
              <span className="px-2 py-0.5 bg-violet-50 text-violet-600 border border-violet-200 rounded-full text-[10px] font-bold">
                Bill of Supply — GST not applicable
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-[11.5px] text-gray-400">
            Page {page} of {totalPages}
            <button disabled={page <= 1}         onClick={() => setPage(p => p - 1)} className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30 text-gray-600 text-[12px]">‹</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30 text-gray-600 text-[12px]">›</button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {[
                  "#", "Order No.", "Date", "Dealer", "Invoice Type",
                  "Taxable Value", "CGST 9%", "SGST 9%", "IGST",
                  "Grand Total", "Payment Status", "Action",
                ].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <Skeleton />
              ) : slice.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-14 text-center text-[13px] text-gray-400">
                    No records match the current filters
                  </td>
                </tr>
              ) : slice.map((order, i) => {
                const net   = Number(order.order_amount) - Number(order.order_discount);
                const g     = gst(net);
                const ps    = getPayStatus(order);
                const rowN  = (page - 1) * PAGE_SIZE + i + 1;
                const invType = isBos ? "Bill of Supply" : "Tax Invoice";

                return (
                  <tr key={order.order_id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-3 text-[11px] text-gray-400 font-mono">
                      {String(rowN).padStart(2, "0")}
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-mono text-[11.5px] font-bold text-indigo-700">
                        {formatDisplayOrderNumber(order.order_id)}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="text-[12px] text-gray-800">{moment(order.order_date).format("DD MMM YYYY")}</div>
                      <div className="text-[10px] text-gray-400 font-mono">{moment(order.order_date).format("hh:mm A")}</div>
                    </td>
                    <td className="px-3 py-3 text-[12px] text-gray-700 font-medium max-w-[130px] truncate">
                      {order.Dealer_Name || "—"}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        isBos
                          ? "bg-violet-50 border-violet-200 text-violet-700"
                          : "bg-gray-50 border-gray-200 text-gray-600"
                      }`}>
                        {invType}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] text-gray-700">
                      {isBos ? fmtShort(net) : fmtShort(g.taxable)}
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] text-gray-600">
                      {isBos ? <span className="text-gray-300">—</span> : fmtShort(g.cgst)}
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] text-gray-600">
                      {isBos ? <span className="text-gray-300">—</span> : fmtShort(g.sgst)}
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] text-gray-400">
                      {isBos ? <span className="text-gray-300">—</span> : "0.00"}
                    </td>
                    <td className="px-3 py-3 font-mono text-[13px] font-bold text-gray-900">
                      {fmt(net)}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={ps} />
                    </td>
                    <td className="px-3 py-3">
                      <InvoiceBtn order={order} />
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* Totals row */}
            {!loading && filtered.length > 0 && (
              <tfoot>
                <tr className="bg-indigo-50/60 border-t-2 border-indigo-100">
                  <td colSpan={5} className="px-3 py-3 text-[10.5px] font-bold text-gray-500 uppercase tracking-wider">
                    Totals — {filtered.length} orders
                  </td>
                  <td className="px-3 py-3 font-mono text-[12.5px] font-bold text-gray-800">
                    {fmt(totals.taxable)}
                  </td>
                  <td className="px-3 py-3 font-mono text-[12.5px] font-bold text-gray-800">
                    {isBos ? <span className="text-gray-300">—</span> : fmt(totals.cgst)}
                  </td>
                  <td className="px-3 py-3 font-mono text-[12.5px] font-bold text-gray-800">
                    {isBos ? <span className="text-gray-300">—</span> : fmt(totals.sgst)}
                  </td>
                  <td className="px-3 py-3 font-mono text-[12.5px] font-bold text-gray-400">
                    {isBos ? <span className="text-gray-300">—</span> : "0.00"}
                  </td>
                  <td className="px-3 py-3 font-mono text-[14px] font-bold text-indigo-700">
                    {fmt(totals.grand)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Pagination footer */}
        {!loading && filtered.length > PAGE_SIZE && (
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/60 flex items-center justify-between">
            <span className="text-[11.5px] text-gray-400">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1}         onClick={() => setPage(p => p - 1)} className="px-3 py-1 rounded-lg border border-gray-200 hover:bg-white disabled:opacity-30 text-gray-600 text-[12px] font-medium transition-colors">Previous</button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 rounded-lg border border-gray-200 hover:bg-white disabled:opacity-30 text-gray-600 text-[12px] font-medium transition-colors">Next</button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 text-center text-[11px] text-gray-400">
        © {YEAR} Omsons · Order Book — GST values are computed estimates (Net ÷ 1.18)
      </div>
    </div>
  );
}
