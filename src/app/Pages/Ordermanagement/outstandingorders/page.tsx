'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import { STAFF_ORDER_SCOPE_VERSION } from '@/lib/staffOrderScope.js'
import { formatAdditionalDiscountBadge, withDisplayOrderAmounts } from '@/lib/orderAmounts'
import { formatDisplayOrderNumber } from '@/lib/orderDisplay';

type Role = 'admin' | 'dealer' | 'staff' | 'accountant'
type PendingOrderData = {
  order_id: string; order_date: string; order_dealer: string; order_amount: string
  order_status: string; staffid: string; order_discount: string; del_status: string
  reason: string; accept_order: string; outstandingDate: string; orderDate: string
  Dealer_Name: string; orderdata_item_quantity: string
}
type OrderSummaryOverride = Record<string, unknown> & {
  orderId?: string | number
  order_id?: string | number
  order_dealer?: string | number
  dealerId?: string | number
}
type ResponseType = { data: PendingOrderData[]; total: number; last_page: number }

const ITEMS_PER_PAGE = 10
const YEAR           = new Date().getFullYear()
const ALLOWED_ROLES  = new Set<Role>(['admin', 'staff', 'dealer', 'accountant'])

function decodeJWTPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64)) as Record<string, unknown>
  } catch {
    return null
  }
}

function resolveViewer(): { role: Role; id: string } | null {
  if (typeof window === 'undefined') return null

  try {
    const accountantToken = localStorage.getItem('accountant_token')
    if (accountantToken) {
      const payload = decodeJWTPayload(accountantToken)
      if (typeof payload?.sub === 'string' || localStorage.getItem('AccountantData')) {
        return { role: 'accountant', id: String(payload?.sub ?? '') }
      }
    }

    const staffRaw = localStorage.getItem('staffData')
    if (staffRaw) {
      const parsed = JSON.parse(staffRaw)
      if (parsed?.staff_id) return { role: parsed.staff_roletype === '0' ? 'admin' : 'staff', id: String(parsed.staff_id) }
    }

    const userRaw = localStorage.getItem('UserData')
    if (userRaw) {
      const parsed = JSON.parse(userRaw)
      if (parsed?.Dealer_Id) return { role: 'dealer', id: String(parsed.Dealer_Id) }
      if (parsed?.staff_id) return { role: parsed.staff_roletype === '0' ? 'admin' : 'staff', id: String(parsed.staff_id) }
      if (localStorage.getItem('roletype') === '3' && parsed && Object.keys(parsed).length > 0) return { role: 'admin', id: String(parsed.id ?? '') }
    }

    const adminRaw = localStorage.getItem('AdminData') || localStorage.getItem('admin')
    if (adminRaw) {
      const parsed = JSON.parse(adminRaw)
      if (parsed && Object.keys(parsed).length > 0) return { role: 'admin', id: String(parsed.id ?? parsed.admin_id ?? '') }
    }
  } catch {}

  return null
}

function statusBadge(s: string) {
  if (s === "1") return { cls: "badge-approved", dot: "#10b981", label: "Approved" }
  if (s === "0") return { cls: "badge-pending",  dot: "#f59e0b", label: "Pending"  }
  return               { cls: "badge-unknown",  dot: "#9ca3af", label: "Unknown"  }
}
function acceptBadge(a: string) {
  return a === "1"
    ? { cls: "badge-accepted",     dot: "#3b82f6", label: "Accepted"     }
    : { cls: "badge-not-accepted", dot: "#ef4444", label: "Not Accepted" }
}

function orderLookupKey(value: unknown) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const trailing = text.match(/(\d+)(?!.*\d)/)?.[1]
  if (!trailing) return text
  const normalized = String(Number(trailing))
  return normalized === 'NaN' ? trailing : normalized
}

function rememberSummaryOverride(
  target: Record<string, OrderSummaryOverride>,
  item: OrderSummaryOverride
) {
  const ids = [
    item.orderId,
    item.order_id,
  ]

  ids.forEach((id) => {
    const raw = String(id ?? '').trim()
    const normalized = orderLookupKey(id)
    if (raw) target[raw] = item
    if (normalized) target[normalized] = item
  })
}

function FilterSelect({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void
  placeholder: string; options: { value: string; label: string }[]
}) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)}
        className={`appearance-none h-9 pl-3 pr-8 rounded-lg border text-xs font-medium cursor-pointer outline-none transition-all font-[Sora,sans-serif] ${
          value ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
        }`}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
        width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M6 9l6 6 6-6"/>
      </svg>
      {value && (
        <button onClick={() => onChange('')} aria-label="Clear"
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber-500 text-white flex items-center justify-center text-[9px] leading-none">✕</button>
      )}
    </div>
  )
}

export default function PendingOrdersPage() {
  const router      = useRouter()
  const queryClient = useQueryClient()

  const [viewerRole, setViewerRole]   = useState<Role | null>(null)
  const [viewerId, setViewerId] = useState("")
  const [authResolved, setAuthResolved] = useState(false)
  const [page,         setPage]         = useState(1)
  const [search,       setSearch]       = useState("")
  const [searchInput,  setSearchInput]  = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [acceptFilter, setAcceptFilter] = useState("")
  const hasAccess = viewerRole !== null && ALLOWED_ROLES.has(viewerRole)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const viewer = resolveViewer()

      if (!viewer) {
        router.replace('/auth/login')
        setAuthResolved(true)
        return
      }

      if (!ALLOWED_ROLES.has(viewer.role)) {
        router.replace(viewer.role === 'dealer' ? '/dashboard/dealer' : '/dashboard')
        setAuthResolved(true)
        return
      }

      setViewerRole(viewer.role)
      setViewerId(viewer.id)
      setAuthResolved(true)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [router])

  const { data: response, isLoading, isError } = useQuery<ResponseType>({
    queryKey: ['pendingorders', STAFF_ORDER_SCOPE_VERSION, viewerRole, viewerId, page, search, statusFilter, acceptFilter],
    enabled: authResolved && hasAccess,
    queryFn: async () => {
      const res = await axios.get(`/api/orders-data?page=${page}&limit=${ITEMS_PER_PAGE}&search=${encodeURIComponent(search)}&order_status=${encodeURIComponent(statusFilter)}&accepted=${encodeURIComponent(acceptFilter)}`)
      return res.data
    },
    placeholderData: keepPreviousData, staleTime: 5 * 60 * 1000,
  })

  const allData: PendingOrderData[] = response?.data || []
  const orderIdsKey = allData.map((order) => String(order.order_id || '').trim()).filter(Boolean).join(',')
  const { data: summaryOverrides = {} } = useQuery<Record<string, OrderSummaryOverride>>({
    queryKey: ['pendingorders-summary-overrides', orderIdsKey],
    enabled: authResolved && hasAccess && orderIdsKey.length > 0,
    queryFn: async () => {
      const params = new URLSearchParams({ order_ids: orderIdsKey })
      const json = await fetch(`/api/order-summary-overrides?${params.toString()}`, { cache: 'no-store' }).then((r) => r.json())
      const next: Record<string, OrderSummaryOverride> = {}
      if (json.success) {
        ;(json.data ?? []).forEach((item: OrderSummaryOverride) => {
          rememberSummaryOverride(next, item)
        })
      }
      return next
    },
    staleTime: 5 * 60 * 1000,
  })
  const displayData = allData.filter(o => {
    if (statusFilter !== '' && o.order_status !== statusFilter) return false
    if (acceptFilter !== '' && o.accept_order !== acceptFilter) return false
    return true
  })

  const total      = typeof response?.total === "number" ? response.total : (page - 1) * ITEMS_PER_PAGE + allData.length
  const totalPages = response?.last_page || Math.ceil(total / ITEMS_PER_PAGE) || (allData.length < ITEMS_PER_PAGE ? page : page + 1)
  const startIndex = total === 0 ? 0 : (page - 1) * ITEMS_PER_PAGE + 1
  const endIndex   = total === 0 ? 0 : Math.min(page * ITEMS_PER_PAGE, total)
  const activeFilters = [statusFilter, acceptFilter].filter(Boolean).length

  useEffect(() => {
    if (!authResolved || !hasAccess) return
    if (page >= totalPages) return
    queryClient.prefetchQuery({
      queryKey: ['pendingorders', STAFF_ORDER_SCOPE_VERSION, viewerRole, viewerId, page + 1, search, statusFilter, acceptFilter],
      queryFn: async () => { const res = await axios.get(`/api/orders-data?page=${page + 1}&limit=${ITEMS_PER_PAGE}&search=${encodeURIComponent(search)}&order_status=${encodeURIComponent(statusFilter)}&accepted=${encodeURIComponent(acceptFilter)}`); return res.data },
    })
  }, [acceptFilter, authResolved, hasAccess, page, queryClient, search, statusFilter, totalPages, viewerId, viewerRole])

  useEffect(() => { const t = setTimeout(() => { setPage(1); setSearch(searchInput) }, 400); return () => clearTimeout(t) }, [searchInput])

  const updateStatusFilter = (value: string) => {
    setPage(1)
    setStatusFilter(value)
  }

  const updateAcceptFilter = (value: string) => {
    setPage(1)
    setAcceptFilter(value)
  }

  function pageNumbers(): (number | "…")[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const pages: (number | "…")[] = [1]; const s = Math.max(2, page - 1); const e = Math.min(totalPages - 1, page + 1)
    if (s > 2) pages.push("…"); for (let i = s; i <= e; i++) pages.push(i); if (e < totalPages - 1) pages.push("…"); pages.push(totalPages)
    return pages
  }
  const handlePageChange = (p: number) => { if (p < 1 || p > totalPages) return; setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  if (!authResolved || !hasAccess) return null

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .po-root { min-height: 100vh; background: #f7f8fc; font-family: 'Sora', sans-serif; color: #0f172a; }
        .po-topbar { background: #fff; border-bottom: 1px solid #e8eaf0; padding: 0 28px; height: 60px; display: flex; align-items: center; gap: 14px; position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 8px rgba(0,0,0,0.04); }
        .back-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px 6px 10px; border-radius: 8px; border: 1px solid #e2e6ef; background: #f7f8fc; font-size: 12.5px; font-weight: 500; color: #475569; cursor: pointer; font-family: inherit; transition: all 0.15s; }
        .back-btn:hover { background: #eef0f8; border-color: #c7cde0; color: #1e293b; transform: translateX(-1px); }
        .topbar-div { width: 1px; height: 22px; background: #e2e6ef; flex-shrink: 0; }
        .topbar-title { font-size: 15px; font-weight: 600; color: #0f172a; }
        .topbar-sub   { font-size: 12px; color: #94a3b8; margin-left: 4px; }
        .topbar-right { margin-left: auto; }
        .status-pill  { padding: 3px 11px; border-radius: 20px; font-size: 11px; font-weight: 600; background: #fef3c7; color: #b45309; }
        .po-body { padding: 28px; max-width: 1840px; margin: 0 auto; }
        .page-header { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 16px; }
        .page-title   { font-size: 26px; font-weight: 700; letter-spacing: -0.03em; color: #0f172a; }
        .page-caption { font-size: 13px; color: #64748b; margin-top: 3px; }
        .search-wrap { position: relative; }
        .search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #94a3b8; pointer-events: none; width: 15px; height: 15px; }
        .search-input { padding: 9px 14px 9px 36px; border: 1.5px solid #e2e6ef; border-radius: 10px; font-size: 13px; font-family: 'Sora', sans-serif; background: #fff; color: #0f172a; width: 280px; outline: none; transition: border-color 0.15s, box-shadow 0.15s; }
        .search-input::placeholder { color: #94a3b8; }
        .search-input:focus { border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,0.12); }
        .filter-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 11px 16px; background: #fff; border: 1px solid #e8eaf0; border-radius: 12px; margin-bottom: 18px; }
        .filter-label { font-size: 11.5px; font-weight: 600; color: #64748b; display: flex; align-items: center; gap: 5px; white-space: nowrap; }
        .filter-div   { width: 1px; height: 20px; background: #e2e6ef; flex-shrink: 0; }
        .filter-count { display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px; border-radius: 50%; background: #f59e0b; color: #fff; font-size: 10px; font-weight: 700; }
        .filter-tag   { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 500; }
        .filter-tag-x { background: none; border: none; cursor: pointer; padding: 0; line-height: 1; display: flex; align-items: center; opacity: 0.7; }
        .filter-tag-x:hover { opacity: 1; }
        .clear-btn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 7px; border: 1px solid #fde68a; background: #fffbeb; color: #b45309; font-size: 11px; font-weight: 500; cursor: pointer; font-family: inherit; transition: all 0.12s; white-space: nowrap; }
        .clear-btn:hover { background: #fef3c7; }
        .stats-row { display: flex; gap: 12px; margin-bottom: 22px; flex-wrap: wrap; }
        .stat-pill { display: flex; align-items: center; gap: 7px; padding: 8px 16px; background: #fff; border: 1px solid #e8eaf0; border-radius: 10px; font-size: 12.5px; color: #374151; font-weight: 500; }
        .stat-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .stat-num { font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 13px; color: #0f172a; }
        .err-banner { margin-bottom: 16px; padding: 12px 16px; background: #fff5f5; border: 1px solid #fecaca; border-radius: 10px; font-size: 13px; color: #dc2626; display: flex; align-items: center; gap: 8px; }
        .table-card { background: #fff; border: 1px solid #e8eaf0; border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); overflow: hidden; }
        .alert-strip { display: flex; align-items: center; gap: 8px; padding: 10px 20px; font-size: 12px; font-weight: 500; color: #92400e; background: linear-gradient(to right, #fffbeb, #fef3c7); border-bottom: 1px solid #fde68a; }
        .table-scroll { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        thead { background: #fffbeb; }
        th { padding: 12px 14px; text-align: left; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: #92400e; white-space: nowrap; border-bottom: 1px solid #fde68a; }
        th:first-child { padding-left: 20px; } th:last-child { padding-right: 20px; }
        tbody tr { border-bottom: 1px solid #f1f3f9; transition: background 0.12s; }
        tbody tr:last-child { border-bottom: none; } tbody tr:hover { background: #fffbeb; }
        td { padding: 13px 14px; vertical-align: middle; color: #374151; }
        td:first-child { padding-left: 20px; } td:last-child { padding-right: 20px; }
        .shimmer { height: 14px; border-radius: 6px; background: linear-gradient(90deg, #f0f2f8 25%, #e4e8f2 50%, #f0f2f8 75%); background-size: 200% 100%; animation: sh 1.4s infinite; }
        @keyframes sh { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .order-id-pill { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 500; background: #fffbeb; color: #92400e; padding: 3px 8px; border-radius: 6px; border: 1px solid #fde68a; }
        .amount-pill   { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; font-weight: 600; color: #065f46; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 3px 9px; border-radius: 20px; white-space: nowrap; }
        .dealer-name   { font-weight: 500; color: #1e293b; font-size: 12.5px; }
        .dealer-sub    { font-size: 10.5px; color: #94a3b8; margin-top: 1px; }
        .mono-sm       { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: #64748b; }
        .due-urgent    { color: #b45309; font-weight: 600; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; }
        .badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 20px; white-space: nowrap; }
        .badge-dot          { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
        .badge-approved     { background: #ecfdf5; color: #065f46; }
        .badge-pending      { background: #fffbeb; color: #92400e; }
        .badge-unknown      { background: #f3f4f6; color: #6b7280; }
        .badge-accepted     { background: #eff6ff; color: #1d4ed8; }
        .badge-not-accepted { background: #fff1f2; color: #be123c; }
        .empty-row td { padding: 52px 20px; text-align: center; color: #9ca3af; font-size: 13px; }
        .pagination { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-top: 1px solid #f1f3f9; flex-wrap: wrap; gap: 12px; }
        .pagination-info { font-size: 12px; color: #94a3b8; }
        .pagination-info strong { color: #374151; font-weight: 600; }
        .pager { display: flex; align-items: center; gap: 4px; }
        .page-btn { min-width: 32px; height: 32px; padding: 0 8px; border-radius: 8px; border: 1px solid #e2e6ef; background: #fff; font-size: 12.5px; font-family: 'Sora', sans-serif; font-weight: 500; color: #374151; cursor: pointer; transition: all 0.12s; display: flex; align-items: center; justify-content: center; gap: 4px; }
        .page-btn:hover:not(:disabled):not(.active) { background: #fffbeb; border-color: #fde68a; }
        .page-btn.active { background: #b45309; border-color: #b45309; color: #fff; font-weight: 600; }
        .page-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .page-ell { padding: 0 4px; color: #94a3b8; font-size: 13px; }
      `}</style>

      <div className="po-root">

        {/* Topbar */}
        <div className="po-topbar">
          <button className="back-btn" onClick={() => router.back()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
            Back
          </button>
          <div className="topbar-div" />
          <span className="topbar-title">
            Pending Orders
            {!isLoading && total > 0 && <span className="topbar-sub">· {total.toLocaleString()} records</span>}
          </span>
          <div className="topbar-right">
            <span className="status-pill">⏳ Awaiting Action</span>
          </div>
        </div>

        <div className="po-body">

          {/* Header */}
          <div className="page-header">
            <div>
              <div className="page-title">Pending Orders</div>
              <div className="page-caption">Track and manage all outstanding dealer orders</div>
            </div>
            <div className="search-wrap">
              <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input type="text" placeholder="Search orders…" value={searchInput} onChange={e => setSearchInput(e.target.value)} className="search-input" />
            </div>
          </div>

          {/* Filter bar */}
          <div className="filter-bar">
            <span className="filter-label">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
              Filters
              {activeFilters > 0 && <span className="filter-count">{activeFilters}</span>}
            </span>
            <div className="filter-div" />

            <FilterSelect value={statusFilter} onChange={updateStatusFilter} placeholder="Order Status"
              options={[{ value: '0', label: 'Pending' }, { value: '1', label: 'Approved' }]}
            />
            <FilterSelect value={acceptFilter} onChange={updateAcceptFilter} placeholder="Order Confirmation"
              options={[{ value: '0', label: 'Acceptance order is pending' }, { value: '1', label: 'Order accepted' }]}
            />

            {statusFilter && (
              <span className="filter-tag" style={{ background: '#fffbeb', color: '#92400e' }}>
                {statusFilter === '0' ? 'Pending' : 'Approved'}
                <button className="filter-tag-x" onClick={() => updateStatusFilter('')} style={{ color: '#92400e' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </span>
            )}
            {acceptFilter && (
              <span className="filter-tag" style={{ background: '#fff1f2', color: '#be123c' }}>
                {acceptFilter === '0' ? 'Pending acceptance' : 'Accepted'}
                <button className="filter-tag-x" onClick={() => updateAcceptFilter('')} style={{ color: '#be123c' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </span>
            )}
            {activeFilters > 0 && (
              <button className="clear-btn" onClick={() => { updateStatusFilter(''); updateAcceptFilter('') }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                Clear all
              </button>
            )}
          </div>

          {/* Stats */}
          {!isLoading && (
            <div className="stats-row">
              <div className="stat-pill"><span className="stat-dot" style={{ background: "#f59e0b" }} />{activeFilters > 0 ? 'Filtered' : 'Total Pending'}<span className="stat-num">{activeFilters > 0 ? displayData.length : total.toLocaleString()}</span></div>
              <div className="stat-pill"><span className="stat-dot" style={{ background: "#ef4444" }} />Not Accepted<span className="stat-num">{displayData.filter(o => o.accept_order === "0").length}</span></div>
              <div className="stat-pill"><span className="stat-dot" style={{ background: "#3b82f6" }} />Accepted<span className="stat-num">{displayData.filter(o => o.accept_order === "1").length}</span></div>
              <div className="stat-pill"><span className="stat-dot" style={{ background: "#8b5cf6" }} />Page<span className="stat-num">{page}/{totalPages}</span></div>
            </div>
          )}

          {isError && (
            <div className="err-banner">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
              Failed to load orders. Please try again.
            </div>
          )}

          {/* Table */}
          <div className="table-card">
            <div className="alert-strip">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              These orders require attention — review and take action promptly.
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>Order ID</th><th>Dealer</th>
                    <th>Order Date</th><th>Due Date</th><th>Amount</th>
                    <th>Discount</th><th>Qty</th><th>Status</th><th>Acceptance</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 10 }).map((_, j) => <td key={j}><div className="shimmer" style={{ width: j === 2 ? '120px' : j === 5 ? '80px' : '60px' }} /></td>)}</tr>
                  ))}

                  {!isLoading && displayData.length === 0 && (
                    <tr className="empty-row">
                      <td colSpan={10}>
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5" style={{ margin: '0 auto 10px', display: 'block' }}>
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                        {activeFilters > 0 ? 'No orders match the current filters' : 'All caught up — no pending orders'}
                      </td>
                    </tr>
                  )}

                  {!isLoading && displayData.map((order, i) => {
                    const sb = statusBadge(order.order_status)
                    const ab = acceptBadge(order.accept_order)
                    const amounts = withDisplayOrderAmounts(order, summaryOverrides[order.order_id] ?? summaryOverrides[orderLookupKey(order.order_id)])
                    const discountBadge = formatAdditionalDiscountBadge(amounts)
                    return (
                      <tr key={order.order_id ?? i}>
                        <td className="mono-sm">{startIndex + i}</td>
                        <td><span className="order-id-pill">{formatDisplayOrderNumber(order.order_id)}</span></td>
                        <td>
                          <div className="dealer-name">{order.Dealer_Name || '—'}</div>
                          <div className="dealer-sub">ID: {order.order_dealer}</div>
                        </td>
                        <td className="mono-sm">{(order.orderDate || order.order_date || '—').slice(0, 10)}</td>
                        <td>{order.outstandingDate ? <span className="due-urgent">{order.outstandingDate}</span> : <span className="mono-sm">—</span>}</td>
                        <td><span className="amount-pill">₹{amounts.grossAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></td>
                        <td className="mono-sm">
                          ₹{amounts.discountAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                          {discountBadge && (
                            <div className="qty-info" style={{ color: '#4f46e5', fontWeight: 600 }}>
                              {discountBadge}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontWeight: '600', color: '#374151', fontSize: '12.5px' }}>
                          {order.orderdata_item_quantity || '—'}
                        </td>
                        <td><span className={`badge ${sb.cls}`}><span className="badge-dot" style={{ background: sb.dot }} />{sb.label}</span></td>
                        <td><span className={`badge ${ab.cls}`}><span className="badge-dot" style={{ background: ab.dot }} />{ab.label}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="pagination">
              <div className="pagination-info">
                {displayData.length > 0
                  ? <>Showing <strong>{startIndex}–{endIndex}</strong> of <strong>{total.toLocaleString()}</strong> orders</>
                  : 'No results'
                }
              </div>
              <div className="pager">
                <button className="page-btn" onClick={() => handlePageChange(page - 1)} disabled={page === 1}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>Prev
                </button>
                {pageNumbers().map((p, idx) =>
                  p === "…" ? <span key={`e${idx}`} className="page-ell">…</span>
                  : <button key={p} onClick={() => handlePageChange(p as number)} className={`page-btn${p === page ? ' active' : ''}`}>{p}</button>
                )}
                <button className="page-btn" onClick={() => handlePageChange(page + 1)} disabled={page === totalPages}>
                  Next<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
