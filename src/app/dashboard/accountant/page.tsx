"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  QueryClient,
  QueryClientProvider,
  useQueries,
} from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import moment from "moment";
import {
  DollarSign, ShoppingCart, Clock, AlertCircle,
  TrendingUp, Receipt, FileSpreadsheet, Download,
  ChevronDown, X,
} from "lucide-react";
import { isAuthenticated, clearAccountantSession } from "@/lib/accountantauth";
import { downloadOrderInvoice } from "@/lib/invoicegenerator";
import { OrderAmountSource, withDisplayOrderAmounts } from "@/lib/orderAmounts";
import { formatDisplayOrderNumber } from '@/lib/orderDisplay';

// ─── Constants ────────────────────────────────────────────────────────────────
const YEAR = new Date().getFullYear();

// ─── Types ────────────────────────────────────────────────────────────────────
type Order = {
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

type PendingOrder = {
  order_id: string; order_date: string; orderDate: string;
  order_dealer: string; order_amount: string | number; order_discount: string | number;
  order_status: string; accept_order: string; outstandingDate: string;
  Dealer_Name: string; orderdata_item_quantity: string;
  order_discount_amount?: string | number;
  order_net_amount?: string | number;
  grossAmount?: string | number;
  discountAmount?: string | number;
  netPayableAmount?: string | number;
};

type Stats = { dealerCount: number; staffCount: number; orderCount: number; PorderCount: number };
type ChartOrder  = { order_id: string; total: string };
type ChartDealer = { Dealer_Name: string; total: string };
type LedgerSummary = { netBalance: number };
type LedgerResponse = { data: LedgerSummary[] };
type OrderSummaryOverride = OrderAmountSource & { orderId?: string; order_id?: string };
type AccountantDashboardResponse = {
  data?: Stats[];
  stats?: Stats;
  top?: ChartDealer[];
  chartOrders?: ChartOrder[];
  recentOrders?: Order[];
  pendingOrders?: PendingOrder[];
};

// ─── CSV Export ───────────────────────────────────────────────────────────────
function downloadCSV(rows: Record<string, any>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map(r => headers.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `${filename}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function ordersToRows(orders: Order[]) {
  return orders.map(o => ({
    "Order No":        formatDisplayOrderNumber(o.order_id),
    "Date":            moment(o.order_date).format("DD MMM YYYY"),
    "Dealer":          o.Dealer_Name,
    "Gross (₹)":       Number(o.order_amount),
    "Discount (₹)":    Number(o.order_discount),
    "Net (₹)":         Number(o.order_amount) - Number(o.order_discount),
    "Units":           o.orderdata_item_quantity,
    "Outstanding":     o.outstandingDate || "—",
  }));
}

function pendingToRows(orders: PendingOrder[]) {
  return orders.map(o => ({
    "Order No":     formatDisplayOrderNumber(o.order_id),
    "Date":         (o.orderDate || o.order_date || "").slice(0, 10),
    "Dealer":       o.Dealer_Name,
    "Amount (₹)":   Number(o.order_amount),
    "Discount (₹)": Number(o.order_discount),
    "Net (₹)":      Number(o.order_amount) - Number(o.order_discount),
    "Units":        o.orderdata_item_quantity,
    "Due Date":     o.outstandingDate || "—",
    "Status":       o.order_status === "1" ? "Approved" : "Pending",
    "Acceptance":   o.accept_order === "1" ? "Accepted" : "Not Accepted",
  }));
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ type, text, onClose }: { type: "success"|"error"; text: string; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl text-[12.5px] font-semibold shadow-xl border ${
      type === "success" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
    }`}>
      {type === "success"
        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/></svg>}
      {text}
      <button onClick={onClose}><X size={11} className="opacity-50 hover:opacity-100" /></button>
    </div>
  );
}

// ─── Row Invoice Button ───────────────────────────────────────────────────────
function InvoiceBtn({ order }: { order: Order | PendingOrder }) {
  const [loading, setLoading] = useState(false);
  const [toast,   setToast]   = useState<{type:"success"|"error"; text:string}|null>(null);

  const handle = async () => {
    setLoading(true);
    const res = await downloadOrderInvoice(order as any);
    setLoading(false);
    setToast({ type: res.success ? "success" : "error", text: res.success ? "Invoice downloaded" : res.error || "Failed" });
  };

  return (
    <div className="relative">
      <button onClick={handle} disabled={loading}
        className="ghost-btn">
        {loading
          ? <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"/>
          : <Receipt size={10}/>}
        PDF
      </button>
      {toast && <Toast type={toast.type} text={toast.text} onClose={() => setToast(null)}/>}
    </div>
  );
}

// ─── Table Export Menu ────────────────────────────────────────────────────────
function ExportMenu({
  orders, pendingOrders, type,
}: {
  orders?: Order[]; pendingOrders?: PendingOrder[]; type: "orders"|"pending";
}) {
  const [open,  setOpen]  = useState(false);
  const [busy,  setBusy]  = useState(false);
  const [toast, setToast] = useState<{type:"success"|"error"; text:string}|null>(null);

  const handleCSV = () => {
    setOpen(false);
    if (type === "orders" && orders)           downloadCSV(ordersToRows(orders),  `orders_${moment().format("YYYY-MM-DD")}`);
    else if (type === "pending" && pendingOrders) downloadCSV(pendingToRows(pendingOrders), `pending_${moment().format("YYYY-MM-DD")}`);
    setToast({ type: "success", text: "CSV downloaded" });
  };

  const handleAllPDF = async () => {
    setOpen(false); setBusy(true);
    const list = (type === "orders" ? orders : pendingOrders) ?? [];
    for (const o of list.slice(0, 10)) {
      await downloadOrderInvoice(o as any);
      await new Promise(r => setTimeout(r, 400));
    }
    setBusy(false);
    setToast({ type: "success", text: `${Math.min(list.length, 10)} invoices downloaded` });
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)} disabled={busy}
        className="accent-btn">
        {busy ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"/> : <Download size={12}/>}
        Export
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`}/>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)}/>
          <div className="menu-sheet">
            <div className="menu-label">Invoice PDF</div>
            <button onClick={handleAllPDF} className="menu-item" style={{ borderBottom: "1px solid rgba(60,60,67,.11)" }}>
              <Receipt size={13} style={{ color: "#007aff" }}/>
              <div><p style={{ margin: 0, fontWeight: 620 }}>Download All PDFs</p><p className="faint" style={{ margin: "2px 0 0" }}>One per order (up to 10)</p></div>
            </button>
            <div className="menu-label">Excel / CSV</div>
            <button onClick={handleCSV} className="menu-item">
              <FileSpreadsheet size={13} style={{ color: "#1a7f37" }}/>
              <div><p style={{ margin: 0, fontWeight: 620 }}>Download as Excel</p><p className="faint" style={{ margin: "2px 0 0" }}>CSV — opens in Excel</p></div>
            </button>
          </div>
        </>
      )}
      {toast && <Toast type={toast.type} text={toast.text} onClose={() => setToast(null)}/>}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ cols }: { cols: number }) {
  return (
    <>{Array.from({length: 4}).map((_, i) => (
      <tr key={i}>
        {Array.from({length: cols}).map((_, j) => (
          <td key={j}>
            <div className="shimmer" style={{height: 12, width: j===2?110:j===0?30:70}}/>
          </td>
        ))}
      </tr>
    ))}</>
  );
}

const dashboardQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 2,
    },
  },
});

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AccountantDashboard() {
  return (
    <QueryClientProvider client={dashboardQueryClient}>
      <AccountantDashboardInner />
    </QueryClientProvider>
  );
}

function AccountantDashboardInner() {
  const router = useRouter();

  const [chartOrders,   setChartOrders]   = useState<ChartOrder[]>([]);
  const [chartDealers,  setChartDealers]  = useState<ChartDealer[]>([]);
  const [recentOrders,  setRecentOrders]  = useState<Order[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [summaryOverrides, setSummaryOverrides] = useState<Record<string, OrderSummaryOverride>>({});
  const [stats,         setStats]         = useState<Stats>({ dealerCount:0, staffCount:0, orderCount:0, PorderCount:0 });
  const [loading,       setLoading]       = useState(true);

  // Guard: redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/auth/accountant-login");
    }
  }, [router]);

  useEffect(() => {
    async function load() {
      try {
        const dashboard = await fetchJson<AccountantDashboardResponse>("/api/accountant/dashboard");
        const activeRecent = (dashboard.recentOrders || []).slice(0, 10);
        const activePending = (dashboard.pendingOrders || []).slice(0, 10);

        setChartOrders((dashboard.chartOrders || activeRecent.map((order) => ({
          order_id: order.order_id,
          total: String(order.order_net_amount ?? order.netPayableAmount ?? order.order_amount ?? 0),
        }))).sort((left, right) => Number(right.total) - Number(left.total)));
        setChartDealers(dashboard.top || []);
        setStats(dashboard.stats || (Array.isArray(dashboard.data) ? dashboard.data[0] : undefined) || { dealerCount:0, staffCount:0, orderCount:0, PorderCount:0 });
        setPendingOrders(activePending);
        setRecentOrders(activeRecent);
      } catch (e) {
        console.error("Dashboard load error:", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    const orderIds = Array.from(new Set(
      [...recentOrders, ...pendingOrders].map(o => String(o.order_id || "").trim()).filter(Boolean)
    ));
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
  }, [recentOrders, pendingOrders]);

  const [
    ledgerQ,
  ] = useQueries({
    queries: [
      {
        queryKey: ["accountantSidebarSummary", "ledger"],
        queryFn: () => fetchJson<LedgerResponse>("/api/ledger"),
      },
    ],
  });

  const summaryLoading = [ledgerQ].some(q => q.isLoading);
  const summaryError = [ledgerQ].find(q => q.isError);
  const retrySummary = () => {
    ledgerQ.refetch();
  };

  const pricedRecentOrders = recentOrders.map(order =>
    withDisplayOrderAmounts(order, summaryOverrides[order.order_id])
  );
  const pricedPendingOrders = pendingOrders.map(order =>
    withDisplayOrderAmounts(order, summaryOverrides[order.order_id])
  );

  // Derived
  const totalSale         = chartOrders.reduce((s, o) => s + Number(o.total), 0);
  const pendingPayment    = pricedPendingOrders.reduce((s, o) => s + (Number(o.order_amount) - Number(o.order_discount)), 0);
  const pendingPayCount   = pendingOrders.filter(o => o.accept_order === "0" || o.order_status !== "1").length;
  const pendingVerification = pendingOrders.filter(o => o.order_status === "0").length;
  const ledgerRows = ledgerQ.data?.data ?? [];
  const totalOutstandingValue = ledgerRows.reduce((sum, row) => sum + Math.max(0, Number(row.netBalance) || 0), 0);
  const pendingInvoicesCount = ledgerRows.filter(row => Number(row.netBalance) > 0).length;

  const statCards = [
    { label: "Total Sale",       value: `₹${totalSale.toLocaleString("en-IN")}`,     icon: <DollarSign size={15}/>,   tint: "rgba(52,199,89,.12)",  accent: "#1a7f37" },
    { label: "Total Orders",     value: stats.orderCount,                              icon: <ShoppingCart size={15}/>, tint: "rgba(0,122,255,.10)",  accent: "#007aff" },
    { label: "Pending Orders",   value: stats.PorderCount,                             icon: <Clock size={15}/>,        tint: "rgba(255,149,0,.12)",  accent: "#b25c00" },
    { label: "Pending Payments", value: pendingPayCount,                               icon: <AlertCircle size={15}/>,  tint: "rgba(255,59,48,.10)",  accent: "#ff3b30" },
    { label: "Payment Exposure", value: `₹${pendingPayment.toLocaleString("en-IN")}`, icon: <TrendingUp size={15}/>,   tint: "rgba(175,82,222,.10)", accent: "#af52de" },
  ];

  const cOrdData  = chartOrders.map(o  => ({ name: `#${o.order_id}`,                  value: Number(o.total) }));
  const cDealData = chartDealers.map(d => ({ name: d.Dealer_Name.substring(0, 11),    value: Number(d.total) }));

  return (
    <div className="acc-root">
    <div className="acc-shell">
      <style>{`
        .acc-root {
          min-height: 100vh;
          background:
            radial-gradient(circle at 12% -10%, rgba(0, 122, 255, .055), transparent 28%),
            #f5f5f7;
          color: #1d1d1f;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
          text-rendering: optimizeLegibility;
        }
        .acc-shell { width: min(100%, 1840px); margin: 0 auto; padding: 38px 34px 48px; }

        /* ── Page header ── */
        .dashboard-header { margin-bottom: 30px; }
        .eyebrow { display: inline-flex; align-items: center; gap: 7px; color: #007aff; font-size: 12px; line-height: 1; font-weight: 650; margin-bottom: 10px; }
        .eyebrow-dot { width: 7px; height: 7px; border-radius: 999px; background: #007aff; box-shadow: 0 0 0 4px rgba(0, 122, 255, .09); }
        .page-title { margin: 0; font-size: clamp(32px, 4vw, 44px); line-height: 1.02; letter-spacing: -.045em; font-weight: 720; color: #1d1d1f; }
        .page-subtitle { max-width: 620px; margin: 10px 0 0; color: #6e6e73; font-size: 15px; line-height: 1.45; letter-spacing: -.01em; text-wrap: pretty; }
        .section-label { margin: 0 0 12px 2px; color: #6e6e73; font-size: 12px; font-weight: 650; letter-spacing: .01em; }

        /* ── Cards ── */
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; margin-bottom: 30px; }
        .icard, .stat-card {
          min-height: 158px; padding: 20px 21px; border-radius: 22px;
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid rgba(60, 60, 67, .075);
          box-shadow: 0 1px 2px rgba(0,0,0,.02), 0 10px 34px rgba(0,0,0,.045);
          backdrop-filter: saturate(180%) blur(20px);
          transition: transform 180ms ease, box-shadow 180ms ease;
        }
        .icard:hover, .stat-card:hover { transform: translateY(-1px); box-shadow: 0 1px 2px rgba(0,0,0,.02), 0 14px 38px rgba(0,0,0,.055); }
        .icard-lbl, .stat-lbl { color: #6e6e73; font-size: 12px; font-weight: 600; letter-spacing: -.005em; }
        .icard-val, .stat-val { margin-top: 12px; color: #1d1d1f; font-size: clamp(28px, 3.2vw, 34px); line-height: 1; font-weight: 700; letter-spacing: -.045em; font-variant-numeric: tabular-nums; }
        .icard-sub { font-size: 11px; color: #8e8e93; margin-top: 8px; line-height: 1.4; }
        .icard-badge {
          display: inline-flex; align-items: center; gap: 6px;
          margin-top: 15px; margin-right: 12px;
          color: #6e6e73; font-size: 11.5px; line-height: 1.35; white-space: nowrap;
        }
        .icard-badge::before { content: ""; width: 7px; height: 7px; border-radius: 999px; background: #8e8e93; flex-shrink: 0; }
        .badge-amber::before  { background: #ff9500; }
        .badge-green::before  { background: #34c759; }
        .badge-blue::before   { background: #007aff; }
        .badge-purple::before { background: #af52de; }
        .badge-red::before    { background: #ff3b30; }
        .pulse-amber::before { animation: pulseAmber 1.8s infinite; }
        @keyframes pulseAmber { 0%{box-shadow:0 0 0 0 rgba(255,149,0,0.55)} 70%{box-shadow:0 0 0 6px rgba(255,149,0,0)} 100%{box-shadow:0 0 0 0 rgba(255,149,0,0)} }
        .stat-icon { width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; margin-bottom: 14px; }
        .quick-action-btn { display: inline-block; margin-top: 12px; color: #007aff; font-size: 11.5px; font-weight: 620; text-decoration: none; white-space: nowrap; background: none; border: 0; padding: 0; cursor: pointer; font-family: inherit; }
        .quick-action-btn:hover { text-decoration: underline; text-underline-offset: 2px; }

        /* ── Panels ── */
        .panel {
          padding: 22px; border-radius: 24px; min-width: 0; margin-bottom: 16px;
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid rgba(60, 60, 67, .075);
          box-shadow: 0 1px 2px rgba(0,0,0,.02), 0 10px 34px rgba(0,0,0,.045);
          backdrop-filter: saturate(180%) blur(20px);
        }
        .panel-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 18px; margin-bottom: 18px; }
        .panel-title { display: flex; align-items: center; gap: 9px; color: #1d1d1f; font-size: 16px; line-height: 1.2; font-weight: 680; letter-spacing: -.022em; }
        .panel-sub { margin-top: 4px; color: #6e6e73; font-size: 11.5px; line-height: 1.35; }
        .panel-foot { display: flex; flex-wrap: wrap; gap: 12px 22px; align-items: center; justify-content: space-between; margin-top: 18px; padding-top: 16px; border-top: 1px solid rgba(60, 60, 67, .11); font-size: 11.5px; color: #6e6e73; }
        .charts-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
        .charts-2 .panel { margin-bottom: 0; }
        @media (max-width: 900px) { .charts-2 { grid-template-columns: 1fr; } }
        .chart-canvas { width: 100%; height: 260px; }
        .chart-empty { height: 260px; display: grid; place-items: center; color: #8e8e93; font-size: 12px; }
        .leg { display: inline-flex; align-items: center; gap: 5px; color: #6e6e73; font-size: 10.5px; white-space: nowrap; }
        .leg-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

        .pill { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 650; white-space: nowrap; }
        .pill-blue  { background: rgba(0,122,255,.10); color: #007aff; }
        .pill-amber { background: rgba(255,149,0,.14); color: #b25c00; }

        .ghost-btn {
          display: inline-flex; align-items: center; gap: 7px;
          height: 32px; padding: 0 12px; border-radius: 10px;
          background: rgba(118, 118, 128, .12); border: 0;
          color: #1d1d1f; font-size: 11.5px; font-weight: 620;
          white-space: nowrap; cursor: pointer; font-family: inherit;
          transition: background .15s;
        }
        .ghost-btn:hover { background: rgba(118, 118, 128, .2); }
        .ghost-btn:disabled { opacity: .5; cursor: default; }
        .accent-btn {
          display: inline-flex; align-items: center; gap: 7px;
          height: 32px; padding: 0 13px; border-radius: 10px;
          background: #007aff; border: 0; color: #fff;
          font-size: 11.5px; font-weight: 620;
          white-space: nowrap; cursor: pointer; font-family: inherit;
          transition: background .15s;
        }
        .accent-btn:hover { background: #0062cc; }
        .accent-btn:disabled { opacity: .6; cursor: default; }
        .menu-sheet {
          position: absolute; right: 0; margin-top: 6px; width: 224px; z-index: 40;
          background: rgba(255,255,255,.98);
          border: 1px solid rgba(60, 60, 67, .11);
          border-radius: 16px;
          box-shadow: 0 10px 34px rgba(0,0,0,.14);
          overflow: hidden;
        }
        .menu-label { padding: 12px 14px 4px; color: #8e8e93; font-size: 10.5px; font-weight: 650; }
        .menu-item {
          width: 100%; display: flex; align-items: center; gap: 10px;
          padding: 10px 14px; border: 0; background: none;
          color: #1d1d1f; font-size: 12.5px; text-align: left;
          cursor: pointer; font-family: inherit;
          transition: background .15s;
        }
        .menu-item:hover { background: rgba(118, 118, 128, .10); }

        /* ── Tables ── */
        .data-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .data-table th { padding: 0 12px 10px; text-align: left; font-size: 11px; font-weight: 650; color: #6e6e73; white-space: nowrap; }
        .data-table td { padding: 12px; border-top: 1px solid rgba(60, 60, 67, .11); vertical-align: middle; color: #1d1d1f; }
        .data-table tr:hover td { background: rgba(118, 118, 128, .05); }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .muted { color: #6e6e73; }
        .faint { color: #8e8e93; font-size: 10.5px; }
        .strong-num { font-weight: 650; font-variant-numeric: tabular-nums; }
        .status-inline { display: inline-flex; align-items: center; gap: 6px; color: #6e6e73; font-size: 11px; white-space: nowrap; }
        .status-dot { width: 7px; height: 7px; border-radius: 999px; background: #8e8e93; flex-shrink: 0; }
        .sd-green  { background: #34c759; }
        .sd-amber  { background: #ff9500; }
        .sd-red    { background: #ff3b30; }
        .sd-blue   { background: #007aff; }

        /* ── Reports ── */
        .reports-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 26px; }
        @media (max-width: 640px) { .reports-grid { grid-template-columns: 1fr; } }
        .rpt-head { margin-bottom: 5px; color: #6e6e73; font-size: 11px; font-weight: 650; }
        .report-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; min-height: 39px; border-top: 1px solid rgba(60, 60, 67, .11); font-size: 12px; }
        .report-item:first-of-type { border-top: 0; }
        .report-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #6e6e73; }
        .report-value { color: #1d1d1f; font-weight: 650; font-variant-numeric: tabular-nums; }
        .report-empty { padding: 22px 0; color: #8e8e93; font-size: 12px; }

        .err-banner {
          display: flex; align-items: center; gap: 12px;
          margin-bottom: 16px; padding: 12px 14px;
          border: 1px solid rgba(255, 59, 48, .16);
          background: rgba(255,255,255,.8);
          border-radius: 16px; color: #b42318; font-size: 13px;
        }

        .shimmer { background: linear-gradient(90deg, rgba(118,118,128,.08) 25%, rgba(118,118,128,.16) 50%, rgba(118,118,128,.08) 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 8px; }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

        .acc-foot { margin-top: 26px; text-align: center; color: #8e8e93; font-size: 11px; }

        @media (max-width: 850px) { .acc-shell { padding: 28px 20px 36px; } }
        @media (max-width: 560px) {
          .acc-shell { padding: 24px 16px 32px; }
          .page-title { font-size: 34px; }
          .summary-grid { grid-template-columns: 1fr; gap: 10px; }
          .icard, .stat-card { min-height: 140px; padding: 18px; border-radius: 20px; }
          .panel { padding: 18px; border-radius: 20px; }
        }
      `}</style>

      {/* ── Stat Cards ── */}
      <header className="dashboard-header">
        <div className="eyebrow"><span className="eyebrow-dot" /> Finance overview</div>
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">What is billed, what is owed, and which orders are still waiting on verification.</p>
      </header>

      <div className="section-label">At a glance</div>

      <div className="summary-grid">
        {statCards.map(card => (
          <div key={card.label} className="stat-card">
            <div className="stat-icon" style={{ background: card.tint, color: card.accent }}>
              {card.icon}
            </div>
            <div className="stat-lbl">{card.label}</div>
            <div className="stat-val">
              {loading ? <span className="shimmer" style={{ display: "inline-block", width: 90, height: 30 }}/> : card.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Sidebar Summary Widgets ── */}
      {summaryError && (
        <div className="err-banner">
          Some accountant summary data failed to load.
          <button className="quick-action-btn" style={{ marginTop: 0, marginLeft: "auto" }} onClick={retrySummary}>Retry</button>
        </div>
      )}
      <div className="section-label">Needs action</div>

      <div className="summary-grid">
        <div className="icard">
          <div className="icard-lbl">Pending Verification</div>
          <div className="icard-val">{summaryLoading ? <span className="shimmer" style={{ display: "inline-block", width: 60, height: 26 }} /> : pendingVerification}</div>
          <div className="icard-sub">Orders waiting for verification</div>
          <div className={`icard-badge badge-amber${pendingVerification > 0 ? " pulse-amber" : ""}`}>{pendingVerification} pending</div>
          <Link href="/Pages/Ordermanagement/outstandingorders" className="quick-action-btn">+ Review orders</Link>
        </div>
        <div className="icard">
          <div className="icard-lbl">Outstanding Value</div>
          <div className="icard-val">{summaryLoading ? <span className="shimmer" style={{ display: "inline-block", width: 90, height: 26 }} /> : `₹${totalOutstandingValue.toLocaleString("en-IN")}`}</div>
          <div className="icard-sub">Net open balance across dealers</div>
          <div className="icard-badge badge-blue">{ledgerRows.length} ledgers</div>
          <Link href="/dashboard/admin/ledger" className="quick-action-btn">+ Open ledger</Link>
        </div>
        <div className="icard">
          <div className="icard-lbl">Pending Invoices</div>
          <div className="icard-val">{summaryLoading ? <span className="shimmer" style={{ display: "inline-block", width: 60, height: 26 }} /> : pendingInvoicesCount}</div>
          <div className="icard-sub">Dealer balances needing invoice follow-up</div>
          <div className={`icard-badge ${pendingInvoicesCount > 0 ? "badge-red" : "badge-green"}`}>{pendingInvoicesCount} open</div>
          <Link href="/dashboard/accountant/order-book" className="quick-action-btn">+ Open order book</Link>
        </div>
      </div>

      {/* ── Recent Orders Table ── */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">
              <ShoppingCart size={15} style={{ color: "#007aff" }}/>
              Recent Orders
              <span className="pill pill-blue">Last 10</span>
            </div>
            <div className="panel-sub">Latest entries across all dealers</div>
          </div>
          <ExportMenu type="orders" orders={pricedRecentOrders}/>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                {["#","Order No.","Date","Dealer","Gross","Discount","Net","Units","Action"].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? <Skeleton cols={9}/>
                : pricedRecentOrders.length === 0
                  ? <tr><td colSpan={9} style={{ padding: "44px 0", textAlign: "center", fontSize: 12, color: "#8e8e93" }}>No orders found</td></tr>
                  : pricedRecentOrders.map((order, idx) => {
                    const net     = Number(order.order_amount) - Number(order.order_discount);
                    const deleted = !!order.reason;
                    return (
                      <tr key={order.order_id} style={deleted ? { opacity: .5 } : undefined}>
                        <td className="faint num" style={{ textAlign: "left" }}>{String(idx+1).padStart(2,"0")}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span className="strong-num">{formatDisplayOrderNumber(order.order_id)}</span>
                            {deleted && <span className="pill" style={{ background: "rgba(255,59,48,.10)", color: "#ff3b30" }}>DEL</span>}
                          </div>
                        </td>
                        <td>
                          <div className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>{moment(order.order_date).format("DD MMM YYYY")}</div>
                          <div className="faint" style={{ fontVariantNumeric: "tabular-nums" }}>{moment(order.order_date).format("hh:mm A")}</div>
                        </td>
                        <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{order.Dealer_Name || "—"}</td>
                        <td className="num faint">₹{Number(order.order_amount).toLocaleString("en-IN")}</td>
                        <td className="num" style={{ color: "#b25c00" }}>−₹{Number(order.order_discount).toLocaleString("en-IN")}</td>
                        <td className="num strong-num">₹{net.toLocaleString("en-IN")}</td>
                        <td className="num muted">{order.orderdata_item_quantity}u</td>
                        <td style={{ textAlign: "right" }}><InvoiceBtn order={order}/></td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
        <div className="panel-foot">
          <span style={{ color: "#8e8e93" }}>Showing up to 10 recent orders</span>
          <Link href="/Pages/Ordermanagement" className="quick-action-btn" style={{ marginTop: 0 }}>View all →</Link>
        </div>
      </div>

      {/* ── Pending Orders Table ── */}
      {/* <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">
              <Clock size={15} style={{ color: "#ff9500" }}/>
              Pending Orders
              <span className="pill pill-amber">Needs Action</span>
            </div>
            <div className="panel-sub">Orders awaiting approval or payment</div>
          </div>
          <ExportMenu type="pending" pendingOrders={pricedPendingOrders}/>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                {["#","Order No.","Dealer","Date","Due","Amount","Net","Qty","Status","Accept"].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? <Skeleton cols={10}/>
                : pricedPendingOrders.length === 0
                  ? <tr><td colSpan={10} style={{ padding: "44px 0", textAlign: "center", fontSize: 12, color: "#8e8e93" }}>All caught up</td></tr>
                  : pricedPendingOrders.map((order, idx) => {
                    const net      = Number(order.order_amount) - Number(order.order_discount);
                    const approved = order.order_status === "1";
                    const accepted = order.accept_order === "1";
                    return (
                      <tr key={order.order_id}>
                        <td className="faint">{String(idx+1).padStart(2,"0")}</td>
                        <td>
                          <span className="strong-num">{formatDisplayOrderNumber(order.order_id)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div>{order.Dealer_Name || "—"}</div>
                          <div className="faint" style={{ marginTop: 2, fontVariantNumeric: "tabular-nums" }}>ID: {order.order_dealer}</div>
                        </td>
                        <td className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>{(order.orderDate||order.order_date||"—").slice(0,10)}</td>
                        <td>
                          {order.outstandingDate
                            ? <span style={{ color: "#b25c00", fontWeight: 620, fontVariantNumeric: "tabular-nums" }}>{order.outstandingDate}</span>
                            : <span className="faint">—</span>}
                        </td>
                        <td className="num faint">₹{Number(order.order_amount).toLocaleString("en-IN")}</td>
                        <td className="num strong-num">₹{net.toLocaleString("en-IN")}</td>
                        <td className="num muted">{order.orderdata_item_quantity||"—"}</td>
                        <td>
                          <span className="status-inline">
                            <span className={`status-dot ${approved ? "sd-green" : "sd-amber"}`}/>
                            {approved ? "Approved" : "Pending"}
                          </span>
                        </td>
                        <td>
                          <span className="status-inline">
                            <span className={`status-dot ${accepted ? "sd-blue" : "sd-red"}`}/>
                            {accepted ? "Accepted" : "Pending"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
        <div className="panel-foot">
          <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
            <span className="status-inline"><span className="status-dot sd-red"/>Not accepted <strong className="strong-num" style={{ color: "#1d1d1f" }}>{pendingOrders.filter(o => o.accept_order==="0").length}</strong></span>
            <span className="status-inline"><span className="status-dot sd-amber"/>Exposure <strong className="strong-num" style={{ color: "#1d1d1f" }}>₹{pendingPayment.toLocaleString("en-IN")}</strong></span>
          </div>
          <Link href="/Pages/Ordermanagement/outstandingorders" className="quick-action-btn" style={{ marginTop: 0 }}>View all pending →</Link>
        </div>
      </div> */}

      {/* ── Charts ── */}
      <div className="charts-2">
        {[
          { title: "Top Orders by Value",    sub: "Highest order amounts",         data: cOrdData,  fill: "#007aff", legend: "Order value" },
          { title: "Top Dealers by Revenue", sub: "Best performing dealer accounts", data: cDealData, fill: "#8e8e93", legend: "Revenue" },
        ].map(chart => (
          <div key={chart.title} className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">{chart.title}</div>
                <div className="panel-sub">{chart.sub}</div>
              </div>
              <span className="leg"><span className="leg-dot" style={{ background: chart.fill }}/>{chart.legend}</span>
            </div>
            <div className="chart-canvas">
              {loading
                ? <div className="chart-empty">Loading…</div>
                : chart.data.length > 0
                  ? <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chart.data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                        <CartesianGrid stroke="rgba(60,60,67,.08)" vertical={false}/>
                        <XAxis dataKey="name" tick={{fontSize:10.5, fill:"#8e8e93"}} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fontSize:10.5, fill:"#8e8e93"}} axisLine={false} tickLine={false} width={52}/>
                        <Tooltip
                          cursor={{fill:"rgba(0,122,255,.035)"}}
                          contentStyle={{backgroundColor:"rgba(255,255,255,.96)",border:"1px solid rgba(60,60,67,.12)",borderRadius:"14px",boxShadow:"0 10px 30px rgba(0,0,0,.10)",fontSize:11}}
                          labelStyle={{color:"#6e6e73",marginBottom:5}}
                          formatter={(v: any) => `₹${Number(v).toLocaleString("en-IN")}`}
                        />
                        <Bar dataKey="value" fill={chart.fill} radius={[8,8,2,2]} maxBarSize={38}/>
                      </BarChart>
                    </ResponsiveContainer>
                  : <div className="chart-empty">No data</div>}
            </div>
          </div>
        ))}
      </div>

      {/* ── Reports ── */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">
              <TrendingUp size={15} style={{ color: "#007aff" }}/> Reports
            </div>
            <div className="panel-sub">Quick ranked view of your strongest orders and dealers</div>
          </div>
          <button
            onClick={() => downloadCSV([
              ...chartOrders.map(o  => ({ Type:"Order",  Ref:formatDisplayOrderNumber(o.order_id), Value:Number(o.total) })),
              ...chartDealers.map(d => ({ Type:"Dealer", Ref:d.Dealer_Name,              Value:Number(d.total) })),
            ], `report_${moment().format("YYYY-MM-DD")}`)}
            className="ghost-btn"
          >
            <FileSpreadsheet size={13}/> Export Report
          </button>
        </div>
        <div className="reports-grid">
          {[
            { heading: "Top Orders",  items: chartOrders.map(o  => ({ label:formatDisplayOrderNumber(o.order_id), value:o.total  })) },
            { heading: "Top Dealers", items: chartDealers.map(d => ({ label:d.Dealer_Name,               value:d.total  })) },
          ].map(col => (
            <div key={col.heading}>
              <div className="rpt-head">{col.heading}</div>
              {loading
                ? <div className="report-empty">Loading…</div>
                : col.items.length === 0
                  ? <div className="report-empty">No data</div>
                  : col.items.map((item, i) => (
                    <div key={i} className="report-item">
                      <span className="report-name">{item.label}</span>
                      <span className="report-value">₹{Number(item.value).toLocaleString("en-IN")}</span>
                    </div>
                  ))}
            </div>
          ))}
        </div>
      </div>

      <div className="acc-foot">
        © {YEAR} Omsons · Accountant Dashboard
      </div>
    </div>
    </div>
  );
}


