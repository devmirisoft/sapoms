'use client'

import { Fragment, useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import moment from 'moment'
import { useRouter } from 'next/navigation'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Download,
  Search,
  ShieldAlert,
  Store,
} from 'lucide-react'

type AllowedRole = 'admin' | 'staff'

type DealerCategoryReportProps = {
  allowedRoles?: AllowedRole[]
}

type DashboardSession = {
  role: AllowedRole | 'dealer'
  id: string
  roletype?: string
  name?: string
}

type Dealer = {
  Dealer_Id: string
  Dealer_Name: string
  Dealer_City?: string
  Dealer_Number?: string
  Dealer_Dealercode?: string
  assignedstaff?: string
  staffname?: string
}

type DealerListResponse = {
  success: boolean
  data: Dealer[]
  total: number
  last_page: number
  page: number
  pageSize: number
}

type OrderContribution = {
  orderId: string
  orderDate: string
  dealerId: string
  dealerName: string
  catalogueNumber: string
  purchasedQuantity: number
  totalValue: number
  statusLabel: string
}

type ProductRow = {
  productKey: string
  productName: string
  catalogueNumber: string
  normalizedCatalogueNumber?: string
  category: string
  specification: string
  purchasedQuantity: number
  orderCount: number
  totalValue: number
  latestPurchaseDate: string
  orders: OrderContribution[]
}

type CategoryRow = {
  category: string
  purchasedQuantity: number
  orderCount: number
  variantCount: number
  shareOfPurchases: number
  latestPurchaseDate: string
  totalValue: number
  products: ProductRow[]
}

type ReportWarning = {
  code: string
  message: string
  orderIds?: string[]
}

type ReportResponse = {
  success: boolean
  dealer: Dealer | null
  summary: {
    totalOrders: number
    totalPurchasedQuantity: number
    totalCategories: number
    totalVariants: number
    distinctProducts?: number
    totalSalesValue: number
    latestPurchaseDate: string
    dateRange: { from: string; to: string }
    statusFilter: 'all' | 'accepted' | 'completed'
  }
  products: ProductRow[]
  categories: CategoryRow[]
  warnings: ReportWarning[]
  meta: {
    lineCount: number
    failedOrderCount: number
    failedOrderIds: string[]
    dealerId: string
    role: AllowedRole
    orderRouteBase: string
    statusFilter: 'all' | 'accepted' | 'completed'
  }
}

type SortKey = 'quantity_desc' | 'alphabetical' | 'latest_purchase'
type RangePreset = 'all_time' | 'current_fy' | 'this_year' | 'last_12_months' | 'custom'
type StatusFilter = 'all' | 'accepted' | 'completed'

const subscribeToHydration = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

function useHasHydrated() {
  return useSyncExternalStore(subscribeToHydration, getClientSnapshot, getServerSnapshot)
}

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return ''
}

function resolveDashboardSession(): DashboardSession | null {
  if (typeof window === 'undefined') return null

  try {
    const staffRaw = localStorage.getItem('staffData')
    if (staffRaw) {
      const parsed = JSON.parse(staffRaw)
      if (parsed?.staff_id) {
        return {
          role: parsed.staff_roletype === '0' ? 'admin' : 'staff',
          id: String(parsed.staff_id),
          roletype: String(parsed.staff_roletype ?? ''),
          name: parsed.staff_name || '',
        }
      }
    }

    const userRaw = localStorage.getItem('UserData')
    if (userRaw) {
      const parsed = JSON.parse(userRaw)
      if (parsed?.Dealer_Id) {
        return {
          role: 'dealer',
          id: String(parsed.Dealer_Id),
          name: parsed.Dealer_Name || '',
        }
      }

      if (parsed?.staff_id) {
        return {
          role: parsed.staff_roletype === '0' ? 'admin' : 'staff',
          id: String(parsed.staff_id),
          roletype: String(parsed.staff_roletype ?? ''),
          name: parsed.staff_name || '',
        }
      }
    }

    const adminRaw = localStorage.getItem('AdminData') || localStorage.getItem('admin')
    if (adminRaw) {
      const parsed = JSON.parse(adminRaw)
      if (parsed && Object.keys(parsed).length > 0) {
        return {
          role: 'admin',
          id: firstNonEmpty(parsed.id, parsed.admin_id, parsed.Admin_Id, 'admin'),
          roletype: '0',
          name: parsed.name || parsed.email || 'Admin',
        }
      }
    }
  } catch {
    return null
  }

  return null
}

function buildActorHeaders(session: DashboardSession | null): HeadersInit {
  return {}
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const text = await response.text()

  if (!response.ok) {
    try {
      const payload = JSON.parse(text)
      throw new Error(payload?.message || `Request failed with HTTP ${response.status}`)
    } catch (error) {
      if (error instanceof Error && error.message !== text) throw error
      throw new Error(text || `Request failed with HTTP ${response.status}`)
    }
  }

  if (/^\s*</.test(text)) {
    throw new Error('Expected JSON but received HTML')
  }

  return JSON.parse(text) as T
}

function formatRupee(value: number) {
  return `Rs. ${value.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatDate(value: string) {
  if (!value) return 'Not available'
  const parsed = moment(value)
  return parsed.isValid() ? parsed.format('DD MMM YYYY') : 'Not available'
}

function getRangeValues(preset: RangePreset) {
  const today = moment()
  if (preset === 'current_fy') {
    const fyStart = today.month() >= 3
      ? today.clone().month(3).startOf('month')
      : today.clone().subtract(1, 'year').month(3).startOf('month')
    return {
      from: fyStart.format('YYYY-MM-DD'),
      to: today.clone().endOf('day').format('YYYY-MM-DD'),
    }
  }

  if (preset === 'this_year') {
    return {
      from: today.clone().startOf('year').format('YYYY-MM-DD'),
      to: today.clone().endOf('day').format('YYYY-MM-DD'),
    }
  }

  if (preset === 'last_12_months') {
    return {
      from: today.clone().subtract(12, 'months').startOf('day').format('YYYY-MM-DD'),
      to: today.clone().endOf('day').format('YYYY-MM-DD'),
    }
  }

  if (preset === 'all_time') {
    return { from: '', to: '' }
  }

  return null
}

function escapeCsvCell(value: string | number) {
  const text = String(value ?? '')
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function productMatchesSearch(product: ProductRow, search: string) {
  if (!search) return true
  const needle = search.toLowerCase()

  return [
    product.productName,
    product.catalogueNumber,
    product.normalizedCatalogueNumber,
    product.category,
    product.specification,
  ]
    .join(' ')
    .toLowerCase()
    .includes(needle)
}

function sortProducts(rows: ProductRow[], sortBy: SortKey) {
  const sorted = [...rows]
  sorted.sort((left, right) => {
    if (sortBy === 'alphabetical') {
      return left.productName.localeCompare(right.productName, undefined, { sensitivity: 'base' })
    }

    if (sortBy === 'latest_purchase') {
      const leftDate = moment(left.latestPurchaseDate).valueOf() || 0
      const rightDate = moment(right.latestPurchaseDate).valueOf() || 0
      if (rightDate !== leftDate) return rightDate - leftDate
      return right.purchasedQuantity - left.purchasedQuantity
    }

    if (right.purchasedQuantity !== left.purchasedQuantity) {
      return right.purchasedQuantity - left.purchasedQuantity
    }
    return left.productName.localeCompare(right.productName, undefined, { sensitivity: 'base' })
  })
  return sorted
}

function downloadReportCsv(report: ReportResponse) {
  const rows: Array<Array<string | number>> = [
    [
      'Dealer ID',
      'Dealer Name',
      'Dealer Code',
      'City',
      'Date From',
      'Date To',
      'Status Filter',
      'Category',
      'Product',
      'Catalogue Number',
      'Specification',
      'Purchased Quantity',
      'Contributing Order Count',
      'Total Value',
      'Latest Purchase',
    ],
  ]

  for (const product of report.products ?? report.categories.flatMap((category) => category.products.map((row) => ({ ...row, category: category.category })))) {
    rows.push([
      report.dealer?.Dealer_Id || '',
      report.dealer?.Dealer_Name || '',
      report.dealer?.Dealer_Dealercode || '',
      report.dealer?.Dealer_City || '',
      report.summary.dateRange.from || 'All Time',
      report.summary.dateRange.to || 'All Time',
      report.summary.statusFilter,
      product.category,
      product.productName,
      product.catalogueNumber,
      product.specification,
      product.purchasedQuantity,
      product.orderCount,
      product.totalValue,
      product.latestPurchaseDate,
    ])
  }

  const csv = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `dealer-category-report-${report.dealer?.Dealer_Id || 'dealer'}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function DealerCategoryReport({ allowedRoles = ['admin', 'staff'] }: DealerCategoryReportProps) {
  const router = useRouter()
  const hasHydrated = useHasHydrated()
  const session = hasHydrated ? resolveDashboardSession() : null

  const [selectorOpen, setSelectorOpen] = useState(false)
  const [dealerSearch, setDealerSearch] = useState('')
  const [dealerPage, setDealerPage] = useState(1)
  const [selectedDealer, setSelectedDealer] = useState<Dealer | null>(null)
  const [rangePreset, setRangePreset] = useState<RangePreset>('all_time')
  const [customFromDate, setCustomFromDate] = useState('')
  const [customToDate, setCustomToDate] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [tableSearch, setTableSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('quantity_desc')
  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>({})

  const deferredDealerSearch = useDeferredValue(dealerSearch)
  const deferredTableSearch = useDeferredValue(tableSearch)
  const isAllowedRole = session && (session.role === 'admin' || session.role === 'staff') && allowedRoles.includes(session.role)
  const presetRange = useMemo(() => getRangeValues(rangePreset), [rangePreset])
  const fromDate = rangePreset === 'custom' ? customFromDate : (presetRange?.from ?? '')
  const toDate = rangePreset === 'custom' ? customToDate : (presetRange?.to ?? '')

  useEffect(() => {
    if (!hasHydrated) return
    if (!session) {
      router.replace('/auth/login')
      return
    }

    if (session.role === 'dealer') {
      router.replace('/dashboard/dealer')
      return
    }

    if (!allowedRoles.includes(session.role)) {
      router.replace('/auth/login')
    }
  }, [allowedRoles, hasHydrated, router, session])

  const dealersQuery = useQuery<DealerListResponse>({
    queryKey: [
      'dealer-category-report',
      'dealers',
      session?.role,
      session?.id,
      deferredDealerSearch,
      dealerPage,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(dealerPage),
        search: deferredDealerSearch,
      })
      return fetchJson<DealerListResponse>(`/api/reports/dealer-category/dealers?${params.toString()}`, {
        headers: buildActorHeaders(session),
      })
    },
    enabled: !!isAllowedRole && selectorOpen,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })

  const reportQuery = useQuery<ReportResponse>({
    queryKey: [
      'dealer-category-report',
      'report',
      session?.role,
      session?.id,
      selectedDealer?.Dealer_Id,
      fromDate,
      toDate,
      statusFilter,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        dealerId: selectedDealer?.Dealer_Id || '',
        from: fromDate,
        to: toDate,
        status: statusFilter,
      })

      return fetchJson<ReportResponse>(`/api/reports/dealer-category?${params.toString()}`, {
        headers: buildActorHeaders(session),
      })
    },
    enabled: !!isAllowedRole && !!selectedDealer?.Dealer_Id,
    retry: 1,
    staleTime: 60_000,
  })

  const visibleProducts = useMemo(() => {
    const products = reportQuery.data?.products ?? []
    const filtered = products.filter((product) => productMatchesSearch(product, deferredTableSearch))
    return sortProducts(filtered, sortBy)
  }, [deferredTableSearch, reportQuery.data?.products, sortBy])

  if (!hasHydrated || !isAllowedRole) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <div className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4 py-8">
          <div className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600">
              <ShieldAlert size={20} />
            </div>
            <div className="text-lg font-semibold text-slate-900">Checking access</div>
            <div className="mt-1 text-sm text-slate-500">Please wait while we verify your dashboard role.</div>
          </div>
        </div>
      </div>
    )
  }

  const selectedSummaryDealer = reportQuery.data?.dealer ?? selectedDealer
  const selectedReport = reportQuery.data
  const dealerResults = dealersQuery.data?.data ?? []
  const dealerLastPage = dealersQuery.data?.last_page ?? 1
  const dealerTotal = dealersQuery.data?.total ?? 0
  const showDealerLoading = dealersQuery.isFetching && selectorOpen
  const showReportLoading = reportQuery.isLoading || reportQuery.isFetching

  const toggleProduct = (productKey: string) => {
    setExpandedProducts((prev) => ({ ...prev, [productKey]: !prev[productKey] }))
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-[1840px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-6 py-6 text-white shadow-2xl shadow-slate-900/10 sm:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">
                <Store size={12} /> Dealer purchase report
              </p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Dealer Category Report</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">
                Review one dealer&apos;s historical purchases by category, product, and contributing orders.
              </p>
            </div>
            <div className="grid gap-2 text-sm text-white/75 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Dealer</div>
                <div className="mt-1 font-semibold text-white">{selectedSummaryDealer?.Dealer_Name ?? 'Not selected'}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Orders</div>
                <div className="mt-1 font-semibold text-white">{selectedReport?.summary.totalOrders?.toLocaleString('en-IN') ?? '0'}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Units</div>
                <div className="mt-1 font-semibold text-white">{selectedReport?.summary.totalPurchasedQuantity?.toLocaleString('en-IN') ?? '0'}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/45">Categories</div>
                <div className="mt-1 font-semibold text-white">{selectedReport?.summary.totalCategories?.toLocaleString('en-IN') ?? '0'}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Dealer selector</div>
                <div className="text-xs text-slate-500">
                  {session.role === 'staff'
                    ? 'Only your assigned dealers appear here.'
                    : 'Search by dealer name, dealer code, city, phone, or dealer ID.'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectorOpen((value) => !value)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                {selectorOpen ? 'Close' : 'Select'}
                <ChevronDown size={14} className={selectorOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={dealerSearch}
                onChange={(event) => {
                  setDealerSearch(event.target.value)
                  setDealerPage(1)
                  setSelectorOpen(true)
                }}
                onFocus={() => setSelectorOpen(true)}
                placeholder={session.role === 'staff' ? 'Search assigned dealers...' : 'Search dealers...'}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-100"
              />

              {selectorOpen && (
                <div className="absolute z-20 mt-2 w-full rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10">
                  {showDealerLoading ? (
                    <div className="px-3 py-4 text-sm text-slate-500">Loading dealers...</div>
                  ) : dealersQuery.isError ? (
                    <div className="px-3 py-4 text-sm text-red-600">
                      {dealersQuery.error instanceof Error ? dealersQuery.error.message : 'Failed to load dealers.'}
                    </div>
                  ) : dealerResults.length > 0 ? (
                    <>
                      <div className="max-h-80 overflow-auto">
                        {dealerResults.map((dealer) => (
                          <button
                            key={dealer.Dealer_Id}
                            type="button"
                            onClick={() => {
                              setSelectedDealer(dealer)
                              setExpandedProducts({})
                              setSelectorOpen(false)
                            }}
                            className="flex w-full items-start justify-between gap-4 rounded-xl px-3 py-3 text-left transition hover:bg-slate-50"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-medium text-slate-900">{dealer.Dealer_Name}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                {dealer.Dealer_City || 'No city'} · {dealer.Dealer_Number || 'No phone'}
                              </div>
                            </div>
                            <div className="rounded-full bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-700">
                              {dealer.Dealer_Dealercode || dealer.Dealer_Id}
                            </div>
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center justify-between border-t border-slate-100 px-2 pt-3 text-xs text-slate-500">
                        <span>{dealerTotal.toLocaleString('en-IN')} dealers</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={dealerPage <= 1}
                            onClick={() => setDealerPage((page) => Math.max(1, page - 1))}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Prev
                          </button>
                          <span>Page {dealerPage} of {dealerLastPage}</span>
                          <button
                            type="button"
                            disabled={dealerPage >= dealerLastPage}
                            onClick={() => setDealerPage((page) => Math.min(dealerLastPage, page + 1))}
                            className="rounded-lg border border-slate-200 px-2 py-1 text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="px-3 py-4 text-sm text-slate-500">
                      {session.role === 'staff'
                        ? 'No assigned dealers matched your search.'
                        : 'No dealers matched your search.'}
                    </div>
                  )}
                </div>
              )}
            </div>

            {selectedSummaryDealer && (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Selected dealer</div>
                    <div className="mt-1 text-lg font-semibold text-slate-900">{selectedSummaryDealer.Dealer_Name}</div>
                    <div className="mt-1 text-sm text-slate-500">
                      {selectedSummaryDealer.Dealer_Dealercode || selectedSummaryDealer.Dealer_Id}
                      {' · '}
                      {selectedSummaryDealer.Dealer_City || 'No city'}
                      {selectedSummaryDealer.staffname ? ` · ${selectedSummaryDealer.staffname}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDealer(null)
                      setExpandedProducts({})
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4">
              <div className="text-sm font-semibold text-slate-900">Filters</div>
              <div className="text-xs text-slate-500">Date and order-state filters recompute the full report.</div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Date range</span>
                <select
                  value={rangePreset}
                  onChange={(event) => setRangePreset(event.target.value as RangePreset)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-100"
                >
                  <option value="all_time">All Time</option>
                  <option value="current_fy">Current Financial Year</option>
                  <option value="this_year">This Year</option>
                  <option value="last_12_months">Last 12 Months</option>
                  <option value="custom">Custom Range</option>
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Status filter</span>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-100"
                >
                  <option value="all">All eligible orders</option>
                  <option value="accepted">Accepted</option>
                  <option value="completed">Completed / Successful</option>
                </select>
              </label>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">From date</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(event) => {
                    setRangePreset('custom')
                    setCustomFromDate(event.target.value)
                  }}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-100"
                />
              </label>

              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">To date</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(event) => {
                    setRangePreset('custom')
                    setCustomToDate(event.target.value)
                  }}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-100"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Category / product search</span>
                <input
                  value={tableSearch}
                  onChange={(event) => setTableSearch(event.target.value)}
                  placeholder="Search categories or products..."
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-100"
                />
              </label>

              <label className="space-y-2 text-sm">
                <span className="font-medium text-slate-700">Sort table</span>
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortKey)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-100"
                >
                  <option value="quantity_desc">Highest quantity first</option>
                  <option value="alphabetical">Alphabetical</option>
                  <option value="latest_purchase">Latest purchase</option>
                </select>
              </label>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Units</div>
                <div className="mt-1 text-lg font-semibold">{selectedReport?.summary.totalPurchasedQuantity?.toLocaleString('en-IN') ?? '0'} pieces</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Variants</div>
                <div className="mt-1 text-lg font-semibold">{selectedReport?.summary.totalVariants?.toLocaleString('en-IN') ?? '0'}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Sales Value</div>
                <div className="mt-1 text-lg font-semibold text-emerald-700">{formatRupee(selectedReport?.summary.totalSalesValue ?? 0)}</div>
              </div>
            </div>
          </div>
        </div>

        {reportQuery.isError && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {reportQuery.error instanceof Error ? reportQuery.error.message : 'Failed to load the dealer report.'}
          </div>
        )}

        {selectedReport?.warnings?.map((warning) => (
          <div key={warning.code} className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {warning.message}
          </div>
        ))}

        {!selectedDealer && (
          <div className="mt-4 rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <Search size={22} />
            </div>
            <div className="text-lg font-semibold text-slate-900">Select a dealer to view their purchase report</div>
            <div className="mt-2 text-sm text-slate-500">The report loads only after you pick a dealer.</div>
          </div>
        )}

        {selectedDealer && showReportLoading && (
          <div className="mt-4 rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
            <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-cyan-600" />
            <div className="text-lg font-semibold text-slate-900">Loading dealer report</div>
            <div className="mt-2 text-sm text-slate-500">Fetching complete order history and product lines...</div>
          </div>
        )}

        {selectedDealer && !showReportLoading && selectedReport && selectedReport.summary.totalOrders === 0 && (
          <div className="mt-4 rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
            <AlertCircle size={28} className="mx-auto text-slate-300" />
            <div className="mt-3 text-lg font-semibold text-slate-900">No eligible orders were found for this dealer</div>
            <div className="mt-2 text-sm text-slate-500">Try a wider date range or a different status filter.</div>
          </div>
        )}

        {selectedDealer && !showReportLoading && selectedReport && selectedReport.summary.totalOrders > 0 && visibleProducts.length === 0 && (
          <div className="mt-4 rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
            <AlertCircle size={28} className="mx-auto text-slate-300" />
            <div className="mt-3 text-lg font-semibold text-slate-900">No report rows matched the current filters</div>
            <div className="mt-2 text-sm text-slate-500">This dealer has matching orders, but no product rows matched your current search or item data.</div>
          </div>
        )}

        {selectedDealer && !showReportLoading && selectedReport && visibleProducts.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <div className="text-base font-semibold text-slate-900">Product purchase totals</div>
                <div className="mt-1 text-sm text-slate-500">
                  {selectedReport.summary.dateRange.from || 'All Time'} to {selectedReport.summary.dateRange.to || 'Today'} · {selectedReport.summary.totalOrders.toLocaleString('en-IN')} matching orders
                </div>
              </div>
              <button
                type="button"
                onClick={() => downloadReportCsv(selectedReport)}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                <Download size={16} /> Export CSV
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">Product</th>
                    <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">Catalogue</th>
                    <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">Category</th>
                    <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">Total Quantity</th>
                    <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">Orders</th>
                    <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">Latest Purchase</th>
                    <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">Sales Value</th>
                    <th className="px-5 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleProducts.map((product) => {
                    const isProductExpanded = !!expandedProducts[product.productKey]
                    return (
                      <Fragment key={product.productKey}>
                        <tr key={product.productKey} className="hover:bg-slate-50/60">
                          <td className="px-5 py-4">
                            <div className="font-medium text-slate-900">{product.productName}</div>
                            {product.specification && (
                              <div className="mt-1 max-w-md truncate text-xs text-slate-500">{product.specification}</div>
                            )}
                          </td>
                          <td className="px-5 py-4 font-mono text-slate-600">{product.catalogueNumber || 'Not available'}</td>
                          <td className="px-5 py-4 text-slate-600">{product.category || 'Uncategorized'}</td>
                          <td className="px-5 py-4 text-right font-mono text-slate-700">{product.purchasedQuantity.toLocaleString('en-IN')} pieces</td>
                          <td className="px-5 py-4 text-right font-mono text-slate-700">{product.orderCount.toLocaleString('en-IN')}</td>
                          <td className="px-5 py-4 text-right text-slate-700">{formatDate(product.latestPurchaseDate)}</td>
                          <td className="px-5 py-4 text-right font-mono text-emerald-700">{formatRupee(product.totalValue)}</td>
                          <td className="px-5 py-4 text-right">
                            <button
                              type="button"
                              onClick={() => toggleProduct(product.productKey)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              {isProductExpanded ? 'Hide' : 'View'}
                              <ChevronRight size={13} className={isProductExpanded ? 'rotate-90 transition-transform' : 'transition-transform'} />
                            </button>
                          </td>
                        </tr>

                        {isProductExpanded && (
                          <tr>
                            <td colSpan={8} className="bg-slate-50/70 px-5 py-5">
                              <div className="rounded-2xl border border-slate-200 bg-white">
                                <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">Contributing orders for {product.productName}</div>
                                <div className="overflow-x-auto">
                                  <table className="min-w-full text-sm">
                                    <thead className="bg-slate-50 text-slate-500">
                                      <tr>
                                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">Order</th>
                                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">Date</th>
                                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em]">Catalogue</th>
                                        <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">Quantity</th>
                                        <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">Value</th>
                                        <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">Status</th>
                                        <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em]">Action</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {product.orders.map((order) => (
                                        <tr key={`${product.productKey}-${order.orderId}`}>
                                          <td className="px-4 py-3 font-mono text-slate-700">{order.orderId}</td>
                                          <td className="px-4 py-3 text-slate-600">{formatDate(order.orderDate)}</td>
                                          <td className="px-4 py-3 font-mono text-slate-600">{order.catalogueNumber || product.catalogueNumber || 'Not available'}</td>
                                          <td className="px-4 py-3 text-right font-mono text-slate-700">{order.purchasedQuantity.toLocaleString('en-IN')} pieces</td>
                                          <td className="px-4 py-3 text-right font-mono text-emerald-700">{formatRupee(order.totalValue)}</td>
                                          <td className="px-4 py-3 text-right text-slate-600">{order.statusLabel}</td>
                                          <td className="px-4 py-3 text-right">
                                            <button
                                              type="button"
                                              onClick={() => router.push(`/orders/${order.orderId}`)}
                                              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                            >
                                              View Order
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
