'use client'

import { formatDisplayOrderNumber } from '@/lib/orderDisplay';
import Link from "next/link"
import { useMemo, useState, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueries,
} from "@tanstack/react-query"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts"
import {
  LayoutDashboard, UserRoundPlus, ClipboardList,
  BookOpen, LogOut, ChevronUp, ChevronDown, Search, AlertCircle, Eye, Receipt,
} from "lucide-react"
import { formatRupee, resolveCurrentMonthTotal } from "@/lib/companySales"
import { resolveOrderAmounts } from "@/lib/orderAmounts"
import PendingProductsPreview from "@/components/dashboard/PendingProductsPreview"
import { clearAuthStorage } from "@/lib/roleAccess"
import { STAFF_ORDER_SCOPE_VERSION } from "@/lib/staffOrderScope.js"
import {
  applyDealerStatusOverrides,
  fetchDealerStatusOverrides,
  isActiveDealerStatus,
  type DealerStatusDocument,
} from "@/lib/dealerStatus"

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────
const year = new Date().getFullYear()

const NAV_ITEMS = [
  { label: "Dealer List",     href: "/dashboard/admin/dealer/DealerList",        icon: <LayoutDashboard size={15} /> },
  { label: "Dealer Ledger",   href: "/Pages/ledger",                             icon: <BookOpen size={15} /> },
  { label: "Add Dealer",      href: "/dashboard/admin/dealer/AddDealerForm",     icon: <UserRoundPlus size={15} /> },
  { label: "Dealer Category Report", href: "/dashboard/staff/reports/dealer-category", icon: <ClipboardList size={15} /> },
  { label: "Order List",      href: "/Pages/Ordermanagement",                    icon: <ClipboardList size={15} /> },
  { label: "Pending Orders",  href: "/Pages/Ordermanagement/outstandingorders",  icon: <ClipboardList size={15} /> },
  { label: "Discount Requests", href: "/dashboard/staff/discount-requests",      icon: <Receipt size={15} /> },
]

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
type User = {
  staff_id: string
  staff_name: string
  staff_email: string
  staff_designation: string
  staff_location: string
  staff_roletype: string
  sales_region?: string
  salesRegion?: string
  staff_username: string
  staff_dealer: string
  status: string
}

type StaffDealer = {
  Dealer_Id: string
  Dealer_Name: string
  Dealer_City: string
  Dealer_Email: string
  Dealer_Number: string
  Dealer_Address: string
  Dealer_Pincode: string
  Dealer_Dealercode: string
  discount: string
  gst: string
  creditdays: string
  currentlimit: string
  annualtarget: string
  status: string
  assignedstaff: string
}

type OrderItem   = {
  order_id: string
  total: string
  order_amount?: string | number
  order_dealer?: string
  staffid?: string
  status?: string
  order_status?: string
  order_date?: string
  orderDate?: string
  Dealer_Name?: string
  outstandingDate?: string
  accept_order?: string
}
type MonthlyData = { month: string[]; total: string[] }
type TopOrder    = { order_id: string; total: string }
type TopDealer   = { Dealer_Name: string; total: string }
type SortKey     = "Dealer_Name" | "Dealer_City" | "creditdays" | "currentlimit" | "discount"
type DiscountRequest = {
  id: string
  dealerId: string
  dealerName?: string
  requestedDiscountPercent: number
  currentDiscountPercent: number
  subtotal: number
  currentDiscountAmount: number
  requestedDiscountAmount: number
  currentFinalPayable: number
  requestedFinalPayable: number
  discountScope?: "order" | "product"
  targetProduct?: {
    displayName?: string
    variantCode?: string
    productname?: string
  } | null
  status: "pending" | "approved" | "rejected"
  createdAt: string
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function formatSalesRegion(value?: string) {
  const normalized = String(value ?? "").trim().toUpperCase()
  if (!normalized) return ""
  return normalized.charAt(0) + normalized.slice(1).toLowerCase()
}

function getRoleLabel(rt: string, salesRegion?: string) {
  if (rt === "NSM") return "NSM"
  if (rt === "RSM") {
    const regionLabel = formatSalesRegion(salesRegion)
    return regionLabel ? `${regionLabel} RSM` : "RSM"
  }
  if (rt === "ASM") return "ASM"
  if (rt === "0") return "Admin"
  if (rt === "1") return "Staff"
  if (rt === "2") return "Sales Manager"
  return "Staff"
}

function fmtCurrency(n: number) {
  if (n >= 1_000_000) return `₹${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `₹${(n / 1_000).toFixed(1)}K`
  return `₹${n}`
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (/^\s*</.test(text)) throw new Error("Expected JSON but received HTML")
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error("Invalid JSON response")
  }
}

// ─────────────────────────────────────────────────────────────
// QUERY CLIENT  (stable singleton per module load)
// ─────────────────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:        60_000,   // data stays fresh for 1 min
      gcTime:           300_000,  // cache kept for 5 min
      retry:            2,
      refetchOnWindowFocus: true,
    },
  },
})

// ─────────────────────────────────────────────────────────────
// ROOT EXPORT  (wraps with provider)
// ─────────────────────────────────────────────────────────────
export default function ExecutiveDashboardPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <ExecutiveDashboard />
    </QueryClientProvider>
  )
}

// ─────────────────────────────────────────────────────────────
// INNER COMPONENT
// ─────────────────────────────────────────────────────────────
function ExecutiveDashboard() {
  const router   = useRouter()
  const pathname = usePathname()

  // ── Auth (sync, no fetch) ────────────────────────────────────
  const [user, setUser] = useState<User | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem("staffData") || localStorage.getItem("UserData")
      if (!raw) { router.push("/auth/login"); return }
      const parsed: User = JSON.parse(raw)
      if (!parsed?.staff_id) { router.push("/auth/login"); return }
      localStorage.setItem("staffData", JSON.stringify(parsed))
      setUser(parsed)
    } catch {
      router.push("/auth/login")
    } finally {
      setAuthChecked(true)
    }
  }, [router])

  // ── UI state ─────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [dealerSearch, setDealerSearch] = useState("")
  const [sortKey,  setSortKey]  = useState<SortKey>("Dealer_Name")
  const [sortAsc,  setSortAsc]  = useState(true)
  const [dealerPage, setDealerPage] = useState(1)
  const DEALER_PAGE_SIZE = 10

  // ── React Query — parallel queries ───────────────────────────
  //   useQueries fires all at once; each caches + retries independently.
  const enabled = !!user?.staff_id

  const [
    ordersQ,
    dealersQ,
    discountRequestsQ,
    monthlyOrdersQ,
    monthlyValueQ,
    topOrdersQ,
    topDealersQ,
  ] = useQueries({
    queries: [
      {
        queryKey:  ["staffOrders", STAFF_ORDER_SCOPE_VERSION, user?.staff_id],
        queryFn:   () => fetchJson<{ data: OrderItem[] }>(`/api/orders-data?page=1&limit=1000&search=`),
        enabled,
        select:    (d: { data: OrderItem[] }) => (d.data ?? []).map((order) => ({
          ...order,
          total: String(order.total ?? order.order_amount ?? 0),
        })),
      },
      {
        queryKey:  ["staffAssignedDealers", user?.staff_id],
        queryFn:   () => fetchJson<{ data: StaffDealer[] }>(`/api/staff/dealers`),
        enabled,
        select:    (d: { data: StaffDealer[] }) => d.data ?? [],
      },
      {
        queryKey:  ["staffDiscountRequests", user?.staff_id],
        queryFn:   () => fetchJson<{ data: DiscountRequest[] }>(`/api/custom-discount-requests?staff_id=${encodeURIComponent(user!.staff_id)}&status=pending&limit=200`),
        enabled,
        select:    (d: { data: DiscountRequest[] }) => d.data ?? [],
      },
      {
        queryKey:  ["monthlyOrders"],
        queryFn:   async () => ({ month: [], total: [] } as MonthlyData),
        enabled,
        staleTime: 5 * 60_000,
      },
      {
        queryKey:  ["monthlyValue"],
        queryFn:   async () => ({ month: [], total: [] } as MonthlyData),
        enabled,
        staleTime: 5 * 60_000,
      },
      {
        queryKey:  ["topOrders"],
        queryFn:   async () => ({ top: [] as TopOrder[] }),
        enabled,
        select:    (d: { top: TopOrder[] }) => d.top ?? [],
        staleTime: 5 * 60_000,
      },
      {
        queryKey:  ["topDealers"],
        queryFn:   async () => ({ top: [] as TopDealer[] }),
        enabled,
        select:    (d: { top: TopDealer[] }) => d.top ?? [],
        staleTime: 5 * 60_000,
      },
    ],
  })

  // ── Derived values ────────────────────────────────────────────
  const dealerStatusesQ = useQuery<DealerStatusDocument[]>({
    queryKey: ["staffDealerStatuses"],
    queryFn: fetchDealerStatusOverrides,
    enabled,
    staleTime: 5 * 60_000,
  })

  const rawOrders = (ordersQ.data as OrderItem[] | undefined) ?? []
  const rawDealers = (dealersQ.data as StaffDealer[] | undefined) ?? []
  const dealers = useMemo(
    () => applyDealerStatusOverrides(rawDealers, dealerStatusesQ.data ?? [])
      .filter((dealer) => isActiveDealerStatus(dealer.status)),
    [dealerStatusesQ.data, rawDealers]
  )
  const discountRequests = (discountRequestsQ.data as DiscountRequest[] | undefined) ?? []
  const monthlyTotals = new Map<string, { orders: number; value: number }>()
  for (const order of rawOrders) {
    const month = String(order.order_date ?? order.orderDate ?? "").slice(0, 7)
    if (!month) continue
    const current = monthlyTotals.get(month) ?? { orders: 0, value: 0 }
    current.orders += 1
    current.value += Number(order.total ?? order.order_amount ?? 0)
    monthlyTotals.set(month, current)
  }
  const monthlyEntries = Array.from(monthlyTotals.entries()).sort(([left], [right]) => left.localeCompare(right))
  const totalOrders: MonthlyData = { month: monthlyEntries.map(([month]) => month), total: monthlyEntries.map(([, totals]) => String(totals.orders)) }
  const totalValue: MonthlyData = { month: monthlyEntries.map(([month]) => month), total: monthlyEntries.map(([, totals]) => String(totals.value)) }
  const topOrders: TopOrder[] = rawOrders
    .map((order) => ({ order_id: String(order.order_id ?? ""), total: String(order.total ?? order.order_amount ?? 0) }))
    .sort((left, right) => Number(right.total) - Number(left.total))
    .slice(0, 5)
  const dealerTotals = new Map<string, number>()
  for (const order of rawOrders) {
    const name = String(order.Dealer_Name ?? "Dealer")
    dealerTotals.set(name, (dealerTotals.get(name) ?? 0) + Number(order.total ?? order.order_amount ?? 0))
  }
  const topDealers: TopDealer[] = Array.from(dealerTotals, ([Dealer_Name, total]) => ({ Dealer_Name, total: String(total) }))
    .sort((left, right) => Number(right.total) - Number(left.total))
    .slice(0, 5)
  const currentMonth = new Date().toISOString().slice(0, 7)
  const currentMonthOrders = rawOrders.filter((order) => String(order.order_date ?? order.orderDate ?? "").slice(0, 7) === currentMonth)
  const companyWideOrders = currentMonthOrders.length
  const companyWideSales = currentMonthOrders.reduce((sum, order) => sum + Number(order.total ?? order.order_amount ?? 0), 0)

  const orders = rawOrders

  const stats = useMemo(() => ({
    myOrders:      orders.length,
    totalRevenue:  orders.reduce((s, o) => s + resolveOrderAmounts(o).netPayable, 0),
    pendingOrders: orders.filter(o => o.status === "pending" || o.order_status === "0").length,
    myDealers:     dealers.length,
    pendingDiscountRequests: discountRequests.length,
  }), [orders, dealers, discountRequests])

  const activeDealers = dealers.length

  const companyMonthLoading = monthlyOrdersQ.isLoading || monthlyValueQ.isLoading

  const nearCreditLimitDealers = useMemo(
    () => dealers.filter(d => {
      const current = Number(d.currentlimit) || 0
      const target = Number(d.annualtarget) || 0
      return target > 0 && current / target > 0.8
    }),
    [dealers]
  )

  // Any query still loading the very first time
  const globalLoading = !authChecked || [ordersQ, dealersQ, discountRequestsQ].some(q => q.isLoading)
  // Any hard error
  const anyError = [ordersQ, dealersQ, discountRequestsQ, monthlyOrdersQ, monthlyValueQ, topOrdersQ, topDealersQ]
    .find(q => q.isError)

  const refetchAll = () => {
    ordersQ.refetch()
    dealersQ.refetch()
    discountRequestsQ.refetch()
    monthlyOrdersQ.refetch()
    monthlyValueQ.refetch()
    topOrdersQ.refetch()
    topDealersQ.refetch()
    dealerStatusesQ.refetch()
  }

  // ── Chart data ────────────────────────────────────────────────
  const ordersChartData     = (totalOrders?.month ?? []).map((m, i) => ({ name: m, value: Number(totalOrders?.total[i] || 0) }))
  const revenueChartData    = (totalValue?.month  ?? []).map((m, i) => ({ name: m, value: Number(totalValue?.total[i]  || 0) }))
  const topOrdersChartData  = topOrders.map(o => ({ name: `#${o.order_id}`, value: Number(o.total) }))
  const topDealersChartData = topDealers.map(d => ({ name: d.Dealer_Name.substring(0, 12), value: Number(d.total) }))

  // ── Dealer table ──────────────────────────────────────────────
  const filteredDealers = useMemo(() => {
    const q = dealerSearch.toLowerCase()
    return dealers
      .filter(d =>
        !q ||
        d.Dealer_Name?.toLowerCase().includes(q) ||
        d.Dealer_City?.toLowerCase().includes(q) ||
        d.Dealer_Dealercode?.toLowerCase().includes(q) ||
        d.Dealer_Number?.includes(q)
      )
      .sort((a, b) => {
        const av =
          sortKey === "currentlimit" || sortKey === "creditdays" || sortKey === "discount"
            ? Number(a[sortKey] || 0) - Number(b[sortKey] || 0)
            : (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "")
        return sortAsc ? av : -av
      })
  }, [dealers, dealerSearch, sortKey, sortAsc])

  useEffect(() => { setDealerPage(1) }, [dealerSearch, sortKey, sortAsc])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(v => !v)
    else { setSortKey(key); setSortAsc(true) }
  }

  const handleLogout = () => { clearAuthStorage(localStorage); window.dispatchEvent(new Event("omsons-auth-changed")); router.push("/auth/login") }

  if (!user) return null

  const initials   = user.staff_name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()
  const roleLabel  = getRoleLabel(user.staff_roletype, user.sales_region || user.salesRegion)
  const rsmRegionLabel = user.staff_roletype === "RSM" ? formatSalesRegion(user.sales_region || user.salesRegion) : ""

  const STAT_CONFIG = [
    {
      label: "Assigned Sales",
      value: formatRupee(companyWideSales),
      badge: "badge-purple",
      badgeLabel: "This month",
      href: "/dashboard/staff/sales",
      sub: "Sales across all distributors",
    },
    {
      label: "Assigned Orders",
      value: companyWideOrders.toLocaleString("en-IN"),
      badge: "badge-blue",
      badgeLabel: "This month",
      href: "/dashboard/staff/sales",
      sub: "Orders across all distributors",
    },
    { label: "Pending Orders", value: stats.pendingOrders, badge: "badge-amber",  badgeLabel: "Action needed" },
    { label: "My Dealers",     value: stats.myDealers,     badge: "badge-green",  badgeLabel: "Assigned" },
    { label: "Discount Requests", value: stats.pendingDiscountRequests, badge: "badge-amber", badgeLabel: `${stats.pendingDiscountRequests} pending` },
    { label: "Total Orders",   value: stats.myOrders,      badge: "badge-blue",   badgeLabel: "All time" },
    { label: "Total Revenue",  value: formatRupee(stats.totalRevenue), badge: "badge-purple", badgeLabel: `₹${stats.totalRevenue.toLocaleString("en-IN")}` },
  ]

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k
      ? (sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
      : <span style={{ display: "inline-block", width: 12 }} />

  const MoneyTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: "rgba(255,255,255,.96)", border: "1px solid rgba(60,60,67,.12)", borderRadius: 14, boxShadow: "0 10px 30px rgba(0,0,0,.10)", padding: "9px 13px" }}>
        <div style={{ color: "#6e6e73", fontSize: 11, marginBottom: 4 }}>{label}</div>
        <div style={{ color: "#1d1d1f", fontWeight: 680, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>₹{Number(payload[0].value).toLocaleString("en-IN")}</div>
      </div>
    )
  }
  const CountTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: "rgba(255,255,255,.96)", border: "1px solid rgba(60,60,67,.12)", borderRadius: 14, boxShadow: "0 10px 30px rgba(0,0,0,.10)", padding: "9px 13px" }}>
        <div style={{ color: "#6e6e73", fontSize: 11, marginBottom: 4 }}>{label}</div>
        <div style={{ color: "#1d1d1f", fontWeight: 680, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{Number(payload[0].value).toLocaleString("en-IN")} orders</div>
      </div>
    )
  }

  // ── Pagination helpers ────────────────────────────────────────
  const totalDealerPages = Math.ceil(filteredDealers.length / DEALER_PAGE_SIZE)
  const pageStart        = (dealerPage - 1) * DEALER_PAGE_SIZE
  const paginated        = filteredDealers.slice(pageStart, pageStart + DEALER_PAGE_SIZE)

  const pageRange = (): (number | "...")[] => {
    const r: (number | "...")[] = [1]
    const lo = Math.max(2, dealerPage - 1)
    const hi = Math.min(totalDealerPages - 1, dealerPage + 1)
    if (lo > 2) r.push("...")
    for (let i = lo; i <= hi; i++) r.push(i)
    if (hi < totalDealerPages - 1) r.push("...")
    if (totalDealerPages > 1) r.push(totalDealerPages)
    return r
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        button, input { font: inherit; }

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
        .sidebar { position: fixed; top: 0; left: 0; bottom: 0; width: 256px; z-index: 40; background: #0d0c16; display: flex; flex-direction: column; transform: translateX(-100%); transition: transform 0.28s cubic-bezier(0.4,0,0.2,1); }
        .sidebar.open { transform: translateX(0); }
        .sidebar .sb-head { padding: 24px 20px 16px; border-bottom: 1px solid rgba(255,255,255,0.07); }
        .sidebar .sb-chip { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; background: rgba(99,102,241,0.16); color: #818cf8; font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 10px; }
        .sidebar .sb-title { font-size: 16px; font-weight: 600; color: #fff; letter-spacing: -.3px; }
        .sidebar .sb-user { margin: 14px 14px 0; padding: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; }
        .sidebar .sb-avatar { width: 38px; height: 38px; border-radius: 50%; background: linear-gradient(135deg,#6366f1,#a78bfa); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 8px; }
        .sidebar .sb-uname { font-size: 13px; font-weight: 600; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sidebar .sb-meta  { font-size: 10.5px; color: #94a3b8; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sidebar .sb-role  { margin-top: 6px; display: inline-block; font-size: 10px; font-family: monospace; background: rgba(99,102,241,0.18); color: #a5b4fc; padding: 2px 8px; border-radius: 6px; }
        .sidebar .sb-nav { flex: 1; padding: 10px; margin-top: 10px; overflow-y: auto; }
        .sidebar .sb-nav::-webkit-scrollbar { width: 5px; }
        .sidebar .sb-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
        .sidebar .sb-link { display: flex; align-items: center; gap: 11px; padding: 10px 13px; border-radius: 8px; font-size: 13.5px; font-weight: 500; color: #94a3b8; text-decoration: none; margin-bottom: 2px; transition: background .16s, color .16s; }
        .sidebar .sb-link:hover { background: rgba(255,255,255,0.05); color: #e2e8f0; }
        .sidebar .sb-link.active { background: rgba(99,102,241,0.20); color: #a5b4fc; box-shadow: inset 3px 0 0 #6366f1; }
        .sidebar .sb-foot { padding: 14px; border-top: 1px solid rgba(255,255,255,0.07); }
        .sidebar .sb-logout { width: 100%; padding: 9px 14px; border-radius: 8px; background: transparent; border: 1px solid rgba(255,255,255,0.09); font-size: 13px; font-weight: 500; color: #94a3b8; cursor: pointer; font-family: inherit; transition: all .16s; display: flex; align-items: center; justify-content: center; gap: 7px; }
        .sidebar .sb-logout:hover { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.28); color: #f87171; }

        .overlay { position: fixed; inset: 0; z-index: 30; background: rgba(0,0,0,0.5); backdrop-filter: blur(3px); opacity: 0; pointer-events: none; transition: opacity .28s; }
        .overlay.show { opacity: 1; pointer-events: all; }

        /* ── Shell ── */
        .content { width: min(100%, 1840px); margin: 0 auto; padding: 38px 34px 48px; }

        /* ── Profile strip ── */
        .profile-strip {
          display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
          padding: 18px 22px; margin-bottom: 30px;
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid rgba(60, 60, 67, .075);
          box-shadow: 0 1px 2px rgba(0,0,0,.02), 0 10px 34px rgba(0,0,0,.045);
          backdrop-filter: saturate(180%) blur(20px);
          border-radius: 24px;
        }
        .profile-avatar { width: 52px; height: 52px; flex-shrink: 0; border-radius: 50%; background: linear-gradient(145deg, #1d1d1f, #52525a); display: grid; place-items: center; font-size: 18px; font-weight: 700; letter-spacing: -.02em; color: #fff; }
        .profile-name  { font-size: 16px; font-weight: 680; letter-spacing: -.022em; color: #1d1d1f; }
        .profile-email { font-size: 11.5px; color: #6e6e73; margin-top: 3px; }
        .profile-chips { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 9px; }
        .pchip { padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 620; }
        .pc-purple { background: rgba(175,82,222,.10); color: #af52de; }
        .pc-blue   { background: rgba(0,122,255,.10); color: #007aff; }
        .pc-amber  { background: rgba(255,149,0,.12); color: #b25c00; }
        .pc-green  { background: rgba(52,199,89,.12); color: #1a7f37; font-variant-numeric: tabular-nums; }

        /* ── Refetch indicator ── */
        .refetch-bar { height: 2px; background: linear-gradient(90deg, rgba(0,122,255,0), #007aff, rgba(0,122,255,0)); animation: slide 1.2s infinite; border-radius: 2px; margin-bottom: 12px; }
        @keyframes slide { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }

        /* ── Page header ── */
        .dashboard-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 30px; }
        .eyebrow { display: inline-flex; align-items: center; gap: 7px; color: #007aff; font-size: 12px; line-height: 1; font-weight: 650; margin-bottom: 10px; }
        .eyebrow-dot { width: 7px; height: 7px; border-radius: 999px; background: #007aff; box-shadow: 0 0 0 4px rgba(0, 122, 255, .09); }
        .page-title { margin: 0; font-size: clamp(32px, 4vw, 44px); line-height: 1.02; letter-spacing: -.045em; font-weight: 720; color: #1d1d1f; }
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
        .profile-chip-name { max-width: 180px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #1d1d1f; font-size: 12px; font-weight: 650; }
        .profile-chip-role { color: #8e8e93; font-size: 10.5px; margin-top: 1px; }

        /* ── Section labels ── */
        .section-label { margin: 0 0 12px 2px; color: #6e6e73; font-size: 12px; font-weight: 650; letter-spacing: .01em; }

        /* ── Stat cards ── */
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; margin-bottom: 30px; }
        .stat-card {
          min-height: 158px; padding: 20px 21px; border-radius: 22px;
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid rgba(60, 60, 67, .075);
          box-shadow: 0 1px 2px rgba(0,0,0,.02), 0 10px 34px rgba(0,0,0,.045);
          backdrop-filter: saturate(180%) blur(20px);
          transition: transform 180ms ease, box-shadow 180ms ease;
        }
        .stat-card:hover { transform: translateY(-1px); box-shadow: 0 1px 2px rgba(0,0,0,.02), 0 14px 38px rgba(0,0,0,.055); }
        .stat-link-card { display: block; text-decoration: none; color: inherit; }
        .stat-lbl { color: #6e6e73; font-size: 12px; font-weight: 600; letter-spacing: -.005em; }
        .stat-val { margin-top: 12px; color: #1d1d1f; font-size: clamp(28px, 3.2vw, 34px); line-height: 1; font-weight: 700; letter-spacing: -.045em; font-variant-numeric: tabular-nums; }
        .stat-sub { font-size: 11px; color: #8e8e93; margin-top: 8px; line-height: 1.4; }
        .stat-badge {
          display: inline-flex; align-items: center; gap: 6px;
          margin-top: 15px; margin-right: 12px;
          color: #6e6e73; font-size: 11.5px; line-height: 1.35; white-space: nowrap;
        }
        .stat-badge::before { content: ""; width: 7px; height: 7px; border-radius: 999px; background: #8e8e93; flex-shrink: 0; }
        .badge-amber::before  { background: #ff9500; }
        .badge-green::before  { background: #34c759; }
        .badge-blue::before   { background: #007aff; }
        .badge-purple::before { background: #af52de; }
        .badge-red::before    { background: #ff3b30; }
        .pulse-amber::before { animation: pulseAmber 1.8s infinite; }
        @keyframes pulseAmber { 0%{box-shadow:0 0 0 0 rgba(255,149,0,0.55)} 70%{box-shadow:0 0 0 6px rgba(255,149,0,0)} 100%{box-shadow:0 0 0 0 rgba(255,149,0,0)} }
        .quick-action-btn { display: inline-block; margin-top: 12px; color: #007aff; font-size: 11.5px; font-weight: 620; text-decoration: none; white-space: nowrap; }
        .quick-action-btn:hover { text-decoration: underline; text-underline-offset: 2px; }

        /* ── Panels / Charts ── */
        .charts-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
        @media (max-width: 850px) { .charts-2 { grid-template-columns: 1fr; } }
        .panel {
          padding: 22px; border-radius: 24px; min-width: 0;
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid rgba(60, 60, 67, .075);
          box-shadow: 0 1px 2px rgba(0,0,0,.02), 0 10px 34px rgba(0,0,0,.045);
          backdrop-filter: saturate(180%) blur(20px);
        }
        .panel-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 18px; margin-bottom: 18px; }
        .panel-title { color: #1d1d1f; font-size: 16px; line-height: 1.2; font-weight: 680; letter-spacing: -.022em; }
        .panel-sub   { margin-top: 4px; color: #6e6e73; font-size: 11.5px; line-height: 1.35; }
        .chart-canvas { height: 260px; width: 100%; }
        .chart-empty  { height: 260px; display: grid; place-items: center; color: #8e8e93; font-size: 12px; }
        .legend { display: inline-flex; align-items: center; gap: 5px; color: #6e6e73; font-size: 10.5px; white-space: nowrap; }
        .leg-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }

        /* ── Reports ── */
        .reports-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 26px; }
        @media (max-width: 640px) { .reports-row { grid-template-columns: 1fr; } }
        .rpt-head { margin-bottom: 5px; color: #6e6e73; font-size: 11px; font-weight: 650; }
        .report-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; min-height: 39px; border-top: 1px solid rgba(60, 60, 67, .11); font-size: 12px; }
        .report-item:first-of-type { border-top: 0; }
        .report-name  { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #6e6e73; }
        .report-value { color: #1d1d1f; font-weight: 650; font-variant-numeric: tabular-nums; }
        .report-empty { padding: 22px 0; color: #8e8e93; font-size: 12px; }

        /* ── Dealer table ── */
        .dealer-table-wrap { overflow-x: auto; }
        .dealer-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .dealer-table th { padding: 0 12px 10px; text-align: left; font-size: 11px; font-weight: 650; color: #6e6e73; white-space: nowrap; cursor: pointer; user-select: none; }
        .dealer-table th:hover { color: #1d1d1f; }
        .dealer-table td { padding: 12px; border-top: 1px solid rgba(60, 60, 67, .11); vertical-align: middle; }
        .dealer-table tr:hover td { background: rgba(118, 118, 128, .05); }
        .dt-name { font-weight: 620; color: #1d1d1f; font-size: 12.5px; }
        .dt-sub  { font-size: 10.5px; color: #8e8e93; margin-top: 2px; }
        .dt-code { font-size: 10.5px; color: #8e8e93; font-variant-numeric: tabular-nums; }
        .dt-mono { font-size: 12.5px; color: #6e6e73; font-variant-numeric: tabular-nums; }
        .st-active, .st-inactive { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: #6e6e73; white-space: nowrap; }
        .st-active::before, .st-inactive::before { content: ""; width: 7px; height: 7px; border-radius: 999px; flex-shrink: 0; }
        .st-active::before   { background: #34c759; }
        .st-inactive::before { background: #ff3b30; }
        .view-btn { display: inline-flex; align-items: center; gap: 4px; color: #007aff; font-size: 11.5px; font-weight: 620; background: none; border: none; cursor: pointer; text-decoration: none; }
        .view-btn:hover { text-decoration: underline; text-underline-offset: 2px; }

        /* ── Error banner ── */
        .err-banner {
          display: flex; align-items: center; gap: 12px;
          margin-bottom: 16px; padding: 12px 14px;
          border: 1px solid rgba(255, 59, 48, .16);
          background: rgba(255,255,255,.8);
          border-radius: 16px; color: #b42318; font-size: 13px;
        }
        .retry-btn { margin-left: auto; border: 0; background: transparent; color: #007aff; cursor: pointer; font-weight: 650; padding: 4px 7px; }

        /* ── Search ── */
        .search-wrap { position: relative; display: inline-flex; align-items: center; }
        .search-wrap svg { position: absolute; left: 12px; color: #8e8e93; pointer-events: none; }
        .search-input { height: 34px; padding: 0 12px 0 34px; border: 1px solid transparent; border-radius: 12px; font-size: 12px; width: 230px; outline: none; font-family: inherit; color: #1d1d1f; background: rgba(118, 118, 128, .10); transition: border-color .15s, box-shadow .15s, background .15s; }
        .search-input::placeholder { color: #8e8e93; }
        .search-input:focus { border-color: rgba(0,122,255,.4); box-shadow: 0 0 0 3px rgba(0,122,255,0.10); background: #fff; }

        /* ── Shimmer ── */
        .shimmer { background: linear-gradient(90deg, rgba(118,118,128,.08) 25%, rgba(118,118,128,.16) 50%, rgba(118,118,128,.08) 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 8px; }
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
          .page-title { font-size: 34px; }
          .page-subtitle { font-size: 14px; }
          .profile-chip { display: none; }
          .stat-grid { grid-template-columns: 1fr; gap: 10px; }
          .stat-card { min-height: 140px; padding: 18px; border-radius: 20px; }
          .panel { padding: 18px; border-radius: 20px; }
          .profile-strip { border-radius: 20px; }
        }
      `}</style>

      <div className="root">

        {/* ── Overlay ── */}
        <div
          className={`overlay${sidebarOpen ? " show" : ""}`}
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />

        {/* ── Sidebar ── */}
        <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
          <div className="sb-head">
            <div className="sb-chip">Staff Portal</div>
            <div className="sb-title">Workspace</div>
          </div>
          <div className="sb-user">
            <div className="sb-avatar">{initials}</div>
            <div className="sb-uname">{user.staff_name}</div>
            <div className="sb-meta">{user.staff_email || "—"}</div>
            <span className="sb-role">{roleLabel}</span>
          </div>
          <nav className="sb-nav">
            {NAV_ITEMS.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={`sb-link${pathname === item.href ? " active" : ""}`}
                onClick={() => setSidebarOpen(false)}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="sb-foot">
            <button className="sb-logout" onClick={handleLogout}>
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <div>
          <main className="content">

            {/* Background refetch indicator — shows only when re-fetching cached data */}
            {[ordersQ, dealersQ, monthlyOrdersQ, monthlyValueQ].some(q => q.isFetching && !q.isLoading) && (
              <div className="refetch-bar" />
            )}

            {/* Error banner — per-query granular */}
            {anyError && (
              <div className="err-banner">
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                Some data failed to load. Cached results shown where available.
                <button className="retry-btn" onClick={refetchAll}>Retry all</button>
              </div>
            )}

            {/* ── Page header ── */}
            <header className="dashboard-header">
              <div>
                <div className="eyebrow"><span className="eyebrow-dot" /> Staff overview</div>
                <h1 className="page-title">Dashboard</h1>
                <p className="page-subtitle">Your assigned distributors, the orders and requests waiting on you, and how the territory is tracking.</p>
              </div>

              <div className="profile-chip" aria-label="Current staff member">
                <div className="profile-chip-avatar">{initials}</div>
                <div className="profile-copy">
                  <div className="profile-chip-name">{user.staff_name}</div>
                  <div className="profile-chip-role">{roleLabel}</div>
                </div>
              </div>
            </header>

            {/* ── Profile Strip ── */}
            <div className="profile-strip">
              <div className="profile-avatar">{initials}</div>
              <div>
                <div className="profile-name">{user.staff_name}</div>
                <div className="profile-email">{user.staff_email || "—"}</div>
                <div className="profile-chips">
                  <span className="pchip pc-purple">{roleLabel}</span>
                  {rsmRegionLabel && (
                    <span className="pchip pc-blue">{rsmRegionLabel} Zone</span>
                  )}
                  {user.staff_designation?.trim() && (
                    <span className="pchip pc-blue">{user.staff_designation.trim()}</span>
                  )}
                  {user.staff_location && (
                    <span className="pchip pc-amber">📍 {user.staff_location}</span>
                  )}
                  <span className="pchip pc-green">ID: {user.staff_id}</span>
                </div>
              </div>
            </div>

            <div className="section-label">At a glance</div>

            {/* ── Stat Cards ── */}
            <div className="stat-grid">
              {STAT_CONFIG.map(s => (
                s.href ? (
                  <Link key={s.label} href={s.href} className="stat-card stat-link-card">
                    <div className="stat-lbl">{s.label}</div>
                    <div className="stat-val">
                      {companyMonthLoading
                        ? <span className="shimmer" style={{ display: "inline-block", width: 72, height: 26 }} />
                        : s.value}
                    </div>
                    <div className="stat-sub">{s.sub}</div>
                    <div className={`stat-badge ${s.badge}`}>{s.badgeLabel}</div>
                  </Link>
                ) : (
                  <div key={s.label} className="stat-card">
                    <div className="stat-lbl">{s.label}</div>
                    <div className="stat-val">
                      {globalLoading
                        ? <span className="shimmer" style={{ display: "inline-block", width: 60, height: 26 }} />
                        : s.value}
                    </div>
                    <div className={`stat-badge ${s.badge}`}>{s.badgeLabel}</div>
                  </div>
                )
              ))}
            </div>

            <div className="section-label">My workload</div>

            {/* ── Sidebar Summary Widgets ── */}
            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-lbl">Assigned Dealers</div>
                <div className="stat-val">
                  {dealersQ.isLoading
                    ? <span className="shimmer" style={{ display: "inline-block", width: 60, height: 26 }} />
                    : stats.myDealers}
                </div>
                <div className="stat-sub">Dealers mapped to your staff ID</div>
                <div className="stat-badge badge-green">{activeDealers} active</div>
                <Link href="/dashboard/staff/dealerlist" className="quick-action-btn">+ View dealers</Link>
              </div>

              <div className="stat-card">
                <div className="stat-lbl">Pending Orders</div>
                <div className="stat-val">
                  {ordersQ.isLoading
                    ? <span className="shimmer" style={{ display: "inline-block", width: 60, height: 26 }} />
                    : stats.pendingOrders}
                </div>
                <div className="stat-sub">Orders awaiting action from assigned dealers</div>
                <div className={`stat-badge badge-amber${stats.pendingOrders > 0 ? " pulse-amber" : ""}`}>{stats.pendingOrders} pending</div>
                <Link href="/Pages/Ordermanagement/outstandingorders" className="quick-action-btn">+ Review orders</Link>
              </div>

              <div className="stat-card">
                <div className="stat-lbl">Discount Requests</div>
                <div className="stat-val">
                  {discountRequestsQ.isLoading
                    ? <span className="shimmer" style={{ display: "inline-block", width: 60, height: 26 }} />
                    : stats.pendingDiscountRequests}
                </div>
                <div className="stat-sub">Pending discount approvals linked to your staff ID</div>
                <div className={`stat-badge badge-amber${stats.pendingDiscountRequests > 0 ? " pulse-amber" : ""}`}>
                  {stats.pendingDiscountRequests} pending
                </div>
                <Link href="/dashboard/staff/discount-requests" className="quick-action-btn">+ View requests</Link>
              </div>

              <div className="stat-card">
                <div className="stat-lbl">Credit Watch</div>
                <div className="stat-val">
                  {dealersQ.isLoading
                    ? <span className="shimmer" style={{ display: "inline-block", width: 60, height: 26 }} />
                    : nearCreditLimitDealers.length}
                </div>
                <div className="stat-sub">Dealers using over 80% of annual target</div>
                <div className={`stat-badge ${nearCreditLimitDealers.length > 0 ? "badge-red" : "badge-blue"}`}>
                  {nearCreditLimitDealers.length} near limit
                </div>
                <Link href="/Pages/ledger" className="quick-action-btn">+ Open ledger</Link>
              </div>
            </div>

            {/* ── Charts Row 1 ── */}
            <PendingProductsPreview role="staff" moreHref="/dashboard/staff/pending-products" />

            <div className="charts-2">
              <ChartPanel
                title="Monthly Orders"
                sub="Total order count per month"
                legendColor="#007aff"
                legendLabel="Orders"
                loading={monthlyOrdersQ.isLoading}
                data={ordersChartData}
                barFill="#007aff"
                Tooltip={CountTooltip}
              />
              <ChartPanel
                title="Monthly Revenue"
                sub="Total value per month"
                legendColor="#ff9500"
                legendLabel="Revenue"
                loading={monthlyValueQ.isLoading}
                data={revenueChartData}
                barFill="#ff9500"
                Tooltip={MoneyTooltip}
              />
            </div>

            {/* ── Charts Row 2 ── */}
            <div className="charts-2">
              <ChartPanel
                title="Top Orders"
                sub="Order value distribution"
                legendColor="#007aff"
                legendLabel="Order Value"
                loading={topOrdersQ.isLoading}
                data={topOrdersChartData}
                barFill="#007aff"
                Tooltip={MoneyTooltip}
              />
              <ChartPanel
                title="Top Dealers"
                sub="Dealer performance ranking"
                legendColor="#8e8e93"
                legendLabel="Total Value"
                loading={topDealersQ.isLoading}
                data={topDealersChartData}
                barFill="#8e8e93"
                Tooltip={MoneyTooltip}
              />
            </div>

            {/* ── Reports panel ── */}
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-header">
                <div>
                  <div className="panel-title">Reports</div>
                  <div className="panel-sub">Top performing orders and dealers</div>
                </div>
              </div>
              <div className="reports-row">
                <div>
                  <div className="rpt-head">Top Orders</div>
                  {topOrdersQ.isLoading
                    ? <div className="report-empty shimmer" style={{ height: 18, width: "60%", borderRadius: 4 }} />
                    : topOrders.length > 0
                      ? topOrders.map(item => (
                        <div key={item.order_id} className="report-item">
                          <span className="report-name">{formatDisplayOrderNumber(item.order_id)}</span>
                          <span className="report-value">₹{Number(item.total).toLocaleString("en-IN")}</span>
                        </div>
                      ))
                      : <div className="report-empty">No data available</div>}
                </div>
                <div>
                  <div className="rpt-head">Top Dealers</div>
                  {topDealersQ.isLoading
                    ? <div className="report-empty shimmer" style={{ height: 18, width: "60%", borderRadius: 4 }} />
                    : topDealers.length > 0
                      ? topDealers.map((d, i) => (
                        <div key={i} className="report-item">
                          <span className="report-name">{d.Dealer_Name}</span>
                          <span className="report-value">₹{Number(d.total).toLocaleString("en-IN")}</span>
                        </div>
                      ))
                      : <div className="report-empty">No data available</div>}
                </div>
              </div>
            </div>

            {/* ── Assigned Dealers Table ── */}
            <div className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">My Assigned Dealers</div>
                  <div className="panel-sub">
                    {dealersQ.isLoading
                      ? "Loading…"
                      : `${filteredDealers.length} of ${dealers.length} dealers`}
                  </div>
                </div>
                <div className="search-wrap">
                  <Search size={14} />
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Search dealers…"
                    value={dealerSearch}
                    onChange={e => setDealerSearch(e.target.value)}
                  />
                </div>
              </div>

              {dealersQ.isLoading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 0" }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="shimmer" style={{ height: 44, borderRadius: 8 }} />
                  ))}
                </div>
              ) : filteredDealers.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#8e8e93", fontSize: 13 }}>
                  {dealers.length === 0 ? "No dealers assigned." : "No dealers match your search."}
                </div>
              ) : (
                <>
                  <div className="dealer-table-wrap">
                    <table className="dealer-table">
                      <thead>
                        <tr>
                          <th onClick={() => handleSort("Dealer_Name")} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            Dealer <SortIcon k="Dealer_Name" />
                          </th>
                          <th onClick={() => handleSort("Dealer_City")}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>City <SortIcon k="Dealer_City" /></span>
                          </th>
                          <th>Contact</th>
                          <th onClick={() => handleSort("discount")}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Disc% <SortIcon k="discount" /></span>
                          </th>
                          <th onClick={() => handleSort("creditdays")}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Credit Days <SortIcon k="creditdays" /></span>
                          </th>
                          <th onClick={() => handleSort("currentlimit")}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Limit <SortIcon k="currentlimit" /></span>
                          </th>
                          <th>Status</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {paginated.map((d, i) => (
                          <tr key={d.Dealer_Id || i}>
                            <td>
                              <div className="dt-name">{d.Dealer_Name}</div>
                              {d.Dealer_Dealercode && (
                                <div style={{ marginTop: 3 }}>
                                  <span className="dt-code">{d.Dealer_Dealercode}</span>
                                </div>
                              )}
                            </td>
                            <td>
                              <div className="dt-mono">{d.Dealer_City || "—"}</div>
                              {d.Dealer_Pincode && <div className="dt-sub">{d.Dealer_Pincode}</div>}
                            </td>
                            <td>
                              <div className="dt-mono">{d.Dealer_Number || "—"}</div>
                              {d.Dealer_Email && (
                                <div className="dt-sub" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {d.Dealer_Email}
                                </div>
                              )}
                            </td>
                            <td className="dt-mono">{d.discount ? `${d.discount}%` : "—"}</td>
                            <td className="dt-mono">{d.creditdays || "—"}</td>
                            <td className="dt-mono">
                              {d.currentlimit ? `₹${Number(d.currentlimit).toLocaleString("en-IN")}` : "—"}
                            </td>
                            <td>
                              <span className={Number(d.status) === 1 ? "st-active" : "st-inactive"}>
                                {Number(d.status) === 1 ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td>
                              <Link href={`/dashboard/admin/dealer/${d.Dealer_Id}`} className="view-btn">
                                <Eye size={11} /> View
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalDealerPages > 1 && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18, flexWrap: "wrap", gap: 10 }}>
                      <span style={{ fontSize: 11.5, color: "#8e8e93", fontVariantNumeric: "tabular-nums" }}>
                        Showing {pageStart + 1}–{Math.min(pageStart + DEALER_PAGE_SIZE, filteredDealers.length)} of {filteredDealers.length}
                      </span>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          onClick={() => setDealerPage(p => p - 1)}
                          disabled={dealerPage === 1}
                          style={{ minWidth: 36, height: 34, padding: "0 10px", fontSize: 13, borderRadius: 7, border: "1px solid rgba(60,60,67,.11)", background: "transparent", color: dealerPage === 1 ? "#c4c4c8" : "#1d1d1f", cursor: dealerPage === 1 ? "default" : "pointer", opacity: dealerPage === 1 ? 0.4 : 1 }}
                        >‹</button>

                        {pageRange().map((item, idx) =>
                          item === "..." ? (
                            <span key={`e${idx}`} style={{ width: 36, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#8e8e93", fontSize: 13 }}>…</span>
                          ) : (
                            <button
                              key={item}
                              onClick={() => setDealerPage(item as number)}
                              style={{ minWidth: 36, height: 34, padding: "0 10px", fontSize: 13, borderRadius: 7, border: "1px solid", borderColor: dealerPage === item ? "#007aff" : "rgba(60,60,67,.11)", background: dealerPage === item ? "#007aff" : "transparent", color: dealerPage === item ? "#fff" : "#1d1d1f", fontWeight: dealerPage === item ? 700 : 400, cursor: "pointer" }}
                            >{item}</button>
                          )
                        )}

                        <button
                          onClick={() => setDealerPage(p => p + 1)}
                          disabled={dealerPage === totalDealerPages}
                          style={{ minWidth: 36, height: 34, padding: "0 10px", fontSize: 13, borderRadius: 7, border: "1px solid rgba(60,60,67,.11)", background: "transparent", color: dealerPage === totalDealerPages ? "#c4c4c8" : "#1d1d1f", cursor: dealerPage === totalDealerPages ? "default" : "pointer", opacity: dealerPage === totalDealerPages ? 0.4 : 1 }}
                        >›</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

          </main>
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────
// CHART PANEL — extracted to avoid repetition
// ─────────────────────────────────────────────────────────────
function ChartPanel({
  title, sub, legendColor, legendLabel,
  loading, data, barFill, Tooltip: TooltipComp,
}: {
  title: string
  sub: string
  legendColor: string
  legendLabel: string
  loading: boolean
  data: { name: string; value: number }[]
  barFill: string
  Tooltip: React.ComponentType<any>
}) {
  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">{title}</div>
          <div className="panel-sub">{sub}</div>
        </div>
        <div className="legend">
          <span className="leg-dot" style={{ background: legendColor }} />
          {legendLabel}
        </div>
      </div>
      {loading ? (
        <div className="chart-empty">
          <div className="shimmer" style={{ width: "100%", height: 200, borderRadius: 10 }} />
        </div>
      ) : data.length === 0 ? (
        <div className="chart-empty">No data available</div>
      ) : (
        <div className="chart-canvas">
          <ResponsiveContainer width="100%" height={260} minWidth={0}>
            <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="rgba(60,60,67,.08)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: "#8e8e93" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10.5, fill: "#8e8e93" }} axisLine={false} tickLine={false} width={52} />
              <Tooltip content={<TooltipComp />} />
              <Bar dataKey="value" fill={barFill} radius={[8, 8, 2, 2]} maxBarSize={38} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
