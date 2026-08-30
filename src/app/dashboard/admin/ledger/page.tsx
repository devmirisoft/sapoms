'use client'

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Download,
  FileText,
  Loader2,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { formatDisplayOrderNumber } from '@/lib/orderDisplay'
import { resolveOrderAmounts } from '@/lib/orderAmounts'
import { resolveStoredAuth } from '@/lib/roleAccess'

type AccountBook = {
  bookedCount?: number
}

type Dealer = {
  Dealer_Id: string
  Dealer_Name: string
  Dealer_Email?: string
  Dealer_Number?: string
  Dealer_City?: string
  creditdays?: string | number
  creditDays?: string | number
  credit_period?: string | number
  Credit_Period?: string | number
  walletBalance?: string | number
  accountBook?: AccountBook
}

type RawOrder = {
  order_id?: string
  order_date?: string
  order_amount?: string | number
  order_discount?: string | number
  total?: string | number
}

type LedgerResponse = {
  success: boolean
  data: Dealer[]
  total: number
  isLive?: boolean
  updatedAt?: string
}

type DealerDetail = {
  dealer: Dealer
  orders: RawOrder[]
  bills: Bill[]
}

type BillPdf = {
  name: string
  url: string
  downloadUrl?: string
  bytes?: number
}

type Bill = {
  id: string
  dealerId: string
  orderNumber: string
  billAmount: number
  gstPercent: number
  billDate: string
  pdfName: string
  pdfUrl?: string
  pdfFiles?: BillPdf[]
  paidAmount: number
  lastPaymentDate?: string
}

type Toast = {
  type: 'success' | 'error'
  text: string
}

type DealerTerms = 'credit' | 'advance'
type TermsFilter = 'all' | DealerTerms

const TERMS_FILTERS: { value: TermsFilter; label: string }[] = [
  { value: 'all', label: 'All dealers' },
  { value: 'credit', label: 'Credit' },
  { value: 'advance', label: 'Advance' },
]

const ITEMS_PER_PAGE = 10
const DEFAULT_CREDIT_DAYS = 60
const PAYMENT_MODES = ['Cash', 'Cheque', 'NEFT', 'UPI', 'IMPF']
const EMPTY_BILL_FORM = {
  orderNumbers: [] as string[],
  billAmount: '',
  gstPercent: '18',
  billDate: new Date().toISOString().slice(0, 10),
}
const EMPTY_PAYMENT_FORM = {
  amount: '',
  paymentMode: 'NEFT',
  paymentDate: new Date().toISOString().slice(0, 10),
  reference: '',
  notes: '',
}

function formatFileSize(bytes?: number) {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Cloudinary stores the bill as an extension-less raw blob (PDF-format delivery
// is blocked on the account), so downloads go through our own streaming route,
// which sets the PDF content type and the original file name.
function billPdfHref(bill: Bill, index: number, mode: 'attachment' | 'inline') {
  const dealerId = encodeURIComponent(bill.dealerId)
  const params = new URLSearchParams({ billId: bill.id, index: String(index), mode })
  return `/api/ledger/${dealerId}/bill-pdf/download?${params.toString()}`
}

// Bills saved before multi-file uploads only carry pdfName / pdfUrl.
function billPdfs(bill: Bill): BillPdf[] {
  if (bill.pdfFiles && bill.pdfFiles.length > 0) return bill.pdfFiles
  if (bill.pdfUrl) return [{ name: bill.pdfName || 'Bill PDF', url: bill.pdfUrl }]
  return []
}

function formatAmount(value: number | string | undefined) {
  const amount = Number(value || 0)
  return `Rs. ${amount.toLocaleString('en-IN', {
    minimumFractionDigits: amount % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

function parseDisplayDate(value: string | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  const displayMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed)
  if (displayMatch) {
    const [, day, month, year] = displayMatch
    const date = new Date(`${year}-${month}-${day}T00:00:00`)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed)
  if (isoMatch) {
    const [, year, month, day] = isoMatch
    const date = new Date(`${year}-${month}-${day}T00:00:00`)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

function formatDateObject(date: Date) {
  if (Number.isNaN(date.getTime())) return '-'
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${day}/${month}/${date.getFullYear()}`
}

function formatDate(value: string | undefined) {
  const date = parseDisplayDate(value)
  if (!date) return value || '-'
  return formatDateObject(date)
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date
}

function getDaysRemaining(dateValue: string, creditDays: number) {
  const dueDate = addDays(dateValue, creditDays)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((dueDate.getTime() - today.getTime()) / 86_400_000)
}

function creditDaysForDealer(dealer?: Dealer) {
  const raw =
    dealer?.creditdays ??
    dealer?.creditDays ??
    dealer?.credit_period ??
    dealer?.Credit_Period
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_CREDIT_DAYS
}

// Dealers with configured credit days buy on credit; everyone else pays up front.
// Unlike creditDaysForDealer, this reads the raw value so the 60-day display
// default doesn't misclassify an advance dealer as a credit dealer.
function dealerTerms(dealer: Dealer): DealerTerms {
  const raw =
    dealer.creditdays ??
    dealer.creditDays ??
    dealer.credit_period ??
    dealer.Credit_Period
  if (raw === null || raw === undefined || String(raw).trim() === '') return 'advance'
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? 'credit' : 'advance'
}

function orderNumber(order: RawOrder) {
  return String(order.order_id || '').trim()
}

function formatLedgerOrderId(value: string) {
  return formatDisplayOrderNumber(value)
}

function orderLabel(order: RawOrder) {
  return formatLedgerOrderId(orderNumber(order))
}

function orderAmount(order: RawOrder) {
  return resolveOrderAmounts(order).netPayable
}

function roundForInput(value: number) {
  return Math.round(value * 100) / 100
}

function getLedgerViewerRole() {
  if (typeof window === 'undefined') return null
  const session = resolveStoredAuth(window.localStorage)
  return session.status === 'authenticated' ? session.role : null
}

function isStaffLedgerSession() {
  return getLedgerViewerRole() === 'staff'
}

export default function DealerLedgerShellPage() {
  const router = useRouter()
  const [redirectingStaff, setRedirectingStaff] = useState(() => isStaffLedgerSession())
  const [viewerRole, setViewerRole] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [termsFilter, setTermsFilter] = useState<TermsFilter>('all')
  const [expandedDealerId, setExpandedDealerId] = useState<string | null>(null)
  const [dealerDetails, setDealerDetails] = useState<Record<string, DealerDetail>>({})
  const [loadingDealerId, setLoadingDealerId] = useState<string | null>(null)
  const [billsByDealer, setBillsByDealer] = useState<Record<string, Bill[]>>({})
  const [billDealer, setBillDealer] = useState<Dealer | null>(null)
  const [billForm, setBillForm] = useState(EMPTY_BILL_FORM)
  const [billFiles, setBillFiles] = useState<File[]>([])
  const [orderDropdownOpen, setOrderDropdownOpen] = useState(false)
  const [paymentTarget, setPaymentTarget] = useState<{ dealer: Dealer; bill: Bill } | null>(null)
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT_FORM)
  const [pdfTarget, setPdfTarget] = useState<{ dealer: Dealer; bill: Bill } | null>(null)
  const [isSavingBill, setIsSavingBill] = useState(false)
  const [isUploadingPdfs, setIsUploadingPdfs] = useState(false)
  const [isSavingPayment, setIsSavingPayment] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const objectUrls = useRef<string[]>([])

  useEffect(() => {
    const role = getLedgerViewerRole()
    setViewerRole(role)
    if (role !== 'staff') return
    setRedirectingStaff(true)
    router.replace('/Pages/ledger')
  }, [router])

  const { data, isLoading, error } = useQuery<LedgerResponse>({
    queryKey: ['dealer-ledger-shell'],
    queryFn: async () => {
      const res = await axios.get('/api/ledger')
      return res.data
    },
    staleTime: 5 * 60 * 1000,
    enabled: !redirectingStaff,
  })

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1)
      setSearch(searchInput.trim())
    }, 350)

    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2800)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    return () => {
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  const canManageLedgerEntries = viewerRole === 'accountant'

  const dealers = useMemo(() => {
    const rows = data?.data || []
    const key = search.toLowerCase()

    return rows.filter((dealer) => {
      if (termsFilter !== 'all' && dealerTerms(dealer) !== termsFilter) return false
      if (!key) return true
      return [
        dealer.Dealer_Name,
        dealer.Dealer_Email,
        dealer.Dealer_Number,
        dealer.Dealer_City,
        dealer.Dealer_Id,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(key))
    })
  }, [data?.data, search, termsFilter])

  const totalPages = Math.max(1, Math.ceil(dealers.length / ITEMS_PER_PAGE))
  const pageRows = dealers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
  const startIndex = dealers.length === 0 ? 0 : (page - 1) * ITEMS_PER_PAGE + 1
  const endIndex = Math.min(page * ITEMS_PER_PAGE, dealers.length)

  const showToast = (nextToast: Toast) => setToast(nextToast)

  const ensureDealerDetails = useCallback(
    async (dealer: Dealer) => {
      if (dealerDetails[dealer.Dealer_Id]) return dealerDetails[dealer.Dealer_Id]

      setLoadingDealerId(dealer.Dealer_Id)
      try {
        const res = await axios.get(`/api/ledger/${encodeURIComponent(dealer.Dealer_Id)}`)
        const detail: DealerDetail = {
          dealer: { ...dealer, ...(res.data?.dealer || {}) },
          orders: Array.isArray(res.data?.orders) ? res.data.orders : [],
          bills: Array.isArray(res.data?.bills) ? res.data.bills : [],
        }
        setDealerDetails((prev) => ({ ...prev, [dealer.Dealer_Id]: detail }))
        setBillsByDealer((prev) => ({ ...prev, [dealer.Dealer_Id]: detail.bills || [] }))
        return detail
      } catch (detailError) {
        console.error('[ledger dealer detail]', detailError)
        const fallback = { dealer, orders: [], bills: [] }
        setDealerDetails((prev) => ({ ...prev, [dealer.Dealer_Id]: fallback }))
        showToast({ type: 'error', text: 'Could not load orders for this dealer' })
        return fallback
      } finally {
        setLoadingDealerId(null)
      }
    },
    [dealerDetails]
  )

  const handleExpand = async (dealer: Dealer) => {
    const isOpen = expandedDealerId === dealer.Dealer_Id
    setExpandedDealerId(isOpen ? null : dealer.Dealer_Id)
    if (!isOpen) await ensureDealerDetails(dealer)
  }

  const openBillModal = async (dealer: Dealer) => {
    setBillDealer(dealer)
    setBillForm(EMPTY_BILL_FORM)
    setBillFiles([])
    setOrderDropdownOpen(false)
    await ensureDealerDetails(dealer)
  }

  const closeBillModal = () => {
    setBillDealer(null)
    setBillForm(EMPTY_BILL_FORM)
    setBillFiles([])
    setOrderDropdownOpen(false)
  }

  const handleBillFiles = (files: FileList | null) => {
    const selectedFiles = Array.from(files || [])
    if (selectedFiles.length === 0) {
      setBillFiles([])
      return
    }

    const invalidFile = selectedFiles.find((file) => file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))
    if (invalidFile) {
      showToast({ type: 'error', text: 'Please upload a PDF bill' })
      return
    }

    setBillFiles(selectedFiles)
  }

  const toggleBillOrder = (nextOrderNumber: string, checked: boolean) => {
    setBillForm((prev) => {
      const nextOrderNumbers = checked
        ? Array.from(new Set([...prev.orderNumbers, nextOrderNumber]))
        : prev.orderNumbers.filter((orderNumber) => orderNumber !== nextOrderNumber)
      const selectedOrders = (billDealer ? dealerDetails[billDealer.Dealer_Id]?.orders || [] : [])
        .filter((order) => nextOrderNumbers.includes(orderNumber(order)))
      const nextAmount = selectedOrders.reduce((sum, order) => sum + orderAmount(order), 0)

      return {
        ...prev,
        orderNumbers: nextOrderNumbers,
        billAmount: nextOrderNumbers.length > 0 ? String(roundForInput(nextAmount)) : '',
      }
    })
  }

  const submitBill = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!billDealer) return

    const amount = Number(billForm.billAmount)
    const gst = Number(billForm.gstPercent)

    if (billForm.orderNumbers.length === 0 || amount <= 0 || gst < 0 || !billForm.billDate) {
      showToast({ type: 'error', text: 'Fill all bill fields before saving' })
      return
    }

    setIsSavingBill(true)

    try {
      let uploadedPdfs: BillPdf[] = []

      if (billFiles.length > 0) {
        setIsUploadingPdfs(true)
        try {
          const form = new FormData()
          billFiles.forEach((file) => form.append('files', file))
          const upload = await axios.post(
            `/api/ledger/${encodeURIComponent(billDealer.Dealer_Id)}/bill-pdf`,
            form
          )
          uploadedPdfs = upload.data?.files || []
          if (uploadedPdfs.length === 0) throw new Error('Upload returned no files')
        } catch (uploadError) {
          console.error('[ledger bill pdf upload]', uploadError)
          const message = axios.isAxiosError(uploadError)
            ? uploadError.response?.data?.message || 'Could not upload the bill PDFs'
            : 'Could not upload the bill PDFs'
          showToast({ type: 'error', text: message })
          return
        } finally {
          setIsUploadingPdfs(false)
        }
      }

      const response = await axios.post(`/api/ledger/${encodeURIComponent(billDealer.Dealer_Id)}`, {
        orderNumbers: billForm.orderNumbers,
        billAmount: amount,
        gstPercent: gst,
        billDate: billForm.billDate,
        pdfNames: billFiles.map((file) => file.name),
        pdfFiles: uploadedPdfs,
      })

      const savedBill: Bill | undefined = response.data?.bill
      if (!savedBill) throw new Error('Saved bill payload missing')

      setBillsByDealer((prev) => ({
        ...prev,
        [billDealer.Dealer_Id]: [savedBill, ...(prev[billDealer.Dealer_Id] || []).filter((bill) => bill.id !== savedBill.id)],
      }))
      setExpandedDealerId(billDealer.Dealer_Id)
      closeBillModal()
      showToast({ type: 'success', text: 'Bill saved' })
    } catch (billError) {
      console.error('[ledger bill]', billError)
      showToast({ type: 'error', text: 'Could not save bill to backend' })
    } finally {
      setIsSavingBill(false)
    }
  }

  const openPaymentModal = (dealer: Dealer, bill: Bill) => {
    setPaymentTarget({ dealer, bill })
    setPaymentForm({
      ...EMPTY_PAYMENT_FORM,
      amount: String(Math.max(0, bill.billAmount - bill.paidAmount)),
    })
  }

  const closePaymentModal = () => {
    setPaymentTarget(null)
    setPaymentForm(EMPTY_PAYMENT_FORM)
  }

  const submitPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!paymentTarget) return

    const amount = Number(paymentForm.amount)
    if (amount <= 0 || !paymentForm.paymentDate) {
      showToast({ type: 'error', text: 'Enter a valid payment amount and date' })
      return
    }

    setIsSavingPayment(true)

    try {
      const idempotencyKey = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `ledger-payment-${paymentTarget.bill.id}-${Date.now()}`
      const response = await axios.post(`/api/ledger/${encodeURIComponent(paymentTarget.dealer.Dealer_Id)}/pay`, {
        idempotencyKey,
        billId: paymentTarget.bill.id,
        amount,
        paymentMode: paymentForm.paymentMode,
        paymentDate: paymentForm.paymentDate,
        referenceId: paymentForm.reference || paymentTarget.bill.orderNumber,
        narration: paymentForm.notes || `Payment against bill ${paymentTarget.bill.orderNumber}`,
      })

      const savedBill: Bill | undefined = response.data?.bill
      setBillsByDealer((prev) => ({
        ...prev,
        [paymentTarget.dealer.Dealer_Id]: (prev[paymentTarget.dealer.Dealer_Id] || []).map((bill) =>
          bill.id === paymentTarget.bill.id
            ? (savedBill || {
                ...bill,
                paidAmount: Math.min(bill.billAmount, bill.paidAmount + amount),
                lastPaymentDate: paymentForm.paymentDate,
              })
            : bill
        ),
      }))

      closePaymentModal()
      showToast({ type: 'success', text: 'Payment recorded' })
    } catch (paymentError) {
      console.error('[ledger payment]', paymentError)
      showToast({ type: 'error', text: 'Could not record payment in backend' })
    } finally {
      setIsSavingPayment(false)
    }
  }

  if (redirectingStaff) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="admin-page-shell rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
          Opening assigned dealer ledger...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="admin-page-shell rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Failed to load dealer ledger data.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {toast && (
        <div
          className={`fixed right-5 top-5 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white'
          }`}
        >
          {toast.text}
        </div>
      )}

      <div className="admin-page-shell p-6">
        <div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Dealer Ledger</h1>
            <p className="mt-1 text-sm text-gray-500">Manage dealer bills, due dates, and payments</p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-end lg:w-auto">
            <div className="inline-flex rounded-lg border border-gray-300 bg-white p-1">
              {TERMS_FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setTermsFilter(option.value)
                    setPage(1)
                  }}
                  aria-pressed={termsFilter === option.value}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    termsFilter === option.value
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search dealers..."
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {data?.isLive === false && (
          <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            Showing cached ledger data. Live billing data is temporarily unavailable.
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="w-12 px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600" />
                  <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Dealer
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    City
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Orders
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Credit
                  </th>
                  <th className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Action
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {isLoading &&
                  Array.from({ length: ITEMS_PER_PAGE }).map((_, index) => (
                    <tr key={index}>
                      {Array.from({ length: 6 }).map((__, cellIndex) => (
                        <td key={cellIndex} className="px-4 py-4">
                          <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
                        </td>
                      ))}
                    </tr>
                  ))}

                {!isLoading && pageRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-400">
                      {search || termsFilter !== 'all' ? 'No dealers match your filters' : 'No dealers found'}
                    </td>
                  </tr>
                )}

                {!isLoading &&
                  pageRows.map((dealer) => {
                    const isExpanded = expandedDealerId === dealer.Dealer_Id
                    const creditDays = creditDaysForDealer(dealerDetails[dealer.Dealer_Id]?.dealer || dealer)
                    const bills = billsByDealer[dealer.Dealer_Id] || []
                    const orderCount = dealer.accountBook?.bookedCount ?? 0

                    return (
                      <FragmentRow
                        key={dealer.Dealer_Id}
                        dealer={dealer}
                        isExpanded={isExpanded}
                        isLoadingDetails={loadingDealerId === dealer.Dealer_Id}
                        creditDays={creditDays}
                        terms={dealerTerms(dealer)}
                        orderCount={orderCount}
                        bills={bills}
                        detail={dealerDetails[dealer.Dealer_Id]}
                        onExpand={() => handleExpand(dealer)}
                        canManageLedgerEntries={canManageLedgerEntries}
                        onAddBill={() => openBillModal(dealer)}
                        onPayment={(bill) => openPaymentModal(dealer, bill)}
                        onViewPdfs={(bill) => setPdfTarget({ dealer, bill })}
                      />
                    )
                  })}
              </tbody>
            </table>
          </div>

          {!isLoading && dealers.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-gray-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-gray-400">
                Showing {startIndex}-{endIndex} of {dealers.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="text-xs font-medium text-gray-500">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page === totalPages}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {billDealer && (
        <ModalShell title="Add Invoice" onClose={closeBillModal}>
          <form onSubmit={submitBill} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Orders
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOrderDropdownOpen((open) => !open)}
                  className="flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <span>
                    {billForm.orderNumbers.length > 0
                      ? `${billForm.orderNumbers.length} order${billForm.orderNumbers.length === 1 ? '' : 's'} selected`
                      : 'Select orders'}
                  </span>
                  <ChevronDown className={`h-4 w-4 text-gray-400 transition ${orderDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {orderDropdownOpen && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-gray-300 bg-white shadow-lg">
                    {(dealerDetails[billDealer.Dealer_Id]?.orders || [])
                      .filter((order) => orderNumber(order))
                      .map((order) => {
                        const currentOrderNumber = orderNumber(order)
                        return (
                          <label key={currentOrderNumber} className="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 hover:bg-gray-50">
                            <input
                              type="checkbox"
                              checked={billForm.orderNumbers.includes(currentOrderNumber)}
                              onChange={(event) => toggleBillOrder(currentOrderNumber, event.target.checked)}
                              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="flex-1 text-gray-900">{orderLabel(order)}</span>
                            <span className="text-xs font-semibold text-gray-600">{formatAmount(orderAmount(order))}</span>
                          </label>
                        )
                      })}
                    {(dealerDetails[billDealer.Dealer_Id]?.orders || []).filter((order) => orderNumber(order)).length === 0 && (
                      <div className="px-3 py-4 text-sm text-gray-400">No billable orders found</div>
                    )}
                  </div>
                )}
              </div>
              {billForm.orderNumbers.length > 0 && (
                <p className="mt-1.5 text-xs text-gray-500">{billForm.orderNumbers.map(formatLedgerOrderId).join(', ')}</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label="Invoice Amount"
                type="number"
                min="0"
                step="0.01"
                value={billForm.billAmount}
                onChange={(value) => setBillForm((prev) => ({ ...prev, billAmount: value }))}
                required
              />
              {/* <FormField
                label="GST %"
                type="number"
                min="0"
                step="0.01"
                value={billForm.gstPercent}
                onChange={(value) => setBillForm((prev) => ({ ...prev, gstPercent: value }))}
                required
              /> */} <h1 className="text-black justify-content justify-center my-auto mt-7 italic">*GST included</h1>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label="Invoice Date"
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={billForm.billDate}
                onChange={(value) => setBillForm((prev) => ({ ...prev, billDate: value }))}
                required
              />
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Invoice PDF
                </label>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  onChange={(event) => handleBillFiles(event.target.files)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-indigo-700"
                />
                {billFiles.length > 0 && (
                  <p className="mt-1.5 text-xs text-gray-500">{billFiles.length} PDF{billFiles.length === 1 ? '' : 's'} selected</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeBillModal}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingBill}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
              >
                {isSavingBill && <Loader2 className="h-4 w-4 animate-spin" />}
                {isUploadingPdfs ? 'Uploading PDFs…' : 'Save Invoice'}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {pdfTarget && (
        <ModalShell
          title={`Bill PDFs - ${pdfTarget.dealer.Dealer_Name}`}
          onClose={() => setPdfTarget(null)}
        >
          <div className="space-y-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Order {formatLedgerOrderId(pdfTarget.bill.orderNumber)} - {formatAmount(pdfTarget.bill.billAmount)} - {formatDate(pdfTarget.bill.billDate)}
            </div>

            {billPdfs(pdfTarget.bill).length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">No PDF uploaded for this bill.</p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {billPdfs(pdfTarget.bill).map((file, index) => (
                  <li key={`${file.url}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <a
                      href={billPdfHref(pdfTarget.bill, index, 'inline')}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-w-0 items-center gap-2 text-sm text-gray-700 hover:text-indigo-700"
                      title="Open in a new tab"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-red-500" />
                      <span className="truncate font-medium">{file.name}</span>
                      {file.bytes ? (
                        <span className="shrink-0 text-xs text-gray-400">{formatFileSize(file.bytes)}</span>
                      ) : null}
                    </a>
                    <a
                      href={billPdfHref(pdfTarget.bill, index, 'attachment')}
                      download={file.name}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </ModalShell>
      )}

      {paymentTarget && (
        <ModalShell title="Record Payment" onClose={closePaymentModal}>
          <form onSubmit={submitPayment} className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              {paymentTarget.dealer.Dealer_Name} - Invoice for order {paymentTarget.bill.orderNumber}
            </div>

            <FormField
              label="Payment Amount"
              type="number"
              min="0"
              step="0.01"
              value={paymentForm.amount}
              onChange={(value) => setPaymentForm((prev) => ({ ...prev, amount: value }))}
              required
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Payment Mode
                </label>
                <select
                  value={paymentForm.paymentMode}
                  onChange={(event) => setPaymentForm((prev) => ({ ...prev, paymentMode: event.target.value }))}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {PAYMENT_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </div>

              <FormField
                label="Payment Date"
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={paymentForm.paymentDate}
                onChange={(value) => setPaymentForm((prev) => ({ ...prev, paymentDate: value }))}
                required
              />
            </div>

            <FormField
              label="Reference / Notes"
              value={paymentForm.reference}
              onChange={(value) => setPaymentForm((prev) => ({ ...prev, reference: value }))}
            />
             {/* <FormField
              label="Cheque/UTR"
              value={paymentForm.notes}
              onChange={(event) => setPaymentForm((prev) => ({  ...prev, notes: event.target.value  }))}
            /> */}

            {/* <textarea
            label="Reference / Notes"
              value={paymentForm.notes}
              onChange={(event) => setPaymentForm((prev) => ({ ...prev, notes: event.target.value }))}
              placeholder="Notes"
              rows={3}
              className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            /> */}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closePaymentModal}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingPayment}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {isSavingPayment && <Loader2 className="h-4 w-4 animate-spin" />}
                Record Payment
              </button>
            </div>
          </form>
        </ModalShell>
      )}
    </div>
  )
}

function FragmentRow({
  dealer,
  isExpanded,
  isLoadingDetails,
  creditDays,
  terms,
  orderCount,
  bills,
  detail,
  onExpand,
  canManageLedgerEntries,
  onAddBill,
  onPayment,
  onViewPdfs,
}: {
  dealer: Dealer
  isExpanded: boolean
  isLoadingDetails: boolean
  creditDays: number
  terms: DealerTerms
  orderCount: number
  bills: Bill[]
  detail?: DealerDetail
  onExpand: () => void
  canManageLedgerEntries: boolean
  onAddBill: () => void
  onPayment: (bill: Bill) => void
  onViewPdfs: (bill: Bill) => void
}) {
  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-4 py-4">
          <button
            type="button"
            onClick={onExpand}
            className="rounded-md p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
            aria-label={isExpanded ? 'Collapse dealer ledger' : 'Expand dealer ledger'}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-4 py-4">
          <Link
            href={`/dashboard/admin/dealer/${encodeURIComponent(dealer.Dealer_Id)}/ledger`}
            className="group inline-block text-left"
          >
            <div className="font-semibold text-gray-900 transition-colors group-hover:text-indigo-600">
              {dealer.Dealer_Name || '-'}
            </div>
            <div className="mt-0.5 text-xs text-gray-500">{dealer.Dealer_Email || dealer.Dealer_Number || '-'}</div>
          </Link>
        </td>
        <td className="px-4 py-4">
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
            {dealer.Dealer_City || '-'}
          </span>
        </td>
        <td className="px-4 py-4">
          <span className="font-medium text-gray-900">{orderCount}</span>
          <span className="ml-1 text-xs text-gray-400">orders</span>
        </td>
        <td className="px-4 py-4 text-sm text-gray-600">
          {terms === 'credit' ? (
            <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
              Credit · {creditDays} days
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
              Advance
            </span>
          )}
        </td>
        <td className="px-4 py-4 text-right">
          {/* Advance dealers pay up front, so there is no invoice to raise - show what is left in their wallet instead. */}
          {terms === 'advance' ? (
            <div className="inline-flex flex-col items-end">
              <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Wallet balance</span>
              <span
                className={`text-sm font-semibold ${
                  Number(dealer.walletBalance || 0) < 0 ? 'text-rose-600' : 'text-emerald-600'
                }`}
              >
                {formatAmount(dealer.walletBalance)}
              </span>
            </div>
          ) : canManageLedgerEntries ? (
            <button
              type="button"
              onClick={onAddBill}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" />
              Add Invoice
            </button>
          ) : (
            <span className="text-xs font-medium text-gray-400">View only</span>
          )}
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={6} className="bg-slate-50 px-4 py-5">
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="flex flex-col gap-2 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Ledger Bills</h2>
                  <p className="text-xs text-gray-500">
                    {detail?.orders?.length ?? 0} orders available for billing
                  </p>
                </div>
                {isLoadingDetails && (
                  <span className="inline-flex items-center gap-2 text-xs font-medium text-indigo-600">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading orders
                  </span>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Order
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Bill
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Bill Date
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Due Date
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        PDF
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Payment
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {bills.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                          No bills recorded yet. Add a bill to start this dealer ledger.
                        </td>
                      </tr>
                    )}

                    {bills.map((bill) => {
                      const dueDate = addDays(bill.billDate, creditDays)
                      const daysRemaining = getDaysRemaining(bill.billDate, creditDays)
                      const isOverdue = daysRemaining < 0
                      const balance = Math.max(0, bill.billAmount - bill.paidAmount)
                      const pdfCount = billPdfs(bill).length

                      return (
                        <tr key={bill.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono text-xs font-semibold text-indigo-700">
                            {formatLedgerOrderId(bill.orderNumber)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-gray-900">{formatAmount(bill.billAmount)}</div>
                            <div className="text-xs text-gray-500">GST {bill.gstPercent}%</div>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{formatDate(bill.billDate)}</td>
                          <td className="px-4 py-3 text-gray-600">{formatDateObject(dueDate)}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                isOverdue
                                  ? 'bg-red-50 text-red-700'
                                  : balance === 0
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-amber-50 text-amber-700'
                              }`}
                            >
                              {balance === 0
                                ? 'Paid'
                                : isOverdue
                                  ? `${Math.abs(daysRemaining)} days overdue`
                                  : `${daysRemaining} days left`}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {pdfCount > 0 ? (
                              <button
                                type="button"
                                onClick={() => onViewPdfs(bill)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                                title="View and download bill PDFs"
                              >
                                <FileText className="h-3.5 w-3.5" />
                                {pdfCount} PDF{pdfCount === 1 ? '' : 's'}
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                                <FileText className="h-3.5 w-3.5" />
                                {bill.pdfName}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {canManageLedgerEntries ? (
                              <button
                                type="button"
                                onClick={() => onPayment(bill)}
                                disabled={balance === 0}
                                className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <CreditCard className="h-3.5 w-3.5" />
                                Record Payment
                              </button>
                            ) : (
                              <span className="text-xs font-medium text-gray-400">Recorded payment only</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
      <div className="w-full max-w-2xl rounded-xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  )
}

function FormField({
  label,
  value,
  onChange,
  type = 'text',
  required,
  min,
  step,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  required?: boolean
  min?: string
  step?: string
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </label>
      <input
        type={type}
        value={value}
        required={required}
        min={min}
        step={step}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  )
}
