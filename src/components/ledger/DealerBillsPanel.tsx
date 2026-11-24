'use client'

import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { CreditCard, FileText, Loader2, Pencil, Plus, X } from 'lucide-react'
import DateInput from '@/components/ui/date-input'
import { showToast } from '@/components/ui/toast'
import type { DispatchTrackingOrder } from '@/lib/dispatchTracking'
import { displayOrderNumber, formatDisplayOrderNumber } from '@/lib/orderDisplay'

export type InvoicePrefill = {
  orderId: string
  amount: number
  shipmentIds: string[]
  shipmentLabel: string
}

export type LedgerBill = {
  id: string
  dealerId: string
  /** The orders as stored on the bill (legacy or row ids): the matching key, never shown. */
  orderNumber: string
  /** The same orders by their numbers, for display. */
  orderLabel?: string
  billNumber?: string
  billAmount: number
  gstPercent: number
  billDate: string
  pdfName: string
  pdfUrl?: string
  pdfFiles?: Array<{ name: string; url: string; bytes?: number }>
  paidAmount: number
  debitNote?: number
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

// 'Credit Note' settles the bill without money changing hands (discount,
// rate difference, return...); the dealer sees it as a debit note.
const PAYMENT_MODES = ['Cash', 'Cheque', 'NEFT', 'UPI', 'IMPF', 'Credit Note']
const today = () => new Date().toISOString().slice(0, 10)
const inputClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500'
const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500'
const fileInputClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brand-600'

export const INVOICE_GST_PERCENT = 18

type TrackingOrder = Pick<DispatchTrackingOrder, 'orderId' | 'orderNumber' | 'orderDate' | 'shipments'>

/**
 * What Add Invoice offers: Dispatch Tracking's To Bill parcels with its own amounts
 * (before GST), so both screens always list the same thing. A parcel with a bill is
 * already invoiced; the id-less group is goods that left without a parcel, which can't
 * be billed. Saving links the ticked parcels to the new bill, which takes them off both.
 */
export function billableShipments(orders: TrackingOrder[]) {
  return orders.flatMap((order) => order.shipments
    .filter((shipment) => shipment.id && !shipment.bill)
    .map((shipment) => ({
      id: shipment.id,
      // Worded like Dispatch Tracking's own rows: "BlueDart · 53691021370".
      label: [shipment.dispatchPartner, shipment.trackingNumber].filter(Boolean).join(' · ') || 'Shipment',
      amount: shipment.value,
      createdAt: shipment.createdAt,
      orderId: order.orderId,
      orderLabel: displayOrderNumber({ order_number: order.orderNumber, order_id: order.orderId, order_date: order.orderDate }),
    })))
}

export type BillableShipment = ReturnType<typeof billableShipments>[number]

/** A dealer's parcels still to bill, straight from Dispatch Tracking (Accountant only, like saving a bill). */
export async function loadBillableShipments(dealerId: string) {
  const params = new URLSearchParams({ tab: 'to_bill', status: 'all', dealerId, report: '1' })
  const response = await axios.get(`/api/dispatch-tracking?${params.toString()}`)
  return billableShipments(response.data?.data?.orders ?? [])
}

/** Shipment values are before GST; the invoice amount includes it. */
export function invoiceAmountFor(shipments: Array<{ amount: number }>) {
  const total = shipments.reduce((sum, shipment) => sum + shipment.amount, 0) * (1 + INVOICE_GST_PERCENT / 100)
  return Math.round(total * 100) / 100
}

/** The rows of the "Shipments to bill" picker, shared by both invoice forms. */
export function ShipmentPicker({ shipments, selected, onToggle }: {
  shipments: BillableShipment[]
  selected: string[]
  onToggle: (shipmentId: string, checked: boolean) => void
}) {
  if (shipments.length === 0) return <div className="px-3 py-4 text-sm text-gray-400">No shipments to bill</div>
  return (
    <>
      {shipments.map((shipment) => (
        <label key={shipment.id} className="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 hover:bg-gray-50">
          <input type="checkbox" checked={selected.includes(shipment.id)} onChange={(event) => onToggle(shipment.id, event.target.checked)} className="h-4 w-4 rounded border-gray-300 text-brand-600" />
          <span className="min-w-0 flex-1">
            <span className="block text-gray-900">{shipment.orderLabel}</span>
            <span className="block truncate text-xs text-gray-500">
              {shipment.label}{shipment.createdAt ? ` · ${formatDate(new Date(shipment.createdAt))}` : ''}
            </span>
          </span>
          <span className="text-xs font-semibold text-gray-600">{formatAmount(shipment.amount)}</span>
        </label>
      ))}
    </>
  )
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

function billOrders(bill: Pick<LedgerBill, 'orderNumber' | 'orderLabel'>) {
  return bill.orderLabel || formatDisplayOrderNumber(bill.orderNumber)
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
        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${tone === 'emerald' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-brand-600 hover:bg-brand-500'}`}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {label}
      </button>
    </div>
  )
}

/**
 * The accountant's correction of a saved bill (amount, number, date, GST, PDFs),
 * used here and on the Dealer Ledger list. `creditDays` is null for advance
 * dealers, who have no due date to warn about.
 */
export function EditBillModal({ dealerId, bill, creditDays, onClose, onSaved }: {
  dealerId: string
  bill: LedgerBill
  creditDays: number | null
  onClose: () => void
  onSaved: (bill: LedgerBill) => void
}) {
  const [form, setForm] = useState({
    amount: String(bill.billAmount),
    billNumber: bill.billNumber || '',
    date: bill.billDate,
    gst: String(bill.gstPercent ?? 0),
    reason: '',
  })
  const [keepUrls, setKeepUrls] = useState(() => billPdfs(bill).map((file) => file.url))
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((prev) => ({ ...prev, [key]: event.target.value }))

  const due = creditDays === null || !form.date ? null : dueDate({ ...bill, billDate: form.date }, creditDays)
  const willBeOverdue = due !== null && Number(form.amount) > bill.paidAmount && daysUntil(due) < 0

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      let newPdfFiles: unknown[] = []
      if (files.length > 0) {
        const upload = new FormData()
        files.forEach((file) => upload.append('files', file))
        newPdfFiles = (await axios.post(`/api/ledger/${encodeURIComponent(dealerId)}/bill-pdf`, upload)).data?.files || []
      }
      const response = await axios.patch(`/api/ledger/${encodeURIComponent(dealerId)}`, {
        billId: bill.id,
        billAmount: Number(form.amount),
        gstPercent: Number(form.gst),
        billDate: form.date,
        billNumber: form.billNumber.trim(),
        keepPdfUrls: keepUrls,
        newPdfFiles,
        reason: form.reason.trim(),
      })
      showToast('success', response.data?.changed ? 'Invoice updated' : 'Nothing to change')
      onSaved(response.data.bill)
    } catch (error) {
      showToast('error', axios.isAxiosError(error) ? error.response?.data?.message || 'Could not update invoice' : 'Could not update invoice')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Edit Invoice" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Invoice for order {billOrders(bill)}
          {bill.paidAmount > 0 && ` · ${formatAmount(bill.paidAmount)} already paid, so the amount can't go below that`}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className={labelClass}>Invoice amount <span className="normal-case italic text-gray-400">(GST incl.)</span></span>
            <input type="number" min={bill.paidAmount > 0 ? bill.paidAmount : 0.01} step="0.01" value={form.amount} onChange={set('amount')} className={inputClass} required />
          </label>
          <label className="block">
            <span className={labelClass}>GST %</span>
            <input type="number" min="0" step="0.01" value={form.gst} onChange={set('gst')} className={inputClass} required />
          </label>
          <label className="block">
            <span className={labelClass}>Invoice no. <span className="normal-case italic text-gray-400">(optional)</span></span>
            <input value={form.billNumber} onChange={set('billNumber')} maxLength={60} className={inputClass} />
          </label>
          <label className="block">
            <span className={labelClass}>Invoice date</span>
            <DateInput value={form.date} onChange={set('date')} className={inputClass} required />
          </label>
        </div>
        {due && (
          <p className={`rounded-lg border px-3 py-2 text-xs ${willBeOverdue ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
            Due {formatDate(due)}
            {willBeOverdue && ' · This bill will be overdue, and the dealer won\'t be able to place orders until it\'s paid.'}
          </p>
        )}
        <div>
          <span className={labelClass}>Invoice PDF</span>
          {billPdfs(bill).filter((file) => keepUrls.includes(file.url)).map((file) => (
            <div key={file.url} className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700">
              <span className="flex min-w-0 items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 shrink-0 text-red-500" />
                <span className="truncate">{file.name}</span>
              </span>
              <button
                type="button"
                onClick={() => setKeepUrls((prev) => prev.filter((url) => url !== file.url))}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                aria-label={`Remove ${file.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <input type="file" accept="application/pdf,.pdf" multiple onChange={(event) => setFiles(Array.from(event.target.files || []))} className={fileInputClass} />
        </div>
        <label className="block">
          <span className={labelClass}>Reason for change</span>
          <input value={form.reason} onChange={set('reason')} maxLength={500} className={inputClass} required />
        </label>
        <Actions onCancel={onClose} busy={busy} label="Save Changes" />
      </form>
    </Modal>
  )
}

export default function DealerBillsPanel({
  dealerId,
  bills,
  credit,
  canManageBills,
  canExtendCredit,
  onChanged,
  prefill = null,
  onInvoiceSaved,
}: {
  dealerId: string
  bills: LedgerBill[]
  credit: CreditSnapshot
  canManageBills: boolean
  canExtendCredit: boolean
  onChanged: () => Promise<unknown> | void
  /** Dispatch Tracking's "Bill shipment": opens the invoice form for that shipment. */
  prefill?: InvoicePrefill | null
  /** Fires after an invoice that covers a prefilled shipment is saved. */
  onInvoiceSaved?: () => void
}) {
  const [modal, setModal] = useState<null | 'invoice' | 'payment' | 'days' | 'limit'>(null)
  const [busy, setBusy] = useState(false)
  const [invoiceShipmentIds, setInvoiceShipmentIds] = useState<string[]>([])
  const [invoiceAmount, setInvoiceAmount] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([])
  const [invoiceBillNumber, setInvoiceBillNumber] = useState('')
  // Set when Dispatch Tracking's "Bill shipment" opened the form.
  const [invoiceShipment, setInvoiceShipment] = useState<{ orderId: string; label: string } | null>(null)
  const prefillApplied = useRef(false)
  const [paymentBill, setPaymentBill] = useState<LedgerBill | null>(null)
  const [editBill, setEditBill] = useState<LedgerBill | null>(null)
  const [payment, setPayment] = useState({ amount: '', mode: 'NEFT', date: today(), reference: '' })
  const [extendValue, setExtendValue] = useState('')
  const [extendNote, setExtendNote] = useState('')

  const creditDays = credit?.creditDays ?? 0
  const isCreditDealer = credit !== null
  const limitReached = credit?.remaining !== null && credit?.remaining !== undefined && credit.remaining <= 0
  const [selectable, setSelectable] = useState<BillableShipment[]>([])
  const [shipmentsLoading, setShipmentsLoading] = useState(false)

  const refreshShipments = useCallback(async () => {
    if (!canManageBills) return
    setShipmentsLoading(true)
    try {
      setSelectable(await loadBillableShipments(dealerId))
    } catch {
      showToast('error', 'Could not load shipments to bill')
    } finally {
      setShipmentsLoading(false)
    }
  }, [canManageBills, dealerId])

  useEffect(() => {
    void refreshShipments()
  }, [refreshShipments])

  const close = () => {
    setModal(null)
    setPaymentBill(null)
    setExtendValue('')
    setExtendNote('')
  }

  const openInvoice = () => {
    setInvoiceShipmentIds([])
    setInvoiceAmount('')
    setInvoiceDate(today())
    setInvoiceFiles([])
    setInvoiceBillNumber('')
    setInvoiceShipment(null)
    setModal('invoice')
    void refreshShipments()
  }

  // Applied once: canManageBills only turns true after the viewer's role loads.
  useEffect(() => {
    if (!prefill || !canManageBills || prefillApplied.current) return
    prefillApplied.current = true
    setInvoiceShipmentIds(prefill.shipmentIds)
    setInvoiceAmount(prefill.amount > 0 ? String(invoiceAmountFor([prefill])) : '')
    setInvoiceDate(today())
    setInvoiceFiles([])
    setInvoiceBillNumber('')
    setInvoiceShipment({ orderId: prefill.orderId, label: prefill.shipmentLabel })
    setModal('invoice')
  }, [prefill, canManageBills])

  const toggleShipment = (shipmentId: string, checked: boolean) => {
    const next = checked ? [...invoiceShipmentIds, shipmentId] : invoiceShipmentIds.filter((id) => id !== shipmentId)
    setInvoiceShipmentIds(next)
    const picked = selectable.filter((shipment) => next.includes(shipment.id))
    setInvoiceAmount(picked.length > 0 ? String(invoiceAmountFor(picked)) : '')
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
    // The orders the ticked shipments belong to; the server refuses a shipment that isn't on them.
    const orderNumbers = Array.from(new Set([
      ...selectable.filter((shipment) => invoiceShipmentIds.includes(shipment.id)).map((shipment) => shipment.orderId),
      // The prefilled order counts only while its shipment is still ticked.
      ...(invoiceShipment && prefill?.shipmentIds.some((id) => invoiceShipmentIds.includes(id)) ? [invoiceShipment.orderId] : []),
    ]))
    if (invoiceShipmentIds.length === 0 || !(amount > 0) || !invoiceDate) {
      showToast('error', 'Select shipments, amount and date')
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
        orderNumbers,
        billAmount: amount,
        gstPercent: INVOICE_GST_PERCENT,
        billDate: invoiceDate,
        billNumber: invoiceBillNumber.trim(),
        shipmentIds: invoiceShipmentIds,
        pdfNames: invoiceFiles.map((file) => file.name),
        pdfFiles,
      })
      showToast('success', invoiceShipmentIds.length === 1 ? 'Invoice saved and shipment billed' : 'Invoice saved and shipments billed')
      void refreshShipments()
      if (invoiceShipment) onInvoiceSaved?.()
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
    const creditNote = payment.mode === 'Credit Note'
    const note = payment.reference.trim()
    if (creditNote && !note) {
      showToast('error', 'Enter the reason for the credit note')
      return
    }
    run(async () => {
      await axios.post(`/api/ledger/${encodeURIComponent(dealerId)}/pay`, {
        idempotencyKey: crypto.randomUUID(),
        billId: paymentBill.id,
        amount,
        paymentMode: payment.mode,
        paymentDate: payment.date,
        referenceId: (!creditNote && note) || paymentBill.orderNumber,
        narration: creditNote ? `${note} (bill ${billOrders(paymentBill)})` : `Payment against bill ${billOrders(paymentBill)}`,
      })
      showToast('success', creditNote ? 'Credit note recorded' : 'Payment recorded')
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
                  {credit.tempCreditLimit > 0 && <span className="ml-1 text-xs font-medium text-brand-600">+ {formatAmount(credit.tempCreditLimit)} temp</span>}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Outstanding</p>
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
              <button type="button" onClick={() => setModal('days')} className="rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-50">
                Extend credit days
              </button>
              {credit.creditLimit !== null && (
                <button type="button" onClick={() => setModal('limit')} className="rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-50">
                  Add temporary limit
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Also shown to advance dealers with orders or bills from a time on credit, so those get invoiced and paid off. */}
      {(isCreditDealer || bills.length > 0 || selectable.length > 0) && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Invoices</h2>
              {canManageBills && <p className="text-xs text-gray-500">{selectable.length} shipment{selectable.length === 1 ? '' : 's'} to bill</p>}
            </div>
            {canManageBills && (
              <button type="button" onClick={openInvoice} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-500">
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
                  <th className="px-4 py-3">Billed date</th>
                  <th className="px-4 py-3">Due date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">PDF</th>
                  <th className="px-4 py-3 text-right">Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bills.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">No invoices yet.</td></tr>
                )}
                {bills.map((bill) => {
                  const due = dueDate(bill, creditDays)
                  const left = daysUntil(due)
                  const balance = Math.max(0, bill.billAmount - bill.paidAmount)
                  const pdfs = billPdfs(bill)
                  return (
                    <tr key={bill.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-brand-600">{billOrders(bill)}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900">{formatAmount(bill.billAmount)}</div>
                        {bill.billNumber && <div className="font-mono text-xs text-gray-700">#{bill.billNumber}</div>}
                        <div className="text-xs text-gray-500">Paid {formatAmount(bill.paidAmount)}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(new Date(`${bill.billDate}T00:00:00`))}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {isCreditDealer ? formatDate(due) : '-'}
                        {(bill.extraCreditDays || 0) > 0 && <div className="text-xs font-medium text-brand-600">+{bill.extraCreditDays} days extended</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${balance === 0 ? 'bg-emerald-50 text-emerald-700' : left < 0 || !isCreditDealer ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                          {balance === 0 ? 'Paid' : !isCreditDealer ? 'Unpaid' : left < 0 ? `${Math.abs(left)} days overdue` : `${left} days left`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {pdfs.length === 0 ? <span className="text-xs text-gray-400">-</span> : pdfs.map((file, index) => (
                          <a
                            key={`${file.url}-${index}`}
                            href={`/api/ledger/${encodeURIComponent(dealerId)}/bill-pdf/download?${new URLSearchParams({ billId: bill.id, index: String(index), mode: 'inline' })}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 text-xs text-gray-700 hover:text-brand-500"
                          >
                            <FileText className="h-3.5 w-3.5 text-red-500" /> {file.name}
                          </a>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canManageBills && (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditBill(bill)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </button>
                            <button
                              type="button"
                              disabled={balance === 0}
                              onClick={() => {
                                setPaymentBill(bill)
                                setPayment({ amount: String(balance), mode: 'NEFT', date: today(), reference: '' })
                                setModal('payment')
                              }}
                              className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <CreditCard className="h-3.5 w-3.5" /> Add Payment
                            </button>
                          </div>
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
            {invoiceShipment && (
              <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800">
                Covers shipment <span className="font-semibold">{invoiceShipment.label}</span> of order {selectable.find((shipment) => shipment.orderId === invoiceShipment.orderId)?.orderLabel ?? formatDisplayOrderNumber(invoiceShipment.orderId)}.
                Saving moves it to Billed Shipments.
              </div>
            )}
            <div>
              <span className={labelClass}>Shipments to bill</span>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-300">
                {shipmentsLoading && selectable.length === 0
                  ? <div className="px-3 py-4 text-sm text-gray-400">Loading shipments…</div>
                  : <ShipmentPicker shipments={selectable} selected={invoiceShipmentIds} onToggle={toggleShipment} />}
              </div>
              <p className="mt-1 text-xs text-gray-500">Shipment values are before GST; the amount below adds {INVOICE_GST_PERCENT}%.</p>
            </div>
            <label className="block">
              <span className={labelClass}>Invoice amount <span className="normal-case italic text-gray-400">(GST included)</span></span>
              <input type="number" min="0" step="0.01" value={invoiceAmount} onChange={(event) => setInvoiceAmount(event.target.value)} className={inputClass} required />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className={labelClass}>Invoice no. <span className="normal-case italic text-gray-400">(optional)</span></span>
                <input value={invoiceBillNumber} onChange={(event) => setInvoiceBillNumber(event.target.value)} maxLength={60} className={inputClass} />
              </label>
              <label className="block">
                <span className={labelClass}>Invoice date</span>
                <DateInput value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className={inputClass} />
              </label>
            </div>
            <label className="block">
              <span className={labelClass}>Invoice PDF</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                multiple
                onChange={(event) => setInvoiceFiles(Array.from(event.target.files || []))}
                className={fileInputClass}
              />
            </label>
            <Actions onCancel={close} busy={busy} label="Save Invoice" />
          </form>
        </Modal>
      )}

      {editBill && (
        <EditBillModal
          dealerId={dealerId}
          bill={editBill}
          creditDays={creditDays}
          onClose={() => setEditBill(null)}
          onSaved={() => {
            setEditBill(null)
            void onChanged()
          }}
        />
      )}

      {modal === 'payment' && paymentBill && (
        <Modal title="add Payment" onClose={close}>
          <form onSubmit={submitPayment} className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Invoice for order {billOrders(paymentBill)} · Due {formatAmount(Math.max(0, paymentBill.billAmount - paymentBill.paidAmount))}
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
              <span className={labelClass}>{payment.mode === 'Credit Note' ? 'Credit note reason' : 'Reference / Notes'}</span>
              <input value={payment.reference} onChange={(event) => setPayment((prev) => ({ ...prev, reference: event.target.value }))} className={inputClass} required={payment.mode === 'Credit Note'} />
            </label>
            <Actions onCancel={close} busy={busy} label="add Payment" tone="emerald" />
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
