'use client'

import { useState } from 'react'
import moment from 'moment'
import { Download, Loader2, Receipt } from 'lucide-react'
import { downloadOrderInvoice } from '@/lib/invoicegenerator'
import { formatDisplayOrderNumber } from '@/lib/orderDisplay'
import { showToast } from "@/components/ui/toast";

interface RawOrder {
  order_id: string
  order_date: string
  order_amount: string | number
  order_discount: string | number
  Dealer_Name?: string
  orderdata_item_quantity?: string | number
  mtstatus?: string | number
  outstandingDate?: string
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
  order?: RawOrder
}

interface TransactionTableProps {
  transactions: Transaction[]
  isLoading: boolean
  isFetching?: boolean
  count: number
  page?: number
  totalPages?: number
  pageSize?: number
  hasNextPage?: boolean
  hasPreviousPage?: boolean
  onPageChange?: (page: number) => void
  onInvoiceClick?: (invoiceId: string) => void
}

function formatAmount(value: number): string {
  if (value === 0 || !value) return '--'
  return `Rs. ${value.toLocaleString('en-IN')}`
}

function formatCount(value: number): string {
  return value.toLocaleString('en-IN')
}

function pageNumbers(page: number, totalPages: number): (number | '...')[] {
  return Array.from({ length: totalPages }, (_, index) => index + 1)
    .filter((item) => item === 1 || item === totalPages || Math.abs(item - page) <= 1)
    .reduce<(number | '...')[]>((acc, item, index, arr) => {
      if (index > 0 && item - arr[index - 1] > 1) acc.push('...')
      acc.push(item)
      return acc
    }, [])
}

function txTone(tx: Transaction) {
  if (tx.credit > 0) {
    return {
      label: 'Credit',
      wrap: 'bg-emerald-50 border-emerald-200 text-emerald-700',
      dot: 'bg-emerald-400',
    }
  }

  return {
    label: 'Debit',
    wrap: 'bg-red-50 border-red-200 text-red-700',
    dot: 'bg-red-400',
  }
}

function modeTone(mode: string) {
  const normalized = mode.toLowerCase().replace(/[\s_-]/g, '')
  if (normalized.includes('settled') || normalized.includes('completed')) {
    return 'bg-emerald-50 border-emerald-200 text-emerald-700'
  }
  if (normalized.includes('supposed')) {
    return 'bg-blue-50 border-blue-200 text-blue-700'
  }
  if (normalized.includes('awaiting')) {
    return 'bg-amber-50 border-amber-200 text-amber-700'
  }
  return 'bg-slate-50 border-slate-200 text-slate-700'
}

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100">
      {[44, 150, 118, 86, 86, 110, 100, 86].map((width, index) => (
        <td key={index} className="px-4 py-3.5">
          <div className="h-3.5 rounded bg-gray-100 animate-pulse" style={{ width }} />
        </td>
      ))}
    </tr>
  )
}

function InvoiceButton({ tx }: { tx: Transaction }) {
  const [loading, setLoading] = useState(false)
  const handleInvoice = async () => {
    if (tx.order) {
      setLoading(true)
      const result = await downloadOrderInvoice(tx.order as any)
      setLoading(false)
      showToast(
        result.success ? 'success' : 'error',
        result.success ? 'Invoice downloaded' : result.error || 'Invoice download failed'
      )
    }
  }

  if (!tx.order) {
    return tx.invoice ? (
      <span className="rounded-lg bg-gray-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-gray-600">
        Ref: {tx.invoice}
      </span>
    ) : (
      <span className="text-gray-400">--</span>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleInvoice}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 shadow-sm transition-all hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50"
        title="Download invoice PDF"
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Download className="h-3 w-3" />
        )}
        Invoice
      </button>

    </div>
  )
}

export default function TransactionTable({
  transactions,
  isLoading,
  isFetching = false,
  count,
  page = 1,
  totalPages = 1,
  pageSize = transactions.length || 10,
  hasNextPage = page < totalPages,
  hasPreviousPage = page > 1,
  onPageChange,
}: TransactionTableProps) {
  const safeCount = Math.max(0, count)
  const safePageSize = Math.max(1, pageSize)
  const safeTotalPages = Math.max(1, totalPages)
  const safePage = Math.min(Math.max(1, page), safeTotalPages)
  const start = safeCount === 0 ? 0 : (safePage - 1) * safePageSize + 1
  const end = Math.min(safePage * safePageSize, safeCount)
  const showPagination = safeCount > safePageSize
  const pageItems = pageNumbers(safePage, safeTotalPages)

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-indigo-500" />
          <div>
            <h2 className="text-[15px] font-bold text-gray-900">Invoices</h2>
            <p className="text-[12px] text-gray-500">
              {safeCount === 0 ? 'No transaction records' : `${formatCount(safeCount)} transaction records`}
              {isFetching && !isLoading ? (
                <span className="ml-2 inline-flex items-center gap-1 text-indigo-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-ping" />
                  refreshing
                </span>
              ) : null}
            </p>
          </div>
        </div>

        <span className="text-[12px] font-medium text-gray-600">
          Showing {formatCount(start)}-{formatCount(end)} of {formatCount(safeCount)}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[940px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              {['#', 'Transaction', 'Date', 'Debit', 'Credit', 'Status / Mode', 'Invoice', 'Record Type'].map((heading) => (
                <th
                  key={heading}
                  className="whitespace-nowrap px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {isLoading
              ? Array.from({ length: 8 }).map((_, index) => <SkeletonRow key={index} />)
              : transactions.length === 0
                ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="flex flex-col items-center justify-center gap-3 py-16">
                        <Receipt className="h-9 w-9 text-gray-300" />
                        <p className="text-sm text-gray-600">No transactions found</p>
                      </div>
                    </td>
                  </tr>
                )
                : transactions.map((tx, index) => {
                  const tone = txTone(tx)
                  const rowNumber = (safePage - 1) * safePageSize + index + 1
                  const orderYear = tx.date && moment(tx.date).isValid()
                    ? moment(tx.date).year()
                    : new Date().getFullYear()

                  return (
                    <tr key={`${tx.type || 'tx'}-${tx.id}`} className="transition-colors hover:bg-blue-50/30">
                      <td className="px-4 py-3.5 font-medium text-gray-700">
                        {String(rowNumber).padStart(2, '0')}
                      </td>

                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[13px] font-bold text-indigo-700">
                            {tx.invoice ? formatDisplayOrderNumber(tx.invoice, orderYear) : tx.id}
                          </span>
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${tone.wrap}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                            {tone.label}
                          </span>
                        </div>
                        <p className="mt-1 max-w-[320px] truncate text-[11px] text-gray-500" title={tx.narration}>
                          {tx.narration || `${tone.label} record`}
                        </p>
                      </td>

                      <td className="px-4 py-3.5">
                        <p className="text-[13px] font-medium text-gray-900">
                          {tx.date ? moment(tx.date).format('DD MMM YYYY') : '--'}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-gray-500">
                          {tx.date ? moment(tx.date).format('hh:mm A') : '--'}
                        </p>
                      </td>

                      <td className="px-4 py-3.5 font-mono text-[13px] font-semibold text-red-600">
                        {tx.debit > 0 ? formatAmount(tx.debit) : '--'}
                      </td>

                      <td className="px-4 py-3.5 font-mono text-[13px] font-semibold text-emerald-700">
                        {tx.credit > 0 ? formatAmount(tx.credit) : '--'}
                      </td>

                      <td className="px-4 py-3.5">
                        {tx.mode ? (
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${modeTone(tx.mode)}`}>
                            {tx.mode}
                          </span>
                        ) : (
                          <span className="text-gray-400">--</span>
                        )}
                      </td>

                      <td className="w-px whitespace-nowrap px-4 py-3.5">
                        <InvoiceButton tx={tx} />
                      </td>

                      <td className="px-4 py-3.5">
                        <span className="rounded-lg bg-gray-100 px-2 py-0.5 font-mono text-[12px] font-semibold text-gray-800">
                          {tx.order ? 'order' : tx.type || (tx.credit > 0 ? 'payment' : 'record')}
                        </span>
                      </td>
                    </tr>
                  )
                })}
          </tbody>
        </table>
      </div>

      {showPagination && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4">
          <p className="text-[13px] font-medium text-gray-700">
            Page {safePage} of {safeTotalPages} <span className="text-gray-500">- {formatCount(safeCount)} records</span>
          </p>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onPageChange?.(Math.max(1, safePage - 1))}
              disabled={!hasPreviousPage || isLoading || isFetching || !onPageChange}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-700 transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              ‹
            </button>

            {pageItems.map((item, index) => item === '...'
              ? (
                <span key={`ellipsis-${index}`} className="flex h-8 w-8 items-center justify-center text-[13px] text-gray-500">
                  ...
                </span>
              )
              : (
                <button
                  key={item}
                  type="button"
                  onClick={() => onPageChange?.(item)}
                  disabled={item === safePage || isLoading || isFetching || !onPageChange}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border text-[13px] font-semibold transition-all ${
                    item === safePage
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-200 text-gray-700 hover:bg-white'
                  } disabled:cursor-default`}
                >
                  {item}
                </button>
              ))}

            <button
              type="button"
              onClick={() => onPageChange?.(Math.min(safeTotalPages, safePage + 1))}
              disabled={!hasNextPage || isLoading || isFetching || !onPageChange}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-700 transition-all hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
