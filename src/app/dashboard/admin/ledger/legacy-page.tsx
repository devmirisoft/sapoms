'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { Search, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react'

interface LedgerSummary {
  Dealer_Id: string
  Dealer_Name: string
  Dealer_Email: string
  Dealer_Number: string
  Dealer_City: string
  totalDebit: number
  totalCredit: number
  netBalance: number
  walletBalance: number
}

interface LedgerResponse {
  success: boolean
  data: LedgerSummary[]
  total: number
  isLive?: boolean
  updatedAt?: string
}

const ITEMS_PER_PAGE = 10

export default function CollectiveLedgerPage() {
  const router = useRouter()

  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1)
      setSearch(searchInput)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Fetch ledger data
  const { data, isLoading, error } = useQuery<LedgerResponse>({
    queryKey: ['collective-ledger', page, search],
    queryFn: async () => {
      const res = await axios.get('/api/ledger')
      // Filter by search locally since API doesn't support it yet
      let filtered = res.data.data || []
      if (search) {
        const searchLower = search.toLowerCase()
        filtered = filtered.filter(
          (item: LedgerSummary) =>
            item.Dealer_Name.toLowerCase().includes(searchLower) ||
            item.Dealer_Email.toLowerCase().includes(searchLower) ||
            item.Dealer_City.toLowerCase().includes(searchLower)
        )
      }
      // Paginate
      const start = (page - 1) * ITEMS_PER_PAGE
      const end = start + ITEMS_PER_PAGE
      return {
        success: res.data.success,
        data: filtered.slice(start, end),
        total: filtered.length,
        isLive: res.data.isLive,
        updatedAt: res.data.updatedAt,
      }
    },
    staleTime: 5 * 60 * 1000,
  })

  const dealers = data?.data || []
  const total = data?.total || 0
  const isLive = data?.isLive ?? true
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE) || 1

  const startIndex = (page - 1) * ITEMS_PER_PAGE + 1
  const endIndex = Math.min(page * ITEMS_PER_PAGE, total)

  function pageNumbers(): (number | '…')[] {
    const pages: (number | '…')[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (page > 3) pages.push('…')
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++)
        pages.push(i)
      if (page < totalPages - 2) pages.push('…')
      pages.push(totalPages)
    }
    return pages
  }

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return
    setPage(newPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function formatAmount(value: number): string {
    if (!value) return '₹0'
    return `₹${value.toLocaleString('en-IN')}`
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="p-6 admin-page-shell">
          <div className="flex items-center gap-3 p-4 bg-red-50 rounded-lg border border-red-200">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <p className="text-sm text-red-700">Failed to load ledger data</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="p-6 admin-page-shell">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Dealer Ledger</h1>
              <p className="text-sm text-gray-500 mt-1">View all dealers account summaries</p>
            </div>
          </div>

          {!isLive && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              Showing offline cached ledger data. Connection to main billing system is temporarily unavailable.
            </div>
          )}

          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search dealers…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition w-full"
            />
          </div>
        </div>

        {/* Table Card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    S.No.
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    Dealer Name
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    City
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    Total Debit
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    Total Credit
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    Net Balance
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    Wallet
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    Action
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {/* Loading */}
                {isLoading &&
                  Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-6 py-4">
                          <div className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))}

                {/* Empty */}
                {!isLoading && dealers.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-gray-400 text-sm">
                      {search ? 'No dealers found matching your search' : 'No dealers found'}
                    </td>
                  </tr>
                )}

                {/* Data rows */}
                {!isLoading &&
                  dealers.map((dealer, idx) => (
                    <tr
                      key={dealer.Dealer_Id}
                      onClick={() => router.push(`/dashboard/admin/dealer/${dealer.Dealer_Id}/ledger`)}
                      className="cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4 text-gray-400 text-xs">{startIndex + idx}</td>

                      <td className="px-6 py-4">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            router.push(`/dashboard/admin/dealer/${dealer.Dealer_Id}/ledger`)
                          }}
                          className="font-medium text-gray-900 hover:text-brand-500"
                        >
                          {dealer.Dealer_Name}
                        </button>
                        <p className="text-xs text-gray-500 mt-0.5">{dealer.Dealer_Email}</p>
                      </td>

                      <td className="px-6 py-4">
                        <span className="bg-blue-50 text-blue-600 text-xs font-medium px-2.5 py-1 rounded-full">
                          {dealer.Dealer_City || '—'}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <span className="font-semibold text-red-600">
                          {formatAmount(dealer.totalDebit)}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <span className="font-semibold text-green-600">
                          {formatAmount(dealer.totalCredit)}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <span className="font-semibold text-gray-900">
                          {formatAmount(dealer.netBalance)}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          {formatAmount(dealer.walletBalance)}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            router.push(`/dashboard/admin/dealer/${dealer.Dealer_Id}/ledger`)
                          }}
                          className="text-brand-600 hover:text-brand-500 font-medium text-sm transition-colors"
                        >
                          View Ledger →
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {!isLoading && total > 0 && (
            <div className="px-6 py-5 border-t border-gray-200 flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Showing {startIndex} to {endIndex} of {total} dealers
              </p>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page === 1}
                  className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                {pageNumbers().map((num, idx) =>
                  num === '…' ? (
                    <span key={`ellipsis-${idx}`} className="px-2 text-gray-400">
                      …
                    </span>
                  ) : (
                    <button
                      key={num}
                      onClick={() => handlePageChange(num)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                        page === num
                          ? 'bg-brand-600 text-white'
                          : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {num}
                    </button>
                  )
                )}

                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page === totalPages}
                  className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
