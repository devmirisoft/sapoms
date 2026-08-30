'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { ChevronLeft, AlertCircle } from 'lucide-react'
import DealerInfoCard from '@/components/ledger/DealerInfoCard'
import LedgerSummary from '@/components/ledger/LedgerSummary'
import AccountBookSummary, { AccountBookStats } from '@/components/ledger/AccountBookSummary'
import TransactionTable from '@/components/ledger/TransactionTable'
import PayMoneyModal, { PaymentData } from '@/components/ledger/PayMoneyModal'
import { InvoiceModal } from '@/components/InvoiceModel'
import { createIdempotencyKey } from '@/lib/idempotency'
import { resolveStoredAuth } from '@/lib/roleAccess'

const TRANSACTIONS_PAGE_SIZE = 10

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
  availableBalance: number
  status: 'active' | 'inactive'
  totalCredited: number
  totalConsumed: number
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

function getLedgerViewerRole() {
  if (typeof window === 'undefined') return null
  const session = resolveStoredAuth(window.localStorage)
  return session.status === 'authenticated' ? session.role : null
}

function isStaffLedgerSession() {
  return getLedgerViewerRole() === 'staff'
}

export default function DealerLedgerPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  // params values are string | string[] | undefined and are absent on the
  // first render, so normalise instead of casting the possibility away.
  const rawDealerId = params.dealerId
  const dealerId = Array.isArray(rawDealerId) ? (rawDealerId[0] ?? '') : (rawDealerId ?? '')

  const [redirectingStaff, setRedirectingStaff] = useState(() => isStaffLedgerSession())
  const [viewerRole, setViewerRole] = useState<string | null>(null)
  const [payModalOpen, setPayModalOpen] = useState(false)
  const [payLoading, setPayLoading] = useState(false)
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false)
  const [walletAdjustOpen, setWalletAdjustOpen] = useState(false)
  const [walletAdjustType, setWalletAdjustType] = useState<'activate' | 'topup' | 'disable'>('topup')
  const [walletAdjustAmount, setWalletAdjustAmount] = useState('')
  const [walletAdjustReference, setWalletAdjustReference] = useState('')
  const [walletAdjustNote, setWalletAdjustNote] = useState('')
  const [walletTransactionDate, setWalletTransactionDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [walletAdjustLoading, setWalletAdjustLoading] = useState(false)
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [transactionsPage, setTransactionsPage] = useState(1)

  useEffect(() => {
    const role = getLedgerViewerRole()
    setViewerRole(role)
    if (!dealerId || role !== 'staff') return
    setRedirectingStaff(true)
    router.replace(`/Pages/ledger/${encodeURIComponent(dealerId)}`)
  }, [dealerId, router])

  // Fetch dealer info and summary
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
    enabled: !!dealerId && !redirectingStaff,
    staleTime: 5 * 60 * 1000,
  })

  // Fetch transactions
  const {
    data: transactionsData,
    isLoading: isTransactionsLoading,
    isFetching: isTransactionsFetching,
    error: transactionsError,
  } = useQuery<TransactionsResponse>({
    queryKey: ['dealer-transactions', dealerId, transactionsPage],
    queryFn: async () => {
      const res = await axios.get(`/api/ledger/${dealerId}/transactions`, {
        params: { page: transactionsPage, limit: TRANSACTIONS_PAGE_SIZE },
      })
      return res.data
    },
    enabled: !!dealerId && !redirectingStaff,
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
      const session = resolveStoredAuth(window.localStorage)
      if (session.status !== 'authenticated') throw new Error('Missing wallet identity')
      const res = await axios.get(`/api/wallet/${dealerId}`)
      return res.data
    },
    enabled: !!dealerId && !redirectingStaff,
    staleTime: 60 * 1000,
  })

  useEffect(() => {
    setTransactionsPage(1)
  }, [dealerId])

  useEffect(() => {
    if (!dealerId || redirectingStaff || !transactionsData?.hasNextPage) return

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
  }, [dealerId, queryClient, redirectingStaff, transactionsData?.hasNextPage, transactionsPage])

  // Auto-open the Add Funds modal when arriving from the Dealer List "Payment" action
  useEffect(() => {
    if (searchParams.get('wallet') === 'addfund') {
      setWalletAdjustType('topup')
      setWalletAdjustOpen(true)
    }
  }, [searchParams])

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  const handlePayMoney = async (data: PaymentData) => {
    setPayLoading(true)
    try {
      const response = await axios.post(`/api/ledger/${dealerId}/pay`, data)
      if (response.data.success) {
        setToast({ text: 'Payment recorded successfully', type: 'success' })
        // Refetch data
        await Promise.all([
          refetchLedger(),
          refetchWallet(),
          queryClient.invalidateQueries({ queryKey: ['dealer-transactions', dealerId] }),
        ])
      }
    } catch (error: any) {
      setToast({
        text: error.response?.data?.message || 'Failed to record payment',
        type: 'error',
      })
    } finally {
      setPayLoading(false)
    }
  }

  const handleWalletAdjust = async () => {
    const amount = Number(walletAdjustAmount)
    if (walletAdjustType !== 'disable' && walletAdjustType !== 'activate' && (!Number.isFinite(amount) || amount <= 0)) {
      setToast({ text: 'Enter a valid wallet amount', type: 'error' })
      return
    }
    if (walletAdjustType === 'activate' && walletData?.balance === 0 && (!Number.isFinite(amount) || amount <= 0)) {
      setToast({ text: 'Enter an opening wallet amount', type: 'error' })
      return
    }
    if (!walletAdjustNote.trim() || !walletTransactionDate) {
      setToast({ text: 'Transaction date and note are required', type: 'error' })
      return
    }
    if (walletAdjustType !== 'disable' && !walletAdjustReference.trim()) {
      setToast({ text: 'Reference is required', type: 'error' })
      return
    }

    setWalletAdjustLoading(true)
    try {
      const session = resolveStoredAuth(window.localStorage)
      if (session.status !== 'authenticated') throw new Error('Missing wallet identity')
      const idempotencyKey = createIdempotencyKey('wallet-adjust')
      const response = await axios.post(`/api/wallet/${dealerId}/adjust`, {
        action: walletAdjustType,
        ...(walletAdjustType !== 'disable' && Number.isFinite(amount) && amount > 0 ? { amount } : {}),
        reference: walletAdjustReference.trim(),
        note: walletAdjustNote,
        transactionDate: walletTransactionDate,
        idempotencyKey,
      }, { headers: {
        'idempotency-key': idempotencyKey,
      } })
      if (response.data.success) {
        setToast({ text: walletAdjustType === 'disable' ? 'Wallet disabled' : walletAdjustType === 'activate' ? 'Wallet activated' : 'Funds added successfully', type: 'success' })
        setWalletAdjustOpen(false)
        setWalletAdjustAmount('')
        setWalletAdjustReference('')
        setWalletAdjustNote('')
        await Promise.all([refetchWallet(), refetchLedger()])
      }
    } catch (error: any) {
      setToast({
        text: error.response?.data?.message || 'Failed to update wallet',
        type: 'error',
      })
    } finally {
      setWalletAdjustLoading(false)
    }
  }

  if (redirectingStaff) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="p-6 admin-page-shell">
          <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
            Opening assigned dealer ledger...
          </div>
        </div>
      </div>
    )
  }

  if (ledgerError) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="p-6 admin-page-shell">
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
  const canManageLedgerEntries = viewerRole === 'accountant'
  const transactions = transactionsData?.data || []
  const transactionCount = transactionsData?.count || 0
  const transactionPage = transactionsData?.page || transactionsPage
  const transactionPageSize = transactionsData?.pageSize || TRANSACTIONS_PAGE_SIZE
  const transactionTotalPages = transactionsData?.totalPages || 1

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 text-sm px-4 py-3 rounded-lg shadow-lg transition-all flex items-center gap-2 ${
            toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white'
          }`}
        >
          {toast.type === 'success' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4m0 4h.01" />
            </svg>
          )}
          {toast.text}
        </div>
      )}

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

      {walletAdjustOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h3 className="text-base font-semibold text-gray-900">Manage Dealer Wallet</h3>
              <button
                type="button"
                onClick={() => setWalletAdjustOpen(false)}
                className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              >
                X
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                Status: <strong className={walletData?.status === 'active' ? 'text-emerald-700' : 'text-gray-600'}>{walletData?.status === 'active' ? 'Active' : 'Inactive'}</strong> · Available: ₹{Number(walletData?.availableBalance ?? walletData?.balance ?? 0).toLocaleString('en-IN')}
                <p className="mt-1 text-xs text-gray-500">This is a running balance. Every successful order deducts its Net Payable until the balance is exhausted.</p>
              </div>
              {walletAdjustType !== 'disable' && <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Amount</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={walletAdjustAmount}
                  onChange={(e) => setWalletAdjustAmount(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <span className="mt-1 block text-xs text-gray-500">Funds are added to the current balance; they do not set a per-order limit.</span>
              </label>}

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Transaction date</span>
                <input type="date" min={new Date().toISOString().slice(0, 10)} value={walletTransactionDate} onChange={(e) => setWalletTransactionDate(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Reference <span className="text-red-500">*</span></span>
                <input
                  type="text"
                  value={walletAdjustReference}
                  onChange={(e) => setWalletAdjustReference(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Note</span>
                <textarea
                  value={walletAdjustNote}
                  onChange={(e) => setWalletAdjustNote(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWalletAdjustOpen(false)}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleWalletAdjust}
                  disabled={walletAdjustLoading}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
                >
                  {walletAdjustLoading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                  {walletAdjustType === 'disable' ? 'Disable Wallet' : walletAdjustType === 'activate' ? 'Activate Wallet' : 'Add Funds'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 admin-page-shell">
        {!isLive && (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            Showing offline cached ledger data. Connection to main billing system is temporarily unavailable.
          </div>
        )}

        {/* Back button */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors mb-6"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Dealers
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
          canAdjustWallet
          onAdjustWalletClick={() => setWalletAdjustOpen(true)}
        />

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
