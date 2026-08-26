/* eslint-disable react-hooks/set-state-in-effect */
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import { formatAdditionalDiscountBadge, getCompactOrderDiscountRows, withDisplayOrderAmounts } from '@/lib/orderAmounts'
import { formatDisplayOrderNumber } from '@/lib/orderDisplay';
import { STAFF_ORDER_SCOPE_VERSION } from '@/lib/staffOrderScope.js'
import {
  buildCustomDiscountProgressMap,
  getCustomDiscountProgressKeyForOrder,
  type CustomDiscountProgress,
} from '@/lib/customDiscountProgress'

type Role = 'admin' | 'dealer' | 'staff' | 'accountant'
type UserSession = { role: Role; id: string; name: string; roletype?: string; viewRoute: string }
type OrderData = {
  order_id: string; order_date: string; orderDate: string; order_dealer: string
  order_amount: string; order_status: string; order_discount: string; del_status: string
  reason: string; accept_order: string; outstandingDate: string; Dealer_Name: string
  orderdata_item_quantity: string; readyquantity: string; mtstatus: string
  orderdata_datetime: string; staffid: string
  rsmApprovalStatus?: string
  rsm_approval_status?: string
  rsmReviewedBy?: string
  rsm_reviewed_by?: string
}
type DispatchOrderProduct = {
  orderdata_id: string
  orderdata_orderid: string
  orderdata_cat_no: string
  orderdata_item_quantity: string
  orderdata_status: string
  readyquantity: string
  product_name?: string
  product_discription?: string
  remark?: string
  remarks?: string
}
type DispatchRemark = {
  remark?: string
  readyquantity?: string
  status?: string
  datetime?: string
}
type OrderResponse = { data: OrderData[]; total?: number; count?: number; last_page?: number }
type OrderSummaryOverride = {
  orderId?: string | number
  order_id?: string | number
  grossAmount?: number | string
  discountAmount?: number | string
  netPayableAmount?: number | string
  gross_amount?: number | string
  discount_amount?: number | string
  net_payable_amount?: number | string
  order_amount?: number | string
  order_discount?: number | string
  order_discount_amount?: number | string
  order_net_amount?: number | string
  baseDiscountAmount?: number | string
  baseDiscountPercent?: number | string
  postBaseAmount?: number | string
  amountBeforeSlab?: number | string
  additionalDiscountType?: string | null
  additionalDiscountAmount?: number | string
  customDiscountAmount?: number | string
  customDiscountPercent?: number | string
  approvedDiscountAmount?: number | string
  approvedDiscountPercent?: number | string
  slabDiscountAmount?: number | string
  slabDiscountPercent?: number | string
  allocatedDiscountPercent?: number | string
  couponDiscountPercent?: number | string
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
type CancelledOrderOverlay = {
  orderId: string
  formattedOrderNumber?: string
  dealerId: string
  dealerName?: string
  assignedStaffId?: string | null
  cancellation?: {
    reason?: string
    cancelledAt?: string
    cancelledBy?: { id?: string; role?: string; name?: string }
  }
  originalOrderRef?: Record<string, unknown>
}

const ITEMS_PER_PAGE = 10
const YEAR           = new Date().getFullYear()

const ROLE_CONFIG: Record<Role, {
  label: string; pillCls: string; caption: string
  endpoint: (id: string, page: number, search: string) => string
  showDealerCol: boolean; showActions: boolean
  canDelete: (s: UserSession, row: OrderData) => boolean
  canAccept: (s: UserSession, row: OrderData) => boolean
  requireReason: boolean
}> = {
  admin: {
    label: 'Admin', pillCls: 'role-admin', caption: 'All dealer orders across the system',
    endpoint: (_id, page, search) =>
      `/api/orders-data?page=${page}&limit=${ITEMS_PER_PAGE}&search=${encodeURIComponent(search)}`,
    showDealerCol: true, showActions: true,
    canDelete: (_s, row) => row.accept_order === '0' && row.del_status === '0',
    canAccept: (_s, row) => row.del_status === '0',
    requireReason: true,
  },
  dealer: {
    label: 'Dealer', pillCls: 'role-dealer', caption: 'Your order history',
    endpoint: (id, page, search) =>
      `/api/orders-data?page=${page}&limit=${ITEMS_PER_PAGE}&search=${encodeURIComponent(search)}`,
    showDealerCol: false, showActions: true,
    canDelete: (_s, row) => row.accept_order === '0' && row.del_status === '0',
    canAccept: () => false,
    requireReason: true,
  },
  staff: {
    label: 'Staff', pillCls: 'role-staff', caption: 'Orders assigned to you',
    endpoint: (id, page, search) =>
      `/api/orders-data?page=${page}&limit=${ITEMS_PER_PAGE}&search=${encodeURIComponent(search)}`,
    showDealerCol: true, showActions: true,
    canDelete: () => false,
    canAccept: (s, row) => s.roletype !== '2' && row.del_status === '0',
    requireReason: false,
  },
  accountant: {
    label: 'Accountant', pillCls: 'role-accountant', caption: 'All dealer orders across the system',
    endpoint: (_id, page, search) =>
      `/api/orders-data?page=${page}&limit=${ITEMS_PER_PAGE}&search=${encodeURIComponent(search)}`,
    showDealerCol: true, showActions: false,
    canDelete: () => false,
    canAccept: () => false,
    requireReason: false,
  },
}

function resolveSession(): UserSession | null {
  if (typeof window === 'undefined') return null
  try {
    const staffRaw = localStorage.getItem('staffData')
    if (staffRaw) {
      const p = JSON.parse(staffRaw)
      if (p?.staff_id) {
        return {
          role: p.staff_roletype === '0' ? 'admin' : 'staff',
          id: p.staff_id, name: p.staff_name || '',
          roletype: p.staff_roletype, viewRoute: '/orders',
        }
      }
    }
    const userRaw = localStorage.getItem('UserData')
    if (userRaw) {
      const p = JSON.parse(userRaw)
      if (p?.Dealer_Id) return { role: 'dealer', id: p.Dealer_Id, name: p.Dealer_Name || '', viewRoute: '/orders' }
      if (p?.staff_id)  return { role: p.staff_roletype === '0' ? 'admin' : 'staff', id: p.staff_id, name: p.staff_name || '', roletype: p.staff_roletype, viewRoute: '/orders' }
      if (p?.role === 'accountant' || p?.accountant_id)
        return { role: 'accountant', id: p.accountant_id || p._id || '', name: p.name || p.email || 'Accountant', roletype: '4', viewRoute: '/orders' }
      if (localStorage.getItem('roletype') === '3' && p && Object.keys(p).length > 0)
        return { role: 'admin', id: p.id || p.admin_id || p.Admin_Id || '', name: p.name || p.email || 'Admin', roletype: '0', viewRoute: '/orders' }
    }
    const adminRaw = localStorage.getItem('AdminData') || localStorage.getItem('admin')
    if (adminRaw) {
      const p = JSON.parse(adminRaw)
      if (p && Object.keys(p).length > 0)
        return { role: 'admin', id: p.id || p.admin_id || p.Admin_Id || '', name: p.name || 'Admin', roletype: '0', viewRoute: '/orders' }
    }
    const accountantRaw = localStorage.getItem('AccountantData')
    if (accountantRaw) {
      const p = JSON.parse(accountantRaw)
      if (p && Object.keys(p).length > 0)
        return { role: 'accountant', id: p.accountant_id || p._id || '', name: p.name || p.email || 'Accountant', roletype: '4', viewRoute: '/orders' }
    }
  } catch {}
  return null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function acceptBadge(a: string) {
  return a === '1'
    ? { cls: 'badge-accepted', label: 'Accepted', dot: '#1d4ed8' }
    : { cls: 'badge-awaiting', label: 'Awaiting',  dot: '#f59e0b' }
}

function rsmApprovalValue(order: OrderData) {
  return String(order.rsmApprovalStatus || order.rsm_approval_status || '').toUpperCase()
}

function mtStatusValue(s: string) {
  const key = (s || '').trim().toLowerCase().replace(/[\s_-]/g, '')
  if (key === 'pending') return 'Pending'
  if (key === 'inprocess') return 'InProcess'
  if (key === 'completed') return 'Completed'
  return 'NoActionTaken'
}

function mtBadge(s: string) {
  const value = mtStatusValue(s)
  if (value === 'Completed') return { value, cls: 'badge-approved',  dot: '#10b981', label: 'Completed' }
  if (value === 'InProcess') return { value, cls: 'badge-inprocess', dot: '#ef4444', label: 'In Process' }
  if (value === 'Pending') return { value, cls: 'badge-pending', dot: '#f59e0b', label: 'Pending' }
  return { value, cls: 'badge-noaction', dot: '#94a3b8', label: 'No Action Taken' }
}

function safeNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function dispatchStatusOptionLabel(status: string) {
  switch (String(status || '').trim()) {
    case '1': return 'Packing'
    case '2': return 'Dispatched'
    case '3': return 'Not in Stock'
    case '4': return 'Successful'
    default: return 'Unknown'
  }
}

function getDispatchLeftQuantity(item: DispatchOrderProduct): number {
  return Math.max(0, safeNumber(item.orderdata_item_quantity) - safeNumber(item.readyquantity))
}

function getOriginalProductRemarks(item: DispatchOrderProduct): string {
  return [item.remark, item.remarks].filter(Boolean).join(' | ')
}

function dispatchProductFromRecord(record: Record<string, unknown>): DispatchOrderProduct {
  const orderedQuantity = String(record.orderedQuantity ?? record.orderdata_item_quantity ?? '0')
  const dispatchedQuantity = String(record.dispatchedQuantity ?? record.readyquantity ?? '0')
  const updates = Array.isArray(record.updates) ? record.updates as Array<Record<string, unknown>> : []
  const latestUpdate = updates[updates.length - 1] ?? {}
  return {
    orderdata_id: String(record.orderItemId ?? record.orderdata_id ?? record.id ?? ''),
    orderdata_orderid: String(record.orderId ?? record.orderdata_orderid ?? ''),
    orderdata_cat_no: String(record.sku ?? record.orderdata_cat_no ?? ''),
    orderdata_item_quantity: orderedQuantity,
    orderdata_status: String(record.currentStatus ?? record.orderdata_status ?? ''),
    readyquantity: dispatchedQuantity,
    product_name: String(record.productName ?? record.product_name ?? record.sku ?? record.orderdata_cat_no ?? ''),
    product_discription: String(record.productDescription ?? record.product_discription ?? ''),
    remark: String(latestUpdate.remark ?? record.remark ?? ''),
    remarks: String(record.remarks ?? ''),
  }
}

function dispatchHistoryFromRecord(record: Record<string, unknown> | null): DispatchRemark[] {
  const updates = Array.isArray(record?.updates) ? record.updates as Array<Record<string, unknown>> : []
  return updates.slice().reverse().map((update) => ({
    remark: String(update.remark ?? ''),
    readyquantity: String(update.quantity ?? ''),
    status: String(update.status ?? ''),
    datetime: String(update.createdAt ?? ''),
  }))
}

function dispatchStatusForApi(status: string) {
  switch (String(status || '').trim()) {
    case '1': return 'dispatched'
    case '2': return 'dispatched'
    case '3': return 'not_in_stock'
    case '4': return 'successful'
    default: return status
  }
}

function customDiscountBadge(progress: CustomDiscountProgress) {
  if (progress === 'completely') {
    return { cls: 'badge-approved', dot: '#10b981', label: 'Completely' }
  }
  if (progress === 'partially') {
    return { cls: 'badge-pending', dot: '#f59e0b', label: 'Partially' }
  }
  return null
}

function formatOrderListMoney(amount: number, minimumFractionDigits = 0) {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits, maximumFractionDigits: 2 })}`
}

function resolveAdditionalDiscountDisplay(amounts: {
  additionalDiscountType?: string | null
  customDiscountAmount?: number
  slabDiscountAmount?: number
  slabDiscountPercent?: number
}) {
  if (amounts.additionalDiscountType === 'custom' && safeNumber(amounts.customDiscountAmount) > 0) {
    return {
      label: 'Custom',
      amountText: formatOrderListMoney(safeNumber(amounts.customDiscountAmount), 2),
    }
  }

  if (amounts.additionalDiscountType === 'slab' && safeNumber(amounts.slabDiscountAmount) > 0) {
    const slabPercent = safeNumber(amounts.slabDiscountPercent)
    return {
      label: slabPercent > 0 ? `Slab ${slabPercent}%` : 'Slab',
      amountText: formatOrderListMoney(safeNumber(amounts.slabDiscountAmount), 2),
    }
  }

  return null
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
    (item as Record<string, unknown>).orderNumber,
    (item as Record<string, unknown>).order_number,
  ]
  ids.forEach((id) => {
    const raw = String(id ?? '').trim()
    const normalized = orderLookupKey(id)
    if (raw) target[raw] = item
    if (normalized) target[normalized] = item
  })
}

function highlight(text: string, query: string) {
  if (!query || !text) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    text.slice(0, idx) +
    `<mark class="hl">${text.slice(idx, idx + query.length)}</mark>` +
    text.slice(idx + query.length)
  )
}

// ─── FilterTag ────────────────────────────────────────────────────────────────
function FilterTag({ label, color, bg, onRemove }: {
  label: string; color: string; bg: string; onRemove: () => void
}) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 8px 3px 10px', borderRadius: 20, background: bg,
      color, fontSize: 11, fontWeight: 500,
    }}>
      {label}
      <button onClick={onRemove} style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        lineHeight: 1, display: 'flex', alignItems: 'center', color, opacity: 0.7,
      }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </span>
  )
}

// ─── ActionMenu ───────────────────────────────────────────────────────────────
function ActionMenu({
  showDelete,
  showAccept,
  showDispatch,
  dispatchDisabled,
  acceptOrder,
  rsmMode,
  onView,
  onDispatch,
  onAccept,
  onDecline,
  onDelete,
}: {
  showDelete: boolean; showAccept: boolean; showDispatch?: boolean; dispatchDisabled?: boolean; acceptOrder: string
  rsmMode?: boolean
  onView: () => void; onDispatch?: () => void; onAccept: () => void; onDecline: () => void; onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const MENU_WIDTH = 176

  const place = useCallback(() => {
    const btn = btnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const menuH = menuRef.current?.offsetHeight ?? 220
    const below = window.innerHeight - r.bottom
    // flip above the button when there isn't room below
    const top = below < menuH + 16 && r.top > menuH + 16 ? r.top - menuH - 8 : r.bottom + 8
    const left = Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
    setPos({ top, left })
  }, [])

  useEffect(() => {
    if (!open) { setPos(null); return }
    place()
    const h = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  const close = (fn: () => void) => () => { fn(); setOpen(false) }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={ref}>
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        aria-label="Actions"
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 3, width: 32, height: 32, borderRadius: 8,
          border: `1px solid ${open ? '#c7d2fe' : '#e2e8f0'}`,
          background: open ? '#eef2ff' : '#f8fafc',
          cursor: 'pointer', transition: 'all 0.15s',
        }}
      >
        {[0, 1, 2].map(i => (
          <span key={i} style={{ width: 3.5, height: 3.5, borderRadius: '50%', background: open ? '#6366f1' : '#94a3b8', display: 'block', transition: 'background 0.15s' }} />
        ))}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div ref={menuRef} style={{
          position: 'fixed',
          top: pos?.top ?? -9999,
          left: pos?.left ?? -9999,
          visibility: pos ? 'visible' : 'hidden',
          zIndex: 10000,
          minWidth: MENU_WIDTH,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)',
          padding: '6px',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          <button
            onClick={close(onView)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              width: '100%', padding: '9px 12px',
              borderRadius: 8, border: 'none',
              background: 'transparent', cursor: 'pointer',
              fontSize: 12.5, fontWeight: 500, color: '#374151',
              fontFamily: 'inherit', textAlign: 'left',
              transition: 'background 0.12s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{
              width: 28, height: 28, borderRadius: 7,
              background: '#f1f5f9', border: '1px solid #e2e8f0',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
              </svg>
            </span>
            <span>
              <div style={{ lineHeight: 1.2 }}>View Details</div>
              <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>Open order page</div>
            </span>
          </button>

          {showDispatch && (
            <button
              onClick={dispatchDisabled || !onDispatch ? undefined : close(onDispatch)}
              disabled={dispatchDisabled || !onDispatch}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '9px 12px',
                borderRadius: 8, border: 'none',
                background: 'transparent',
                cursor: dispatchDisabled ? 'not-allowed' : 'pointer',
                fontSize: 12.5, fontWeight: 500,
                color: dispatchDisabled ? '#9ca3af' : '#4338ca',
                fontFamily: 'inherit', textAlign: 'left',
                transition: 'background 0.12s',
                opacity: dispatchDisabled ? 0.8 : 1,
              }}
              onMouseEnter={e => { if (!dispatchDisabled) e.currentTarget.style.background = '#eef2ff' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{
                width: 28, height: 28, borderRadius: 7,
                background: dispatchDisabled ? '#f8fafc' : '#eef2ff',
                border: `1px solid ${dispatchDisabled ? '#e5e7eb' : '#c7d2fe'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={dispatchDisabled ? '#9ca3af' : '#4338ca'} strokeWidth="2" strokeLinecap="round">
                  <path d="M9 12h6M12 9v6" />
                  <path d="M4 7h16M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
                </svg>
              </span>
              <span>
                <div style={{ lineHeight: 1.2 }}>Dispatch Details</div>
                <div style={{ fontSize: 10.5, color: dispatchDisabled ? '#cbd5e1' : '#818cf8', marginTop: 2 }}>
                  {dispatchDisabled ? 'Accept order first' : 'Update dispatch on this page'}
                </div>
              </span>
            </button>
          )}

          {showAccept && rsmMode && (
            <>
              <button
                onClick={close(onAccept)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '9px 12px',
                  borderRadius: 8, border: 'none',
                  background: 'transparent', cursor: 'pointer',
                  fontSize: 12.5, fontWeight: 500, color: '#065f46',
                  fontFamily: 'inherit', textAlign: 'left',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f0fdf4')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: '#dcfce7', border: '1px solid #bbf7d0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <span>
                  <div style={{ lineHeight: 1.2 }}>Approve Order</div>
                  <div style={{ fontSize: 10.5, color: '#86efac', marginTop: 2 }}>Release to staff for acceptance</div>
                </span>
              </button>
              <button
                onClick={close(onDecline)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '9px 12px',
                  borderRadius: 8, border: 'none',
                  background: 'transparent', cursor: 'pointer',
                  fontSize: 12.5, fontWeight: 500, color: '#be123c',
                  fontFamily: 'inherit', textAlign: 'left',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#fff1f2')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: '#fff1f2', border: '1px solid #fecdd3',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#be123c" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </span>
                <span>
                  <div style={{ lineHeight: 1.2 }}>Disapprove Order</div>
                  <div style={{ fontSize: 10.5, color: '#fda4af', marginTop: 2 }}>Reject this order</div>
                </span>
              </button>
            </>
          )}

          {showAccept && !rsmMode && acceptOrder === '0' && (
            <button
              onClick={close(onAccept)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '9px 12px',
                borderRadius: 8, border: 'none',
                background: 'transparent', cursor: 'pointer',
                fontSize: 12.5, fontWeight: 500, color: '#065f46',
                fontFamily: 'inherit', textAlign: 'left',
                transition: 'background 0.12s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f0fdf4')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{
                width: 28, height: 28, borderRadius: 7,
                background: '#dcfce7', border: '1px solid #bbf7d0',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <span>
                <div style={{ lineHeight: 1.2 }}>Accept Order</div>
                <div style={{ fontSize: 10.5, color: '#86efac', marginTop: 2 }}>Mark as confirmed</div>
              </span>
            </button>
          )}

          {showAccept && !rsmMode && acceptOrder === '1' && (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 8,
                fontSize: 12.5, fontWeight: 500, color: '#6ee7b7', opacity: 0.7,
              }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: '#f0fdf4', border: '1px solid #bbf7d0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <span>
                  <div style={{ lineHeight: 1.2, color: '#065f46' }}>Accepted</div>
                  <div style={{ fontSize: 10.5, color: '#a7f3d0', marginTop: 2 }}>Already confirmed</div>
                </span>
              </div>
              <button
                onClick={close(onDecline)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '9px 12px',
                  borderRadius: 8, border: 'none',
                  background: 'transparent', cursor: 'pointer',
                  fontSize: 12.5, fontWeight: 500, color: '#be123c',
                  fontFamily: 'inherit', textAlign: 'left',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#fff1f2')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: '#fff1f2', border: '1px solid #fecdd3',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#be123c" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </span>
                <span>
                  <div style={{ lineHeight: 1.2 }}>Decline</div>
                  <div style={{ fontSize: 10.5, color: '#fda4af', marginTop: 2 }}>Revert acceptance</div>
                </span>
              </button>
            </>
          )}

          {showDelete && (
            <>
              <div style={{ height: 1, background: '#f1f5f9', margin: '2px 4px' }} />
              <button
                onClick={close(onDelete)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '9px 12px',
                  borderRadius: 8, border: 'none',
                  background: 'transparent', cursor: 'pointer',
                  fontSize: 12.5, fontWeight: 500, color: '#be123c',
                  fontFamily: 'inherit', textAlign: 'left',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#fff1f2')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: '#fff1f2', border: '1px solid #fecdd3',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#be123c" strokeWidth="2" strokeLinecap="round">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6m5 0V4h4v2" />
                  </svg>
                </span>
                <span>
                  <div style={{ lineHeight: 1.2 }}>Delete Order</div>
                  <div style={{ fontSize: 10.5, color: '#fda4af', marginTop: 2 }}>This cannot be undone</div>
                </span>
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
function DispatchDetailsDrawer({
  order,
  products,
  loadingProducts,
  productsError,
  selectedProductId,
  onSelectProduct,
  history,
  historyLoading,
  historyError,
  form,
  formError,
  submitting,
  onFormChange,
  onSubmit,
  onClose,
}: {
  order: OrderData | null
  products: DispatchOrderProduct[]
  loadingProducts: boolean
  productsError: string
  selectedProductId: string
  onSelectProduct: (productId: string) => void
  history: DispatchRemark[]
  historyLoading: boolean
  historyError: string
  form: { readyQuantity: string; status: string; remark: string }
  formError: string
  submitting: boolean
  onFormChange: (field: 'readyQuantity' | 'status' | 'remark', value: string) => void
  onSubmit: () => void
  onClose: () => void
}) {
  if (!order) return null

  const selectedProduct = products.find((item) => item.orderdata_id === selectedProductId) ?? null
  const availableLeftQuantity = selectedProduct ? getDispatchLeftQuantity(selectedProduct) : 0

  return (
    <div className="dispatch-overlay" onClick={onClose}>
      <div className="dispatch-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="dispatch-header">
          <div>
            <p className="dispatch-kicker">Dispatch Details</p>
            <h2 className="dispatch-title">Order No: {formatDisplayOrderNumber(order.order_id)}</h2>
            <p className="dispatch-subtitle">Dealer: {order.Dealer_Name || '—'}</p>
          </div>
          <button type="button" className="dispatch-close" onClick={onClose} aria-label="Close dispatch details">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="dispatch-layout">
          <div className="dispatch-products">
            <div className="dispatch-section-head">
              <h3>Order Products</h3>
              {!loadingProducts && <span>{products.length} line{products.length !== 1 ? 's' : ''}</span>}
            </div>

            {loadingProducts && <div className="dispatch-empty">Loading order products…</div>}
            {!loadingProducts && productsError && <div className="dispatch-error">{productsError}</div>}
            {!loadingProducts && !productsError && products.length === 0 && (
              <div className="dispatch-empty">No products returned for this order.</div>
            )}

            {!loadingProducts && !productsError && products.length > 0 && (
              <div className="dispatch-product-list">
                {products.map((item, index) => {
                  const selected = item.orderdata_id === selectedProductId
                  return (
                    <div key={item.orderdata_id} className={`dispatch-product-card${selected ? ' is-selected' : ''}`}>
                      <div className="dispatch-product-top">
                        <span className="dispatch-product-index">{String(index + 1).padStart(2, '0')}</span>
                        <span className="dispatch-cat-pill">{item.orderdata_cat_no || '—'}</span>
                        <span className="dispatch-line-id">#{item.orderdata_id}</span>
                      </div>
                      <p className="dispatch-product-name">{item.product_name || item.orderdata_cat_no || '—'}</p>
                      <p className="dispatch-product-desc">{item.product_discription || 'No description available.'}</p>
                      <div className="dispatch-product-grid">
                        <span>Ordered: {safeNumber(item.orderdata_item_quantity)}</span>
                        <span>Dispatched: {safeNumber(item.readyquantity)}</span>
                        <span>Left: {getDispatchLeftQuantity(item)}</span>
                        <span>Status: {dispatchStatusOptionLabel(item.orderdata_status)}</span>
                      </div>
                      <div className="dispatch-original-note">
                        <span className="dispatch-original-note-label">Product Note / Original Remarks</span>
                        <p>{getOriginalProductRemarks(item) || '—'}</p>
                      </div>
                      <button type="button" className="dispatch-select-btn" onClick={() => onSelectProduct(item.orderdata_id)}>
                        Update Dispatch
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="dispatch-editor">
            <div className="dispatch-section-head">
              <h3>Dispatch Update</h3>
              {selectedProduct && <span>Line #{selectedProduct.orderdata_id}</span>}
            </div>

            {!selectedProduct && <div className="dispatch-empty">Choose a product line to update its dispatch details.</div>}

            {selectedProduct && (
              <>
                <div className="dispatch-form-card">
                  <div className="dispatch-form-row">
                    <label htmlFor="dispatch-ready">Ready Quantity</label>
                    <input
                      id="dispatch-ready"
                      type="number"
                      min="1"
                      value={form.readyQuantity}
                      onChange={(event) => onFormChange('readyQuantity', event.target.value)}
                      disabled={submitting}
                    />
                  </div>

                  <div className="dispatch-form-row">
                    <label htmlFor="dispatch-left">Left Quantity</label>
                    <input id="dispatch-left" type="text" value={String(availableLeftQuantity)} readOnly disabled />
                  </div>

                  <div className="dispatch-form-row">
                    <label htmlFor="dispatch-status">Current Status</label>
                    <select
                      id="dispatch-status"
                      value={form.status}
                      onChange={(event) => onFormChange('status', event.target.value)}
                      disabled={submitting}
                    >
                      <option value="">Select status</option>
                      <option value="1">Packing</option>
                      <option value="2">Dispatched</option>
                      <option value="3">Not in Stock</option>
                      <option value="4">Successful</option>
                    </select>
                  </div>

                  <div className="dispatch-form-row">
                    <label htmlFor="dispatch-remark">Remark</label>
                    <textarea
                      id="dispatch-remark"
                      value={form.remark}
                      onChange={(event) => onFormChange('remark', event.target.value)}
                      placeholder="Add dispatch remark"
                      rows={4}
                      disabled={submitting}
                    />
                  </div>

                  {formError && <div className="dispatch-error">{formError}</div>}

                  <button type="button" className="dispatch-submit-btn" onClick={onSubmit} disabled={submitting}>
                    {submitting ? 'Saving…' : 'Save Dispatch Update'}
                  </button>
                </div>

                <div className="dispatch-history-card">
                  <div className="dispatch-section-head">
                    <h3>Dispatch History</h3>
                    {!historyLoading && <span>{history.length} update{history.length !== 1 ? 's' : ''}</span>}
                  </div>

                  {historyLoading && <div className="dispatch-empty">Loading remark history…</div>}
                  {!historyLoading && historyError && <div className="dispatch-error">{historyError}</div>}
                  {!historyLoading && !historyError && history.length === 0 && (
                    <div className="dispatch-empty">No dispatch history found for this product line.</div>
                  )}
                  {!historyLoading && !historyError && history.length > 0 && (
                    <div className="dispatch-history-list">
                      {history.map((entry, index) => (
                        <div key={`${selectedProduct.orderdata_id}-${index}`} className="dispatch-history-item">
                          <div className="dispatch-history-top">
                            <span className="dispatch-product-index">{String(index + 1).padStart(2, '0')}</span>
                            <span className="dispatch-history-status">{dispatchStatusOptionLabel(String(entry.status || ''))}</span>
                          </div>
                          <p className="dispatch-history-remark">{entry.remark || '—'}</p>
                          <div className="dispatch-history-meta">
                            <span>Ready Qty: {safeNumber(entry.readyquantity)}</span>
                            <span>{entry.datetime || '—'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function OrdersPage() {
  const router      = useRouter()
  const queryClient = useQueryClient()

  const [session,      setSession     ] = useState<UserSession | null>(null)
  const [isRsm,        setIsRsm       ] = useState(false)
  const [rsmOnlyAwaiting, setRsmOnlyAwaiting] = useState(false)
  const [page,         setPage        ] = useState(1)
  const [toast,        setToast       ] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [orderIdInput, setOrderIdInput] = useState('')
  const [dealerInput,  setDealerInput ] = useState('')
  const [statusSearch, setStatusSearch] = useState('')
  const [mtFilter,     setMtFilter    ] = useState('')
  const [amountMin,    setAmountMin   ] = useState('')
  const [amountMax,    setAmountMax   ] = useState('')
  const [dateFrom,     setDateFrom    ] = useState('')
  const [dateTo,       setDateTo      ] = useState('')
  const [summaryOverrides, setSummaryOverrides] = useState<Record<string, OrderSummaryOverride>>({})
  const [dispatchOrder, setDispatchOrder] = useState<OrderData | null>(null)
  const [dispatchProducts, setDispatchProducts] = useState<DispatchOrderProduct[]>([])
  const [dispatchProductsLoading, setDispatchProductsLoading] = useState(false)
  const [dispatchProductsError, setDispatchProductsError] = useState('')
  const [selectedDispatchProductId, setSelectedDispatchProductId] = useState('')
  const [dispatchHistory, setDispatchHistory] = useState<DispatchRemark[]>([])
  const [dispatchHistoryLoading, setDispatchHistoryLoading] = useState(false)
  const [dispatchHistoryError, setDispatchHistoryError] = useState('')
  const [dispatchSubmitting, setDispatchSubmitting] = useState(false)
  const [dispatchFormError, setDispatchFormError] = useState('')
  const [dispatchForm, setDispatchForm] = useState({ readyQuantity: '', status: '', remark: '' })
  const [section, setSection] = useState<'active' | 'cancelled'>('active')

  useEffect(() => {
    const s = resolveSession()
    if (!s) { router.push('/auth/login'); return }
    setSession(s)
  }, [router])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return
        const rsm = String(json?.data?.role ?? '').toLowerCase() === 'rsm'
        setIsRsm(rsm)
        setRsmOnlyAwaiting(rsm)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t) }, [toast])
  useEffect(() => { setPage(1) }, [orderIdInput, dealerInput, statusSearch, mtFilter, amountMin, amountMax, dateFrom, dateTo, rsmOnlyAwaiting])

  const cfg          = session ? ROLE_CONFIG[session.role] : null
  const serverSearch = dealerInput

  const { data: response, isLoading, isError } = useQuery<OrderResponse>({
    queryKey: ['orders', STAFF_ORDER_SCOPE_VERSION, session?.role, session?.id, page, serverSearch, orderIdInput, statusSearch, mtFilter, amountMin, amountMax, dateFrom, dateTo],
    queryFn: async () => {
      if (!session || !cfg) throw new Error('No session')
      const params = new URLSearchParams()
      if (orderIdInput) params.set('order_id', orderIdInput)
      if (statusSearch) params.set('accepted', statusSearch)
      if (mtFilter) params.set('mt_status', mtFilter)
      if (amountMin) params.set('amount_min', amountMin)
      if (amountMax) params.set('amount_max', amountMax)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const suffix = params.toString()
      const res = await axios.get(`${cfg.endpoint(session.id, page, serverSearch)}${suffix ? `&${suffix}` : ''}`)
      return res.data
    },
    enabled: !!session,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })

  const { data: cancelledResponse, isLoading: cancelledLoading, isError: cancelledError } = useQuery<{ data: CancelledOrderOverlay[]; total?: number; count?: number; totalPages?: number; last_page?: number }>({
    queryKey: ['cancelled-orders', session?.role, session?.id, page, serverSearch],
    queryFn: async () => {
      if (!session) throw new Error('No session')
      const res = await fetch(`/api/order-overlays/cancelled?page=${page}&limit=${ITEMS_PER_PAGE}&search=${encodeURIComponent(serverSearch)}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.message || 'Unable to load cancelled orders')
      return json
    },
    enabled: !!session && section === 'cancelled',
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  })

  const { data: customDiscountRequests = [] } = useQuery<CustomDiscountRequest[]>({
    queryKey: ['custom-discount-requests', session?.role, session?.id],
    queryFn: async () => {
      if (!session || session.role === 'dealer') return []
      const actorScope = session.role === 'staff' ? `&staff_id=${encodeURIComponent(session.id)}` : ''
      const res = await fetch(`/api/custom-discount-requests?limit=500${actorScope}`, {
        cache: 'no-store',
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.message ?? 'Failed to load custom discount requests')
      return Array.isArray(json.data) ? json.data : []
    },
    enabled: !!session && session.role !== 'dealer',
    staleTime: 60 * 1000,
  })

  const cancelledData = cancelledResponse?.data ?? []
  const allData: OrderData[] = section === 'active' ? (response?.data || []) : []
  const allOrderIdsKey = allData.map(o => o.order_id).filter(Boolean).join(',')
  const allDealerIdsKey = allData.map(o => o.order_dealer || '').join(',')
  const customDiscountProgressMap = buildCustomDiscountProgressMap(customDiscountRequests)
  const showCustomDiscountCol = !!session && session.role !== 'dealer'

  useEffect(() => {
    if (!allOrderIdsKey) { setSummaryOverrides({}); return }
    const dealerGroups = new Map<string, string[]>()
    const orderIds = allOrderIdsKey.split(',')
    const dealerIds = allDealerIdsKey.split(',')
    orderIds.forEach((orderId, index) => {
      const dealerId = String(dealerIds[index] || (session?.role === 'dealer' ? session.id : '') || '').trim()
      if (!orderId) return
      const key = dealerId || '__all__'
      dealerGroups.set(key, [...(dealerGroups.get(key) ?? []), orderId])
    })

    Promise.all(Array.from(dealerGroups.entries()).map(([dealerId, orderIds]) => {
      const params = new URLSearchParams({ order_ids: orderIds.join(',') })
      if (dealerId !== '__all__') params.set('dealer_id', dealerId)
      return fetch(`/api/order-summary-overrides?${params.toString()}`, { cache: 'no-store' })
        .then(r => r.json())
        .catch(() => ({ success: false, data: [] }))
    }))
      .then(results => {
        const next: Record<string, OrderSummaryOverride> = {}
        results.forEach((json) => {
          if (!json.success) return
          ;(json.data ?? []).forEach((item: OrderSummaryOverride & { orderId?: string }) => {
            rememberSummaryOverride(next, item)
          })
        })
        setSummaryOverrides(next)
      })
      .catch(() => {})
  }, [allOrderIdsKey, allDealerIdsKey, session?.id, session?.role])

  const filteredAll = allData.filter(o => {
    const amounts = withDisplayOrderAmounts(o, summaryOverrides[o.order_id] ?? summaryOverrides[orderLookupKey(o.order_id)])
    if (isRsm && rsmOnlyAwaiting && rsmApprovalValue(o) !== 'AWAITING') return false
    if (orderIdInput.trim() && !o.order_id.startsWith(orderIdInput.trim())) return false
    if (dealerInput.trim()  && !(o.Dealer_Name || '').toLowerCase().includes(dealerInput.trim().toLowerCase())) return false
    if (statusSearch !== '' && o.accept_order !== statusSearch) return false
    if (mtFilter     !== '' && mtStatusValue(o.mtstatus) !== mtFilter) return false
    if (amountMin    !== '' && amounts.grossAmount < Number(amountMin)) return false
    if (amountMax    !== '' && amounts.grossAmount > Number(amountMax)) return false
    if (dateFrom !== '') { const d = (o.orderDate || o.order_date || '').slice(0, 10); if (d < dateFrom) return false }
    if (dateTo   !== '') { const d = (o.orderDate || o.order_date || '').slice(0, 10); if (d > dateTo)   return false }
    return true
  })

  const hasClientFilters = !!(orderIdInput || dealerInput || statusSearch || mtFilter || amountMin || amountMax || dateFrom || dateTo || (isRsm && rsmOnlyAwaiting))
  const shouldSlice      = allData.length > ITEMS_PER_PAGE && !response?.last_page

  const data: OrderData[] = hasClientFilters
    ? filteredAll.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
    : shouldSlice ? allData.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
    : allData

  const total      = section === 'cancelled'
    ? (cancelledResponse?.total ?? cancelledResponse?.count ?? cancelledData.length)
    : hasClientFilters ? filteredAll.length : shouldSlice ? allData.length : (response?.total ?? response?.count ?? allData.length)
  const totalPages = section === 'cancelled'
    ? (cancelledResponse?.last_page ?? cancelledResponse?.totalPages ?? Math.max(1, Math.ceil(total / ITEMS_PER_PAGE)))
    : response?.last_page ?? Math.max(1, Math.ceil(total / ITEMS_PER_PAGE))
  const startIndex = total === 0 ? 0 : (page - 1) * ITEMS_PER_PAGE + 1
  const endIndex   = total === 0 ? 0 : Math.min(page * ITEMS_PER_PAGE, total)

  const clearSearch     = () => { setOrderIdInput(''); setDealerInput(''); setStatusSearch('') }
  const clearAllFilters = () => { setMtFilter(''); setAmountMin(''); setAmountMax(''); setDateFrom(''); setDateTo('') }

  const exportCSV = () => {
    const rows = (hasClientFilters ? filteredAll : allData).map((o, i) => {
      const amounts = withDisplayOrderAmounts(o, summaryOverrides[o.order_id] ?? summaryOverrides[orderLookupKey(o.order_id)])
      const customDiscountSummary = customDiscountProgressMap[getCustomDiscountProgressKeyForOrder(o.order_id)]
      const base: Record<string, string | number> = {
        'S.No.':        i + 1,
        'Order No':     formatDisplayOrderNumber(o.order_id),
        'Date':         (o.orderDate || o.order_date || '').slice(0, 10),
        'Due Date':     o.outstandingDate || '',
        'Amount (₹)':   amounts.grossAmount,
        'Discount (₹)': amounts.discountAmount,
        'Net (₹)':      amounts.netPayableAmount,
        'Qty':          o.orderdata_item_quantity || '',
        'Confirmation': o.accept_order === '1' ? 'Accepted' : 'Awaiting',
        'MT Status':    mtBadge(o.mtstatus).label,
      }
      if (showCustomDiscountCol) {
        base['Custom Discount Status'] = customDiscountSummary?.customDiscountStatus === 'completely'
          ? 'Completely'
          : customDiscountSummary?.customDiscountStatus === 'partially'
            ? 'Partially'
            : '—'
      }
      base['Discount Breakdown'] = getCompactOrderDiscountRows(amounts)
        .map((row) => row.amount === undefined ? row.label : `${row.label} - ${formatOrderListMoney(row.amount, 2)}`)
        .join(' | ')
      if (cfg?.showDealerCol) base['Dealer'] = o.Dealer_Name || ''
      return base
    })
    if (!rows.length) return

    const headers = Object.keys(rows[0])
    const csv = [
      headers.join(','),
      ...rows.map(r =>
        headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n')

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url

    const parts = ['orders']
    if (dealerInput)  parts.push(`dealer-${dealerInput.replace(/\s+/g, '-')}`)
    if (orderIdInput) parts.push(`id-${orderIdInput}`)
    if (dateFrom || dateTo) parts.push(`${dateFrom || 'start'}-to-${dateTo || 'now'}`)
    if (statusSearch) parts.push(statusSearch === '1' ? 'accepted' : 'awaiting')
    if (mtFilter)     parts.push(mtBadge(mtFilter).label.toLowerCase().replace(/\s+/g, '-'))
    if (amountMin || amountMax) parts.push(`amt-${amountMin || '0'}-${amountMax || 'max'}`)
    parts.push(new Date().toISOString().slice(0, 10))

    a.download = `${parts.join('_')}.csv`
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
    setToast({ msg: `Exported ${rows.length} order${rows.length !== 1 ? 's' : ''}.`, type: 'ok' })
  }

  const handleDelete = useCallback(async (id: string) => {
    if (!session || !cfg) return
    const reason = cfg.requireReason ? window.prompt('Reason for delete') : ''
    if (cfg.requireReason && !reason?.trim()) { setToast({ msg: 'Please provide a reason.', type: 'err' }); return }
    if (!window.confirm('Are you sure?')) return
    try {
      if (session.role !== 'dealer' && session.role !== 'admin') {
        throw new Error('Only Dealers or Admin can cancel orders.')
      }
      const order = data.find((row) => String(row.order_id) === String(id))
      const overlayRes = await fetch(`/api/order-overlays/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel',
          reason: reason || 'Cancelled from order management.',
          formattedOrderNumber: formatDisplayOrderNumber(id),
        }),
      })
      const overlayJson = await overlayRes.json().catch(() => null)
      if (!overlayRes.ok || overlayJson?.success === false) {
        throw new Error(overlayJson?.message || 'Cancellation could not be recorded.')
      }
      setToast({ msg: overlayJson?.message || 'Deleted.', type: 'ok' })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['cancelled-orders'] })
    } catch (error) { setToast({ msg: error instanceof Error ? error.message : 'Delete failed.', type: 'err' }) }
  }, [session, cfg, data, queryClient])

  const handleAccept = useCallback(async (id: string, status: 0 | 1) => {
    if (!session) return
    try {
      const currentRes = await fetch(`/api/order-overlays/${encodeURIComponent(id)}`, { cache: 'no-store' })
      const currentJson = await currentRes.json().catch(() => null)
      if (currentRes.ok && currentJson?.data?.isCancelled) {
        setToast({ msg: 'Cancelled orders cannot be accepted or declined.', type: 'err' })
        queryClient.invalidateQueries({ queryKey: ['orders'] })
        return
      }
      const order = data.find((row) => String(row.order_id) === String(id))
      const res = await fetch(`/api/order-overlays/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: status === 1 ? 'mirror_acceptance' : 'decline',
          acceptOrder: status === 1 ? '1' : '2',
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || json?.success === false) {
        throw new Error(json?.message || 'Acceptance update failed')
      }
      setToast({
        msg: isRsm ? (status === 1 ? 'Order approved.' : 'Order disapproved.') : 'Status updated.',
        type: 'ok',
      })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    } catch (error) { setToast({ msg: error instanceof Error ? error.message : 'Action failed.', type: 'err' }) }
  }, [data, queryClient, session, isRsm])

  const loadDispatchProducts = useCallback(async (orderId: string, preferredProductId?: string) => {
    setDispatchProductsLoading(true)
    setDispatchProductsError('')
    try {
      const res = await fetch(`/api/order-dispatch?orderId=${encodeURIComponent(orderId)}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || json?.success === false) throw new Error(json?.message || 'Failed to load order products.')
      const nextProducts: DispatchOrderProduct[] = Array.isArray(json?.data)
        ? json.data.map((item: Record<string, unknown>) => dispatchProductFromRecord(item))
        : []
      setDispatchProducts(nextProducts)
      const resolvedProductId = preferredProductId && nextProducts.some((item) => item.orderdata_id === preferredProductId)
        ? preferredProductId
        : nextProducts[0]?.orderdata_id ?? ''
      setSelectedDispatchProductId(resolvedProductId)
      setDispatchFormError('')
    } catch {
      setDispatchProducts([])
      setSelectedDispatchProductId('')
      setDispatchProductsError('Failed to load order products. Please try again.')
    } finally {
      setDispatchProductsLoading(false)
    }
  }, [])

  const loadDispatchHistory = useCallback(async (productId: string) => {
    if (!productId) {
      setDispatchHistory([])
      setDispatchHistoryError('')
      return
    }
    setDispatchHistoryLoading(true)
    setDispatchHistoryError('')
    try {
      const product = dispatchProducts.find((item) => item.orderdata_id === productId)
      const orderId = product?.orderdata_orderid || dispatchOrder?.order_id || ''
      if (!orderId) throw new Error('Missing order id')
      const res = await fetch(`/api/order-dispatch?orderId=${encodeURIComponent(orderId)}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || json?.success === false) throw new Error(json?.message || 'Failed to load dispatch history.')
      const record = Array.isArray(json?.data)
        ? json.data.find((item: Record<string, unknown>) => String(item.orderItemId ?? item.orderdata_id ?? item.id ?? '') === productId) ?? null
        : null
      setDispatchHistory(dispatchHistoryFromRecord(record))
    } catch {
      setDispatchHistory([])
      setDispatchHistoryError('Failed to load dispatch history. Please try again.')
    } finally {
      setDispatchHistoryLoading(false)
    }
  }, [dispatchOrder, dispatchProducts])

  const openDispatchDetails = useCallback((order: OrderData) => {
    setDispatchOrder(order)
    setDispatchProducts([])
    setDispatchProductsError('')
    setDispatchHistory([])
    setDispatchHistoryError('')
    setSelectedDispatchProductId('')
    setDispatchFormError('')
    setDispatchForm({ readyQuantity: '', status: '', remark: '' })
    loadDispatchProducts(order.order_id)
  }, [loadDispatchProducts])

  const closeDispatchDetails = useCallback(() => {
    setDispatchOrder(null)
    setDispatchProducts([])
    setDispatchProductsError('')
    setDispatchHistory([])
    setDispatchHistoryError('')
    setSelectedDispatchProductId('')
    setDispatchFormError('')
    setDispatchForm({ readyQuantity: '', status: '', remark: '' })
  }, [])

  useEffect(() => {
    const selectedProduct = dispatchProducts.find((item) => item.orderdata_id === selectedDispatchProductId) ?? null
    if (!selectedProduct) {
      setDispatchHistory([])
      setDispatchHistoryError('')
      setDispatchForm({ readyQuantity: '', status: '', remark: '' })
      return
    }

    setDispatchForm({
      readyQuantity: '',
      status: ['1', '2', '3', '4'].includes(String(selectedProduct.orderdata_status || ''))
        ? String(selectedProduct.orderdata_status)
        : '',
      remark: '',
    })
    setDispatchFormError('')
    loadDispatchHistory(selectedProduct.orderdata_id)
  }, [selectedDispatchProductId, dispatchProducts, loadDispatchHistory])

  const selectedDispatchProduct = dispatchProducts.find((item) => item.orderdata_id === selectedDispatchProductId) ?? null

  const handleDispatchFormChange = useCallback((field: 'readyQuantity' | 'status' | 'remark', value: string) => {
    setDispatchForm((previous) => ({ ...previous, [field]: value }))
    setDispatchFormError('')
  }, [])

  const handleDispatchSubmit = useCallback(async () => {
    if (!dispatchOrder || !selectedDispatchProduct) return

    const enteredReadyQuantity = Number(dispatchForm.readyQuantity)
    const availableLeftQuantity = getDispatchLeftQuantity(selectedDispatchProduct)
    const trimmedRemark = dispatchForm.remark.trim()

    if (!dispatchForm.readyQuantity.trim() || !Number.isFinite(enteredReadyQuantity)) {
      setDispatchFormError('Ready quantity is required.')
      return
    }
    if (enteredReadyQuantity <= 0) {
      setDispatchFormError('Ready quantity must be greater than zero.')
      return
    }
    if (enteredReadyQuantity > availableLeftQuantity) {
      setDispatchFormError('Ready quantity cannot exceed the currently available left quantity.')
      return
    }
    if (!dispatchForm.status) {
      setDispatchFormError('Please select a status.')
      return
    }
    if (!trimmedRemark) {
      setDispatchFormError('Remark is required.')
      return
    }

    setDispatchSubmitting(true)
    setDispatchFormError('')
    try {
      const res = await fetch('/api/order-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: dispatchOrder.order_id,
          orderItemId: selectedDispatchProduct.orderdata_id,
          sku: selectedDispatchProduct.orderdata_cat_no,
          dispatchQuantity: enteredReadyQuantity,
          status: dispatchStatusForApi(dispatchForm.status),
          remark: trimmedRemark,
          dealerId: dispatchOrder.order_dealer,
          assignedStaffId: dispatchOrder.staffid,
          delStatus: dispatchOrder.del_status,
          orderedQuantity: selectedDispatchProduct.orderdata_item_quantity,
          legacyReadyQuantity: selectedDispatchProduct.readyquantity,
          legacyStatus: selectedDispatchProduct.orderdata_status,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || json?.success === false) {
        throw new Error(json?.message || 'Failed to save dispatch update.')
      }
      setToast({ msg: 'Dispatch details updated.', type: 'ok' })
      setDispatchForm((previous) => ({ ...previous, readyQuantity: '', remark: '' }))
      await Promise.all([
        loadDispatchProducts(dispatchOrder.order_id, selectedDispatchProduct.orderdata_id),
        loadDispatchHistory(selectedDispatchProduct.orderdata_id),
      ])
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    } catch (error) {
      setDispatchFormError(error instanceof Error ? error.message : 'Failed to save dispatch update. Please try again.')
    } finally {
      setDispatchSubmitting(false)
    }
  }, [
    dispatchForm.readyQuantity,
    dispatchForm.remark,
    dispatchForm.status,
    dispatchOrder,
    loadDispatchHistory,
    loadDispatchProducts,
    queryClient,
    selectedDispatchProduct,
  ])

  function pageNumbers(): (number | '…')[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const pages: (number | '…')[] = [1]
    const s = Math.max(2, page - 1); const e = Math.min(totalPages - 1, page + 1)
    if (s > 2) pages.push('…')
    for (let i = s; i <= e; i++) pages.push(i)
    if (e < totalPages - 1) pages.push('…')
    pages.push(totalPages)
    return pages
  }
  const handlePageChange = (p: number) => {
    if (p < 1 || p > totalPages) return
    setPage(p)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const inputCls = (active: boolean) =>
    `h-[30px] px-2.5 rounded-[7px] border text-[11.5px] outline-none font-[inherit] transition-colors ${
      active ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-gray-50 text-gray-500'
    }`
  const selectCls = (active: boolean) =>
    `h-[30px] pl-2.5 pr-6 rounded-[7px] border text-[11.5px] outline-none font-[inherit] appearance-none cursor-pointer transition-colors ${
      active ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-gray-50 text-gray-500'
    }`

  if (!session || !cfg) return null

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .orders-root { min-height: 100vh; background: #f7f8fc; font-family: 'Sora', sans-serif; color: #0f172a; }
        .orders-topbar { background: #fff; border-bottom: 1px solid #e8eaf0; padding: 0 28px; height: 60px; display: flex; align-items: center; gap: 14px; position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 8px rgba(0,0,0,0.04); }
        .back-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px 6px 10px; border-radius: 8px; border: 1px solid #e2e6ef; background: #f7f8fc; font-size: 12.5px; font-weight: 500; color: #475569; cursor: pointer; font-family: inherit; transition: all 0.15s; }
        .back-btn:hover { background: #eef0f8; border-color: #c7cde0; color: #1e293b; transform: translateX(-1px); }
        .topbar-divider { width: 1px; height: 22px; background: #e2e6ef; }
        .topbar-title { font-size: 15px; font-weight: 600; color: #0f172a; }
        .topbar-sub { font-size: 12px; color: #94a3b8; margin-left: 4px; }
        .role-pill { padding: 3px 11px; border-radius: 20px; font-size: 11px; font-weight: 600; }
        .role-admin  { background: #ede9fe; color: #7c3aed; }
        .role-dealer { background: #dbeafe; color: #1d4ed8; }
        .role-staff  { background: #d1fae5; color: #065f46; }
        .role-accountant { background: #fef3c7; color: #92400e; }
        .orders-body { padding: 24px 28px; width: 100%; max-width: 1840px; margin: 0 auto; }
        mark.hl { background: #fef08a; color: #713f12; border-radius: 2px; padding: 0 1px; }
        .stats-row { display: flex; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; }
        .stat-pill { display: flex; align-items: center; gap: 7px; padding: 7px 14px; background: #fff; border: 1px solid #e8eaf0; border-radius: 10px; font-size: 12px; color: #374151; font-weight: 500; }
        .stat-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .stat-num { font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 12.5px; color: #0f172a; }
        .table-card { background: #fff; border: 1px solid #e8eaf0; border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); overflow: visible; }
        .table-scroll { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        thead { background: #f8f9fd; }
        th { padding: 10px 14px; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: #64748b; border-bottom: 1px solid #e8eaf0; white-space: nowrap; vertical-align: top; }
        th:first-child { padding-left: 20px; } th:last-child { padding-right: 20px; }
        th .th-filter { margin-top: 6px; }
        tbody tr { border-bottom: 1px solid #f1f3f9; transition: background 0.12s; }
        tbody tr:last-child { border-bottom: none; } tbody tr:hover { background: #f8f9fd; }
        td { padding: 12px 14px; vertical-align: middle; color: #374151; }
        td:first-child { padding-left: 20px; } td:last-child { padding-right: 20px; }
        .shimmer { height: 13px; border-radius: 6px; background: linear-gradient(90deg, #f0f2f8 25%, #e4e8f2 50%, #f0f2f8 75%); background-size: 200% 100%; animation: sh 1.4s infinite; }
        @keyframes sh { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .order-id-pill { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 500; background: #f1f3fb; color: #4b5563; padding: 3px 8px; border-radius: 6px; border: 1px solid #e2e6ef; }
        .amount-pill { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; font-weight: 600; color: #065f46; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 3px 9px; border-radius: 20px; white-space: nowrap; }
        .dealer-name { font-weight: 500; color: #1e293b; font-size: 12.5px; }
        .dealer-sub  { font-size: 10.5px; color: #94a3b8; margin-top: 1px; }
        .mono-sm     { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: #64748b; }
        .qty-info    { font-size: 10.5px; color: #94a3b8; margin-top: 2px; }
        .reason-tag  { font-size: 10.5px; color: #be123c; margin-top: 2px; }
        .badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 20px; white-space: nowrap; }
        .badge-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
        .badge-approved  { background: #ecfdf5; color: #065f46; }
        .badge-pending   { background: #fffbeb; color: #92400e; }
        .badge-accepted  { background: #eff6ff; color: #1d4ed8; }
        .badge-awaiting  { background: #fffbeb; color: #92400e; }
        .badge-inprocess { background: #fff1f2; color: #be123c; }
        .badge-noaction  { background: #f8fafc; color: #475569; }
        .dispatch-overlay { position: fixed; inset: 0; z-index: 80; background: rgba(15, 23, 42, 0.28); backdrop-filter: blur(5px); display: flex; justify-content: flex-end; }
        .dispatch-drawer { width: min(1120px, 100%); height: 100%; background: #f8fafc; box-shadow: -18px 0 40px rgba(15, 23, 42, 0.16); display: flex; flex-direction: column; }
        .dispatch-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 24px 28px 20px; border-bottom: 1px solid #e2e8f0; background: #fff; }
        .dispatch-kicker { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #64748b; margin-bottom: 8px; }
        .dispatch-title { font-size: 22px; font-weight: 700; color: #0f172a; line-height: 1.15; }
        .dispatch-subtitle { font-size: 13px; color: #64748b; margin-top: 4px; }
        .dispatch-close { width: 38px; height: 38px; border-radius: 12px; border: 1px solid #e2e8f0; background: #fff; color: #475569; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s; }
        .dispatch-close:hover { background: #f8fafc; color: #0f172a; border-color: #cbd5e1; }
        .dispatch-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(340px, 0.92fr); gap: 20px; padding: 20px 28px 28px; overflow: hidden; }
        .dispatch-products, .dispatch-editor { min-height: 0; display: flex; flex-direction: column; gap: 14px; }
        .dispatch-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .dispatch-section-head h3 { font-size: 15px; font-weight: 700; color: #0f172a; }
        .dispatch-section-head span { font-size: 11px; color: #64748b; font-family: 'JetBrains Mono', monospace; }
        .dispatch-product-list, .dispatch-history-list { overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding-right: 4px; }
        .dispatch-product-card, .dispatch-form-card, .dispatch-history-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 18px; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04); }
        .dispatch-product-card { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
        .dispatch-product-card.is-selected { border-color: #818cf8; box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.14); }
        .dispatch-product-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
        .dispatch-product-index { display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 24px; border-radius: 999px; background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 700; font-family: 'JetBrains Mono', monospace; }
        .dispatch-cat-pill, .dispatch-line-id, .dispatch-history-status { display: inline-flex; align-items: center; padding: 4px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
        .dispatch-cat-pill { background: #fef3c7; color: #92400e; }
        .dispatch-line-id { background: #eef2ff; color: #4338ca; font-family: 'JetBrains Mono', monospace; }
        .dispatch-history-status { background: #eff6ff; color: #1d4ed8; }
        .dispatch-product-name { font-size: 14px; font-weight: 700; color: #111827; }
        .dispatch-product-desc { font-size: 12px; color: #64748b; margin-top: 4px; line-height: 1.5; }
        .dispatch-product-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
        .dispatch-product-grid span, .dispatch-history-meta span { font-size: 11px; color: #475569; font-family: 'JetBrains Mono', monospace; }
        .dispatch-original-note { margin-top: 12px; padding: 12px; border-radius: 14px; background: #f8fafc; border: 1px solid #e2e8f0; }
        .dispatch-original-note-label { display: block; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; margin-bottom: 6px; }
        .dispatch-original-note p { font-size: 12px; color: #334155; line-height: 1.5; }
        .dispatch-select-btn, .dispatch-submit-btn { border: none; cursor: pointer; font-family: inherit; font-weight: 600; transition: all 0.15s; }
        .dispatch-select-btn { align-self: flex-start; padding: 9px 14px; border-radius: 12px; background: #eef2ff; color: #4338ca; }
        .dispatch-select-btn:hover { background: #e0e7ff; }
        .dispatch-form-card, .dispatch-history-card { padding: 16px; }
        .dispatch-form-card { display: flex; flex-direction: column; gap: 14px; }
        .dispatch-form-row { display: flex; flex-direction: column; gap: 6px; }
        .dispatch-form-row label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; }
        .dispatch-form-row input, .dispatch-form-row select, .dispatch-form-row textarea { width: 100%; border-radius: 12px; border: 1px solid #dbe2ee; background: #fff; padding: 11px 12px; font-size: 13px; font-family: inherit; color: #0f172a; outline: none; transition: border-color 0.15s, box-shadow 0.15s; }
        .dispatch-form-row input:focus, .dispatch-form-row select:focus, .dispatch-form-row textarea:focus { border-color: #818cf8; box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.14); }
        .dispatch-form-row input[disabled], .dispatch-form-row select[disabled], .dispatch-form-row textarea[disabled] { background: #f8fafc; color: #64748b; cursor: not-allowed; }
        .dispatch-submit-btn { padding: 11px 16px; border-radius: 12px; background: #1d4ed8; color: #fff; }
        .dispatch-submit-btn:hover:not(:disabled) { background: #1e40af; }
        .dispatch-submit-btn:disabled { opacity: 0.55; cursor: wait; }
        .dispatch-history-card { display: flex; flex-direction: column; gap: 14px; min-height: 0; }
        .dispatch-history-item { padding: 12px; border-radius: 14px; background: #f8fafc; border: 1px solid #e2e8f0; }
        .dispatch-history-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
        .dispatch-history-remark { font-size: 12px; color: #1f2937; line-height: 1.5; }
        .dispatch-history-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; flex-wrap: wrap; }
        .dispatch-empty, .dispatch-error { padding: 16px; border-radius: 14px; font-size: 12.5px; }
        .dispatch-empty { background: #fff; border: 1px dashed #dbe2ee; color: #64748b; }
        .dispatch-error { background: #fff1f2; border: 1px solid #fecdd3; color: #be123c; }
        .empty-row td { padding: 52px 20px; text-align: center; color: #9ca3af; font-size: 13px; }
        .pagination { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-top: 1px solid #f1f3f9; flex-wrap: wrap; gap: 12px; }
        .pagination-info { font-size: 12px; color: #94a3b8; }
        .pagination-info strong { color: #374151; font-weight: 600; }
        .pager { display: flex; align-items: center; gap: 4px; }
        .page-btn { min-width: 32px; height: 32px; padding: 0 8px; border-radius: 8px; border: 1px solid #e2e6ef; background: #fff; font-size: 12.5px; font-family: 'Sora', sans-serif; font-weight: 500; color: #374151; cursor: pointer; transition: all 0.12s; display: flex; align-items: center; justify-content: center; gap: 4px; }
        .page-btn:hover:not(:disabled):not(.active) { background: #f1f3fb; border-color: #c7cde0; }
        .page-btn.active { background: #1e40af; border-color: #1e40af; color: #fff; font-weight: 600; }
        .page-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .page-ell { padding: 0 4px; color: #94a3b8; font-size: 13px; }
        .toast-wrap { position: fixed; bottom: 24px; right: 24px; z-index: 100; padding: 12px 20px; border-radius: 12px; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.12); animation: slideUp 0.2s ease; }
        .toast-ok  { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
        .toast-err { background: #fff1f2; color: #be123c; border: 1px solid #fecdd3; }
        @keyframes slideUp { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .active-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
        @media (max-width: 1100px) {
          .dispatch-layout { grid-template-columns: 1fr; overflow-y: auto; }
          .dispatch-drawer { width: 100%; }
        }
        @media (max-width: 1024px) {
          .orders-body { width: 100%; padding: 16px; }
        }
      `}</style>

      <div className="orders-root">

        {/* Toast */}
        {toast && (
          <div className={`toast-wrap ${toast.type === 'ok' ? 'toast-ok' : 'toast-err'}`}>
            {toast.type === 'ok'
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5" /></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" /></svg>
            }
            {toast.msg}
          </div>
        )}

        {/* Topbar */}
        <div className="orders-topbar">
          <button className="back-btn" onClick={() => router.back()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            Back
          </button>
          <div className="topbar-divider" />
          <span className="topbar-title">
            Order Management
            {!isLoading && total > 0 && <span className="topbar-sub">· {total.toLocaleString()} records</span>}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <span className={`role-pill ${cfg.pillCls}`}>{cfg.label} View</span>
            <span className="text-xs text-gray-400 font-mono">id: {session.id || 'none'}</span>
          </div>
        </div>

        <div className="orders-body">

          {/* Heading */}
          <div className="flex items-end justify-between flex-wrap gap-4 mb-5">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
              <p className="text-sm text-slate-500 mt-1">{cfg.caption}</p>
              <div className="mt-3 inline-flex rounded-lg border border-slate-200 bg-white p-1">
                <button
                  type="button"
                  onClick={() => { setSection('active'); setPage(1) }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md ${section === 'active' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  Active Orders
                </button>
                <button
                  type="button"
                  onClick={() => { setSection('cancelled'); setPage(1) }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md ${section === 'cancelled' ? 'bg-red-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  Cancelled Orders
                </button>
              </div>
              {isRsm && section === 'active' && (
                <div className="mt-3 ml-0 sm:ml-2 inline-flex rounded-lg border border-slate-200 bg-white p-1">
                  <button
                    type="button"
                    onClick={() => setRsmOnlyAwaiting(true)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md ${rsmOnlyAwaiting ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    Awaiting my approval
                  </button>
                  <button
                    type="button"
                    onClick={() => setRsmOnlyAwaiting(false)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md ${!rsmOnlyAwaiting ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    All team orders
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={exportCSV}
              disabled={isLoading || allData.length === 0}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '8px 16px', borderRadius: 10,
                border: `1px solid ${hasClientFilters ? '#a5b4fc' : '#e2e6ef'}`,
                background: hasClientFilters ? '#eef2ff' : '#fff',
                color: hasClientFilters ? '#4338ca' : '#374151',
                fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'all 0.15s',
                opacity: (isLoading || allData.length === 0) ? 0.4 : 1,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export CSV
              <span style={{
                padding: '1px 7px', borderRadius: 20,
                background: hasClientFilters ? '#c7d2fe' : '#f1f3fb',
                color: hasClientFilters ? '#3730a3' : '#64748b',
                fontSize: 11, fontWeight: 700,
              }}>
                {hasClientFilters ? filteredAll.length : allData.length}
              </span>
            </button>
          </div>

          {/* Active filter tags */}
          {(orderIdInput || dealerInput || statusSearch || mtFilter || amountMin || amountMax || dateFrom || dateTo) && (
            <div className="active-tags">
              {orderIdInput  && <FilterTag label={`ID: ${orderIdInput}…`} color="#4338ca" bg="#eef2ff" onRemove={() => setOrderIdInput('')} />}
              {dealerInput   && <FilterTag label={`Dealer: ${dealerInput}`} color="#065f46" bg="#ecfdf5" onRemove={() => setDealerInput('')} />}
              {statusSearch  && <FilterTag label={statusSearch === '1' ? 'Accepted' : 'Awaiting'} color={statusSearch === '1' ? '#1d4ed8' : '#92400e'} bg={statusSearch === '1' ? '#eff6ff' : '#fffbeb'} onRemove={() => setStatusSearch('')} />}
              {mtFilter      && <FilterTag label={mtBadge(mtFilter).label} color="#92400e" bg="#fffbeb" onRemove={() => setMtFilter('')} />}
              {(amountMin || amountMax) && <FilterTag label={`₹${amountMin||'0'}–₹${amountMax||'∞'}`} color="#065f46" bg="#ecfdf5" onRemove={() => { setAmountMin(''); setAmountMax('') }} />}
              {(dateFrom || dateTo) && <FilterTag label={`${dateFrom||'…'} → ${dateTo||'…'}`} color="#7c3aed" bg="#ede9fe" onRemove={() => { setDateFrom(''); setDateTo('') }} />}
              <button onClick={() => { clearSearch(); clearAllFilters() }} className="text-[11px] text-slate-400 underline cursor-pointer bg-transparent border-none font-[inherit] px-2">
                Clear all
              </button>
            </div>
          )}

          {/* Stats */}
          {section === 'active' && !isLoading && (
            <div className="stats-row">
              <div className="stat-pill"><span className="stat-dot" style={{ background: '#6366f1' }} />{hasClientFilters ? 'Filtered' : 'Total'}<span className="stat-num">{total.toLocaleString()}</span></div>
              <div className="stat-pill"><span className="stat-dot" style={{ background: '#1d4ed8' }} />Accepted<span className="stat-num">{data.filter(o => o.accept_order === '1').length}</span></div>
              <div className="stat-pill"><span className="stat-dot" style={{ background: '#f59e0b' }} />Awaiting<span className="stat-num">{data.filter(o => o.accept_order === '0').length}</span></div>
              <div className="stat-pill"><span className="stat-dot" style={{ background: '#3b82f6' }} />Page<span className="stat-num">{page} / {totalPages}</span></div>
            </div>
          )}

          {section === 'active' && isError && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" /></svg>
              Failed to load orders. Please try again.
            </div>
          )}
          {section === 'cancelled' && cancelledError && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" /></svg>
              Failed to load cancelled orders. Please try again.
            </div>
          )}

          {/* Table */}
          <div className="table-card">
            <div className="table-scroll">
              {section === 'cancelled' ? (
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Order ID</th>
                      {cfg.showDealerCol && <th>Dealer</th>}
                      <th>Cancelled Date</th>
                      <th>Reason</th>
                      <th>Cancelled By</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cancelledLoading && Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                      <tr key={i}><td colSpan={cfg.showDealerCol ? 8 : 7}><div className="shimmer" style={{ width: 160 }} /></td></tr>
                    ))}
                    {!cancelledLoading && cancelledData.length === 0 && (
                      <tr className="empty-row">
                        <td colSpan={cfg.showDealerCol ? 8 : 7}>No cancelled orders found</td>
                      </tr>
                    )}
                    {!cancelledLoading && cancelledData.map((order, i) => (
                      <tr key={order.orderId}>
                        <td className="mono-sm">{startIndex + i}</td>
                        <td><span className="order-id-pill">{order.formattedOrderNumber || formatDisplayOrderNumber(order.orderId)}</span></td>
                        {cfg.showDealerCol && (
                          <td>
                            <div className="dealer-name">{order.dealerName || (order.originalOrderRef?.Dealer_Name as string) || 'Dealer'}</div>
                            <div className="dealer-sub">ID: {order.dealerId}</div>
                          </td>
                        )}
                        <td className="mono-sm">{(order.cancellation?.cancelledAt || '').slice(0, 10) || '—'}</td>
                        <td className="max-w-[360px] text-sm text-slate-700">{order.cancellation?.reason || '—'}</td>
                        <td className="mono-sm">{order.cancellation?.cancelledBy?.name || order.cancellation?.cancelledBy?.id || 'Dealer'}</td>
                        <td><span className="badge badge-rejected"><span className="badge-dot" style={{ background: '#ef4444' }} />Cancelled</span></td>
                        <td>
                          <button className="page-btn" onClick={() => router.push(`/orders/${order.orderId}`)}>View Order</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>
                      Order ID
                      <div className="th-filter">
                        <input type="text" placeholder="e.g. 45…" value={orderIdInput} onChange={e => setOrderIdInput(e.target.value)} maxLength={8} autoComplete="off" className={`w-[90px] ${inputCls(!!orderIdInput)}`} />
                      </div>
                    </th>
                    {cfg.showDealerCol && (
                      <th>
                        Dealer
                        <div className="th-filter">
                          <input type="text" placeholder="Search…" value={dealerInput} onChange={e => setDealerInput(e.target.value)} autoComplete="off" className={`w-[120px] ${inputCls(!!dealerInput)}`} />
                        </div>
                      </th>
                    )}
                    <th>
                      Order Date
                      <div className="th-filter">
                        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputCls(!!dateFrom)} style={{ width: 130 }} />
                      </div>
                    </th>
                    <th>Due Date</th>
                    <th>
                      Amount
                      <div className="th-filter flex gap-1">
                        <input type="number" placeholder="Min" value={amountMin} onChange={e => setAmountMin(e.target.value)} className={`w-[60px] ${inputCls(!!amountMin)}`} />
                        <input type="number" placeholder="Max" value={amountMax} onChange={e => setAmountMax(e.target.value)} className={`w-[60px] ${inputCls(!!amountMax)}`} />
                      </div>
                    </th>
                    <th>Discount</th>
                    <th>After Discount</th>
                    <th>Qty</th>
                    <th>
                      Confirmation
                      <div className="th-filter relative">
                        <select value={statusSearch} onChange={e => setStatusSearch(e.target.value)} className={`w-[110px] ${selectCls(!!statusSearch)}`}>
                          <option value="">Any</option>
                          <option value="1">Accepted</option>
                          <option value="0">Awaiting</option>
                        </select>
                      </div>
                    </th>
                    <th>
                      MT Status
                      <div className="th-filter relative">
                        <select value={mtFilter} onChange={e => setMtFilter(e.target.value)} className={`w-[145px] ${selectCls(!!mtFilter)}`}>
                          <option value="">Any</option>
                          <option value="Pending">Pending</option>
                          <option value="InProcess">In Process</option>
                          <option value="Completed">Completed</option>
                          <option value="NoActionTaken">No Action Taken</option>
                        </select>
                      </div>
                    </th>
                    {showCustomDiscountCol && <th>Custom Discount Status</th>}
                    {cfg.showActions && <th>Actions</th>}
                  </tr>
                </thead>

                <tbody>
                  {isLoading && Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: cfg.showDealerCol ? (showCustomDiscountCol ? 13 : 12) : (showCustomDiscountCol ? 12 : 11) }).map((_, j) => (
                        <td key={j}><div className="shimmer" style={{ width: j === 2 ? 120 : 70 }} /></td>
                      ))}
                    </tr>
                  ))}

                  {!isLoading && data.length === 0 && (
                    <tr className="empty-row">
                      <td colSpan={cfg.showDealerCol ? (showCustomDiscountCol ? 13 : 12) : (showCustomDiscountCol ? 12 : 11)}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5" style={{ margin: '0 auto 10px', display: 'block' }}>
                          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
                        </svg>
                        {hasClientFilters ? 'No orders match the current filters' : 'No orders found'}
                      </td>
                    </tr>
                  )}

                  {!isLoading && data.map((order, i) => {
                    const ab         = acceptBadge(order.accept_order)
                    const mtb        = mtBadge(order.mtstatus)
                    const rsmStatus  = rsmApprovalValue(order)
                    const showDelete = cfg.canDelete(session, order)
                    // An RSM reviews the order first; assigned staff can only accept
                    // once that review has cleared, matching the server-side gate.
                    const showAccept = isRsm
                      ? rsmStatus === 'AWAITING' || rsmStatus === ''
                      : cfg.canAccept(session, order) && (session.role !== 'staff' || rsmStatus === 'ACCEPTED')
                    const hlId       = orderIdInput ? highlight(order.order_id ?? '', orderIdInput) : (order.order_id ?? '')
                    const hlDealer   = dealerInput  ? highlight(order.Dealer_Name || '—', dealerInput) : (order.Dealer_Name || '—')
                    const amounts    = withDisplayOrderAmounts(order, summaryOverrides[order.order_id] ?? summaryOverrides[orderLookupKey(order.order_id)])
                    const discountBadge = formatAdditionalDiscountBadge(amounts)
                    const additionalDiscountDisplay = resolveAdditionalDiscountDisplay(amounts)
                    const customDiscountSummary = customDiscountProgressMap[getCustomDiscountProgressKeyForOrder(order.order_id)]
                    const customBadge = customDiscountBadge(customDiscountSummary?.customDiscountStatus ?? null)

                    return (
                      <tr key={order.order_id ?? i}>
                        <td className="mono-sm">{startIndex + i}</td>

                        <td>
                          <span className="order-id-pill" dangerouslySetInnerHTML={{ __html: formatDisplayOrderNumber(hlId) }} />
                        </td>

                        {cfg.showDealerCol && (
                          <td>
                            <div className="dealer-name" dangerouslySetInnerHTML={{ __html: hlDealer }} />
                            <div className="dealer-sub">ID: {order.order_dealer}</div>
                          </td>
                        )}

                        <td className="mono-sm">{(order.orderDate || order.order_date || '—').slice(0, 10)}</td>
                        <td className="mono-sm">{order.outstandingDate || '—'}</td>

                        <td><span className="amount-pill">₹{amounts.grossAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></td>
                        <td className="mono-sm">
                          {formatOrderListMoney(amounts.discountAmount)}
                          {additionalDiscountDisplay ? (
                            <>
                              <div className="qty-info" style={{ color: '#4f46e5', fontWeight: 600 }}>
                                {additionalDiscountDisplay.label}
                              </div>
                              <div className="qty-info" style={{ color: '#4f46e5' }}>
                                {additionalDiscountDisplay.amountText}
                              </div>
                            </>
                          ) : (
                            discountBadge && <div className="qty-info" style={{ color: '#4f46e5' }}>{discountBadge}</div>
                          )}
                        </td>
                        <td className="mono-sm">₹{amounts.netPayableAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>

                        <td style={{ textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: '#374151' }}>
                          {order.orderdata_item_quantity || '—'}
                        </td>

                        <td>
                          <span className={`badge ${ab.cls}`}>
                            <span className="badge-dot" style={{ background: ab.dot }} />
                            {ab.label}
                          </span>
                          {rsmStatus === 'ACCEPTED' && (
                            <div className="qty-info" style={{ color: '#047857', fontWeight: 600 }}>
                              RSM Approved{(order.rsmReviewedBy || order.rsm_reviewed_by) ? ` by ${order.rsmReviewedBy || order.rsm_reviewed_by}` : ''}
                            </div>
                          )}
                          {rsmStatus === 'DECLINED' && (
                            <div className="qty-info" style={{ color: '#be123c', fontWeight: 600 }}>
                              RSM Disapproved{(order.rsmReviewedBy || order.rsm_reviewed_by) ? ` by ${order.rsmReviewedBy || order.rsm_reviewed_by}` : ''}
                            </div>
                          )}
                          {rsmStatus === 'AWAITING' && (
                            <div className="qty-info" style={{ color: '#b45309', fontWeight: 600 }}>
                              Awaiting RSM approval
                            </div>
                          )}
                        </td>

                        <td>
                          <span className={`badge ${mtb.cls}`}>
                            <span className="badge-dot" style={{ background: mtb.dot }} />
                            {mtb.label}
                          </span>
                          <div className="qty-info">Total: {order.orderdata_item_quantity} · Dispatch: {order.readyquantity}</div>
                          {order.reason && <div className="reason-tag">⚠ {order.reason}</div>}
                        </td>

                        {showCustomDiscountCol && (
                          <td>
                            {customBadge ? (
                              <span className={`badge ${customBadge.cls}`}>
                                <span className="badge-dot" style={{ background: customBadge.dot }} />
                                {customBadge.label}
                              </span>
                            ) : (
                              <span className="mono-sm">—</span>
                            )}
                          </td>
                        )}

                        {cfg.showActions && (
                          <td>
                            <ActionMenu
                              showDelete={showDelete}
                              showAccept={showAccept}
                              showDispatch={false}
                              dispatchDisabled={true}
                              acceptOrder={order.accept_order}
                              rsmMode={isRsm}
                              // ── unified route: same detail page as order history ──
                              onView={() => router.push(`/orders/${order.order_id}`)}
                              onDispatch={() => openDispatchDetails(order)}
                              onAccept={() => handleAccept(order.order_id, 1)}
                              onDecline={() => handleAccept(order.order_id, 0)}
                              onDelete={() => handleDelete(order.order_id)}
                            />
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              )}
            </div>

            {/* Pagination */}
            <div className="pagination">
              <div className="pagination-info">
                {data.length > 0
                  ? <><strong>{startIndex}–{endIndex}</strong> of <strong>{total.toLocaleString()}</strong> orders</>
                  : 'No results'}
              </div>
              <div className="pager">
                <button className="page-btn" onClick={() => handlePageChange(page - 1)} disabled={page === 1}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
                  Prev
                </button>
                {pageNumbers().map((p, idx) =>
                  p === '…'
                    ? <span key={`e${idx}`} className="page-ell">…</span>
                    : <button key={p} onClick={() => handlePageChange(p as number)} className={`page-btn${p === page ? ' active' : ''}`}>{p}</button>
                )}
                <button className="page-btn" onClick={() => handlePageChange(page + 1)} disabled={page === totalPages}>
                  Next
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

      <DispatchDetailsDrawer
        order={dispatchOrder}
        products={dispatchProducts}
        loadingProducts={dispatchProductsLoading}
        productsError={dispatchProductsError}
        selectedProductId={selectedDispatchProductId}
        onSelectProduct={setSelectedDispatchProductId}
        history={dispatchHistory}
        historyLoading={dispatchHistoryLoading}
        historyError={dispatchHistoryError}
        form={dispatchForm}
        formError={dispatchFormError}
        submitting={dispatchSubmitting}
        onFormChange={handleDispatchFormChange}
        onSubmit={handleDispatchSubmit}
        onClose={closeDispatchDetails}
      />
    </>
  )
}
