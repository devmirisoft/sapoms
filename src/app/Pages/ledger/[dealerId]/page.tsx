'use client'

import { formatDisplayOrderNumber } from '@/lib/orderDisplay';

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import moment from 'moment'
import {
  ChevronLeft, ChevronDown, ChevronRight,
  AlertCircle, ShieldAlert, Receipt,
} from 'lucide-react'
import DealerInfoCard from '@/components/ledger/DealerInfoCard'
import LedgerSummary from '@/components/ledger/LedgerSummary'
import AccountBookSummary, { AccountBookStats } from '@/components/ledger/AccountBookSummary'
import TransactionTable from '@/components/ledger/TransactionTable'
import PayMoneyModal, { PaymentData } from '@/components/ledger/PayMoneyModal'
import { InvoiceModal } from '@/components/InvoiceModel'
import { downloadOrderInvoice } from '@/lib/invoicegenerator'
import { resolveOrderAmounts } from '@/lib/orderAmounts'
import {
  calculateOutstandingAging,
  getPayStatus,
  type PayStatus,
} from '@/lib/outstandingBalance'
import { showToast } from "@/components/ui/toast";

// ─── Constants ────────────────────────────────────────────────────────────────
const YEAR = new Date().getFullYear()
const TODAY = moment().startOf('day')
const ORDERS_PAGE_SIZE = 20
const TRANSACTIONS_PAGE_SIZE = 10

// ─── Types ────────────────────────────────────────────────────────────────────
type Role = 'admin' | 'dealer' | 'staff' | 'accountant'

interface Dealer {
  Dealer_Id: string
  Dealer_Name: string
  Dealer_Email: string
  Dealer_Number: string
  Dealer_Address: string
  Dealer_City: string
  Dealer_Pincode: string
  walletBalance: number
}

interface WalletTransaction {
  id: string
  type: 'credit' | 'debit'
  amount: number
  balanceBefore: number
  balanceAfter: number
  reference?: string
  note?: string
  createdAt?: string | null
}

interface WalletResponse {
  success: boolean
  dealerId: string
  balance: number
  transactions: WalletTransaction[]
  updatedAt?: string | null
}

interface LedgerSummaryData {
  totalDebit: number
  totalCredit: number
  netBalance: number
}

interface Transaction {
  id: string
  debit: number
  credit: number
  narration: string
  date: string
  invoice: string
  mode: string
  type?: string
}

interface DealerLedgerResponse {
  success: boolean
  dealer: Dealer
  summary: LedgerSummaryData
  summaryStats: AccountBookStats
  orders: RawOrder[]
  transactionCount: number
  isLive: boolean
  updatedAt?: string
  message?: string
}

interface TransactionsResponse {
  success: boolean
  data: Transaction[]
  count: number
  page: number
  pageSize: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
  message?: string
}

type RawOrder = {
  order_id: string
  order_date: string
  order_amount: string | number
  order_discount: string | number
  order_dealer?: string
  accept_order?: string
  del_status?: string
  Dealer_Name: string
  orderdata_item_quantity: string
  mtstatus: string
  outstandingDate: string
  reason?: string
  product_name?: string
  order_discount_amount?: string | number
  order_net_amount?: string | number
  grossAmount?: string | number
  discountAmount?: string | number
  netPayableAmount?: string | number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function resolveRole(): { role: Role; dealerId?: string; staffId?: string } {
  if (typeof window === 'undefined') return { role: 'admin' }
  try {
    if (localStorage.getItem('accountant_token')) return { role: 'accountant' }
    const userData = localStorage.getItem('UserData')
    if (userData) {
      const p = JSON.parse(userData)
      if (p?.Dealer_Id) return { role: 'dealer', dealerId: p.Dealer_Id }
      if (p?.staff_id) return {
        role: p.staff_roletype === '0' ? 'admin' : 'staff',
        staffId: p.staff_id,
      }
      if (localStorage.getItem('roletype') === '3') return { role: 'admin' }
    }
    const staffRaw = localStorage.getItem('staffData')
    if (staffRaw) {
      const p = JSON.parse(staffRaw)
      if (p?.staff_id) return {
        role: p.staff_roletype === '0' ? 'admin' : 'staff',
        staffId: p.staff_id,
      }
    }
    const adminRaw = localStorage.getItem('AdminData') || localStorage.getItem('admin')
    if (adminRaw) return { role: 'admin' }
  } catch (_) {}
  return { role: 'admin' }
}

function fmt(n: number) {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: PayStatus }) {
  const cls: Record<PayStatus, string> = {
    Paid:    'bg-emerald-50 border-emerald-200 text-emerald-700',
    Partial: 'bg-blue-50 border-blue-200 text-blue-700',
    Unpaid:  'bg-amber-50 border-amber-200 text-amber-700',
    Overdue: 'bg-red-50 border-red-200 text-red-700',
  }
  const dot: Record<PayStatus, string> = {
    Paid: 'bg-emerald-400', Partial: 'bg-blue-400', Unpaid: 'bg-amber-400', Overdue: 'bg-red-500',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10.5px] font-bold border whitespace-nowrap ${cls[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot[status]}`} />
      {status}
    </span>
  )
}

// ─── Invoice download button ─────────────────────────────────────────────────
function InvoiceBtn({ order }: { order: RawOrder }) {
  const [loading, setLoading] = useState(false)
  const handle = async () => {
    setLoading(true)
    await downloadOrderInvoice(order as any)
    setLoading(false)
  }
  return (
    <button onClick={handle} disabled={loading}
      className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold bg-white border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-700 rounded-lg transition-all shadow-sm disabled:opacity-50 whitespace-nowrap">
      {loading
        ? <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
        : <Receipt size={10} />}
      PDF
    </button>
  )
}

// ─── Aging Panel (scoped to single dealer) ───────────────────────────────────
function DealerAgingPanel({ orders }: { orders: RawOrder[] }) {
  const [open, setOpen] = useState(true)

  const aging = useMemo(() => calculateOutstandingAging(orders, TODAY), [orders])

  if (aging.count === 0) return null

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm mb-6">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 border-b border-gray-100 hover:bg-gray-50/60 transition-colors"
      >
        <div className="flex items-center gap-2 text-[13.5px] font-semibold text-gray-900">
          {open ? <ChevronDown size={15} className="text-indigo-500" /> : <ChevronRight size={15} className="text-indigo-500" />}
          Outstanding Balance
          <span className="px-2 py-0.5 bg-red-50 text-red-600 rounded-full text-[10px] font-bold">
            {fmt(aging.total)}
          </span>
        </div>
        <span className="text-[11.5px] text-gray-400">{aging.count} outstanding order{aging.count !== 1 ? 's' : ''}</span>
      </button>

      {open && (
        <div className="p-5">
          {/* Outstanding total card */}
          <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-xl p-4 mb-4">
            <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-1">Total Outstanding</p>
            <p className="text-2xl font-bold text-red-700">{fmt(aging.total)}</p>
          </div>

          {/* Aging buckets */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: '0–30 Days', value: aging.current, color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
              { label: '31–60 Days', value: aging.d31, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
              { label: '61–90 Days', value: aging.d61, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
              { label: '90+ Days', value: aging.d90, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
            ].map(bucket => (
              <div key={bucket.label} className={`${bucket.bg} border ${bucket.border} rounded-xl p-3`}>
                <p className="text-[10.5px] font-bold text-gray-500 uppercase tracking-wider mb-1">{bucket.label}</p>
                <p className={`text-lg font-bold font-mono ${bucket.color}`}>
                  {bucket.value > 0 ? fmt(bucket.value) : '—'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Orders skeleton ─────────────────────────────────────────────────────────
function OrdersSkeleton() {
  return (
    <>{Array.from({ length: 5 }).map((_, i) => (
      <tr key={i} className="border-b border-gray-50">
        {Array.from({ length: 8 }).map((_, j) => (
          <td key={j} className="px-3 py-3">
            <div className="h-3 bg-gray-100 rounded animate-pulse" style={{ width: j === 1 ? 100 : j === 0 ? 24 : 60 }} />
          </td>
        ))}
      </tr>
    ))}</>
  )
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
/**
 * Standalone wallet top-up request, raised by the dealer from their ledger.
 *
 * Posts to the same endpoint the advance-order flow uses, with no order
 * attached, so both request types share one approval chain and one funding
 * path rather than duplicating either.
 */
function RequestFundsPanel({
  onDone,
  onRefresh,
}: {
  onDone: (text: string, type: 'success' | 'error') => void
  onRefresh: () => void
}) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      onDone('Enter a valid amount to request.', 'error')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/dealer-fund-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type: 'ADDITIONAL_FUNDS', amount: value, note: note.trim() || undefined }),
      })
      const json = await res.json()
      if (!res.ok || !json?.success) throw new Error(json?.message || 'Unable to raise the fund request.')
      onDone('Fund request raised. You can track it under My Fund Requests.', 'success')
      setOpen(false)
      setAmount('')
      setNote('')
      onRefresh()
    } catch (err: any) {
      onDone(err?.message || 'Unable to raise the fund request.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold text-gray-900">Request Additional Funds</h3>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Ask for funds to be added to your wallet. Goes to your RSM, then Staff, then the Accountant.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/dealer/fund-requests"
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-100"
          >
            My Fund Requests
          </Link>
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700"
          >
            {open ? 'Cancel' : 'Request Funds'}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 flex flex-col gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:items-center">
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="Amount"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-emerald-300 sm:w-48"
          />
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Reason (optional)"
            className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-emerald-300"
          />
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit request'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function DealerLedgerPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  // params values are string | string[] | undefined and are absent on the
  // first render, so normalise instead of casting the possibility away.
  const rawDealerId = params.dealerId
  const dealerId = Array.isArray(rawDealerId) ? (rawDealerId[0] ?? '') : (rawDealerId ?? '')

  const [payModalOpen, setPayModalOpen] = useState(false)
  const [payLoading, setPayLoading] = useState(false)
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [userRole, setUserRole] = useState<Role>('admin')
  const [staffId, setStaffId] = useState<string | undefined>()
  const [ordersPage, setOrdersPage] = useState(1)
  const [transactionsPage, setTransactionsPage] = useState(1)

  // ── Access control: dealers can only see their own ledger ──
  useEffect(() => {
    const { role, dealerId: ownDealerId, staffId: sid } = resolveRole()
    setUserRole(role)
    setStaffId(sid)
    if (role === 'dealer' && ownDealerId && ownDealerId !== dealerId) {
      setAccessDenied(true)
    }
  }, [dealerId])

  // ── Staff access check: verify dealer is assigned to this staff ──
  const { data: staffAssignedDealers } = useQuery<{ data: { Dealer_Id: string }[] }>({
    queryKey: ['staff-assigned-dealers-check', staffId],
    queryFn: async () => {
      const res = await fetch('/api/staff/dealers')
      if (!res.ok) throw new Error('Failed to load assigned dealers')
      return res.json()
    },
    enabled: userRole === 'staff' && !!staffId && !!dealerId,
    staleTime: 5 * 60 * 1000,
  })

  // Deny access if staff and dealer not in assigned list
  useEffect(() => {
    if (userRole !== 'staff' || !staffAssignedDealers?.data) return
    const isAssigned = staffAssignedDealers.data.some(d => d.Dealer_Id === dealerId)
    if (!isAssigned) setAccessDenied(true)
  }, [userRole, staffAssignedDealers, dealerId])

  // ── Fetch dealer info and summary ──
  const {
    data: ledgerData,
    isLoading: isLedgerLoading,
    error: ledgerError,
    refetch: refetchLedger,
  } = useQuery<DealerLedgerResponse>({
    queryKey: ['dealer-ledger', dealerId],
    queryFn: async () => {
      const res = await axios.get(`/api/ledger/${dealerId}`)
      return res.data
    },
    enabled: !!dealerId && !accessDenied,
    staleTime: 5 * 60 * 1000,
  })

  // ── Fetch transactions ──
  const {
    data: transactionsData,
    isLoading: isTransactionsLoading,
    isFetching: isTransactionsFetching,
  } = useQuery<TransactionsResponse>({
    queryKey: ['dealer-transactions', dealerId, transactionsPage],
    queryFn: async () => {
      const res = await axios.get(`/api/ledger/${dealerId}/transactions`, {
        params: { page: transactionsPage, limit: TRANSACTIONS_PAGE_SIZE },
      })
      return res.data
    },
    enabled: !!dealerId && !accessDenied,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })

  const {
    data: walletData,
    isLoading: isWalletLoading,
    refetch: refetchWallet,
  } = useQuery<WalletResponse>({
    queryKey: ['dealer-wallet', dealerId],
    queryFn: async () => {
      const res = await axios.get(`/api/wallet/${dealerId}`)
      return res.data
    },
    enabled: !!dealerId,
    staleTime: 60 * 1000,
  })

  useEffect(() => {
    setTransactionsPage(1)
  }, [dealerId])

  useEffect(() => {
    if (!dealerId || accessDenied || !transactionsData?.hasNextPage) return

    queryClient.prefetchQuery({
      queryKey: ['dealer-transactions', dealerId, transactionsPage + 1],
      queryFn: async () => {
        const res = await axios.get(`/api/ledger/${dealerId}/transactions`, {
          params: { page: transactionsPage + 1, limit: TRANSACTIONS_PAGE_SIZE },
        })
        return res.data
      },
      staleTime: 5 * 60 * 1000,
    })
  }, [accessDenied, dealerId, queryClient, transactionsData?.hasNextPage, transactionsPage])

  // ── Fetch all orders (for orders list + aging) ──
  const isOrdersLoading = isLedgerLoading

  const dealerOrders = useMemo(() => {
    return [...(ledgerData?.orders || [])]
      .sort((a, b) => moment(b.order_date).valueOf() - moment(a.order_date).valueOf())
  }, [ledgerData?.orders])

  // Paginate orders
  const ordersTotalPages = Math.max(1, Math.ceil(dealerOrders.length / ORDERS_PAGE_SIZE))
  const ordersSlice = dealerOrders.slice((ordersPage - 1) * ORDERS_PAGE_SIZE, ordersPage * ORDERS_PAGE_SIZE)

  // ── Toast auto-dismiss ──

  // ── Pay money handler ──
  const handlePayMoney = async (data: PaymentData) => {
    setPayLoading(true)
    try {
      const response = await axios.post(`/api/ledger/${dealerId}/pay`, data)
      if (response.data.success) {
        showToast('success', 'Payment recorded successfully')
        await Promise.all([
          refetchLedger(),
          refetchWallet(),
          queryClient.invalidateQueries({ queryKey: ['dealer-transactions', dealerId] }),
        ])
      }
    } catch (error: any) {
      showToast('error', error.response?.data?.message || 'Failed to record payment')
    } finally {
      setPayLoading(false)
    }
  }

  // ── Access denied view ──
  if (accessDenied) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="p-6 max-w-7xl mx-auto">
          <div className="flex items-center gap-3 p-6 bg-amber-50 rounded-xl border border-amber-200">
            <ShieldAlert className="w-6 h-6 text-amber-600 shrink-0" />
            <div>
              <p className="font-semibold text-amber-900">Access Denied</p>
              <p className="text-sm text-amber-700 mt-1">
                You can only view your own ledger account.
              </p>
              <button
                onClick={() => router.replace('/Pages/ledger')}
                className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors"
              >
                ← Go to My Ledger
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Error state ──
  if (ledgerError) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="p-6 max-w-7xl mx-auto">
          <div className="flex items-center gap-3 p-4 bg-red-50 rounded-lg border border-red-200">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <div>
              <p className="font-semibold text-red-900">Error Loading Ledger</p>
              <p className="text-sm text-red-700 mt-1">
                {(ledgerError as any)?.message || 'Dealer not found'}
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const dealer = ledgerData?.dealer
  const summary = ledgerData?.summary || { totalDebit: 0, totalCredit: 0, netBalance: 0 }
  const summaryStats = ledgerData?.summaryStats
  const isLive = ledgerData?.isLive ?? true
  const canManageLedgerEntries = userRole === 'accountant'
  const transactions = transactionsData?.data || []
  const transactionCount = transactionsData?.count || 0
  const transactionPage = transactionsData?.page || transactionsPage
  const transactionPageSize = transactionsData?.pageSize || TRANSACTIONS_PAGE_SIZE
  const transactionTotalPages = transactionsData?.totalPages || 1

  // Hide pay button for dealers
  const showPayButton = userRole !== 'dealer'

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Toast */}

      {/* Pay Money Modal */}
      <PayMoneyModal
        isOpen={payModalOpen}
        onClose={() => setPayModalOpen(false)}
        onSubmit={handlePayMoney}
        dealerName={dealer?.Dealer_Name || 'Dealer'}
        isLoading={payLoading}
      />

      {/* Invoice Modal */}
      <InvoiceModal
        isOpen={invoiceModalOpen}
        onClose={() => setInvoiceModalOpen(false)}
        dealerId={dealerId}
      />

      <div className="p-6 max-w-7xl mx-auto">
        {!isLive && (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            Showing offline cached ledger data. Connection to main billing system is temporarily unavailable.
          </div>
        )}

        {/* Back button */}
        <button
          onClick={() => router.push('/Pages/ledger')}
          className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors mb-6"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Dealer Ledger
        </button>

        {/* Dealer Info Card */}
        <DealerInfoCard
          dealer={dealer || null}
          isLoading={isLedgerLoading}
          walletBalance={walletData?.balance}
          walletTransactions={walletData?.transactions}
          walletLoading={isWalletLoading}
          onPayMoneyClick={() => setPayModalOpen(true)}
          canRecordPayment={canManageLedgerEntries}
        />

        {/* A dealer can ask for a wallet top-up from their own ledger. The
            request runs the same RSM -> Staff -> Accountant chain as an
            advance order; there is simply no order to place at the end. */}
        {userRole === 'dealer' && (
          <RequestFundsPanel
            onDone={(text, type) => showToast(type, text)}
            onRefresh={() => void refetchWallet()}
          />
        )}

        {/* Summary Cards */}
        <LedgerSummary
          totalDebit={summary.totalDebit}
          totalCredit={summary.totalCredit}
          netBalance={summary.netBalance}
          isLoading={isLedgerLoading}
        />

        <AccountBookSummary
          stats={summaryStats}
          isLoading={isLedgerLoading}
        />

        {/* ── Outstanding / Aging Panel ── */}
        {!isOrdersLoading && dealerOrders.length > 0 && (
          <DealerAgingPanel orders={dealerOrders} />
        )}

        {/* ── Orders List ── */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm mb-6">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2 text-[13.5px] font-semibold text-gray-900">
              <Receipt size={14} className="text-indigo-500" />
              Orders
              <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-bold">
                {dealerOrders.length} order{dealerOrders.length !== 1 ? 's' : ''}
              </span>
            </div>

            {dealerOrders.length > ORDERS_PAGE_SIZE && (
              <div className="flex items-center gap-2 text-[11.5px] text-gray-400">
                Page {ordersPage} of {ordersTotalPages}
                <button
                  disabled={ordersPage <= 1}
                  onClick={() => setOrdersPage(p => p - 1)}
                  className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30 text-gray-600 text-[12px]"
                >
                  ‹
                </button>
                <button
                  disabled={ordersPage >= ordersTotalPages}
                  onClick={() => setOrdersPage(p => p + 1)}
                  className="px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30 text-gray-600 text-[12px]"
                >
                  ›
                </button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {['#', 'Order No.', 'Date', 'Gross', 'Discount', 'Net', 'Units', 'Payment Status', 'Action'].map(h => (
                    <th key={h} className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-50">
                {isOrdersLoading ? (
                  <OrdersSkeleton />
                ) : ordersSlice.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-14 text-center text-[13px] text-gray-400">
                      No orders found for this dealer
                    </td>
                  </tr>
                ) : ordersSlice.map((order, i) => {
                  const amounts  = resolveOrderAmounts(order)
                  const gross    = amounts.gross
                  const discount = amounts.discountAmount
                  const net      = amounts.netPayable
                  const ps       = getPayStatus(order)
                  const rowN     = (ordersPage - 1) * ORDERS_PAGE_SIZE + i + 1

                  return (
                    <tr key={order.order_id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-3 text-[11px] text-gray-400 font-mono">
                        {String(rowN).padStart(2, '0')}
                      </td>
                      <td className="px-3 py-3">
                        <span className="font-mono text-[11.5px] font-bold text-indigo-700">
                          {formatDisplayOrderNumber(order.order_id)}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="text-[12px] text-gray-800">{moment(order.order_date).format('DD MMM YYYY')}</div>
                        <div className="text-[10px] text-gray-400 font-mono">{moment(order.order_date).format('hh:mm A')}</div>
                      </td>
                      <td className="px-3 py-3 font-mono text-[12px] text-gray-700">{fmt(gross)}</td>
                      <td className="px-3 py-3 font-mono text-[12px] text-gray-500">
                        {discount > 0 ? <span className="text-orange-600">−{fmt(discount)}</span> : '—'}
                      </td>
                      <td className="px-3 py-3 font-mono text-[13px] font-bold text-gray-900">{fmt(net)}</td>
                      <td className="px-3 py-3 text-[12px] text-gray-600 text-center">{order.orderdata_item_quantity || '—'}</td>
                      <td className="px-3 py-3">
                        <StatusBadge status={ps} />
                      </td>
                      <td className="px-3 py-3">
                        <InvoiceBtn order={order} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Orders pagination footer */}
          {!isOrdersLoading && dealerOrders.length > ORDERS_PAGE_SIZE && (
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/60 flex items-center justify-between">
              <span className="text-[11.5px] text-gray-400">
                Showing {(ordersPage - 1) * ORDERS_PAGE_SIZE + 1}–{Math.min(ordersPage * ORDERS_PAGE_SIZE, dealerOrders.length)} of {dealerOrders.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  disabled={ordersPage <= 1}
                  onClick={() => setOrdersPage(p => p - 1)}
                  className="px-3 py-1 rounded-lg border border-gray-200 hover:bg-white disabled:opacity-30 text-gray-600 text-[12px] font-medium transition-colors"
                >
                  Previous
                </button>
                <button
                  disabled={ordersPage >= ordersTotalPages}
                  onClick={() => setOrdersPage(p => p + 1)}
                  className="px-3 py-1 rounded-lg border border-gray-200 hover:bg-white disabled:opacity-30 text-gray-600 text-[12px] font-medium transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Transaction Table */}
        <TransactionTable
          transactions={transactions}
          isLoading={isTransactionsLoading}
          isFetching={isTransactionsFetching}
          count={transactionCount}
          page={transactionPage}
          pageSize={transactionPageSize}
          totalPages={transactionTotalPages}
          hasNextPage={transactionsData?.hasNextPage}
          hasPreviousPage={transactionsData?.hasPreviousPage}
          onPageChange={setTransactionsPage}
          onInvoiceClick={() => setInvoiceModalOpen(true)}
        />
      </div>
    </div>
  )
}

