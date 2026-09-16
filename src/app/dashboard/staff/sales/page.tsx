'use client'

import DateInput from "@/components/ui/date-input";
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { CalendarRange, ChevronLeft, RefreshCw, Search } from "lucide-react"
import { DistributorSalesRow, formatRupee, getOrderDate, groupOrdersByDistributor, type SalesOrder } from "@/lib/companySales"
import { STAFF_ORDER_SCOPE_VERSION } from "@/lib/staffOrderScope.js"
import type { OrderAmountSource } from "@/lib/orderAmounts"

type OrderResponse = {
  data: SalesOrder[]
  total?: number
  count?: number
  last_page?: number
}

type OrderSummaryOverride = OrderAmountSource & {
  orderId?: string
  order_id?: string
}

type StaffSession = {
  staff_id: string
  staff_name: string
  staff_email?: string
  staff_roletype?: string
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
})

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function fetchAllStaffOrders(staffId: string): Promise<SalesOrder[]> {
  const pageSize = 500
  const scope = `role=staff`
  const first = await fetchJson<OrderResponse>(`/api/orders-data?page=1&limit=${pageSize}&search=`)
  const firstRows = first.data ?? []
  const totalRows = first.total ?? first.count ?? firstRows.length
  const totalPages = first.last_page ?? Math.max(1, Math.ceil(totalRows / pageSize))

  if (totalPages <= 1) return firstRows

  const rest = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, idx) => idx + 2).map(page =>
      fetchJson<OrderResponse>(`/api/orders-data?page=${page}&limit=${pageSize}&search=`)
    )
  )

  return [
    ...firstRows,
    ...rest.flatMap(row => row.data ?? []),
  ]
}

async function fetchOrderSummaryOverrides(orderIds: string[]) {
  if (orderIds.length === 0) return {}

  const chunks: string[][] = []
  for (let i = 0; i < orderIds.length; i += 200) {
    chunks.push(orderIds.slice(i, i + 200))
  }

  const responses = await Promise.all(
    chunks.map(async (chunk) => {
      const res = await fetch(`/api/order-summary-overrides?order_ids=${encodeURIComponent(chunk.join(","))}`, { cache: "no-store" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json() as Promise<{ data?: OrderSummaryOverride[] }>
    })
  )

  const map: Record<string, OrderSummaryOverride> = {}
  for (const response of responses) {
    for (const row of response.data ?? []) {
      const id = String(row.orderId ?? row.order_id ?? "").trim()
      if (id) map[id] = row
    }
  }
  return map
}

function resolveStaffSession(): StaffSession | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem("staffData") || localStorage.getItem("UserData")
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.staff_id) return parsed as StaffSession
  } catch {
    return null
  }
  return null
}

function SalesReportPageInner() {
  const router = useRouter()
  const today = new Date()
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
  const [session, setSession] = useState<StaffSession | null>(null)
  const [monthFilter, setMonthFilter] = useState(defaultMonth)
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [queryText, setQueryText] = useState("")

  useEffect(() => {
    const staffSession = resolveStaffSession()
    if (!staffSession) {
      router.replace("/auth/login")
      return
    }
    setSession(staffSession)
  }, [router])

  const { data: orders = [], isLoading, isError, refetch, isFetching } = useQuery<SalesOrder[]>({
    queryKey: ["staffSalesOrders", STAFF_ORDER_SCOPE_VERSION, session?.staff_id],
    queryFn: () => fetchAllStaffOrders(session!.staff_id),
    enabled: !!session,
  })

  const orderIds = useMemo(
    () => Array.from(new Set(orders.map((order) => String(order.order_id ?? "").trim()).filter(Boolean))),
    [orders]
  )

  const {
    data: summaryOverrides = {},
    isLoading: overridesLoading,
    refetch: refetchOverrides,
  } = useQuery<Record<string, OrderSummaryOverride>>({
    queryKey: [
      "staffSalesOverrides",
      STAFF_ORDER_SCOPE_VERSION,
      session?.staff_id,
      orderIds.length,
      orderIds[0] ?? "",
      orderIds[orderIds.length - 1] ?? "",
    ],
    queryFn: () => fetchOrderSummaryOverrides(orderIds),
    enabled: !!session && orderIds.length > 0,
    staleTime: 5 * 60_000,
  })

  const filteredOrders = useMemo(() => {
    const search = queryText.trim().toLowerCase()
    return orders.filter(order => {
      const orderDate = getOrderDate(order)
      if (monthFilter && orderDate.slice(0, 7) !== monthFilter) return false
      if (fromDate && orderDate < fromDate) return false
      if (toDate && orderDate > toDate) return false
      if (search) {
        const haystack = [
          order.Dealer_Name,
          String(order.order_dealer ?? ""),
          String(order.order_id ?? ""),
        ].join(" ").toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })
  }, [orders, monthFilter, fromDate, toDate, queryText])

  const distributorRows = useMemo<DistributorSalesRow[]>(
    () => groupOrdersByDistributor(filteredOrders, summaryOverrides),
    [filteredOrders, summaryOverrides]
  )

  const totals = useMemo(() => {
    return distributorRows.reduce((acc, row) => {
      acc.orderCount += row.orderCount
      acc.grossSales += row.grossSales
      acc.baseDiscount += row.baseDiscount
      acc.slabDiscount += row.slabDiscount
      acc.discount += row.discount
      acc.netSales += row.netSales
      return acc
    }, { orderCount: 0, grossSales: 0, baseDiscount: 0, slabDiscount: 0, discount: 0, netSales: 0 })
  }, [distributorRows])

  if (!session) return null

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        body { margin: 0; }
        .sales-root { min-height: 100vh; background: linear-gradient(180deg, #f7f8fc 0%, #eef2ff 100%); color: #111827; font-family: 'DM Sans', sans-serif; }
        .sales-shell { max-width: 1440px; margin: 0 auto; padding: 24px; }
        .sales-topbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; justify-content: space-between; margin-bottom: 18px; }
        .back-link { display: inline-flex; align-items: center; gap: 8px; color: #334155; text-decoration: none; font-size: 13px; font-weight: 600; }
        .back-link:hover { color: #1d4ed8; }
        .hero { background: linear-gradient(135deg, #0f172a, #1e3a8a 55%, #4338ca); color: #fff; border-radius: 24px; padding: 24px; box-shadow: 0 20px 40px rgba(15, 23, 42, 0.18); margin-bottom: 18px; }
        .hero-kicker { font-size: 10.5px; text-transform: uppercase; letter-spacing: .18em; opacity: .72; margin-bottom: 8px; }
        .hero-title { font-size: 28px; font-weight: 700; letter-spacing: -.04em; margin: 0; }
        .hero-sub { margin-top: 8px; font-size: 13px; color: rgba(255,255,255,.78); max-width: 760px; }
        .hero-meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
        .meta-chip { display: inline-flex; align-items: center; gap: 7px; padding: 8px 12px; border-radius: 999px; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.16); font-size: 12px; font-weight: 600; }
        .toolbar { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
        .tool-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 18px; padding: 14px; box-shadow: 0 1px 8px rgba(15, 23, 42, 0.04); }
        .tool-label { font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #94a3b8; margin-bottom: 8px; }
        .tool-input { width: 100%; border: 1px solid #dbe4f0; background: #f8fafc; border-radius: 12px; padding: 11px 12px; font: inherit; color: #0f172a; }
        .tool-input:focus { outline: none; border-color: #818cf8; box-shadow: 0 0 0 3px rgba(129, 140, 248, .18); background: #fff; }
        .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
        .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 18px; padding: 18px; box-shadow: 0 1px 8px rgba(15, 23, 42, 0.04); }
        .card-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; color: #94a3b8; margin-bottom: 10px; }
        .card-value { font-size: 28px; line-height: 1; font-weight: 700; letter-spacing: -.04em; font-family: 'DM Mono', monospace; color: #111827; }
        .card-sub { margin-top: 8px; font-size: 11.5px; color: #64748b; }
        .table-wrap { background: #fff; border: 1px solid #e5e7eb; border-radius: 22px; overflow: hidden; box-shadow: 0 1px 8px rgba(15, 23, 42, 0.04); }
        .table-head { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: center; padding: 18px 20px; border-bottom: 1px solid #eef2f7; }
        .table-title { font-size: 16px; font-weight: 700; color: #111827; }
        .table-sub { font-size: 12px; color: #64748b; margin-top: 3px; }
        .table-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .icon-btn { display: inline-flex; align-items: center; gap: 7px; border: 1px solid #dbe4f0; background: #fff; color: #334155; padding: 9px 12px; border-radius: 12px; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
        .icon-btn:hover { background: #f8fafc; }
        .table-scroll { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; }
        thead th { text-align: left; padding: 12px 16px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: #64748b; background: #f8fafc; border-bottom: 1px solid #eef2f7; white-space: nowrap; }
        tbody td { padding: 14px 16px; border-bottom: 1px solid #f1f5f9; font-size: 13px; color: #334155; vertical-align: top; }
        tbody tr:hover { background: #fbfdff; }
        .dealer-name { font-weight: 700; color: #0f172a; }
        .dealer-sub { margin-top: 3px; font-size: 11px; color: #94a3b8; font-family: 'DM Mono', monospace; }
        .mono { font-family: 'DM Mono', monospace; }
        .right { text-align: right; }
        .empty { padding: 48px 16px; text-align: center; color: #94a3b8; font-size: 13px; }
        tfoot td { padding: 15px 16px; font-weight: 700; border-top: 1px solid #e5e7eb; background: #f8fafc; }
        .footer-note { margin-top: 12px; font-size: 11.5px; color: #64748b; text-align: right; }
        @media (max-width: 1100px) {
          .toolbar, .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 700px) {
          .sales-shell { padding: 16px; }
          .toolbar, .grid { grid-template-columns: 1fr; }
          .hero-title { font-size: 24px; }
        }
      `}</style>

      <div className="sales-root">
        <div className="sales-shell">
          <div className="sales-topbar">
            <Link href="/dashboard/staff" className="back-link">
              <ChevronLeft size={16} />
              Back to dashboard
            </Link>
            <button className="icon-btn" onClick={() => { refetch(); void refetchOverrides(); }} disabled={isFetching || overridesLoading}>
              <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <section className="hero">
            <div className="hero-kicker">Staff dashboard report</div>
            <h1 className="hero-title">Assigned Dealer Sales</h1>
            <div className="hero-sub">
              Monthly sales for your assigned dealers. Filter by month or date range, then review gross, base discount, slab discount, and net sales with a totals row at the bottom.
            </div>
            <div className="hero-meta">
              <span className="meta-chip">
                <CalendarRange size={14} />
                Current filter: {monthFilter || "All months"}
              </span>
              <span className="meta-chip">
                <Search size={14} />
                {filteredOrders.length.toLocaleString("en-IN")} orders
              </span>
              <span className="meta-chip">
                <Search size={14} />
                {distributorRows.length.toLocaleString("en-IN")} distributors
              </span>
            </div>
          </section>

          <section className="toolbar">
            <div className="tool-card">
              <div className="tool-label">Month</div>
              <input
                type="month"
                className="tool-input"
                value={monthFilter}
                onChange={e => setMonthFilter(e.target.value)}
              />
            </div>
            <div className="tool-card">
              <div className="tool-label">From date</div>
              <DateInput
                className="tool-input"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
              />
            </div>
            <div className="tool-card">
              <div className="tool-label">To date</div>
              <DateInput
                className="tool-input"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
              />
            </div>
            <div className="tool-card">
              <div className="tool-label">Search</div>
              <input
                type="text"
                className="tool-input"
                value={queryText}
                onChange={e => setQueryText(e.target.value)}
                placeholder="Distributor, order id, dealer id"
              />
            </div>
          </section>

          <section className="grid">
            <div className="card">
              <div className="card-label">Order Count</div>
              <div className="card-value">{totals.orderCount.toLocaleString("en-IN")}</div>
              <div className="card-sub">Company-wide orders in the current filter</div>
            </div>
            <div className="card">
              <div className="card-label">Gross Sales</div>
              <div className="card-value">{formatRupee(totals.grossSales)}</div>
              <div className="card-sub">Before discounts</div>
            </div>
            <div className="card">
              <div className="card-label">Discount</div>
              <div className="card-value">{formatRupee(totals.discount)}</div>
              <div className="card-sub">Total discount applied</div>
            </div>
            <div className="card">
              <div className="card-label">Net Sales</div>
              <div className="card-value">{formatRupee(totals.netSales)}</div>
              <div className="card-sub">After discount</div>
            </div>
          </section>

          <section className="table-wrap">
            <div className="table-head">
              <div>
                <div className="table-title">Distributor Sales Breakdown</div>
                <div className="table-sub">
                  {isLoading
                    ? "Loading company-wide orders..."
                    : `${distributorRows.length.toLocaleString("en-IN")} distributors matched`}
                </div>
              </div>
              <div className="table-actions">
                <span className="icon-btn" style={{ cursor: "default" }}>
                  <Search size={14} />
                  Read only
                </span>
              </div>
            </div>

            {isError ? (
              <div className="empty">
                Failed to load the monthly sales report.
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Distributor name</th>
                      <th className="right">Order count</th>
                      <th className="right">Gross sales</th>
                      <th className="right">Base discount</th>
                      <th className="right">Slab discount</th>
                      <th className="right">Total discount</th>
                      <th className="right">Net sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <tr>
                        <td colSpan={7} className="empty">Loading company-wide sales...</td>
                      </tr>
                    ) : distributorRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="empty">No sales found for the selected filter.</td>
                      </tr>
                    ) : (
                      distributorRows.map(row => (
                        <tr key={row.dealerKey}>
                          <td>
                            <div className="dealer-name">{row.dealerName}</div>
                            <div className="dealer-sub">ID: {row.dealerKey}</div>
                          </td>
                          <td className="right mono">{row.orderCount.toLocaleString("en-IN")}</td>
                          <td className="right mono">{formatRupee(row.grossSales)}</td>
                          <td className="right mono">{formatRupee(row.baseDiscount)}</td>
                          <td className="right mono">{formatRupee(row.slabDiscount)}</td>
                          <td className="right mono">{formatRupee(row.discount)}</td>
                          <td className="right mono">{formatRupee(row.netSales)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Totals</td>
                      <td className="right mono">{totals.orderCount.toLocaleString("en-IN")}</td>
                      <td className="right mono">{formatRupee(totals.grossSales)}</td>
                      <td className="right mono">{formatRupee(totals.baseDiscount)}</td>
                      <td className="right mono">{formatRupee(totals.slabDiscount)}</td>
                      <td className="right mono">{formatRupee(totals.discount)}</td>
                      <td className="right mono">{formatRupee(totals.netSales)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          <div className="footer-note">
            Staff view is read-only. Edit, delete, approval, payment, and adjustment actions are disabled here.
          </div>
        </div>
      </div>
    </>
  )
}

export default function StaffSalesReportPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <SalesReportPageInner />
    </QueryClientProvider>
  )
}
