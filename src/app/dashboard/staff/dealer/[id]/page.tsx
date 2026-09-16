'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import axios from 'axios'
import { ArrowLeft, Package, Search, Download } from 'lucide-react'
import moment from 'moment'
import { hasPriorityTag } from '@/lib/orderPriority'
import { OrderAmountSource, withDisplayOrderAmounts } from '@/lib/orderAmounts'
import { formatDisplayOrderNumber } from '@/lib/orderDisplay';
import { mergeFallbackProductNotes } from '@/lib/orderProductNotes.mjs'
import { STAFF_ORDER_SCOPE_VERSION } from '@/lib/staffOrderScope.js'
import {
  dealerStatusBadge,
  fetchDealerStatus,
  normalizeDealerStatus,
  type DealerStatus,
} from '@/lib/dealerStatus'

const YEAR        = new Date().getFullYear()
const ORDER_PAGE_SIZE = 15
const ITEM_PAGE_SIZE  = 10
const SHIMMER         = "animate-pulse bg-gray-200 rounded"

// ─── Types ────────────────────────────────────────────────────────────────────

type DealerInfo = {
  Dealer_Id: string
  Dealer_Name: string
  Dealer_City: string
  Dealer_Email: string
  Dealer_Number: string
  Dealer_Dealercode: string
  gst: string
  creditdays: string
  currentlimit: string
  annualtarget: string
  discount: string
  status: string
}

type RawOrder = {
  order_id: string
  order_date: string
  order_amount: string | number
  order_discount: string | number
  Dealer_Name: string
  orderdata_item_quantity: string
  mtstatus: string
  outstandingDate: string
  order_dealer?: string | number
  order_discount_amount?: string | number
  order_net_amount?: string | number
  grossAmount?: string | number
  discountAmount?: string | number
  netPayableAmount?: string | number
}

type OrderSummaryOverride = OrderAmountSource & { orderId?: string; order_id?: string }

type OrderItem = {
  orderdata_id: string
  orderdata_cat_no: string
  order_item_description: string
  orderdata_item_quantity: string
  orderdata_price: string
  orderdata_discount: string
  orderdata_afterDisPrice: string
  orderdata_totalprice: string
  remark: string
  remarks?: string
  displayRemark?: string
  priority?: string | boolean
  isPriority?: string | boolean
  is_priority?: string | boolean
  orderdata_status: string
  orderdata_datetime: string
  orderdata_orderid: string
}

type OrderItemResponse = {
  data: OrderItem[]
  count: number
  last_page: number
}

type OrderProductNote = {
  orderId?: string
  orderItemId?: string | null
  sku?: string
  normalizedSku?: string
  occurrence?: number
  note?: string
}

type PayStatus = "Paid" | "Partial" | "Unpaid" | "Overdue"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TODAY = moment().startOf("day")

function getPayStatus(o: RawOrder): PayStatus {
  const ms = Number(o.mtstatus ?? 0)
  if (ms >= 2) return "Paid"
  if (o.outstandingDate && moment(o.outstandingDate, "YYYY-MM-DD", true).isValid() && moment(o.outstandingDate).isBefore(TODAY))
    return "Overdue"
  if (ms === 1) return "Partial"
  return "Unpaid"
}

function fmt(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function initials(name?: string) {
  return name?.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?"
}

const PAY_STYLE: Record<PayStatus, { wrap: string; dot: string }> = {
  Paid:    { wrap: "bg-emerald-50 border-emerald-200 text-emerald-700", dot: "bg-emerald-400" },
  Partial: { wrap: "bg-blue-50 border-blue-200 text-blue-700",         dot: "bg-blue-400"    },
  Unpaid:  { wrap: "bg-amber-50 border-amber-200 text-amber-700",      dot: "bg-amber-400"   },
  Overdue: { wrap: "bg-red-50 border-red-200 text-red-700",            dot: "bg-red-500"     },
}

function PayBadge({ status }: { status: PayStatus }) {
  const s = PAY_STYLE[status]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-bold border whitespace-nowrap ${s.wrap}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {status}
    </span>
  )
}

function dispatchBadge(status: string) {
  switch (status) {
    case "0": return { bg: "bg-red-50",     text: "text-red-600",     label: "In Process" }
    case "1": return { bg: "bg-blue-50",    text: "text-blue-600",    label: "Packing" }
    case "2": return { bg: "bg-indigo-50",  text: "text-indigo-600",  label: "Dispatched" }
    case "3": return { bg: "bg-amber-50",   text: "text-amber-700",   label: "Not in Stock" }
    case "4": return { bg: "bg-emerald-50", text: "text-emerald-700", label: "Successful" }
    default:  return { bg: "bg-gray-100",   text: "text-gray-500",    label: "Unknown" }
  }
}

function pageRange(current: number, total: number): (number | "…")[] {
  const pages: (number | "…")[] = []
  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i)
  } else {
    pages.push(1)
    if (current > 3) pages.push("…")
    for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
    if (current < total - 2) pages.push("…")
    pages.push(total)
  }
  return pages
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StaffDealerViewPage() {
  const router   = useRouter()
  const params   = useParams()
  const dealerId = params.id as string

  const [tab,           setTab]          = useState<"orders" | "items">("orders")
  const [dealer,        setDealer]       = useState<DealerInfo | null>(null)
  const [dealerStatus,  setDealerStatus] = useState<DealerStatus>("active")
  const [allOrders,     setAllOrders]    = useState<RawOrder[]>([])
  const [summaryOverrides, setSummaryOverrides] = useState<Record<string, OrderSummaryOverride>>({})
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [orderPage,     setOrderPage]    = useState(1)
  const [itemPage,      setItemPage]     = useState(1)
  const [search,        setSearch]       = useState("")
  const [searchInput,   setSearchInput]  = useState("")
  const [fallbackProductNotes, setFallbackProductNotes] = useState<OrderProductNote[]>([])
  const [staffId, setStaffId] = useState("")
  const [dealerAccessAllowed, setDealerAccessAllowed] = useState(false)

  const queryClient = useQueryClient()

  useEffect(() => {
    let active = true
    try {
      const raw = localStorage.getItem("staffData") || localStorage.getItem("UserData")
      const parsed = raw ? JSON.parse(raw) : null
      const actorId = String(parsed?.staff_id ?? "").trim()
      if (!actorId) {
        router.replace("/auth/login")
        return
      }
      setStaffId(actorId)
      fetch(`/api/staff/dealers/${encodeURIComponent(dealerId)}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
        .then((json) => {
          if (!active) return
          if (!json.success || !json.data) { router.replace("/dashboard/staff"); return }
          setDealer(json.data as DealerInfo)
          setDealerStatus(normalizeDealerStatus((json.data as DealerInfo).status))
          setDealerAccessAllowed(true)
        })
        .catch(() => router.replace("/dashboard/staff"))
    } catch {
      router.replace("/auth/login")
    }
    return () => { active = false }
  }, [dealerId, router])


  // Fetch all orders (filter by dealer name client-side)
  const loadOrders = useCallback(async () => {
    setLoadingOrders(true)
    try {
      const res  = await fetch(`/api/orders-data?page=1&limit=1000&search=&dealer=${encodeURIComponent(dealerId)}`)
      const json = await res.json()
      setAllOrders(Array.isArray(json.data) ? json.data : [])
    } catch {
      setAllOrders([])
    } finally {
      setLoadingOrders(false)
    }
  }, [dealerId, staffId])

  useEffect(() => {
    if (dealerAccessAllowed && staffId) loadOrders()
  }, [dealerAccessAllowed, loadOrders, staffId])

  useEffect(() => {
    const orderIds = Array.from(new Set(allOrders.map(o => String(o.order_id || "").trim()).filter(Boolean)))
    if (orderIds.length === 0) {
      setSummaryOverrides({})
      return
    }

    let active = true
    fetch(`/api/order-summary-overrides?order_ids=${encodeURIComponent(orderIds.join(","))}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(json => {
        if (!active) return
        const map: Record<string, OrderSummaryOverride> = {}
        for (const row of Array.isArray(json.data) ? json.data : []) {
          const id = String(row.orderId || row.order_id || "").trim()
          if (id) map[id] = row
        }
        setSummaryOverrides(map)
      })
      .catch(() => {
        if (active) setSummaryOverrides({})
      })

    return () => { active = false }
  }, [allOrders])

  // Debounced search (items tab)
  useEffect(() => {
    const t = setTimeout(() => { setItemPage(1); setSearch(searchInput) }, 400)
    return () => clearTimeout(t)
  }, [searchInput])

  // Order items via React Query
  const { data: itemsResp, isLoading: itemsLoading, isError: itemsError } = useQuery<OrderItemResponse>({
    queryKey: ['staff-dealer-items', STAFF_ORDER_SCOPE_VERSION, staffId, dealerId, itemPage, search],
    queryFn: async () => {
      const res = await axios.get(
        `/api/orders-data?page=${itemPage}&search=${encodeURIComponent(search)}&dealer=${encodeURIComponent(dealerId)}`
      )
      return res.data
    },
    enabled: dealerAccessAllowed && !!staffId && !!dealerId && tab === "items",
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })

  // Prefetch next items page
  useEffect(() => {
    if (!dealerAccessAllowed || !staffId || !dealerId || tab !== "items") return
    queryClient.prefetchQuery({
      queryKey: ['staff-dealer-items', STAFF_ORDER_SCOPE_VERSION, staffId, dealerId, itemPage + 1, search],
      queryFn: async () => {
        const res = await axios.get(
          `/api/orders-data?page=${itemPage + 1}&search=${encodeURIComponent(search)}&dealer=${encodeURIComponent(dealerId)}`
        )
        return res.data
      },
    })
  }, [dealerAccessAllowed, dealerId, itemPage, queryClient, search, staffId, tab])

  const pricedAllOrders = useMemo(() => {
    return allOrders.map(order => withDisplayOrderAmounts(order, summaryOverrides[order.order_id]))
  }, [allOrders, summaryOverrides])

  // Dealer's orders (filtered + sorted)
  const dealerOrders = useMemo(() => {
    if (!dealer) return []
    const name = dealer.Dealer_Name?.toLowerCase() ?? ""
    return pricedAllOrders
      .filter(o => o.Dealer_Name?.toLowerCase() === name)
      .sort((a, b) => moment(b.order_date).valueOf() - moment(a.order_date).valueOf())
  }, [pricedAllOrders, dealer])

  // Summary
  const summary = useMemo(() => {
    let totalValue = 0, totalPaid = 0, totalPending = 0
    for (const o of dealerOrders) {
      const net = Number(o.order_amount) - Number(o.order_discount)
      totalValue += net
      if (Number(o.mtstatus) >= 2) totalPaid   += net
      else                         totalPending += net
    }
    return { count: dealerOrders.length, totalValue, totalPaid, totalPending }
  }, [dealerOrders])

  // Orders pagination
  const orderTotalPages = Math.max(1, Math.ceil(dealerOrders.length / ORDER_PAGE_SIZE))
  const orderSlice      = dealerOrders.slice((orderPage - 1) * ORDER_PAGE_SIZE, orderPage * ORDER_PAGE_SIZE)

  // Items pagination
  const items          = useMemo(() => itemsResp?.data ?? [], [itemsResp])
  const displayItems = useMemo(
    () => mergeFallbackProductNotes(items, fallbackProductNotes) as unknown as OrderItem[],
    [items, fallbackProductNotes]
  )
  const itemTotal      = itemsResp?.count ?? 0
  const itemTotalPages = itemsResp?.last_page || Math.max(1, Math.ceil(itemTotal / ITEM_PAGE_SIZE))
  const statusBadge = dealerStatusBadge(dealerStatus)

  useEffect(() => {
    const orderIds = Array.from(new Set(items.map(item => String(item.orderdata_orderid || '').trim()).filter(Boolean)))
    if (orderIds.length === 0) {
      setFallbackProductNotes([])
      return
    }

    let active = true
    fetch(`/api/order-product-notes?orderIds=${encodeURIComponent(orderIds.join(','))}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(json => {
        if (!active) return
        setFallbackProductNotes(json.success && Array.isArray(json.data) ? json.data : [])
      })
      .catch(() => {
        if (active) setFallbackProductNotes([])
      })

    return () => { active = false }
  }, [items])

  // CSV export for order items
  const exportItemsCSV = () => {
    if (!displayItems.length) return
    const headers = ["S.No.", "Order ID", "Cat. No.", "Description", "Remark", "Qty", "Priority", "Price", "Discount", "After Disc.", "Total", "Status", "Date"]
    const rows = displayItems.map((o, i) => [
      (itemPage - 1) * ITEM_PAGE_SIZE + i + 1,
      o.orderdata_orderid, o.orderdata_cat_no, o.order_item_description,
      o.displayRemark || o.remark || "",
      o.orderdata_item_quantity, hasPriorityTag(o.priority, o.isPriority, o.is_priority, o.remark, o.remarks) ? 'Priority' : '', o.orderdata_price, o.orderdata_discount,
      o.orderdata_afterDisPrice, o.orderdata_totalprice,
      dispatchBadge(o.orderdata_status).label,
      o.orderdata_datetime?.slice(0, 16) ?? "",
    ])
    const csv  = [headers, ...rows].map(r => r.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement("a")
    a.href     = url
    a.download = `order-items-${dealerId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const loading = loadingOrders && !dealer

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="p-6 max-w-7xl mx-auto">

        {/* Back */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dealer List
        </button>

        {/* Dealer header */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xl font-bold flex-shrink-0">
                {dealer ? initials(dealer.Dealer_Name) : "…"}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 leading-tight">
                  {dealer?.Dealer_Name ?? (loading ? "Loading…" : "—")}
                </h1>
                <p className="text-sm text-gray-400 mt-0.5">Dealer Overview</p>
                <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">
                  {dealer?.Dealer_Email     && <span>📧 {dealer.Dealer_Email}</span>}
                  {dealer?.Dealer_Number    && <span>📞 {dealer.Dealer_Number}</span>}
                  {dealer?.Dealer_City      && <span>📍 {dealer.Dealer_City}</span>}
                  {dealer?.Dealer_Dealercode && (
                    <span className="font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                      Code: {dealer.Dealer_Dealercode}
                    </span>
                  )}
                  {dealer?.creditdays && (
                    <span className="font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                      Credit: {dealer.creditdays}d
                    </span>
                  )}
                  {dealer?.discount && dealer.discount !== "0" && (
                    <span className="font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">
                      Disc: {dealer.discount}%
                    </span>
                  )}
                </div>
              </div>
            </div>

            <span className={`text-xs font-semibold px-3 py-1.5 rounded-full self-start ${statusBadge.bg} ${statusBadge.text}`}>
              {statusBadge.label}
            </span>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {[
            { label: "Total Orders",    value: loadingOrders ? "…" : String(summary.count),          color: "text-indigo-600",  sub: "all time"           },
            { label: "Total Purchased", value: loadingOrders ? "…" : fmt(summary.totalValue),        color: "text-purple-600",  sub: "gross value"        },
            { label: "Total Paid",      value: loadingOrders ? "…" : fmt(summary.totalPaid),         color: "text-emerald-600", sub: "settled"            },
            { label: "Outstanding",     value: loadingOrders ? "…" : fmt(summary.totalPending),      color: "text-amber-600",   sub: "pending / overdue"  },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <p className="text-[10.5px] font-bold text-gray-400 uppercase tracking-wider mb-2">{c.label}</p>
              <p className={`text-xl font-bold leading-tight ${c.color}`}>{c.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-white rounded-xl border border-gray-200 shadow-sm p-1 w-fit">
          {(["orders", "items"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 text-sm font-semibold rounded-lg transition ${
                tab === t
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              {t === "orders" ? "Order History" : "Order Items"}
            </button>
          ))}
        </div>

        {/* ── ORDER HISTORY TAB ─────────────────────────────────────────── */}
        {tab === "orders" && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {["#", "Date", "Order ID", "Items", "Grand Total", "Amount Paid", "Balance Due", "Status"].map(h => (
                      <th key={h} className={`px-4 py-4 text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap ${
                        ["Grand Total", "Amount Paid", "Balance Due"].includes(h) ? "text-right" : "text-left"
                      }`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-100">
                  {/* Loading */}
                  {loadingOrders && Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-4"><div className={`${SHIMMER} h-3.5 w-full`} /></td>
                      ))}
                    </tr>
                  ))}

                  {/* Empty */}
                  {!loadingOrders && dealerOrders.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-16 text-center text-sm text-gray-400">
                        No orders found for this dealer
                      </td>
                    </tr>
                  )}

                  {/* Rows */}
                  {!loadingOrders && orderSlice.map((o, i) => {
                    const net       = Number(o.order_amount) - Number(o.order_discount)
                    const ms        = Number(o.mtstatus ?? 0)
                    const isPaid    = ms >= 2
                    const isPartial = ms === 1
                    const amtPaid   = isPaid ? net : isPartial ? null : 0
                    const balDue    = isPaid ? 0   : isPartial ? null : net
                    const status    = getPayStatus(o)
                    return (
                      <tr key={o.order_id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3.5 text-xs text-gray-400">{(orderPage - 1) * ORDER_PAGE_SIZE + i + 1}</td>
                        <td className="px-4 py-3.5 text-xs text-gray-600 whitespace-nowrap">
                          {o.order_date ? moment(o.order_date).format("DD MMM YYYY") : "—"}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs font-semibold text-indigo-700 whitespace-nowrap">
                          {formatDisplayOrderNumber(o.order_id)}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-gray-600">
                          {o.orderdata_item_quantity
                            ? `${o.orderdata_item_quantity} item${Number(o.orderdata_item_quantity) !== 1 ? "s" : ""}`
                            : "—"
                          }
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs font-semibold text-gray-800">
                          {fmt(net)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs">
                          {amtPaid === null
                            ? <span className="text-blue-600 font-semibold">Partial</span>
                            : <span className="text-emerald-700">{fmt(amtPaid)}</span>
                          }
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs">
                          {balDue === null
                            ? <span className="text-blue-600 font-semibold">Partial</span>
                            : balDue > 0
                              ? <span className="text-red-600 font-bold">{fmt(balDue)}</span>
                              : <span className="text-gray-400">₹0.00</span>
                          }
                        </td>
                        <td className="px-4 py-3.5"><PayBadge status={status} /></td>
                      </tr>
                    )
                  })}
                </tbody>

                {/* Totals footer */}
                {!loadingOrders && dealerOrders.length > 0 && (() => {
                  let grand = 0, paid = 0, balance = 0
                  for (const o of dealerOrders) {
                    const net = Number(o.order_amount) - Number(o.order_discount)
                    grand += net
                    if (Number(o.mtstatus) >= 2) paid    += net
                    else                         balance += net
                  }
                  return (
                    <tfoot>
                      <tr className="bg-gray-50 border-t-2 border-gray-200">
                        <td colSpan={4} className="px-4 py-3 text-[10.5px] font-bold text-gray-500 uppercase tracking-wider">
                          Total · {dealerOrders.length} order{dealerOrders.length !== 1 ? "s" : ""}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-bold text-gray-900">{fmt(grand)}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-bold text-emerald-700">{fmt(paid)}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-bold text-red-600">{fmt(balance)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )
                })()}
              </table>
            </div>

            {/* Orders pagination */}
            {orderTotalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
                <span className="text-xs text-gray-400">
                  Showing {(orderPage - 1) * ORDER_PAGE_SIZE + 1}–{Math.min(orderPage * ORDER_PAGE_SIZE, dealerOrders.length)} of {dealerOrders.length}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setOrderPage(p => Math.max(1, p - 1))} disabled={orderPage === 1}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition">
                    ← Prev
                  </button>
                  {pageRange(orderPage, orderTotalPages).map((p, idx) =>
                    p === "…" ? <span key={`e${idx}`} className="px-2 text-gray-400 text-sm">…</span> : (
                      <button key={p} onClick={() => setOrderPage(p as number)}
                        className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                          p === orderPage ? "bg-indigo-600 text-white border-indigo-600 font-medium" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                        }`}>
                        {p}
                      </button>
                    )
                  )}
                  <button onClick={() => setOrderPage(p => Math.min(orderTotalPages, p + 1))} disabled={orderPage === orderTotalPages}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition">
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ORDER ITEMS TAB ───────────────────────────────────────────── */}
        {tab === "items" && (
          <>
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div className="relative w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text" placeholder="Search by catalogue number…"
                  value={searchInput} onChange={e => setSearchInput(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition w-full"
                />
              </div>
              <button
                onClick={exportItemsCSV}
                disabled={!displayItems.length}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            </div>

            {itemsError && (
              <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                Failed to load order items. Please try again.
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {["S.No.", "Order ID", "Cat. No.", "Description", "Qty", "Price", "Discount", "After Disc.", "Total", "Dispatch Status", "Date"].map(h => (
                        <th key={h} className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-100">
                    {itemsLoading && Array.from({ length: ITEM_PAGE_SIZE }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 11 }).map((_, j) => (
                          <td key={j} className="px-4 py-4"><div className={`${SHIMMER} h-4 w-full`} /></td>
                        ))}
                      </tr>
                    ))}

                    {!itemsLoading && displayItems.length === 0 && (
                      <tr>
                        <td colSpan={11} className="py-16 text-center">
                          <div className="flex flex-col items-center gap-2 text-gray-400">
                            <Package className="w-8 h-8" />
                            <span className="text-sm">No order items found</span>
                          </div>
                        </td>
                      </tr>
                    )}

                    {!itemsLoading && displayItems.map((item, i) => {
                      const badge = dispatchBadge(item.orderdata_status)
                      return (
                        <tr key={`${item.orderdata_id ?? 'row'}-${i}`} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3.5 text-xs text-gray-400">{(itemPage - 1) * ITEM_PAGE_SIZE + i + 1}</td>
                          <td className="px-4 py-3.5">
                            <span className="font-mono text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                              #{item.orderdata_orderid}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="font-mono text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded font-semibold">
                              {item.orderdata_cat_no || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-xs text-gray-700 max-w-[180px] truncate">
                            <div className="flex items-center gap-2">
                              <span className="truncate">{item.order_item_description || "—"}</span>
                              {hasPriorityTag(item.priority, item.isPriority, item.is_priority, item.remark, item.remarks) && (
                                <span className="bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                                  Priority
                                </span>
                              )}
                            </div>
                            {item.displayRemark && (
                              <div className="mt-1 text-[11px] leading-5 text-gray-500">{item.displayRemark}</div>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-xs text-gray-600 text-center">
                            {item.orderdata_item_quantity || "—"}
                          </td>
                          <td className="px-4 py-3.5 text-xs text-gray-600">₹{item.orderdata_price || "0"}</td>
                          <td className="px-4 py-3.5 text-xs text-gray-600">₹{item.orderdata_discount || "0"}</td>
                          <td className="px-4 py-3.5 text-xs text-gray-600">₹{item.orderdata_afterDisPrice || "0"}</td>
                          <td className="px-4 py-3.5">
                            <span className="bg-emerald-50 text-emerald-700 text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap">
                              ₹{item.orderdata_totalprice || "0"}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className={`${badge.bg} ${badge.text} text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-xs text-gray-400 whitespace-nowrap">
                            {item.orderdata_datetime?.slice(0, 16) || "—"}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Items pagination */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
                <span className="text-xs text-gray-400">
                  {displayItems.length > 0
                    ? `Showing ${(itemPage - 1) * ITEM_PAGE_SIZE + 1}–${Math.min(itemPage * ITEM_PAGE_SIZE, itemTotal)} of ${itemTotal}`
                    : "No results"
                  }
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setItemPage(p => Math.max(1, p - 1))} disabled={itemPage === 1}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition">
                    ← Prev
                  </button>
                  {pageRange(itemPage, itemTotalPages).map((p, idx) =>
                    p === "…" ? <span key={`e${idx}`} className="px-2 text-gray-400 text-sm">…</span> : (
                      <button key={p} onClick={() => setItemPage(p as number)}
                        className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                          p === itemPage ? "bg-indigo-600 text-white border-indigo-600 font-medium" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                        }`}>
                        {p}
                      </button>
                    )
                  )}
                  <button onClick={() => setItemPage(p => Math.min(itemTotalPages, p + 1))} disabled={itemPage === itemTotalPages}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition">
                    Next →
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
