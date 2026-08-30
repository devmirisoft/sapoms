'use client'

import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import axios from 'axios'
import { STAFF_ORDER_SCOPE_VERSION } from '@/lib/staffOrderScope.js'
import { Download, Search, Package } from 'lucide-react'
import { hasPriorityTag } from '@/lib/orderPriority'
import {
  buildCustomDiscountProgressMap,
  getCustomDiscountProgressKeyForOrder,
  type CustomDiscountProgress,
} from '@/lib/customDiscountProgress'
import { mergeFallbackProductNotes } from '@/lib/orderProductNotes.mjs'

type OrderItem = {
  orderdata_id: string
  orderdata_cat_no: string
  order_item_description: string
  orderdata_capacity: string
  orderdata_item_quantity: string
  orderdata_item_unit: string
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
  orderdata_dealerid: string
}

type OrderResponse = {
  data: OrderItem[]
  count: number
  last_page: number
}

type UserData = {
  Dealer_Id?: string
  staff_id?: string
}

type CustomDiscountRequest = {
  id: string
  status?: string | null
  orderId?: string | null
  order_id?: string | null
  orderNumber?: string | null
  order_number?: string | null
  lastReorderedOrderId?: string | null
}

type OrderProductNote = {
  orderId?: string
  orderItemId?: string | null
  sku?: string
  normalizedSku?: string
  occurrence?: number
  note?: string
}

const SHIMMER = "animate-pulse bg-gray-200 rounded"
const PROFILE_API_MIGRATED = "/api/staff/dealers"
const ITEMS_PER_PAGE = 10

function statusBadge(status: string) {
  switch (status) {
    case "0": return { bg: "bg-red-50",     text: "text-red-600",     label: "In Process" }
    case "1": return { bg: "bg-blue-50",    text: "text-blue-600",    label: "Packing" }
    case "2": return { bg: "bg-indigo-50",  text: "text-indigo-600",  label: "Dispatched" }
    case "3": return { bg: "bg-amber-50",   text: "text-amber-700",   label: "Not in Stock" }
    case "4": return { bg: "bg-emerald-50", text: "text-emerald-700", label: "Successful" }
    default:  return { bg: "bg-gray-100",   text: "text-gray-500",    label: "Unknown" }
  }
}

function customDiscountBadge(progress: CustomDiscountProgress) {
  if (progress === "completely") {
    return { bg: "bg-emerald-50", text: "text-emerald-700", label: "Approved" }
  }
  if (progress === "partially") {
    return { bg: "bg-amber-50", text: "text-amber-700", label: "Partially" }
  }
  return null
}

export default function DispatchStatusPage() {
  const [user, setUser] = useState<UserData | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [fallbackProductNotes, setFallbackProductNotes] = useState<OrderProductNote[]>([])

  const queryClient = useQueryClient()

  // Load user from localStorage on client only
  useEffect(() => {
    const stored = localStorage.getItem("staffData") || localStorage.getItem("UserData")
    if (stored) setUser(JSON.parse(stored))
  }, [])

  const { data: response, isLoading, isError } = useQuery<OrderResponse>({
    queryKey: ['dispatchstatus', STAFF_ORDER_SCOPE_VERSION, page, search, user?.staff_id],
    queryFn: async () => {
      const res = await axios.get(
        `/api/orders-data?page=${page}&limit=${ITEMS_PER_PAGE}&search=${encodeURIComponent(search)}`
      )
      return res.data
    },
    enabled: !!user?.staff_id,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })

  const { data: customDiscountRequests = [] } = useQuery<CustomDiscountRequest[]>({
    queryKey: ['dispatchstatus-custom-discount', user?.staff_id, user?.Dealer_Id],
    queryFn: async () => {
      const query = user?.staff_id
        ? `staff_id=${encodeURIComponent(user.staff_id)}`
        : `dealer_id=${encodeURIComponent(user?.Dealer_Id || "")}`
      const res = await fetch(`/api/custom-discount-requests?${query}&limit=500`, {
        cache: "no-store",
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.message ?? "Failed to load custom discount requests")
      return Array.isArray(json.data) ? json.data : []
    },
    enabled: !!(user?.staff_id || user?.Dealer_Id),
    staleTime: 60 * 1000,
  })

  const data: OrderItem[] = response?.data || []
  const displayData = useMemo(
    () => mergeFallbackProductNotes(data, fallbackProductNotes) as unknown as OrderItem[],
    [data, fallbackProductNotes]
  )
  const customDiscountProgressMap = buildCustomDiscountProgressMap(customDiscountRequests)
  const total = response?.count ?? 0
  const totalPages =
    response?.last_page ||
    Math.ceil(total / ITEMS_PER_PAGE) ||
    (data.length < ITEMS_PER_PAGE ? page : page + 1)

  // Prefetch next page
  useEffect(() => {
    if (!user?.staff_id) return
    queryClient.prefetchQuery({
      queryKey: ['dispatchstatus', STAFF_ORDER_SCOPE_VERSION, page + 1, search, user.staff_id],
      queryFn: async () => {
        const res = await axios.get(
          `/api/orders-data?page=${page + 1}&limit=${ITEMS_PER_PAGE}&search=${encodeURIComponent(search)}`
        )
        return res.data
      },
    })
  }, [page, search, user])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1)
      setSearch(searchInput)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    const orderIds = Array.from(new Set(data.map((item) => String(item.orderdata_orderid || '').trim()).filter(Boolean)))
    if (orderIds.length === 0) {
      setFallbackProductNotes([])
      return
    }

    let active = true
    fetch(`/api/order-product-notes?orderIds=${encodeURIComponent(orderIds.join(','))}`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((json) => {
        if (!active) return
        setFallbackProductNotes(json.success && Array.isArray(json.data) ? json.data : [])
      })
      .catch(() => {
        if (active) setFallbackProductNotes([])
      })

    return () => { active = false }
  }, [data])

  function pageNumbers(): (number | "…")[] {
    const pages: (number | "…")[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (page > 3) pages.push("…")
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
      if (page < totalPages - 2) pages.push("…")
      pages.push(totalPages)
    }
    return pages
  }

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return
    setPage(newPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDownloadCSV = () => {
    if (!displayData.length) return
    const headers = [
      "S.No.", "Order ID", "Cat. No.", "Description", "Quantity",
      "Priority", "Price", "Discount", "After Discount", "Total Price", "Remark", "Status", "Custom Discount Status", "Date/Time"
    ]
    const rows = displayData.map((o, i) => [
      (page - 1) * ITEMS_PER_PAGE + i + 1,
      o.orderdata_id,
      o.orderdata_cat_no,
      o.order_item_description,
      o.orderdata_item_quantity,
      hasPriorityTag(o.priority, o.isPriority, o.is_priority, o.remark, o.remarks) ? "Priority" : "",
      o.orderdata_price,
      o.orderdata_discount,
      o.orderdata_afterDisPrice,
      o.orderdata_totalprice,
      o.displayRemark || o.remark,
      statusBadge(o.orderdata_status).label,
      customDiscountBadge(customDiscountProgressMap[getCustomDiscountProgressKeyForOrder(o.orderdata_orderid)]?.customDiscountStatus ?? null)?.label ?? "",
      o.orderdata_datetime,
    ])
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "dispatch-status.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  const startIndex = (page - 1) * ITEMS_PER_PAGE + 1
  const endIndex = Math.min(page * ITEMS_PER_PAGE, total)

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="p-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Order Status</h1>
              <p className="text-sm text-gray-500 mt-1">Track dispatch status of your order items</p>
            </div>
            <button
              onClick={handleDownloadCSV}
              disabled={!displayData.length}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
            >
              <Download className="w-4 h-4" />
              Export CSV ji
            </button>
          </div>

          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by catalogue number…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="pl-10 pr-4 py-2 px-8 border border-gray-300 rounded-lg text-sm bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition w-full"
            />
          </div>
        </div>

        {isError && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            Failed to load order data. Please try again.
          </div>
        )}

        {/* Table Card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">S.No.</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Order ID</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Cat. No.</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Description</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Qty</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Priority</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Price</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Discount</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">After Disc.</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Total</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Remark</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Custom Discount Status</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Date/Time</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {/* Shimmer */}
                {isLoading && Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 14 }).map((_, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className={`${SHIMMER} h-4 w-full`} />
                      </td>
                    ))}
                  </tr>
                ))}

                {/* Empty */}
                {!isLoading && displayData.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-gray-400">
                        <Package className="w-8 h-8" />
                        <span className="text-sm">No order items found</span>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Rows */}
                {!isLoading && displayData.map((item, i) => {
                  const badge = statusBadge(item.orderdata_status)
                  const isPriority = hasPriorityTag(item.priority, item.isPriority, item.is_priority, item.remark, item.remarks)
                  const customBadge = customDiscountBadge(
                    customDiscountProgressMap[getCustomDiscountProgressKeyForOrder(item.orderdata_orderid)]?.customDiscountStatus ?? null
                  )
                  return (
                    <tr key={item.orderdata_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-4 text-gray-400 text-xs">{startIndex + i}</td>

                      <td className="px-4 py-4">
                        <span className="font-mono text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                          #{item.orderdata_id}
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        <span className="font-mono text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                          {item.orderdata_cat_no || "—"}
                        </span>
                      </td>

                      <td className="px-4 py-4 text-gray-700 text-xs max-w-[180px] truncate">
                        {item.order_item_description || "—"}
                      </td>

                      <td className="px-4 py-4 text-gray-600 text-xs text-center">
                        {item.orderdata_item_quantity || "—"}
                      </td>

                      <td className="px-4 py-4">
                        {isPriority ? (
                          <span className="bg-red-50 text-red-700 border border-red-200 text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap">
                            Priority
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>

                      <td className="px-4 py-4 text-gray-600 text-xs">
                        ₹{item.orderdata_price || "0"}
                      </td>

                      <td className="px-4 py-4 text-gray-600 text-xs">
                        ₹{item.orderdata_discount || "0"}
                      </td>

                      <td className="px-4 py-4 text-gray-600 text-xs">
                        ₹{item.orderdata_afterDisPrice || "0"}
                      </td>

                      <td className="px-4 py-4">
                        <span className="bg-emerald-50 text-emerald-700 text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap">
                          ₹{item.orderdata_totalprice || "0"}
                        </span>
                      </td>

                      <td className="px-4 py-4 text-gray-500 text-xs">
                        {item.displayRemark || item.remark || "—"}
                      </td>

                      <td className="px-4 py-4">
                        <span className={`${badge.bg} ${badge.text} text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap`}>
                          {badge.label}
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        {customBadge ? (
                          <span className={`${customBadge.bg} ${customBadge.text} text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap`}>
                            {customBadge.label}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>

                      <td className="px-4 py-4 text-gray-400 text-xs whitespace-nowrap">
                        {item.orderdata_datetime?.slice(0, 16) || "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
            <span className="text-xs text-gray-400">
              {displayData.length > 0 ? `Showing ${startIndex}–${endIndex} of ${total}` : "No results"}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                ← Prev
              </button>

              {pageNumbers().map((p, idx) =>
                p === "…" ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-gray-400 text-sm">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => handlePageChange(p)}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                      p === page
                        ? "bg-indigo-600 text-white border-indigo-600 font-medium"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {p}
                  </button>
                )
              )}

              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Next →
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
