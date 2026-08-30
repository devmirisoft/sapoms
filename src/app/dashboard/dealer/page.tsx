"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  QueryClient,
  QueryClientProvider,
  useQueries,
} from "@tanstack/react-query";
import { CiSearch } from "react-icons/ci";
import { useCartStore } from "@/Store/store";
import PendingProductsPreview from "@/components/dashboard/PendingProductsPreview";
import { clearAuthStorage } from "@/lib/roleAccess";
import { buildDealerOrderView } from "@/lib/dealerOrderView";
import { resolveStaffRoleKey, type StaffRoleKey } from "@/lib/staffRoleLabel";
import {
  calculateOutstandingAging,
  EMPTY_AGING,
  type OutstandingAging,
  type OutstandingOrder,
} from "@/lib/outstandingBalance";

// ── Types ─────────────────────────────────────────────────────────────────────
type DealerData = {
  Dealer_Id: string; Dealer_Name: string; Dealer_Email: string; Dealer_Number: string;
  Dealer_City: string; Dealer_Address: string; Dealer_Pincode: string;
  Dealer_Dealercode: string; Dealer_Image: string; annualtarget: string;
  currentlimit: string; creditdays: string; discount: string;
  gst: string; status: string; assignedstaff: string; staffname: string; Dealer_shipto: string;
};

// The dealer's assigned staff plus the ASM/RSM above them, as returned by
// GET /api/dealer/profile.
type DealerContact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  designation: string;
  role: string;
  roleKey: StaffRoleKey;
  roleLabel: string;
  salesRegion: string;
};

// This dashboard styles itself with its own scoped CSS rather than Tailwind, so
// role colours map to the local badge-* dot classes instead of the shared
// Tailwind badge helper.
const CONTACT_ROLE_BADGE: Record<StaffRoleKey, string> = {
  NSM: "badge-green",
  RSM: "badge-purple",
  ASM: "badge-blue",
  SALES_MANAGER: "badge-amber",
  STAFF: "badge-blue",
  UNKNOWN: "",
};

type MonthlyData = { month: string; totalorders: number; totalvalue: number };
type WalletSnapshot = {
  status: "active" | "inactive";
  availableBalance: number;
  totalConsumed: number;
};
type FunnelStage = { label: string; value: number; pct: number; color: string };
// Only the orders array is used here — the aging maths is shared with the
// ledger page so both screens report the same outstanding figure.
type LedgerSnapshot = { success?: boolean; orders?: OutstandingOrder[] };
type DraftRow = { producQuanity?: number; price?: number; packSize?: number };
type OrderHistoryItem = {
  order_id?: string;
  order_status?: string;
  status?: string;
  accept_order?: string;
  order_date?: string;
  orderDate?: string;
  order_amount?: string | number;
  total?: string | number;
  order_net_amount?: string | number;
  netPayableAmount?: string | number;
  outstandingDate?: string;
  Dealer_Name?: string;
  order_dealer?: string | number;
};
type SalesPeriod = "day" | "week" | "month" | "quarter" | "year";

const SALES_PERIOD_OPTIONS: Array<{ value: SalesPeriod; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "Quarterly" },
  { value: "year", label: "Yearly" },
];
const EMPTY_DEALER: DealerData = {
  Dealer_Id: "", Dealer_Name: "", Dealer_Email: "", Dealer_Number: "",
  Dealer_City: "", Dealer_Address: "", Dealer_Pincode: "", Dealer_Dealercode: "",
  Dealer_Image: "", annualtarget: "0", currentlimit: "0", creditdays: "0",
  discount: "0", gst: "", status: "0", assignedstaff: "", staffname: "", Dealer_shipto: "",
};

const logoImage = "http://sapoms.com/images/Omsons%20-%20White.png";

const NAV_ITEMS = [
  { label: "Home",      href: "/home",               icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
  { label: "Add Order", href: "/dashboard/dealer/AddOrderForm",  icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg> },
];

// function fmtCurrency(n: number) {
//   if (n >= 1_000_000) return `₹${(n / 1_000_000).toFixed(2)}M`;
//   if (n >= 1_000)     return `₹${(n / 1_000).toFixed(1)}K`;
//   return `₹${n}`;
// }

function fmtCurrency(n: number) {
  return `₹${Number(n || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function parseOrderDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateKey(date: Date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function formatMonthKey(date: Date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDayLabel(date: Date) {
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function formatMonthLabel(date: Date) {
  return date.toLocaleDateString("en-IN", { month: "short" });
}

function getOrderValue(order: OrderHistoryItem) {
  const parsed = Number(order.order_net_amount ?? order.netPayableAmount ?? order.order_amount ?? order.total);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildSalesTrend(orders: OrderHistoryItem[], period: SalesPeriod): MonthlyData[] {
  const today = startOfDay(new Date());
  const year = today.getFullYear();
  const month = today.getMonth();
  const quarterStartMonth = Math.floor(month / 3) * 3;

  const range =
    period === "day" ? { start: today, end: addDays(today, 1), bucket: "day" as const } :
    period === "week" ? { start: addDays(today, -6), end: addDays(today, 1), bucket: "day" as const } :
    period === "month" ? { start: new Date(year, month, 1), end: new Date(year, month + 1, 1), bucket: "day" as const } :
    period === "quarter" ? { start: new Date(year, quarterStartMonth, 1), end: new Date(year, quarterStartMonth + 3, 1), bucket: "month" as const } :
    { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1), bucket: "month" as const };

  const totals = new Map<string, number>();

  if (range.bucket === "day") {
    for (let cursor = new Date(range.start); cursor < range.end; cursor = addDays(cursor, 1)) {
      totals.set(formatDateKey(cursor), 0);
    }
  } else {
    for (let cursor = new Date(range.start); cursor < range.end; cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)) {
      totals.set(formatMonthKey(cursor), 0);
    }
  }

  for (const order of orders) {
    const date = parseOrderDate(order.order_date ?? order.orderDate);
    if (!date || date < range.start || date >= range.end) continue;
    const key = range.bucket === "day" ? formatDateKey(date) : formatMonthKey(date);
    totals.set(key, (totals.get(key) ?? 0) + getOrderValue(order));
  }

  return Array.from(totals.entries()).map(([key, totalvalue]) => {
    const labelDate = range.bucket === "day" ? new Date(key + "T00:00:00") : new Date(key + "-01T00:00:00");
    return {
      month: range.bucket === "day" ? formatDayLabel(labelDate) : formatMonthLabel(labelDate),
      totalorders: 0,
      totalvalue,
    };
  });
}
function createDashboardQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: 2,
      },
    },
  });
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function safeFetch(url: string, options: RequestInit = {}) {
  const res  = await fetch(url, options);
  const text = await res.text();
  try { return JSON.parse(text); } catch (_) {}
  const cleaned = text.replace(/^[\s\S]*?(\{|\[)/, (_, ch) => ch);
  try { return JSON.parse(cleaned); } catch (_) {}
  const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])(?=[^}\]]*$)/);
  if (match) { try { return JSON.parse(match[0]); } catch (_) {} }
  throw new Error(`Could not parse response from ${url}`);
}

// ── Normalise the { month: [...], total: [...] } shape the API returns ────────
function normaliseMonthlyResponse(data: any, valueKey: "orders" | "value"): MonthlyData[] {
  if (!data) return [];

  const months: any[] = Array.isArray(data.month)
    ? data.month
    : Array.isArray(data.months)
    ? data.months
    : Object.values(data.month ?? data.months ?? {});

  const totals: any[] = Array.isArray(data.total)
    ? data.total
    : Array.isArray(data.totals)
    ? data.totals
    : Object.values(data.total ?? data.totals ?? {});

  if (!months.length || !totals.length) return [];

  return months.map((m: any, idx: number) => {
    const raw = parseFloat(String(totals[idx] ?? 0));
    const val = isNaN(raw) ? 0 : raw;
    return {
      month:       String(m).trim(),
      totalorders: valueKey === "orders" ? val : 0,
      totalvalue:  valueKey === "value"  ? val : 0,
    };
  });
}

export default function DealerDashboard() {
  // Per-mount client: a module-scoped one keeps its cache across logout, so the
  // next dealer to sign in briefly sees the previous dealer's cached rows.
  const [queryClient] = useState(createDashboardQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <DealerDashboardInner />
    </QueryClientProvider>
  );
}

function DealerDashboardInner() {
  const router   = useRouter();
  const pathname = usePathname();
  const cartItems = useCartStore((s) => s.cart);

  // Chart refs — one per canvas, one per Chart.js instance
  const barRef   = useRef<HTMLCanvasElement | null>(null);
  const barChart = useRef<any>(null);
  const lineRef  = useRef<HTMLCanvasElement | null>(null);
  const lineChart = useRef<any>(null);

  const [sidebarOpen,   setSidebarOpen]   = useState(false);
  const [loading,       setLoading]       = useState(true);
  const [dealer,        setDealer]        = useState<DealerData>(EMPTY_DEALER);
  const [wallet,        setWallet]        = useState<WalletSnapshot | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [aging,         setAging]         = useState<OutstandingAging>(EMPTY_AGING);
  const [agingLoading,  setAgingLoading]  = useState(true);
  const [monthlyOrders, setMonthlyOrders] = useState<MonthlyData[]>([]);
  const [monthlyValues, setMonthlyValues] = useState<MonthlyData[]>([]);
  const [orderHistory,  setOrderHistory]  = useState<OrderHistoryItem[]>([]);
  const [salesPeriod,   setSalesPeriod]   = useState<SalesPeriod>("year");
  const [funnel,        setFunnel]        = useState<FunnelStage[]>([]);
  const [contacts,      setContacts]      = useState<DealerContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);

  // ── Data fetch ────────────────────────────────────────────────────────────
  // Extracted into a callback so it can be re-run whenever the cached dealer
  // session changes (profile save, login as another dealer, another tab), not
  // just once on mount.
  const loadDashboard = useCallback(async () => {
    if (typeof window === "undefined") return;

    try {
        const raw    = localStorage.getItem("UserData") || localStorage.getItem("user") || "{}";
        const parsed: DealerData = JSON.parse(raw);
        setDealer({ ...EMPTY_DEALER, ...parsed });

        const dealerId = parsed.Dealer_Id;
        if (!dealerId) { setLoading(false); setWalletLoading(false); setContactsLoading(false); setAgingLoading(false); return; }

        fetch(`/api/wallet/${encodeURIComponent(dealerId)}?limit=5`, {
          cache: "no-store",
        })
          .then((response) => response.ok ? response.json() : Promise.reject(new Error("wallet unavailable")))
          .then((payload) => { if (payload.success) setWallet(payload); })
          .catch(() => setWallet(null))
          .finally(() => setWalletLoading(false));

        // Outstanding balance comes from the same ledger endpoint the ledger
        // page uses, so the dashboard total always matches /Pages/ledger.
        fetch(`/api/ledger/${encodeURIComponent(dealerId)}`, { cache: "no-store" })
          .then((response) => response.ok ? response.json() : Promise.reject(new Error("ledger unavailable")))
          .then((payload: LedgerSnapshot) => {
            setAging(calculateOutstandingAging(Array.isArray(payload?.orders) ? payload.orders : []));
          })
          .catch(() => setAging(EMPTY_AGING))
          .finally(() => setAgingLoading(false));

        // Assigned staff first, then the ASM and RSM they roll up to. The API
        // already drops anyone repeated across those three fields; the local
        // de-dupe guards against a staff member who is also their own parent.
        fetch("/api/dealer/profile", { cache: "no-store" })
          .then((response) => response.ok ? response.json() : Promise.reject(new Error("profile unavailable")))
          .then((payload) => {
            const data = payload?.data ?? {};
            const team: DealerContact[] = [
              ...(Array.isArray(data.assignedStaff) ? data.assignedStaff : []),
              ...(data.asm ? [data.asm] : []),
              ...(data.rsm ? [data.rsm] : []),
            ];
            const seen = new Set<string>();
            setContacts(team.filter((entry) => entry?.id && !seen.has(entry.id) && seen.add(entry.id)));
          })
          .catch(() => setContacts([]))
          .finally(() => setContactsLoading(false));

        const activeResponse = await fetchJson<{ data: OrderHistoryItem[] }>(
          `/api/orders-data?page=1&limit=1000&search=`
        );
        const orderView = buildDealerOrderView(activeResponse.data, dealerId);
        setMonthlyOrders(orderView.monthly);
        setOrderHistory(orderView.orders as OrderHistoryItem[]);

        // Funnel from dealer data
        const annual  = Number(parsed.annualtarget) || 0;
        const current = Number(parsed.currentlimit)  || 0;
        setFunnel([
          { label: "Annual Target", value: annual,  pct: 100, color: "#af52de" },
          { label: "Current Limit", value: current, pct: annual > 0 ? Math.round((current / annual) * 100) : 0, color: "#007aff" },
        ]);
    } catch (err) {
      console.error("[DealerDashboard] top-level error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load, plus a re-load whenever the dealer session changes. Profile
  // saves and logins write UserData to localStorage and fire
  // "omsons-auth-changed"; "storage" covers the same edit made in another tab.
  useEffect(() => {
    void loadDashboard();

    const handleAuthChanged = () => { void loadDashboard(); };
    window.addEventListener("omsons-auth-changed", handleAuthChanged);
    window.addEventListener("storage", handleAuthChanged);
    return () => {
      window.removeEventListener("omsons-auth-changed", handleAuthChanged);
      window.removeEventListener("storage", handleAuthChanged);
    };
  }, [loadDashboard]);

  useEffect(() => {
    setMonthlyValues(buildSalesTrend(orderHistory, salesPeriod));
  }, [orderHistory, salesPeriod]);

  useEffect(() => {
    if (loading || monthlyOrders.length === 0) return;

    // rAF ensures the canvas element is painted into the DOM before Chart.js accesses it
    const raf = requestAnimationFrame(async () => {
      if (!barRef.current) return;
      const { default: Chart } = await import("chart.js/auto");

      if (barChart.current) {
        barChart.current.data.labels = monthlyOrders.map(m => m.month);
        barChart.current.data.datasets[0].data = monthlyOrders.map(m => m.totalorders);
        barChart.current.update("active");
        return;
      }

      barChart.current = new Chart(barRef.current, {
        type: "bar",
        data: {
          labels:   monthlyOrders.map(m => m.month),
          datasets: [{
            label: "Total Orders",
            data:  monthlyOrders.map(m => m.totalorders),
            backgroundColor:      "#007aff",
            hoverBackgroundColor: "#0062cc",
            borderRadius: 7,
            borderSkipped: false,
            barPercentage: 0.58,
            categoryPercentage: 0.68,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "rgba(255,255,255,.96)", titleColor: "#6e6e73", bodyColor: "#1d1d1f", borderColor: "rgba(60,60,67,.12)", borderWidth: 1,
              padding: 10, cornerRadius: 14, displayColors: false,
              callbacks: { label: ctx => ` Orders: ${ctx.raw}` },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#8e8e93", font: { size: 10.5 } }, border: { display: false } },
            y: { grid: { color: "rgba(60,60,67,0.08)" }, border: { display: false }, ticks: { color: "#8e8e93", font: { size: 10.5 } } },
          },
        },
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [loading, monthlyOrders]);

  // Destroy bar chart only on unmount
  useEffect(() => () => { barChart.current?.destroy(); }, []);

  useEffect(() => {
    if (loading || monthlyValues.length === 0) return;

    const raf = requestAnimationFrame(async () => {
      if (!lineRef.current) return;
      const { default: Chart } = await import("chart.js/auto");

      if (lineChart.current) {
        lineChart.current.data.labels = monthlyValues.map(m => m.month);
        lineChart.current.data.datasets[0].data = monthlyValues.map(m => m.totalvalue);
        lineChart.current.update("active");
        return;
      }

      lineChart.current = new Chart(lineRef.current, {
        type: "line",
        data: {
          labels:   monthlyValues.map(m => m.month),
          datasets: [{
            label: "Total Value (₹)",
            data:  monthlyValues.map(m => m.totalvalue),
            borderColor:          "#ff9500",
            backgroundColor:      "rgba(245,158,11,0.17)",
            tension:              0.44,
            fill:                 true,
            pointRadius:          3,
            pointBackgroundColor: "#ff9500",
            pointBorderColor:     "#fff",
            pointBorderWidth:     2,
            borderWidth:          2.5,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true, position: "top" },
            tooltip: {
              backgroundColor: "#0f0e17", titleColor: "#e0e7ff", bodyColor: "#c7d2fe",
              padding: 12, cornerRadius: 10,
              callbacks: { label: ctx => ` ₹${(ctx.raw as number).toLocaleString("en-IN")}` },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#8e8e93", font: { size: 10.5 } }, border: { display: false } },
            y: {
              grid: { color: "rgba(60,60,67,0.08)" }, border: { display: false },
              ticks: { color: "#8e8e93", font: { size: 10.5 }, callback: v => `₹${Number(v).toLocaleString("en-IN")}` },
            },
          },
        },
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [loading, monthlyValues]);

  // Destroy line chart only on unmount
  useEffect(() => () => { lineChart.current?.destroy(); }, []);

  const annualTarget = Number(dealer.annualtarget) || 0;
  const currentLimit = Number(dealer.currentlimit)  || 0;
  const creditDays   = Number(dealer.creditdays)    || 0;
  const discountPct  = Number(dealer.discount)      || 0;
  const isWalletActive = wallet?.status === "active";
  const walletAvailable = Number(wallet?.availableBalance ?? 0);
  const walletConsumed = Number(wallet?.totalConsumed ?? 0);
  const outstanding  = aging.total;
  const overdueAmount = aging.d31 + aging.d61 + aging.d90;
  // Outstanding against the credit ceiling — how much of the limit is tied up.
  const limitUsedPct = currentLimit > 0 ? Math.min(100, Math.round((outstanding / currentLimit) * 100)) : 0;
  const usagePct     = annualTarget > 0 ? Math.min(100, Math.round((currentLimit / annualTarget) * 100)) : 0;
  const initials     = dealer.Dealer_Name?.trim()?.charAt(0)?.toUpperCase() || dealer.Dealer_Email?.trim()?.charAt(0)?.toUpperCase() || "D";

  const handleLogout = () => { clearAuthStorage(localStorage); window.dispatchEvent(new Event("omsons-auth-changed")); router.push("/auth/login"); };

  const [
    draftsQ,
    ordersQ,
  ] = useQueries({
    queries: [
      {
        queryKey: ["dealerSidebarSummary", "drafts", dealer.Dealer_Id],
        queryFn: () => fetchJson<{ data: Array<{ rows?: DraftRow[] }> }>(`/api/drafts?dealer_id=${encodeURIComponent(dealer.Dealer_Id)}`),
        enabled: !!dealer.Dealer_Id,
      },
      {
        queryKey: ["dealerSidebarSummary", "orders", "dealer", dealer.Dealer_Id],
        queryFn: () => fetchJson<{ data: OrderHistoryItem[] }>(`/api/orders-data?page=1&limit=1000&search=`),
        enabled: !!dealer.Dealer_Id,
      },
    ],
  });

  const summaryLoading = [draftsQ, ordersQ].some(q => q.isLoading);
  const summaryError = [draftsQ, ordersQ].find(q => q.isError);
  const retrySummary = () => {
    draftsQ.refetch();
    ordersQ.refetch();
  };
  const cartTotalPaise = cartItems.reduce((sum, item) => sum + item.price * item.quantity * (item.packSize ?? 1), 0);
  const draftRows = draftsQ.data?.data ?? [];
  const draftTotal = draftRows.reduce((sum, draft) => {
    return sum + (draft.rows ?? []).reduce((rowSum, row) => {
      const qty = Number(row.producQuanity) || 0;
      const pack = Number(row.packSize) || 1;
      const price = Number(row.price) || 0;
      return rowSum + qty * pack * price;
    }, 0);
  }, 0);
  const orderView = buildDealerOrderView(ordersQ.data?.data ?? [], dealer.Dealer_Id);
  const orderRows = orderView.orders as OrderHistoryItem[];
  const pendingOrders = orderView.pendingCount;
  const shippedOrders = orderView.completedCount;
  const processingOrders = Math.max(0, orderRows.length - pendingOrders - shippedOrders);
  const creditDaysRemaining = Math.max(0, creditDays);
  const paymentAlert = currentLimit > 0 || creditDaysRemaining <= 7;

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        button, input, select { font: inherit; }

        .root {
          min-height: 100vh;
          background:
            radial-gradient(circle at 12% -10%, rgba(0, 122, 255, .055), transparent 28%),
            #f5f5f7;
          color: #1d1d1f;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
          text-rendering: optimizeLegibility;
        }

        /* ── Legacy in-page drawer — scoped so it cannot restyle the app sidebar ── */
        .sidebar { position: fixed; top: 0; left: 0; bottom: 0; width: 256px; z-index: 40; background: #0d0c16; display: flex; flex-direction: column; transform: translateX(-100%); transition: transform 0.28s cubic-bezier(0.4,0,0.2,1); will-change: transform; }
        .sidebar.open { transform: translateX(0); }
        .sidebar .sb-user { margin: 14px 14px 0; padding: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; }
        .sidebar .sb-avatar { width: 38px; height: 38px; border-radius: 50%; background: linear-gradient(135deg,#6366f1,#a78bfa); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 8px; }
        .sidebar .sb-uname { font-size: 13px; font-weight: 600; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sidebar .sb-meta { font-size: 10.5px; color: #94a3b8; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sidebar .sb-code { margin-top: 6px; display: inline-block; font-size: 10px; font-family: monospace; background: rgba(99,102,241,0.18); color: #a5b4fc; padding: 2px 8px; border-radius: 6px; }
        .sidebar .sb-nav { flex: 1; padding: 10px; margin-top: 10px; overflow-y: auto; }
        .sidebar .sb-nav::-webkit-scrollbar { width: 5px; }
        .sidebar .sb-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
        .sidebar .sb-link { display: flex; align-items: center; gap: 11px; padding: 10px 13px; border-radius: 8px; font-size: 13.5px; font-weight: 500; color: #94a3b8; text-decoration: none; margin-bottom: 2px; transition: background .16s, color .16s; }
        .sidebar .sb-link:hover { background: rgba(255,255,255,0.05); color: #e2e8f0; }
        .sidebar .sb-link.active { background: rgba(99,102,241,0.20); color: #a5b4fc; box-shadow: inset 3px 0 0 #6366f1; }
        .sidebar .sb-foot { padding: 14px; border-top: 1px solid rgba(255,255,255,0.07); }
        .sidebar .sb-logout { width: 100%; padding: 9px 14px; border-radius: 8px; background: transparent; border: 1px solid rgba(255,255,255,0.09); font-size: 13px; font-weight: 500; color: #94a3b8; cursor: pointer; font-family: inherit; transition: all .16s; }
        .sidebar .sb-logout:hover { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.28); color: #f87171; }

        .overlay { position: fixed; inset: 0; z-index: 30; background: rgba(0,0,0,0.5); backdrop-filter: blur(3px); opacity: 0; pointer-events: none; transition: opacity .28s; }
        .overlay.show { opacity: 1; pointer-events: all; }


        /* ── Shell ── */
        .main { min-width: 0; }
        .content { width: min(100%, 1840px); margin: 0 auto; padding: 38px 34px 48px; }

        /* ── Page header ── */
        .dashboard-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 30px; }
        .eyebrow { display: inline-flex; align-items: center; gap: 7px; color: #007aff; font-size: 12px; line-height: 1; font-weight: 650; margin-bottom: 10px; }
        .eyebrow-dot { width: 7px; height: 7px; border-radius: 999px; background: #007aff; box-shadow: 0 0 0 4px rgba(0, 122, 255, .09); }
        .page-heading, .page-title { margin: 0; font-size: clamp(32px, 4vw, 44px); line-height: 1.02; letter-spacing: -.045em; font-weight: 720; color: #1d1d1f; }
        .page-subtitle { max-width: 620px; margin: 10px 0 0; color: #6e6e73; font-size: 15px; line-height: 1.45; letter-spacing: -.01em; text-wrap: pretty; }
        .profile-chip {
          display: flex; align-items: center; gap: 11px; flex-shrink: 0;
          padding: 7px 9px 7px 7px;
          border: 1px solid rgba(60, 60, 67, .09);
          background: rgba(255,255,255,.72);
          box-shadow: 0 4px 18px rgba(0,0,0,.035);
          backdrop-filter: saturate(180%) blur(18px);
          border-radius: 999px;
        }
        .profile-chip-avatar { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: linear-gradient(145deg, #1d1d1f, #52525a); color: #fff; font-size: 12px; font-weight: 700; letter-spacing: -.02em; }
        .profile-copy { min-width: 0; padding-right: 5px; }
        .profile-chip-name { max-width: 190px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #1d1d1f; font-size: 12px; font-weight: 650; }
        .profile-chip-role { color: #8e8e93; font-size: 10.5px; margin-top: 1px; font-variant-numeric: tabular-nums; }

        .section-label { margin: 0 0 12px 2px; color: #6e6e73; font-size: 12px; font-weight: 650; letter-spacing: .01em; }

        /* ── Info cards ── */
        .info-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; margin-bottom: 30px; }
        .icard {
          min-height: 158px; padding: 20px 21px; border-radius: 22px;
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid rgba(60, 60, 67, .075);
          box-shadow: 0 1px 2px rgba(0,0,0,.02), 0 10px 34px rgba(0,0,0,.045);
          backdrop-filter: saturate(180%) blur(20px);
          transition: transform 180ms ease, box-shadow 180ms ease;
        }
        .icard:hover { transform: translateY(-1px); box-shadow: 0 1px 2px rgba(0,0,0,.02), 0 14px 38px rgba(0,0,0,.055); }
        .icard { position: relative; }
        .icard > .quick-action-btn::after { content: ""; position: absolute; inset: 0; }
        .icard-lbl { color: #6e6e73; font-size: 12px; font-weight: 600; letter-spacing: -.005em; }
        .icard-val { margin-top: 12px; color: #1d1d1f; font-size: clamp(28px, 3.2vw, 34px); line-height: 1; font-weight: 700; letter-spacing: -.045em; font-variant-numeric: tabular-nums; }
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
        .quick-action-btn { display: inline-block; margin-top: 12px; color: #007aff; font-size: 11.5px; font-weight: 620; text-decoration: none; white-space: nowrap; background: none; border: 0; padding: 0; cursor: pointer; font-family: inherit; }
        .quick-action-btn:hover { text-decoration: underline; text-underline-offset: 2px; }

        /* ── Panels ── */
        .panel {
          padding: 22px; border-radius: 24px; min-width: 0;
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid rgba(60, 60, 67, .075);
          box-shadow: 0 1px 2px rgba(0,0,0,.02), 0 10px 34px rgba(0,0,0,.045);
          backdrop-filter: saturate(180%) blur(20px);
        }
        .panel-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 18px; margin-bottom: 18px; }
        .panel-title { color: #1d1d1f; font-size: 16px; line-height: 1.2; font-weight: 680; letter-spacing: -.022em; }
        .panel-sub { margin-top: 4px; color: #6e6e73; font-size: 11.5px; line-height: 1.35; }
        .panel-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .chart-filter {
          height: 30px; padding: 0 11px; border-radius: 10px;
          border: 1px solid transparent; background: rgba(118, 118, 128, .12);
          color: #1d1d1f; font-size: 11.5px; font-weight: 600;
          cursor: pointer; outline: none;
        }
        .chart-filter:focus { border-color: rgba(0,122,255,.4); box-shadow: 0 0 0 3px rgba(0,122,255,.10); }

        .charts-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
        .bottom-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
        @media (max-width: 900px) { .charts-row, .bottom-row { grid-template-columns: 1fr; } }
        .chart-wrap { width: 100%; height: 260px; }
        .chart-empty { height: 260px; display: grid; place-items: center; color: #8e8e93; font-size: 12px; }
        .legend { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .leg { display: inline-flex; align-items: center; gap: 5px; color: #6e6e73; font-size: 10.5px; white-space: nowrap; }
        .leg-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

        /* ── Outstanding / wallet ── */
        .outstanding-block { min-width: 0; }
        .outstanding-amount { font-size: clamp(34px, 3.6vw, 46px); line-height: 1; font-weight: 700; letter-spacing: -.045em; color: #1d1d1f; font-variant-numeric: tabular-nums; }
        .outstanding-sub { margin-top: 8px; color: #6e6e73; font-size: 12px; }
        .progress-bar-wrap { margin-top: 22px; }
        .progress-label { display: flex; align-items: center; justify-content: space-between; color: #6e6e73; font-size: 11.5px; margin-bottom: 8px; }
        .progress-label span:last-child { color: #1d1d1f; font-weight: 650; font-variant-numeric: tabular-nums; }
        .progress-track { height: 8px; border-radius: 999px; background: rgba(118, 118, 128, .14); overflow: hidden; }
        .progress-fill { height: 100%; border-radius: 999px; background: #007aff; transition: width .3s ease; }
        .credit-meta { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 20px; }
        .credit-chip { display: inline-flex; align-items: center; gap: 6px; color: #6e6e73; font-size: 11.5px; white-space: nowrap; }
        .credit-chip::before { content: ""; width: 7px; height: 7px; border-radius: 999px; background: #8e8e93; flex-shrink: 0; }
        .aging-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 20px; }
        @media (max-width: 620px) { .aging-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        .aging-cell { padding: 10px 11px; border-radius: 14px; background: rgba(118, 118, 128, .07); min-width: 0; }
        .aging-lbl { color: #8e8e93; font-size: 10px; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; }
        .aging-val { margin-top: 5px; color: #8e8e93; font-size: 13px; font-weight: 680; font-variant-numeric: tabular-nums; letter-spacing: -.02em; overflow-wrap: anywhere; }
        .aging-val.tone-green  { color: #248a3d; }
        .aging-val.tone-amber  { color: #b25000; }
        .aging-val.tone-orange { color: #c93400; }
        .aging-val.tone-red    { color: #d70015; }

        /* ── Sales team ── */
        .team-body { display: flex; flex-direction: column; gap: 10px; max-height: 300px; overflow-y: auto; }
        .team-row {
          display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
          padding: 12px 14px; border-radius: 14px; min-width: 0;
          background: rgba(118, 118, 128, .06);
        }
        .team-main { min-width: 0; }
        .team-name { color: #1d1d1f; font-size: 13px; font-weight: 650; letter-spacing: -.01em; overflow-wrap: anywhere; }
        .team-desig { margin-top: 2px; color: #8e8e93; font-size: 11px; overflow-wrap: anywhere; }
        .team-contact { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; }
        .team-link { color: #007aff; font-size: 11.5px; text-decoration: none; overflow-wrap: anywhere; }
        .team-link:hover { text-decoration: underline; text-underline-offset: 2px; }
        .team-panel .credit-chip { flex-shrink: 0; padding-top: 2px; }
        /* Third panel in a 2-up grid: span both columns so it does not sit
           orphaned in a half-width row. */
        .team-panel { grid-column: 1 / -1; }
        .team-panel .team-body { max-height: none; }
        @media (min-width: 901px) {
          .team-panel .team-body {
            display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px;
          }
        }
        .team-empty { display: grid; place-items: center; padding: 28px 0; color: #8e8e93; font-size: 12px; }

        /* ── Funnel ── */
        .funnel-body { display: flex; flex-direction: column; gap: 14px; }
        .funnel-row { display: grid; grid-template-columns: 92px minmax(0, 1fr) 92px; align-items: center; gap: 12px; }
        .funnel-lbl { color: #6e6e73; font-size: 11.5px; }
        .funnel-bar-wrap { height: 26px; border-radius: 8px; background: rgba(118, 118, 128, .10); overflow: hidden; }
        .funnel-bar { height: 100%; border-radius: 8px; display: flex; align-items: center; padding-left: 10px; color: #fff; font-size: 11px; font-weight: 650; }
        .funnel-val { text-align: right; font-size: 12px; font-weight: 680; color: #1d1d1f; font-variant-numeric: tabular-nums; }
        .annual-target { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 14px; margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(60, 60, 67, .11); }
        .at-lbl { color: #6e6e73; font-size: 11.5px; }
        .at-val { font-size: 15px; font-weight: 680; letter-spacing: -.02em; color: #1d1d1f; font-variant-numeric: tabular-nums; }

        /* ── Search ── */
        .search-wrap { position: relative; display: inline-flex; align-items: center; }
        .search-wrap svg { position: absolute; left: 12px; color: #8e8e93; pointer-events: none; }
        .search-input { height: 34px; padding: 0 12px 0 34px; border: 1px solid transparent; border-radius: 12px; font-size: 12px; width: 230px; outline: none; font-family: inherit; color: #1d1d1f; background: rgba(118, 118, 128, .10); }
        .search-input:focus { border-color: rgba(0,122,255,.4); box-shadow: 0 0 0 3px rgba(0,122,255,0.10); background: #fff; }

        .loading-pulse { background: linear-gradient(90deg, rgba(118,118,128,.08) 25%, rgba(118,118,128,.16) 50%, rgba(118,118,128,.08) 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 8px; }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

        @media (max-width: 850px) {
          .content { padding: 28px 20px 36px; }
          .dashboard-header { align-items: flex-start; }
          .profile-copy { display: none; }
          .profile-chip { padding-right: 7px; }
        }
        @media (max-width: 560px) {
          .content { padding: 24px 16px 32px; }
          .dashboard-header { margin-bottom: 24px; }
          .page-heading, .page-title { font-size: 34px; }
          .profile-chip { display: none; }
          .info-cards { grid-template-columns: 1fr; gap: 10px; }
          .icard { min-height: 140px; padding: 18px; border-radius: 20px; }
          .panel { padding: 18px; border-radius: 20px; }
          .funnel-row { grid-template-columns: 78px minmax(0, 1fr) 78px; }
        }
      `}</style>

      <div className="root">
        <div className={`overlay${sidebarOpen ? " show" : ""}`} onClick={() => setSidebarOpen(false)} aria-hidden="true" />

        {/* Sidebar */}
        <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
          <div className="sb-user">
            <div className="sb-avatar">{loading ? "…" : initials}</div>
            <div className="sb-uname">{loading ? "Loading…" : (dealer.Dealer_Name || "Dealer")}</div>
            <div className="sb-meta">{dealer.Dealer_Email || dealer.Dealer_Number || "—"}</div>
            {dealer.Dealer_Dealercode && <span className="sb-code">{dealer.Dealer_Dealercode}</span>}
          </div>
          <nav className="sb-nav">
            {NAV_ITEMS.map(item => (
              <Link key={item.href} href={item.href} className={`sb-link${pathname === item.href ? " active" : ""}`} onClick={() => setSidebarOpen(false)}>
                {item.icon}{item.label}
              </Link>
            ))}
          </nav>
          <div className="sb-foot">
            <button className="sb-logout" onClick={handleLogout}>Sign out</button>
          </div>
        </aside>

        <div className="main">
          

          <main className="content">

            {/* ── Page header ── */}
            <header className="dashboard-header">
              <div>
                <div className="eyebrow"><span className="eyebrow-dot" /> Dealer overview</div>
                <h1 className="page-title">Dashboard</h1>
                <p className="page-subtitle">Your balance and credit terms, the orders in flight, and how the year is tracking against target.</p>
              </div>

              <div className="profile-chip" aria-label="Current dealer">
                <div className="profile-chip-avatar">{loading ? "…" : initials}</div>
                <div className="profile-copy">
                  <div className="profile-chip-name">{loading ? "Loading…" : (dealer.Dealer_Name || "Dealer")}</div>
                  <div className="profile-chip-role">{dealer.Dealer_Dealercode || "Dealer"}</div>
                </div>
              </div>
            </header>

            <div className="section-label">Account</div>

            {/* Info Cards */}
            <div className="info-cards font-sans">
              <div className="icard" style={wallet?.status === "active" ? { borderColor: "rgba(52,199,89,.28)", background: "rgba(52,199,89,.045)" } : undefined}>
                <div className="icard-lbl">Wallet Balance</div>
                <div className="icard-val">{walletLoading ? "—" : fmtCurrency(wallet?.availableBalance ?? 0)}</div>
                <div className="icard-sub">Running balance after successful orders</div>
                <div className={`icard-badge ${wallet?.status === "active" ? (Number(wallet.availableBalance) > 0 ? "badge-green" : "badge-red") : "badge-blue"}`}>
                  {walletLoading ? "Loading" : wallet?.status === "active" ? (Number(wallet.availableBalance) > 0 ? "Active" : "Exhausted") : "Inactive"}
                </div>
                {wallet?.status === "active" && <div className="icard-sub">Consumed: {fmtCurrency(wallet.totalConsumed ?? 0)}</div>}
              </div>
              <div className="icard" style={outstanding > 0 ? { borderColor: "rgba(255,59,48,.28)", background: "rgba(255,59,48,.04)" } : undefined}>
                <div className="icard-lbl">Outstanding Balance</div>
                <div className="icard-val">{agingLoading ? "—" : fmtCurrency(outstanding)}</div>
                <div className="icard-sub">Unpaid, partial and overdue orders</div>
                <div className={`icard-badge ${agingLoading ? "badge-blue" : overdueAmount > 0 ? "badge-red pulse-amber" : outstanding > 0 ? "badge-amber" : "badge-green"}`}>
                  {agingLoading
                    ? "Loading"
                    : aging.count === 0
                      ? "All settled"
                      : `${aging.count} order${aging.count !== 1 ? "s" : ""} pending`}
                </div>
                {!agingLoading && overdueAmount > 0 && (
                  <div className="icard-sub">Over 30 days: {fmtCurrency(overdueAmount)}</div>
                )}
                <Link href="/Pages/ledger" className="quick-action-btn">+ View ledger</Link>
              </div>
              <div className="icard">
                <div className="icard-lbl">Annual Target</div>
                <div className="icard-val">{fmtCurrency(annualTarget)}</div>
                <div className="icard-sub">Full year goal</div>
                <div className="icard-badge badge-purple">₹{annualTarget.toLocaleString("en-IN")}</div>
              </div>
              {!isWalletActive && (
                <>
                  <div className="icard">
                    <div className="icard-lbl">Current Limit</div>
                    <div className="icard-val">{fmtCurrency(currentLimit)}</div>
                    <div className="icard-sub">Credit ceiling</div>
                    <div className="icard-badge badge-blue">{usagePct}% of target</div>
                  </div>
                  <div className="icard">
                    <div className="icard-lbl">Credit Days</div>
                    <div className="icard-val">{creditDays}</div>
                    <div className="icard-sub">Payment window</div>
                    <div className="icard-badge badge-amber">{creditDays} days</div>
                  </div>
                </>
              )}
              <div className="icard">
                <div className="icard-lbl">Discount</div>
                <div className="icard-val">{discountPct}%</div>
                <div className="icard-sub">Dealer discount rate</div>
                <div className="icard-badge badge-green">Active</div>
              </div>
            </div>

            <div className="section-label">In flight</div>

            {/* ── Sidebar Summary Widgets ── */}
            {summaryError && (
              <div className="panel" style={{ marginBottom: 16, borderColor: "rgba(255,59,48,.16)", color: "#b42318", display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
                Some summary data failed to load.
                <button className="quick-action-btn" style={{ marginTop: 0, marginLeft: "auto" }} onClick={retrySummary}>Retry</button>
              </div>
            )}
            <div className="info-cards font-sans">
              <div className="icard">
                <div className="icard-lbl">Active Cart</div>
                <div className="icard-val">{cartItems.length}</div>
                <div className="icard-sub">Items ready for checkout</div>
                <div className="icard-badge badge-blue">₹{(cartTotalPaise / 100).toLocaleString("en-IN")}</div>
                <Link href="/Pages/Cart" className="quick-action-btn">+ Open cart</Link>
              </div>
              <div className="icard">
                <div className="icard-lbl">Saved Drafts</div>
                <div className="icard-val">{summaryLoading ? "—" : draftRows.length}</div>
                <div className="icard-sub">Stored order drafts</div>
                <div className="icard-badge badge-purple">₹{draftTotal.toLocaleString("en-IN")}</div>
                <Link href="/drafts" className="quick-action-btn">+ View drafts</Link>
              </div>
              <div className="icard">
                <div className="icard-lbl">Order Status</div>
                <div className="icard-val">{summaryLoading ? "—" : orderRows.length}</div>
                <div className="icard-sub">Latest order history snapshot</div>
                <div className={`icard-badge badge-amber${pendingOrders > 0 ? " pulse-amber" : ""}`}>{pendingOrders} pending</div>
                <div className="icard-badge badge-blue" style={{ marginLeft: 6 }}>{processingOrders} processing</div>
                <div className="icard-badge badge-green" style={{ marginLeft: 6 }}>{shippedOrders} shipped</div>
              </div>
              {isWalletActive ? (
                <div className="icard">
                  <div className="icard-lbl">Advance Wallet</div>
                  <div className="icard-val">{fmtCurrency(walletAvailable)}</div>
                  <div className="icard-sub">Available balance for new orders</div>
                  <div className={`icard-badge ${walletAvailable > 0 ? "badge-green" : "badge-amber pulse-amber"}`}>
                    {walletAvailable > 0 ? "Ready" : "Top-up needed"}
                  </div>
                  <Link href="/Pages/ledger" className="quick-action-btn">+ Open ledger</Link>
                </div>
              ) : (
                <div className="icard">
                  <div className="icard-lbl">Payment Due</div>
                  <div className="icard-val">{creditDaysRemaining}</div>
                  <div className="icard-sub">Credit days remaining</div>
                  <div className={`icard-badge ${paymentAlert ? "badge-amber pulse-amber" : "badge-green"}`}>
                    {agingLoading ? "Loading" : `₹${outstanding.toLocaleString("en-IN")} outstanding`}
                  </div>
                  <Link href="/Pages/ledger" className="quick-action-btn">+ Open ledger</Link>
                </div>
              )}
            </div>

            <PendingProductsPreview role="dealer" moreHref="/dashboard/dealer/pending-products" />

            {/* Charts */}
            <div className="charts-row">

              <div className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Order Details</div>
                    <div className="panel-sub">Monthly order count</div>
                  </div>
                  <div className="legend">
                    <span className="leg"><span className="leg-dot" style={{ background: "#007aff" }} />Total Orders</span>
                  </div>
                </div>
                {loading ? (
                  <div className="chart-empty loading-pulse">Loading chart…</div>
                ) : monthlyOrders.length === 0 ? (
                  <div className="chart-empty">No order data available</div>
                ) : (
                  <div className="chart-wrap">
                    <canvas ref={barRef} />
                  </div>
                )}
              </div>

              <div className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Sales Analysis — {new Date().getFullYear()}</div>
                    <div className="panel-sub">Monthly revenue trends</div>
                  </div>
                  <div className="panel-controls">
                    <select
                      className="chart-filter"
                      value={salesPeriod}
                      onChange={(event) => setSalesPeriod(event.target.value as SalesPeriod)}
                      aria-label="Sales analysis period"
                    >
                      {SALES_PERIOD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <div className="legend">
                      <span className="leg"><span className="leg-dot" style={{ background: "#ff9500" }} />Revenue</span>
                    </div>
                  </div>
                </div>
                {loading ? (
                  <div className="chart-empty loading-pulse">Loading chart…</div>
                ) : monthlyValues.length === 0 ? (
                  <div className="chart-empty">No sales data available</div>
                ) : (
                  <div className="chart-wrap">
                    <canvas ref={lineRef} />
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Row */}
            <div className="bottom-row">

              {isWalletActive ? (
                <div className="panel">
                  <div className="panel-header">
                    <div>
                      <div className="panel-title">Advance Wallet</div>
                      <div className="panel-sub">Orders consume the active wallet balance</div>
                    </div>
                  </div>
                  <div className="outstanding-block">
                    <div className="outstanding-amount">{fmtCurrency(walletAvailable)}</div>
                    <div className="outstanding-sub">available for order placement</div>
                    <div className="credit-meta">
                      <span className="credit-chip badge-green">Active wallet</span>
                      <span className="credit-chip badge-blue">Consumed: {fmtCurrency(walletConsumed)}</span>
                      <span className="credit-chip badge-amber">Discount: {discountPct}%</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="panel">
                  <div className="panel-header">
                    <div>
                      <div className="panel-title">Outstanding</div>
                      <div className="panel-sub">Amount owed across unpaid orders</div>
                    </div>
                    <Link href="/Pages/ledger" className="quick-action-btn" style={{ marginTop: 0 }}>Ledger</Link>
                  </div>
                  <div className="outstanding-block">
                    <div className="outstanding-amount">{agingLoading ? "—" : `₹${outstanding.toLocaleString("en-IN")}`}</div>
                    <div className="outstanding-sub">
                      {agingLoading
                        ? "Loading ledger…"
                        : aging.count === 0
                          ? "No outstanding orders"
                          : `across ${aging.count} order${aging.count !== 1 ? "s" : ""}`}
                    </div>
                    <div className="progress-bar-wrap">
                      <div className="progress-label"><span>Of ₹{currentLimit.toLocaleString("en-IN")} limit</span><span>{limitUsedPct}%</span></div>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${limitUsedPct}%`, background: overdueAmount > 0 ? "#ff3b30" : undefined }} />
                      </div>
                    </div>
                    <div className="aging-grid">
                      {[
                        { label: "0–30 days", value: aging.current, cls: "tone-green" },
                        { label: "31–60 days", value: aging.d31, cls: "tone-amber" },
                        { label: "61–90 days", value: aging.d61, cls: "tone-orange" },
                        { label: "90+ days", value: aging.d90, cls: "tone-red" },
                      ].map(bucket => (
                        <div className="aging-cell" key={bucket.label}>
                          <div className="aging-lbl">{bucket.label}</div>
                          <div className={`aging-val ${bucket.value > 0 ? bucket.cls : ""}`}>
                            {agingLoading ? "—" : bucket.value > 0 ? `₹${bucket.value.toLocaleString("en-IN")}` : "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="credit-meta">
                      <span className="credit-chip badge-amber">Credit: {creditDays} days</span>
                      <span className="credit-chip badge-blue">Discount: {discountPct}%</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Sales Funnel</div>
                    <div className="panel-sub">Pipeline vs annual target</div>
                  </div>
                </div>
                <div className="funnel-body">
                  {funnel.length > 0 ? funnel.map(stage => (
                    <div className="funnel-row" key={stage.label}>
                      <div className="funnel-lbl">{stage.label}</div>
                      <div className="funnel-bar-wrap">
                        <div className="funnel-bar" style={{ width: `${Math.max(stage.pct, 14)}%`, minWidth: 60, background: stage.color }}>
                          {stage.pct}%
                        </div>
                      </div>
                      <div className="funnel-val">{fmtNum(stage.value)}</div>
                    </div>
                  )) : (
                    <div style={{ color: "#8e8e93", textAlign: "center", padding: "20px", fontSize: 12 }}>
                      {loading ? "Loading funnel…" : "No funnel data"}
                    </div>
                  )}
                </div>
                <div className="annual-target">
                  <div className="at-lbl">Annual Target</div>
                  <div className="at-val">₹{annualTarget.toLocaleString("en-IN")}</div>
                </div>
              </div>

              <div className="panel team-panel">
                <div className="panel-header">
                  <div>
                    <div className="panel-title">Your Sales Team</div>
                    <div className="panel-sub">Assigned staff and the managers above them</div>
                  </div>
                </div>
                {contactsLoading ? (
                  <div className="team-empty loading-pulse">Loading team…</div>
                ) : contacts.length === 0 ? (
                  <div className="team-empty">No staff assigned yet</div>
                ) : (
                  <div className="team-body">
                    {contacts.map((contact) => (
                      <div className="team-row" key={contact.id}>
                        <div className="team-main">
                          <div className="team-name">{contact.name || "—"}</div>
                          {contact.designation && <div className="team-desig">{contact.designation}</div>}
                          <div className="team-contact">
                            {contact.email && <a href={`mailto:${contact.email}`} className="team-link">{contact.email}</a>}
                            {contact.phone && <a href={`tel:${contact.phone}`} className="team-link">{contact.phone}</a>}
                          </div>
                        </div>
                        <span className={`credit-chip ${CONTACT_ROLE_BADGE[resolveStaffRoleKey(contact)]}`}>
                          {contact.roleLabel}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </main>
        </div>
      </div>
    </>
  );
}
