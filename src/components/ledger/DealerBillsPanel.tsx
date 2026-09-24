'use client'

import { FormEvent, ReactNode, useState } from 'react'
import axios from 'axios'
import { CreditCard, FileText, Loader2, Plus, X } from 'lucide-react'
import DateInput from '@/components/ui/date-input'
import { showToast } from '@/components/ui/toast'
import { formatDisplayOrderNumber } from '@/lib/orderDisplay'
import { resolveOrderAmounts } from '@/lib/orderAmounts'

export type BillableOrder = {
  order_id?: string
  order_amount?: string | number
  order_discount?: string | number
  total?: string | number
  orderdata_item_quantity?: string | number
  readyquantity?: string | number
}

export type LedgerBill = {
  id: string
  dealerId: string
  orderNumber: string
  billAmount: number
  gstPercent: number
  billDate: string
  pdfName: string
  pdfUrl?: string
  pdfFiles?: Array<{ name: string; url: string; bytes?: number }>
  paidAmount: number
  lastPaymentDate?: string
  extraCreditDays?: number
}

export type CreditSnapshot = {
  creditDays: number | null
  creditLimit: number | null
  tempCreditLimit: number
  used: number
  remaining: number | null
  isOverdue: boolean
} | null

const PAYMENT_MODES = ['Cash', 'Cheque', 'NEFT', 'UPI', 'IMPF']
const today = () => new Date().toISOString().slice(0, 10)
const inputClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500'
const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500'

// Accountant only bills what's actually gone out: for a partially dispatched
// order this scales the order's net payable down to the dispatched share, so
// a 200-piece/20000 order with 100 pieces dispatched bills 10000.
export function dispatchedOrderAmount(order: BillableOrder) {
  const net = resolveOrderAmounts(order).netPayable
  const ordered = Number(order.orderdata_item_quantity || 0)
  const dispatched = Number(order.readyquantity || 0)
  if (ordered > 0 && dispatched < ordered) return Math.round(net * (dispatched / ordered) * 100) / 100
  return net
}

/** Orders with something dispatched - the only ones the accountant can bill. */
export function billableOrders<T extends BillableOrder>(orders: T[]) {
  return orders.filter((order) => String(order.order_id || '').trim() && Number(order.readyquantity || 0) > 0)
}

function formatAmount(value: number | string | undefined) {
  const amount = Number(value || 0)
  return `Rs. ${amount.toLocaleString('en-IN', { minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
}

function dueDate(bill: LedgerBill, creditDays: number) {
  const date = new Date(`${bill.billDate}T00:00:00`)
  date.setDate(date.getDate() + creditDays + (bill.extraCreditDays || 0))
  return date
}

function daysUntil(date: Date) {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000)
}

function formatDate(date: Date) {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`
}

function billPdfs(bill: LedgerBill) {
  if (bill.pdfFiles && bill.pdfFiles.length > 0) return bill.pdfFiles
  return bill.pdfUrl ? [{ name: bill.pdfName || 'Bill PDF', url: bill.pdfUrl }] : []
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  )
}

function Actions({ onCancel, busy, label, tone = 'indigo' }: { onCancel: () => void; busy: boolean; label: string; tone?: 'indigo' | 'emerald' }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" onClick={onCancel} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
      <button
        type="submit"
        disabled={busy}
        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${tone === 'emerald' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {label}
      </button>
    </div>
  )
}

export default function DealerBillsPanel({
  dealerId,
  orders,
  bills,
  credit,
  canManageBills,
  canExtendCredit,
  onChanged,
}: {
  dealerId: string
  orders: BillableOrder[]
  bills: LedgerBill[]
  credit: CreditSnapshot
  canManageBills: boolean
  canExtendCredit: boolean
  onChanged: () => Promise<unknown> | void
}) {
  const [modal, setModal] = useState<null | 'invoice' | 'payment' | 'days' | 'limit'>(null)
  const [busy, setBusy] = useState(false)
  const [invoiceOrders, setInvoiceOrders] = useState<string[]>([])
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([])
  const [paymentBill, setPaymentBill] = useState<LedgerBill | null>(null)
  const [payment, setPayment] = useState({ amount: '', mode: 'NEFT', date: today(), reference: '' })
  const [extendValue, setExtendValue] = useState('')
  const [extendNote, setExtendNote] = useState('')

  const creditDays = credit?.creditDays ?? 0
  const isCreditDealer = credit !== null
  const limitReached = credit?.remaining !== null && credit?.remaining !== undefined && credit.remaining <= 0
  const selectable = billableOrders(orders)

  const close = () => {
    setModal(null)
    setPaymentBill(null)
    setExtendValue('')
    setExtendNote('')
  }

  const openInvoice = () => {
    setInvoiceOrders([])
    setInvoiceAmount('')
    setInvoiceDate(today())
    setInvoiceFiles([])
    setModal('invoice')
  }

  const toggleOrder = (orderId: string, checked: boolean) => {
    const next = checked ? [...invoiceOrders, orderId] : invoiceOrders.filter((id) => id !== orderId)
    setInvoiceOrders(next)
    const total = selectable.filter((order) => next.includes(String(order.order_id))).reduce((sum, order) => sum + dispatchedOrderAmount(order), 0)
    setInvoiceAmount(next.length > 0 ? String(Math.round(total * 100) / 100) : '')
  }

  const run = async (work: () => Promise<void>, fallback: string) => {
    setBusy(true)
    try {
      await work()
      close()
      await onChanged()
    } catch (error) {
      showToast('error', axios.isAxiosError(error) ? error.response?.data?.message || fallback : fallback)
    } finally {
      setBusy(false)
    }
  }

  const submitInvoice = (event: FormEvent) => {
    event.preventDefault()
    const amount = Number(invoiceAmount)
    if (invoiceOrders.length === 0 || !(amount > 0) || !invoiceDate) {
      showToast('error', 'Select orders, amount and date')
      return
    }
    run(async () => {
      let pdfFiles: unknown[] = []
      if (invoiceFiles.length > 0) {
        const form = new FormData()
        invoiceFiles.forEach((file) => form.append('files', file))
        const upload = await axios.post(`/api/ledger/${encodeURIComponent(dealerId)}/bill-pdf`, form)
        pdfFiles = upload.data?.files || []
      }
      await axios.post(`/api/ledger/${encodeURIComponent(dealerId)}`, {
        orderNumbers: invoiceOrders,
        billAmount: amount,
        gstPercent: 18,
        billDate: invoiceDate,
        pdfNames: invoiceFiles.map((file) => file.name),
        pdfFiles,
      })
      showToast('success', 'Invoice saved')
    }, 'Could not save invoice')
  }

  const submitPayment = (event: FormEvent) => {
    event.preventDefault()
    if (!paymentBill) return
    const amount = Number(payment.amount)
    if (!(amount > 0) || !payment.date) {
      showToast('error', 'Enter a valid payment amount and date')
      return
    }
    run(async () => {
      await axios.post(`/api/ledger/${encodeURIComponent(dealerId)}/pay`, {
        idempotencyKey: crypto.randomUUID(),
        billId: paymentBill.id,
        amount,
        paymentMode: payment.mode,
        paymentDate: payment.date,
        referenceId: payment.reference || paymentBill.orderNumber,
        narration: `Payment against bill ${paymentBill.orderNumber}`,
      })
      showToast('success', 'Payment recorded')
    }, 'Could not record payment')
  }

  const submitExtension = (event: FormEvent) => {
    event.preventDefault()
    const value = Number(extendValue)
    if (!(value > 0)) {
      showToast('error', modal === 'days' ? 'Enter the number of days' : 'Enter an amount')
      return
    }
    run(async () => {
      await axios.post(`/api/ledger/${encodeURIComponent(dealerId)}/credit-extension`, modal === 'days'
        ? { type: 'days', days: value, note: extendNote }
        : { type: 'limit', amount: value, note: extendNote })
      showToast('success', modal === 'days' ? `Unpaid bills extended by ${value} days` : `Temporary limit of ${formatAmount(value)} added`)
    }, 'Could not extend credit')
  }

  return (
    <>
      {isCreditDealer && (
        <div className={`mb-6 rounded-xl border px-5 py-4 ${credit.isOverdue || limitReached ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Credit days</p>
                <p className="font-semibold text-gray-900">{credit.creditDays} days</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Credit limit</p>
                <p className="font-semibold text-gray-900">
                  {credit.creditLimit === null ? 'Not set' : formatAmount(credit.creditLimit)}
                  {credit.tempCreditLimit > 0 && <span className="ml-1 text-xs font-medium text-indigo-600">+ {formatAmount(credit.tempCreditLimit)} temp</span>}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Ordered</p>
                <p className="font-semibold text-gray-900">{formatAmount(credit.used)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Available</p>
                <p className={`font-semibold ${limitReached ? 'text-red-700' : 'text-emerald-700'}`}>
                  {credit.remaining === null ? 'No limit' : formatAmount(credit.remaining)}
                </p>
              </div>
            </div>
            {(credit.isOverdue || limitReached) && (
              <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">
                Ordering blocked · {credit.isOverdue ? 'Payment overdue' : 'Limit reached'}
              </span>
            )}
          </div>
          {canExtendCredit && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-200/70 pt-3">
              <button type="button" onClick={() => setModal('days')} className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">
                Extend credit days
              </button>
              {credit.creditLimit !== null && (
                <button type="button" onClick={() => setModal('limit')} className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">
                  Add temporary limit
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {isCreditDealer && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Invoices</h2>
              <p className="text-xs text-gray-500">{selectable.length} dispatched order{selectable.length === 1 ? '' : 's'} available for billing</p>
            </div>
            {canManageBills && (
              <button type="button" onClick={openInvoice} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                <Plus className="h-4 w-4" /> Add Invoice
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Due date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">PDF</th>
                  <th className="px-4 py-3 text-right">Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bills.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">No invoices yet.</td></tr>
                )}
                {bills.map((bill) => {
                  const due = dueDate(bill, creditDays)
                  const left = daysUntil(due)
                  const balance = Math.max(0, bill.billAmount - bill.paidAmount)
                  const pdfs = billPdfs(bill)
                  return (
                    <tr key={bill.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-indigo-700">{formatDisplayOrderNumber(bill.orderNumber)}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900">{formatAmount(bill.billAmount)}</div>
                        <div className="text-xs text-gray-500">Paid {formatAmount(bill.paidAmount)}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {formatDate(due)}
                        {(bill.extraCreditDays || 0) > 0 && <div className="text-xs font-medium text-indigo-600">+{bill.extraCreditDays} days extended</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${balance === 0 ? 'bg-emerald-50 text-emerald-700' : left < 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                          {balance === 0 ? 'Paid' : left < 0 ? `${Math.abs(left)} days overdue` : `${left} days left`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {pdfs.length === 0 ? <span className="text-xs text-gray-400">-</span> : pdfs.map((file, index) => (
                          <a
                            key={`${file.url}-${index}`}
                            href={`/api/ledger/${encodeURIComponent(dealerId)}/bill-pdf/download?${new URLSearchParams({ billId: bill.id, index: String(index), mode: 'inline' })}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 text-xs text-gray-700 hover:text-indigo-700"
                          >
                            <FileText className="h-3.5 w-3.5 text-red-500" /> {file.name}
                          </a>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canManageBills && (
                          <button
                            type="button"
                            disabled={balance === 0}
                            onClick={() => {
                              setPaymentBill(bill)
                              setPayment({ amount: String(balance), mode: 'NEFT', date: today(), reference: '' })
                              setModal('payment')
                            }}
                            className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <CreditCard className="h-3.5 w-3.5" /> Record Payment
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal === 'invoice' && (
        <Modal title="Add Invoice" onClose={close}>
          <form onSubmit={submitInvoice} className="space-y-4">
            <div>
              <span className={labelClass}>Dispatched orders</span>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-300">
                {selectable.length === 0 && <div className="px-3 py-4 text-sm text-gray-400">No dispatched orders to bill</div>}
                {selectable.map((order) => {
                  const id = String(order.order_id)
                  return (
                    <label key={id} className="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 hover:bg-gray-50">
                      <input type="checkbox" checked={invoiceOrders.includes(id)} onChange={(event) => toggleOrder(id, event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-indigo-600" />
                      <span className="flex-1 text-gray-900">{formatDisplayOrderNumber(id)}</span>
                      <span className="text-xs font-semibold text-gray-600">{formatAmount(dispatchedOrderAmount(order))}</span>
                    </label>
                  )
                })}
              </div>
            </div>
            <label className="block">
              <span className={labelClass}>Invoice amount <span className="normal-case italic text-gray-400">(GST included)</span></span>
              <input type="number" min="0" step="0.01" value={invoiceAmount} onChange={(event) => setInvoiceAmount(event.target.value)} className={inputClass} required />
            </label>
            <label className="block">
              <span className={labelClass}>Invoice date</span>
              <DateInput value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className={inputClass} />
            </label>
            <label className="block">
              <span className={labelClass}>Invoice PDF</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                multiple
                onChange={(event) => setInvoiceFiles(Array.from(event.target.files || []))}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-indigo-700"
              />
            </label>
            <Actions onCancel={close} busy={busy} label="Save Invoice" />
          </form>
        </Modal>
      )}

      {modal === 'payment' && paymentBill && (
        <Modal title="Record Payment" onClose={close}>
          <form onSubmit={submitPayment} className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Invoice for order {formatDisplayOrderNumber(paymentBill.orderNumber)} · Due {formatAmount(Math.max(0, paymentBill.billAmount - paymentBill.paidAmount))}
            </div>
            <label className="block">
              <span className={labelClass}>Amount</span>
              <input type="number" min="0" step="0.01" value={payment.amount} onChange={(event) => setPayment((prev) => ({ ...prev, amount: event.target.value }))} className={inputClass} required />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className={labelClass}>Mode</span>
                <select value={payment.mode} onChange={(event) => setPayment((prev) => ({ ...prev, mode: event.target.value }))} className={inputClass}>
                  {PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={labelClass}>Date</span>
                <DateInput value={payment.date} onChange={(event) => setPayment((prev) => ({ ...prev, date: event.target.value }))} className={inputClass} />
              </label>
            </div>
            <label className="block">
              <span className={labelClass}>Reference / Notes</span>
              <input value={payment.reference} onChange={(event) => setPayment((prev) => ({ ...prev, reference: event.target.value }))} className={inputClass} />
            </label>
            <Actions onCancel={close} busy={busy} label="Record Payment" tone="emerald" />
          </form>
        </Modal>
      )}

      {(modal === 'days' || modal === 'limit') && (
        <Modal title={modal === 'days' ? 'Extend Credit Days' : 'Add Temporary Credit Limit'} onClose={close}>
          <form onSubmit={submitExtension} className="space-y-4">
            <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              {modal === 'days'
                ? `Adds days to every unpaid invoice only. New invoices go back to the normal ${creditDays}-day terms.`
                : `Extra headroom on top of the ${formatAmount(credit?.creditLimit ?? 0)} limit. Once orders use it up, the limit goes back to ${formatAmount(credit?.creditLimit ?? 0)}.`}
            </p>
            <label className="block">
              <span className={labelClass}>{modal === 'days' ? 'Extra days' : 'Extra amount'}</span>
              <input type="number" min="1" step={modal === 'days' ? '1' : '0.01'} value={extendValue} onChange={(event) => setExtendValue(event.target.value)} className={inputClass} required />
            </label>
            <label className="block">
              <span className={labelClass}>Reason (optional)</span>
              <input value={extendNote} onChange={(event) => setExtendNote(event.target.value)} className={inputClass} />
            </label>
            <Actions onCancel={close} busy={busy} label={modal === 'days' ? 'Extend Days' : 'Add Limit'} />
          </form>
        </Modal>
      )}
    </>
  )
}
