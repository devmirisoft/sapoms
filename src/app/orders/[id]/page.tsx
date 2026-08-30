"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import moment from "moment";
import * as XLSX from "xlsx";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import { hasPriorityTag } from "@/lib/orderPriority";
import { formatDisplayOrderNumber } from "@/lib/orderDisplay";
import { downloadOrderInvoice, type OrderInvoiceData } from "@/lib/invoicegenerator";
import {
  formatAdditionalDiscountBadge,
  getOrderDiscountSummaryRows,
  resolveOrderAmounts,
  resolveOrderDiscountBreakdown,
} from "@/lib/orderAmounts";
import { mergeFallbackProductNotes } from "@/lib/orderProductNotes.mjs";
import {
  mergeOrderSummarySources,
  normalizeOrderDetailResponse,
  resolveEffectiveOrderDetailItems,
} from "@/lib/orderDetailItems";
import ProductDispatchPanel from "@/components/orders/ProductDispatchPanel";
import DispatchTrackingCard from "@/components/orders/DispatchTrackingCard";
import {
  buildBulkDispatchPlan,
  buildBulkDispatchLineKey,
  mergeOrderItemsWithDispatchRecords,
  canUserBulkDispatch,
  canUserEditDispatch,
  canUserEditDispatchTracking,
  readDispatchTrackingInfo,
  DISPATCH_MUTATION_STATUSES,
  DISPATCH_STATUS_LABELS,
  normalizeOrderAcceptance,
  resolveOrderAcceptance,
  type DispatchUserSession,
  type OrderDispatchRecord,
  type DispatchStatus,
  type DispatchTrackingInfo,
} from "@/lib/orderDispatch";
import { PenLine, Trash2 } from "lucide-react";
import { fetchLegacyDealerProfile, fetchLegacyOrderDetail } from "@/lib/legacyOrderDetail";


// ─── Types ────────────────────────────────────────────────────────────────────
type OrderData = {
  orderdata_id: string;
  orderdata_orderid: string;
  orderdata_cat_no: string;
  orderdata_item_quantity: string;
  orderdata_price: string;
  orderdata_discount: string;
  orderdata_afterDisPrice: string;
  orderdata_status: string;
  orderdata_datetime: string;
  product_name: string;
  product_discription: string;
  product_unit: string;
  readyquantity: string;
  remark?: string;
  remarks?: string;
  displayRemark?: string;
  fallbackProductNote?: string;
  order_note?: string;
  note?: string;
  priority?: string | boolean;
  isPriority?: string | boolean;
  is_priority?: string | boolean;
  discount: string;
  order_discount: string;
  del_status: string;
  accept_order?: string;
  staffid?: string;
  assignedstaff?: string;
  orderdata_dealerid?: string;
  Dealer_Name?: string;
  Dealer_Address?: string;
  Dealer_Number?: string;
  gst?: string;
  order_dealer?: string;
  packSize?: number | string;
  pack_size?: number | string;
  totalPieces?: number | string;
  total_pieces?: number | string;
  quantityPacks?: number | string;
  quantity_packs?: number | string;
  unitPrice?: number | string;
  unit_price?: number | string;
  listPriceTotal?: number | string;
  list_price_total?: number | string;
  listPrice?: number | string;
  list_price?: number | string;
  discountAmount?: number | string;
  discount_amount?: number | string;
  finalPrice?: number | string;
  final_price?: number | string;
  totalDiscountPercent?: number | string;
  total_discount_percentage?: number | string;
  total_discount?: number | string;
  orderItemId?: string | null;
  orderedQuantity?: number;
  dispatchedQuantity?: number;
  remainingQuantity?: number;
  dispatchStatus?: DispatchStatus;
  dispatchHistory?: Array<{
    id: string;
    quantity: number;
    remark: string;
    status: DispatchStatus;
    actorId: string;
    actorRole: "staff" | "admin";
    createdAt: string | Date;
  }>;
  occurrence?: number;
};

type DealerInfo = {
  Dealer_Id?: string;
  Dealer_Name?: string;
  Dealer_Email?: string;
  Dealer_Number?: string;
  Dealer_Address?: string;
  Dealer_shipto?: string;
  Dealer_City?: string;
  Dealer_Pincode?: string;
  Dealer_Username?: string;
  Dealer_Dealercode?: string;
  Dealer_Notes?: string;
  gst?: string;
  // creditdays?: string;
  discount?: string;
  // annualtarget?: string;
  staffname?: string;
  currentlimit?: string;
};

type OrderSummaryOverride = Record<string, unknown> & {
  grossAmount?: number | string;
  discountAmount?: number | string;
  netPayableAmount?: number | string;
  discountPercent?: number | string;
  baseDiscountAmount?: number | string;
  baseDiscountPercent?: number | string;
  customDiscountAmount?: number | string;
  customDiscountPercent?: number | string;
  amountBeforeSlab?: number | string;
  slabDiscountAmount?: number | string;
  slabDiscountPercent?: number | string;
  allocatedDiscountPercent?: number | string;
  approvedDiscountPercent?: number | string;
};

type ActiveOrderHeader = Record<string, unknown>;

type OrderProductNote = {
  orderId?: string;
  orderItemId?: string | null;
  sku?: string;
  normalizedSku?: string;
  occurrence?: number;
  note?: string;
};

type OrderMeta = Record<string, unknown> & {
  accept_order?: string;
  staffid?: string;
  assignedstaff?: string;
  order_dealer?: string;
  orderdata_dealerid?: string;
  del_status?: string;
  order_status?: string;
  Dealer_Name?: string;
  Dealer_Address?: string;
  Dealer_Number?: string;
  gst?: string;
  mtstatus?: string;
  order_date?: string;
  outstandingDate?: string;
  totalDiscountPercentage?: number | string;
  discountPercent?: number | string;
  allocatedDiscountPercent?: number | string;
  allocatedDiscount?: number | string;
  approvedDiscountPercent?: number | string;
  items?: unknown[];
};

type DispatchRecordResponse = OrderDispatchRecord & {
  remainingQuantity?: number;
};

type OrderDispatchAccessMeta = {
  accept_order?: string;
  staffid?: string;
  assignedstaff?: string;
  del_status?: string;
  order_status?: string;
  order_dealer?: string;
};

type OrderDispatchAccessState = {
  key: string;
  meta: OrderDispatchAccessMeta | null;
};

type OrderRevision = {
  previousOrderNumber?: string;
  previousOrderId?: string;
  rejectedByName?: string;
  rejectionNote?: string;
  rejectedAt?: string | null;
  submittedAt?: string;
  changes?: Array<{ type?: string; catNo?: string; summary?: string }>;
};

type EffectiveOrderOverlayState = {
  isCancelled: boolean;
  isEdited: boolean;
  latestRevision: number;
  cancellation?: { reason?: string; cancelledAt?: string; cancelledBy?: { id?: string; role?: string; name?: string } } | null;
  eligibility?: { canDealerChange?: boolean; reason?: string; accepted?: boolean } | null;
  changeHistory?: Array<{ summary?: string; type?: string }>;
  changeRequests?: Array<Record<string, unknown> & { id?: string; type?: string; status?: string; note?: string; requestedAt?: string; revision?: { effectiveItems?: OrderData[]; changes?: Array<{ summary?: string; type?: string }> }; originalItems?: OrderData[]; proposedItems?: OrderData[] } >;
  acceptance?: { status?: string; rawStatus?: string; acceptedAt?: string } | null;
};

const ORDER_DETAILS_FALLBACK_STORAGE_KEY = "omsons.orderDetailsFallback.v1";

function readLocalOrderDetailsFallback(orderId: string): OrderSummaryOverride | null {
  if (typeof window === "undefined" || !orderId) return null;
  try {
    const raw = localStorage.getItem(ORDER_DETAILS_FALLBACK_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const fallback = (parsed as Record<string, unknown>)[orderId];
    return fallback && typeof fallback === "object" && !Array.isArray(fallback)
      ? fallback as OrderSummaryOverride
      : null;
  } catch {
    return null;
  }
}

function saveLocalOrderDetailsFallback(orderId: string, fallback: Record<string, unknown>) {
  if (typeof window === "undefined" || !orderId) return;
  try {
    const raw = localStorage.getItem(ORDER_DETAILS_FALLBACK_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const records = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
    localStorage.setItem(ORDER_DETAILS_FALLBACK_STORAGE_KEY, JSON.stringify({
      ...records,
      [orderId]: {
        ...fallback,
        orderId,
        order_id: orderId,
        savedAt: new Date().toISOString(),
      },
    }));
  } catch {}
}

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function orderLookupKey(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const trailing = text.match(/(\d+)(?!.*\d)/)?.[1];
  if (!trailing) return text;
  const normalized = String(Number(trailing));
  return normalized === "NaN" ? trailing : normalized;
}

async function fetchOrderDispatchAccessMeta(
  orderId: string,
  dealerId: string,
  actor: DispatchUserSession
): Promise<OrderDispatchAccessMeta | null> {
  const dealerFilter = actor.role === "staff" && dealerId
    ? `&dealer=${encodeURIComponent(dealerId)}`
    : "";
  const url = `/api/orders-data?page=1&limit=20&search=${encodeURIComponent(orderId)}${dealerFilter}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`orders-data failed with ${response.status}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const matched = rows.find((entry: Record<string, unknown>) => orderLookupKey(entry?.order_id) === orderLookupKey(orderId));
  if (!matched) return null;

  return {
    accept_order: firstNonEmptyString(matched.accept_order),
    staffid: firstNonEmptyString(matched.staffid),
    assignedstaff: firstNonEmptyString(matched.assignedstaff),
    del_status: firstNonEmptyString(matched.del_status),
    order_status: firstNonEmptyString(matched.order_status),
    order_dealer: firstNonEmptyString(matched.order_dealer),
  };
}

function resolveCurrentUser(): DispatchUserSession | null {
  if (typeof window === "undefined") return null;

  try {
    const staffRaw = localStorage.getItem("staffData");
    if (staffRaw) {
      const parsed = JSON.parse(staffRaw);
      if (parsed?.staff_id) {
        return {
          role: parsed.role === "NSM" || parsed.staff_roletype === "NSM" || parsed.staff_roletype === "0" ? "admin" : "staff",
          id: String(parsed.staff_id),
          name: parsed.staff_name || "",
          roletype: String(parsed.staff_roletype ?? ""),
        };
      }
    }

    const userRaw = localStorage.getItem("UserData");
    if (userRaw) {
      const parsed = JSON.parse(userRaw);
      if (parsed?.Dealer_Id) {
        return {
          role: "dealer",
          id: String(parsed.Dealer_Id),
          name: parsed.Dealer_Name || "",
        };
      }
      if (parsed?.staff_id) {
        return {
          role: parsed.role === "NSM" || parsed.staff_roletype === "NSM" || parsed.staff_roletype === "0" ? "admin" : "staff",
          id: String(parsed.staff_id),
          name: parsed.staff_name || "",
          roletype: String(parsed.staff_roletype ?? ""),
        };
      }
      if (localStorage.getItem("roletype") === "3" && parsed && Object.keys(parsed).length > 0) {
        return {
          role: "admin",
          id: String(parsed.id || parsed.admin_id || parsed.Admin_Id || ""),
          name: parsed.name || parsed.email || "Admin",
          roletype: "0",
        };
      }
    }

    const adminRaw = localStorage.getItem("AdminData") || localStorage.getItem("admin");
    if (adminRaw) {
      const parsed = JSON.parse(adminRaw);
      if (parsed && Object.keys(parsed).length > 0) {
        return {
          role: "admin",
          id: String(parsed.id || parsed.admin_id || parsed.Admin_Id || ""),
          name: parsed.name || "Admin",
          roletype: "0",
        };
      }
    }
  } catch {}

  return null;
}

function buildDispatchHeaders(user: DispatchUserSession | null): HeadersInit {
  return {};
}

function buildDispatchRecordFallbackKey(record: Partial<OrderDispatchRecord>) {
  return [
    String(record.orderId ?? "").trim(),
    String(record.normalizedSku ?? record.sku ?? "").trim().toLowerCase(),
    String(record.occurrence ?? ""),
  ].join("::");
}

// ─── Status config ─────────────────────────────────────────────────────────────
const itemStatusMap: Record<string, { label: string; dot: string; text: string; bg: string }> = {
  "0": { label: "In Process",   dot: "bg-amber-400",   text: "text-amber-700",   bg: "bg-amber-50"   },
  "1": { label: "Processing",   dot: "bg-blue-400",    text: "text-blue-700",    bg: "bg-blue-50"    },
  "2": { label: "Dispatched",   dot: "bg-indigo-400",  text: "text-indigo-700",  bg: "bg-indigo-50"  },
  "3": { label: "Not in Stock", dot: "bg-red-400",     text: "text-red-700",     bg: "bg-red-50"     },
  "4": { label: "Successful",   dot: "bg-emerald-400", text: "text-emerald-700", bg: "bg-emerald-50" },
  pending: { label: "Pending", dot: "bg-amber-400", text: "text-amber-700", bg: "bg-amber-50" },
  packing: { label: "Packing", dot: "bg-blue-400", text: "text-blue-700", bg: "bg-blue-50" },
  dispatched: { label: "Dispatched", dot: "bg-indigo-400", text: "text-indigo-700", bg: "bg-indigo-50" },
  not_in_stock: { label: "Not in Stock", dot: "bg-red-400", text: "text-red-700", bg: "bg-red-50" },
  successful: { label: "Successful", dot: "bg-emerald-400", text: "text-emerald-700", bg: "bg-emerald-50" },
  partially_dispatched: { label: "Partially Dispatched", dot: "bg-orange-400", text: "text-orange-700", bg: "bg-orange-50" },
};

// A line item is "partially dispatched" when some but not all of the ordered
// quantity has gone out — "Not in Stock" stays as-is since it isn't progress.
function resolveItemStatusCode(o: OrderData, pricing: RowPricing): string {
  const rawCode = String(o.dispatchStatus ?? o.orderdata_status ?? "0");
  const isNotInStock = rawCode === "3" || rawCode === "not_in_stock";
  if (!isNotInStock && pricing.ready > 0 && pricing.left > 0) {
    return "partially_dispatched";
  }
  return rawCode;
}

function StatusPill({ code }: { code: string }) {
  const s = itemStatusMap[code] ?? { label: code || "—", dot: "bg-gray-300", text: "text-gray-600", bg: "bg-gray-50" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function extractOrderNote(orders: OrderData[], overlayNote: string) {
  if (overlayNote.trim()) return overlayNote.trim();
  for (const order of orders) {
    const direct = order.order_note || order.note;
    if (direct?.trim()) return direct.trim();
    const remarks = [order.remark, order.remarks].filter(Boolean).join(" | ");
    const fromRemark = remarks.match(/Order note:\s*([^|]+)/i)?.[1]?.trim();
    if (fromRemark) return fromRemark;
  }
  return "";
}

// ─── Tracking Modal ────────────────────────────────────────────────────────────
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function closeTo(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.01);
}

type RowPricing = {
  orderedQuantity: number;
  ready: number;
  left: number;
  pieces: number;
  packs: number;
  packSize: number;
  unitPrice: number;
  gross: number;
  discount: number;
  final: number;
  pct: number;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function rebalanceRowDiscounts(pricings: RowPricing[], targetDiscountTotal: number): RowPricing[] {
  const activeRows = pricings
    .map((pricing, index) => ({ pricing, index }))
    .filter(({ pricing }) => pricing.gross > 0);

  if (activeRows.length === 0) return pricings;

  const totalGross = activeRows.reduce((sum, row) => sum + row.pricing.gross, 0);
  if (!(totalGross > 0)) return pricings;

  const lastActiveIndex = activeRows[activeRows.length - 1]?.index ?? pricings.length - 1;
  let allocatedDiscount = 0;

  return pricings.map((pricing, index) => {
    if (!(pricing.gross > 0)) {
      return {
        ...pricing,
        discount: 0,
        final: roundMoney(pricing.gross),
        pct: 0,
      };
    }

    const nextDiscount = index === lastActiveIndex
      ? roundMoney(Math.max(0, targetDiscountTotal - allocatedDiscount))
      : roundMoney((targetDiscountTotal * pricing.gross) / totalGross);

    allocatedDiscount += nextDiscount;

    const discount = Math.min(roundMoney(pricing.gross), Math.max(0, nextDiscount));
    const final = roundMoney(Math.max(0, pricing.gross - discount));
    const pct = pricing.gross > 0 ? roundMoney((discount / pricing.gross) * 100) : 0;

    return {
      ...pricing,
      discount,
      final,
      pct,
    };
  });
}

function getRowPricing(o: OrderData, packLookup: Record<string, number>, orderMeta?: OrderMeta | null) {
  const orderedQuantity = num(o.orderdata_item_quantity);
  const ready = num(o.dispatchedQuantity ?? o.readyquantity);
  const unitPrice = num(o.unitPrice ?? o.unit_price ?? o.orderdata_price);
  const packSize = num(o.packSize ?? o.pack_size ?? packLookup[o.orderdata_cat_no]) || 1;
  const explicitPieces = num(o.totalPieces ?? o.total_pieces);
  const explicitPacks = num(o.quantityPacks ?? o.quantity_packs);

  const storedDiscount = num(o.discountAmount ?? o.discount_amount ?? o.orderdata_discount ?? o.order_discount);
  const storedNet = num(o.finalPrice ?? o.final_price ?? o.orderdata_afterDisPrice);
  const storedGross = storedDiscount + storedNet;
  const quantityGross = orderedQuantity * unitPrice;
  const packGross = quantityGross * packSize;

  let pieces = explicitPieces > 0 ? explicitPieces : orderedQuantity * packSize;
  let packs = explicitPacks > 0 ? explicitPacks : orderedQuantity;

  if (explicitPieces <= 0 && storedGross > 0 && unitPrice > 0 && packSize > 1 && !closeTo(quantityGross, storedGross) && closeTo(packGross, storedGross)) {
    pieces = orderedQuantity * packSize;
  }

  if (explicitPacks <= 0 && packSize > 1 && pieces !== orderedQuantity) {
    packs = orderedQuantity;
  }

  const explicitGross = num(o.listPriceTotal ?? o.list_price_total);
  const calculatedGross = unitPrice * pieces;
  const gross = explicitGross > 0 ? explicitGross : calculatedGross > 0 ? calculatedGross : storedGross;

  const perItemPct = num(o.totalDiscountPercent ?? o.total_discount_percentage ?? o.total_discount ?? o.discount);
  const orderPct = num(orderMeta?.totalDiscountPercentage ?? orderMeta?.discountPercent ?? orderMeta?.allocatedDiscountPercent ?? orderMeta?.allocatedDiscount);
  const derivedPct = gross > 0 && storedDiscount > 0 ? Math.round((storedDiscount / gross) * 10000) / 100 : 0;
  const pct = perItemPct || orderPct || derivedPct;

  const discount = storedDiscount > 0 ? storedDiscount : gross * (pct / 100);
  const final = storedNet > 0 ? storedNet : Math.max(0, gross - discount);

  return {
    orderedQuantity,
    ready,
    left: typeof o.remainingQuantity === "number" ? o.remainingQuantity : orderedQuantity - ready,
    pieces,
    packs,
    packSize,
    unitPrice,
    gross,
    discount,
    final,
    pct,
  };
}

export function LegacyTrackingModal() {
  return null;
}

// ─── View Toggle ───────────────────────────────────────────────────────────────
function TrackingModal({
  isOpen,
  orderId,
  dealerId,
  assignedStaffId,
  acceptOrder,
  delStatus,
  items,
  currentUser,
  selectedItemId,
  onClose,
  onRecordSaved,
}: {
  isOpen: boolean;
  orderId: string;
  dealerId?: string;
  assignedStaffId?: string;
  acceptOrder?: string;
  delStatus?: string;
  items: OrderData[];
  currentUser: DispatchUserSession | null;
  selectedItemId: string | null;
  onClose: () => void;
  onRecordSaved: (record: OrderDispatchRecord) => void;
}) {
  return (
    <ProductDispatchPanel
      isOpen={isOpen}
      orderId={orderId}
      dealerId={dealerId}
      assignedStaffId={assignedStaffId}
      acceptOrder={acceptOrder}
      delStatus={delStatus}
      items={items}
      currentUser={currentUser}
      selectedItemId={selectedItemId}
      onClose={onClose}
      onRecordSaved={onRecordSaved}
    />
  );
}

type ViewMode = "table" | "cards";

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <SegmentedTabs
      label="Result view"
      value={mode}
      onChange={(next) => onChange(next as ViewMode)}
      items={[
        {
          value: "table",
          label: "List",
          icon: (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" />
                    </svg>
                  ),
        },
        {
          value: "cards",
          label: "Cards",
          icon: (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                  ),
        },
      ]}
    />
  );
}

// ─── Card View ─────────────────────────────────────────────────────────────────
function ItemCard({
  o,
  idx,
  pricing,
  additionalDiscountType,
  onDispatch,
  dispatchLabel,
  selectable,
  selected,
  onSelectedChange,
}: {
  o: OrderData;
  idx: number;
  pricing: RowPricing;
  additionalDiscountType: "slab" | "custom" | null;
  onDispatch: () => void;
  dispatchLabel: string;
  selectable: boolean;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  const left    = pricing.left;
  const isDeleted = o.del_status === "1";
  const originalRemarksText = [o.remark, o.remarks].filter(Boolean).join(" | ");
  const progressPct = pricing.orderedQuantity > 0
    ? Math.round((pricing.ready / pricing.orderedQuantity) * 100) : 0;
  const isPriority = hasPriorityTag(o.priority, o.isPriority, o.is_priority, o.remark, o.remarks);

  return (
    <div className={`bg-white border border-gray-200 rounded-2xl p-5 flex flex-col gap-4 hover:border-gray-300 hover:shadow-md transition-all ${isDeleted ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelectedChange(event.target.checked)}
            aria-label={`Select ${o.product_name || o.orderdata_cat_no || "product"} for dispatch`}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold text-gray-400 font-mono">#{String(idx + 1).padStart(2, "0")}</span>
            <span className="text-[10px] font-bold text-amber-700 font-mono bg-amber-50 px-2 py-0.5 rounded-full">{o.orderdata_cat_no || "—"}</span>
            {isPriority && (
              <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                Priority
              </span>
            )}
          </div>
          <h3 className="text-[14px] font-bold text-gray-900 truncate">{o.product_name || "—"}</h3>
          {o.product_discription && <p className="text-[12px] text-gray-500 truncate mt-0.5">{o.product_discription}</p>}
          {o.fallbackProductNote && <p className="mt-2 text-[11px] leading-5 text-indigo-700">Product Note: {o.fallbackProductNote}</p>}
          {originalRemarksText && <p className="mt-2 text-[11px] leading-5 text-gray-600">{originalRemarksText}</p>}
        </div>
        <StatusPill code={resolveItemStatusCode(o, pricing)} />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-gray-600">Dispatch progress</span>
          <span className="text-[11px] font-mono font-bold text-gray-900">{progressPct}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[11px] text-gray-500 font-mono">{pricing.ready} dispatched</span>
          <span className={`text-[11px] font-mono font-semibold ${left > 0 ? "text-red-600" : "text-emerald-600"}`}>
            {left > 0 ? `${left} left` : "complete"}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 border-t border-gray-100 pt-4">
        {[
          { label: "Ordered",    val: `${pricing.packs}`, sub: "packs", cls: "text-gray-900" },
          { label: "Price",      val: `₹${pricing.unitPrice.toLocaleString("en-IN")}`, cls: "text-gray-900" },
          { label: "Discount",   val: `${pricing.pct}%`, sub: additionalDiscountType ? `incl. ${additionalDiscountType}` : undefined, cls: "text-amber-700" },
          { label: "Gross",      val: `₹${pricing.gross.toLocaleString("en-IN")}`, cls: "text-gray-500 line-through" },
          { label: "Saved",      val: `−₹${pricing.discount.toLocaleString("en-IN")}`, sub: additionalDiscountType ? `incl. ${additionalDiscountType}` : undefined, cls: "text-amber-700" },
          { label: "Final",      val: `₹${pricing.final.toLocaleString("en-IN")}`, cls: "text-emerald-700" },
        ].map(f => (
          <div key={f.label}>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{f.label}</p>
            <p className={`text-[13px] font-bold font-mono mt-0.5 ${f.cls}`}>{f.val}{f.sub && <span className="text-[11px] text-gray-500 font-normal"> {f.sub}</span>}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-gray-100 pt-3">
        <span className="text-[11px] text-gray-400 font-mono">{o.orderdata_datetime || "—"}</span>
        <button onClick={onDispatch} disabled={isDeleted}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all ${isDeleted ? "opacity-40 cursor-not-allowed bg-gray-50 text-gray-400 border-gray-200" : "bg-white text-gray-700 border-gray-200 hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50"}`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
          </svg>
          {dispatchLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Dealer Info Field ─────────────────────────────────────────────────────────
function DealerField({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
      <p className="text-[13px] font-semibold text-gray-900 mt-0.5 break-words">{value}</p>
    </div>
  );
}

function CancelOrderDialog({
  orderId,
  requestMode,
  saving,
  error,
  onClose,
  onConfirm,
}: {
  orderId: string;
  requestMode: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
        <h2 className="text-base font-bold text-gray-900">{requestMode ? "Request cancellation?" : "Cancel this order?"}</h2>
        <p className="mt-2 text-sm leading-6 text-gray-600">This action will remove order {formatDisplayOrderNumber(orderId)} from the active fulfilment workflow. The original order record will be preserved.</p>
        <label className="mt-5 block text-[11px] font-bold uppercase tracking-wider text-gray-500">{requestMode ? "Cancellation request note" : "Cancellation reason"}</label>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value.slice(0, 1000))}
          disabled={saving}
          className="mt-2 text-gray-900 h-28 w-full resize-none rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100"
        />
        {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Keep Order</button>
          <button type="button" onClick={() => onConfirm(reason)} disabled={saving} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            {saving ? (requestMode ? "Sending..." : "Cancelling...") : (requestMode ? "Request Cancellation" : "Cancel Order")}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditOrderDialog({
  items,
  packLookup,
  latestRevision,
  requestMode,
  saving,
  error,
  onClose,
  onSave,
}: {
  items: OrderData[];
  packLookup: Record<string, number>;
  latestRevision: number;
  requestMode: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (payload: { expectedRevision: number; items: Array<Record<string, unknown>>; note?: string }) => void;
}) {
  const [draftItems, setDraftItems] = useState(() => items.map((item) => ({ ...item, originalLineId: item.orderdata_id })));
  const [reviewing, setReviewing] = useState(false);
  const [requestNote, setRequestNote] = useState("");
  const visibleItems = draftItems.filter((item) => !(item as Record<string, unknown>)._removed);
  const invalidQuantity = visibleItems.some((item) => !(Number(item.orderdata_item_quantity) > 0));
  const changeSummaries = draftItems.flatMap((item) => {
    const original = items.find((entry) => entry.orderdata_id === item.originalLineId);
    if (!original) return [];
    if ((item as Record<string, unknown>)._removed) return [`Removed: ${original.product_name || original.orderdata_cat_no}`];
    const changes: string[] = [];
    if (String(original.orderdata_cat_no ?? "").trim().toLowerCase() !== String(item.orderdata_cat_no ?? "").trim().toLowerCase()) changes.push(`Replaced ${original.orderdata_cat_no} with ${item.orderdata_cat_no}`);
    if (Number(original.orderdata_item_quantity) !== Number(item.orderdata_item_quantity)) changes.push(`Quantity ${original.orderdata_item_quantity} to ${item.orderdata_item_quantity} for ${item.product_name || item.orderdata_cat_no}`);
    return changes;
  });

  const updateItem = (lineId: string, patch: Partial<OrderData>) => {
    setDraftItems((current) => current.map((item) => {
      if (item.originalLineId !== lineId) return item;
      const next = { ...item, ...patch };
      if (patch.orderdata_cat_no !== undefined) {
        const resolvedPack = packLookup[String(patch.orderdata_cat_no).trim()];
        if (resolvedPack > 0) {
          next.packSize = resolvedPack;
          next.pack_size = resolvedPack;
        }
      }
      return next;
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div className="w-full max-w-5xl rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-gray-900">{requestMode ? "Request Edit" : "Edit Order Items"}</h2>
            <p className="mt-1 text-sm text-gray-600">{requestMode ? "Send the proposed edited order for Admin/NSM approval." : "Remove items, replace catalogue details, or correct quantities before acceptance."}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600">Close</button>
        </div>
        {!reviewing ? (
          <div className="mt-5 max-h-[60vh] overflow-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                <tr><th className="p-3 text-gray-900">Cat No.</th><th className="p-3">Product</th><th className="p-3">Qty</th><th className="p-3">Pack</th><th className="p-3">Note</th><th className="p-3">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {draftItems.map((item) => {
                  const removed = !!(item as Record<string, unknown>)._removed;
                  return (
                    <tr key={item.originalLineId} className={removed ? "opacity-95" : ""}>
                      <td className="p-3 text-gray-900"><input value={String(item.orderdata_cat_no ?? "")} disabled={removed || saving} onChange={(event) => updateItem(item.originalLineId, { orderdata_cat_no: event.target.value })} className="w-36 rounded-lg border border-gray-200 px-2 py-1.5 font-mono text-xs" /></td>
                      <td className="p-3 text-gray-900"><input value={String(item.product_name ?? "")} disabled={removed || saving} onChange={(event) => updateItem(item.originalLineId, { product_name: event.target.value })} className="w-64 rounded-lg border border-gray-200 px-2 py-1.5 text-xs" /></td>
                      <td className="p-3 text-gray-900"><input type="number" min="1" value={String(item.orderdata_item_quantity ?? "")} disabled={removed || saving} onChange={(event) => updateItem(item.originalLineId, { orderdata_item_quantity: event.target.value })} className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-xs" /></td>
                      <td className="p-3 text-gray-900"><input type="number" min="1" value={String(packLookup[String(item.orderdata_cat_no ?? "").trim()] ?? item.packSize ?? item.pack_size ?? 1)} disabled={removed || saving} onChange={(event) => updateItem(item.originalLineId, { packSize: event.target.value, pack_size: event.target.value })} className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-xs" /></td>
                      <td className="p-3 text-xs text-gray-900">{item.fallbackProductNote || item.remark || "—"}</td>
                      <td className="p-3">
                        <button type="button" disabled={saving} onClick={() => updateItem(item.originalLineId, { _removed: !removed } as Partial<OrderData>)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700">
                          {removed ? "Restore" : "Remove"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>


            </table>
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Review Changes</p>
            {changeSummaries.length === 0 ? <p className="mt-2 text-sm text-amber-800">No changes detected.</p> : (
              <ul className="mt-2 space-y-1 text-sm text-amber-900">{changeSummaries.map((summary, index) => <li key={index}>{summary}</li>)}</ul>
            )}
          </div>
        )}
        {requestMode && (
          <label className="mt-4 block text-[11px] font-bold uppercase tracking-wider text-gray-500">
            Edit request note
            <textarea value={requestNote} onChange={(event) => setRequestNote(event.target.value.slice(0, 1000))} disabled={saving} className="mt-2 h-24 w-full resize-none rounded-xl border border-gray-200 p-3 text-sm normal-case tracking-normal text-gray-900 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100" />
          </label>
        )}
        {visibleItems.length === 0 && <p className="mt-3 text-sm font-medium text-red-600">An edited order cannot be saved with no items. Use Cancel Order instead.</p>}
        {visibleItems.length > 0 && invalidQuantity && <p className="mt-3 text-sm font-medium text-red-600">Every remaining item needs a quantity greater than zero.</p>}
        {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          {reviewing && <button type="button" onClick={() => setReviewing(false)} disabled={saving} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700">Back</button>}
          {!reviewing ? (
            <button type="button" onClick={() => setReviewing(true)} disabled={saving || visibleItems.length === 0 || invalidQuantity} className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Review Changes</button>
          ) : (
            <button type="button" disabled={saving || visibleItems.length === 0 || invalidQuantity || changeSummaries.length === 0 || (requestMode && !requestNote.trim())} onClick={() => onSave({ expectedRevision: latestRevision, items: visibleItems, note: requestNote })} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {saving ? (requestMode ? "Sending..." : "Saving...") : (requestMode ? "Request Edit" : "Save Edit")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function ViewOrderDealerPage() {
  const params   = useParams();
  const router   = useRouter();
  const id       = params.id as string;
  const tableRef = useRef<HTMLTableElement>(null);
  const year     = new Date().getFullYear();

  const [phpOrders, setPhpOrders] = useState<OrderData[]>([]);
  const [loading,   setLoading  ] = useState(true);
  const [orderAccessVerified, setOrderAccessVerified] = useState(false);
  const [viewMode,  setViewMode ] = useState<ViewMode>("table");
  const [localOrderNote, setLocalOrderNote] = useState("");
  const [packLookup, setPackLookup] = useState<Record<string, number>>({});
  const [orderMeta, setOrderMeta] = useState<OrderMeta | null>(null);
  const [activeOrderHeader, setActiveOrderHeader] = useState<ActiveOrderHeader | null>(null);
  const isPostgresDetail = activeOrderHeader?.__source === "postgres";
  const [orderAccessState, setOrderAccessState] = useState<OrderDispatchAccessState>({ key: "", meta: null });
  const [summaryOverride, setSummaryOverride] = useState<OrderSummaryOverride | null>(null);
  const [localOrderFallback, setLocalOrderFallback] = useState<OrderSummaryOverride | null>(null);
  const [overlayTotals, setOverlayTotals] = useState<OrderSummaryOverride | null>(null);
  const [, setOverlayError] = useState("");
  const [, setSummaryError] = useState("");
  const [, setProductNotesError] = useState("");
  const [fallbackProductNotes, setFallbackProductNotes] = useState<OrderProductNote[]>([]);
  const [dispatchRecords, setDispatchRecords] = useState<DispatchRecordResponse[]>([]);
  const [dispatchRecordsLoaded, setDispatchRecordsLoaded] = useState(false);
  const [dispatchRecordsOrderId, setDispatchRecordsOrderId] = useState("");
  const [dispatchRecordsError, setDispatchRecordsError] = useState("");
  const [activeDispatchItemId, setActiveDispatchItemId] = useState<string | null>(null);
  const [dispatchAllDialogOpen, setDispatchAllDialogOpen] = useState(false);
  const [dispatchAllRemark, setDispatchAllRemark] = useState("");
  const [dispatchAllIdempotencyKey, setDispatchAllIdempotencyKey] = useState("");
  const [dispatchAllSaving, setDispatchAllSaving] = useState(false);
  const [dispatchAllError, setDispatchAllError] = useState("");
  const [dispatchTrackingOverride, setDispatchTrackingOverride] = useState<DispatchTrackingInfo | null>(null);
  const [selectedDispatchKeys, setSelectedDispatchKeys] = useState<Set<string>>(new Set());
  const [dispatchSelectedQuantities, setDispatchSelectedQuantities] = useState<Record<string, string>>({});
  const [dispatchSelectedStatus, setDispatchSelectedStatus] = useState<Exclude<DispatchStatus, "pending">>("dispatched");
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceToast, setInvoiceToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [overlayState, setOverlayState] = useState<EffectiveOrderOverlayState | null>(null);
  const [overlayItems, setOverlayItems] = useState<OrderData[] | null>(null);
  // Revisions of a previously disapproved order: what the dealer changed before
  // sending it back for approval.
  const [orderRevisions, setOrderRevisions] = useState<OrderRevision[]>([]);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelSaving, setCancelSaving] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  // RSM approval lives here (moved out of the order-management row menu).
  const [isRsm, setIsRsm] = useState(false);
  const [rsmSaving, setRsmSaving] = useState(false);
  const [rsmDeclineOpen, setRsmDeclineOpen] = useState(false);
  const [rsmDeclineNote, setRsmDeclineNote] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const dealer = useMemo<DealerInfo | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem("UserData");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.Dealer_Id ? parsed as DealerInfo : null;
    } catch {
      return null;
    }
  }, []);
  const [orderDealerProfile, setOrderDealerProfile] = useState<DealerInfo | null>(null);
  const currentUser = useMemo<DispatchUserSession | null>(() => resolveCurrentUser(), []);
  const orderAccessDealerId = useMemo(
    () => firstNonEmptyString(
      phpOrders[0]?.order_dealer,
      phpOrders[0]?.orderdata_dealerid,
      orderMeta?.order_dealer,
      orderMeta?.orderdata_dealerid,
      activeOrderHeader?.order_dealer,
      activeOrderHeader?.orderdata_dealerid,
      activeOrderHeader?.Dealer_Id
    ),
    [activeOrderHeader, orderMeta, phpOrders]
  );
  const orderAccessKey = useMemo(
    () => (id ? `${id}:${orderAccessDealerId || "header"}` : ""),
    [id, orderAccessDealerId]
  );
  const orderAccessMeta = orderAccessState.key.split(":")[0] === id ? orderAccessState.meta : null;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setLocalOrderFallback(readLocalOrderDetailsFallback(id));
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const applyDetailPayload = (payload: unknown, persistFallback: boolean) => {
      const normalized = normalizeOrderDetailResponse(payload, id);
      if (cancelled) return normalized;
      setPhpOrders(normalized.items as OrderData[]);
      setOrderMeta(normalized.meta as OrderMeta);
      if (normalized.items.length > 0 && persistFallback) {
        const fallback = { ...(normalized.meta ?? {}), items: normalized.items };
        saveLocalOrderDetailsFallback(id, fallback);
        setLocalOrderFallback(fallback as OrderSummaryOverride);
      }
      return normalized;
    };

    const finishLoading = () => {
      if (cancelled) return;
      setOrderAccessVerified(true);
      setLoading(false);
    };

    const loadPostgresDetails = async () => {
      const response = await fetch("/api/order-access/" + encodeURIComponent(id), { cache: "no-store" });
      if (!response.ok) return false;
      const json = await response.json();
      if (!json?.success || !json.data || json.data.__source !== "postgres") return false;
      const normalized = applyDetailPayload({ data: json.data }, true);
      if (!cancelled) {
        setActiveOrderHeader(json.data as ActiveOrderHeader);
        setLocalOrderNote(String(json.data.order_note ?? json.data.note ?? json.data.orderNotes?.[0]?.note ?? ""));
        setFallbackProductNotes(Array.isArray(json.data.orderProductNotes) ? json.data.orderProductNotes : []);
        setSummaryOverride(Array.isArray(json.data.summaryOverrides) ? json.data.summaryOverrides[0] ?? null : null);
        setOverlayTotals(null);
        setOverlayItems(null);
        setOverlayState({ isCancelled: String(json.data.status ?? "") === "CANCELLED", isEdited: false, latestRevision: 0, acceptance: null });
        setOrderRevisions(
          (Array.isArray(json.data.overlays) ? json.data.overlays : [])
            .filter((overlay: { type?: string }) => overlay?.type === "revision")
            .map((overlay: { metadata?: OrderRevision }) => (overlay.metadata ?? {}) as OrderRevision)
        );
        setDispatchRecords(Array.isArray(json.data.dispatchRecords) ? json.data.dispatchRecords : []);
        setDispatchRecordsLoaded(true);
        setDispatchRecordsOrderId(id);
        setDispatchRecordsError("");
      }
      return normalized.items.length > 0;
    };

    const loadLegacyDetails = async () => {
      const payload = await fetchLegacyOrderDetail(id);
      const normalized = applyDetailPayload(payload, true);
      if (!cancelled) setActiveOrderHeader(normalized.meta as ActiveOrderHeader);
      return normalized.items.length > 0;
    };

    loadPostgresDetails()
      .then(async (loaded) => {
        if (!loaded) await loadLegacyDetails();
      })
      .catch(async () => {
        try {
          if (!await loadLegacyDetails() && !cancelled) {
            setActiveOrderHeader(null);
            setPhpOrders([]);
          }
        } catch {
          if (!cancelled) {
            setActiveOrderHeader(null);
            setPhpOrders([]);
            setOrderMeta(null);
          }
        }
      })
      .finally(finishLoading);

    return () => {
      cancelled = true;
    };
  }, [currentUser, id, reloadKey]);

  useEffect(() => {
    if (!orderAccessVerified || isPostgresDetail || !id || !orderAccessKey || !currentUser) return;

    let cancelled = false;

    fetchOrderDispatchAccessMeta(id, orderAccessDealerId, currentUser)
      .then((meta) => {
        if (!cancelled && meta) {
          setActiveOrderHeader((current) => ({ ...(current ?? {}), ...meta }));
        }
        if (!cancelled) setOrderAccessState((previous) => {
          if (meta || previous.key !== orderAccessKey || normalizeOrderAcceptance(previous.meta?.accept_order) !== "accepted") {
            return { key: orderAccessKey, meta };
          }
          return previous;
        });
      })
      .catch(() => {
        if (!cancelled) setOrderAccessState((previous) =>
          previous.key === orderAccessKey && normalizeOrderAcceptance(previous.meta?.accept_order) === "accepted"
            ? previous
            : { key: orderAccessKey, meta: null }
        );
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser, id, orderAccessDealerId, orderAccessKey, isPostgresDetail, orderAccessVerified]);

  useEffect(() => {
    if (!orderAccessVerified || !isPostgresDetail || !id) return;

    let cancelled = false;
    fetch(`/api/order-overlays/${encodeURIComponent(id)}`, {
      cache: "no-store",
      headers: buildDispatchHeaders(currentUser),
    })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((json) => {
        if (cancelled || !json?.success || !json.data) return;
        setOverlayError("");
        const data = json.data as {
          effectiveItems?: OrderData[];
          effectiveTotals?: { grossAmount?: number; discountAmount?: number; netPayableAmount?: number };
          itemContract?: "complete" | "partial";
          overlay?: { acceptance?: EffectiveOrderOverlayState["acceptance"]; changeRequests?: EffectiveOrderOverlayState["changeRequests"] } | null;
        } & EffectiveOrderOverlayState;
        setOverlayItems(Array.isArray(data.effectiveItems)
          ? normalizeOrderDetailResponse({ data: { ...data, items: data.effectiveItems } }, id).items as OrderData[]
          : null);
        if (data.isEdited && data.effectiveTotals) {
          setOverlayTotals({
            grossAmount: data.effectiveTotals.grossAmount,
            discountAmount: data.effectiveTotals.discountAmount,
            netPayableAmount: data.effectiveTotals.netPayableAmount,
          });
        } else {
          setOverlayTotals(null);
        }
        setOverlayState({
          isCancelled: !!data.isCancelled,
          isEdited: !!data.isEdited,
          latestRevision: Number(data.latestRevision ?? 0),
          cancellation: data.cancellation,
          eligibility: data.eligibility,
          changeHistory: data.changeHistory,
          changeRequests: Array.isArray(data.overlay?.changeRequests) ? data.overlay.changeRequests : [],
          acceptance: data.overlay?.acceptance ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) setOverlayError("Order changes could not be loaded; original order items are shown.");
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser, id, isPostgresDetail, orderAccessVerified, reloadKey]);

  useEffect(() => {
    if (!orderAccessVerified || isPostgresDetail || !id) return;
    fetch(`/api/order-notes?order_id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data?.[0]?.note) setLocalOrderNote(json.data[0].note);
      })
      .catch(() => {});
  }, [id, isPostgresDetail, orderAccessVerified]);

  useEffect(() => {
    if (!orderAccessVerified || isPostgresDetail || !id) return;
    fetch(`/api/order-product-notes?orderId=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((json) => {
        if (json.success && Array.isArray(json.data)) {
          setFallbackProductNotes(json.data);
          setProductNotesError("");
        } else {
          setProductNotesError("Product Notes could not be loaded.");
        }
      })
      .catch(() => setProductNotesError("Product Notes could not be loaded."));
  }, [id, isPostgresDetail, orderAccessVerified]);

  useEffect(() => {
    if (!orderAccessVerified || isPostgresDetail || !id) return;
    const params = new URLSearchParams({ order_id: id });
    if (orderAccessDealerId) params.set("dealer_id", orderAccessDealerId);
    fetch(`/api/order-summary-overrides?${params.toString()}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(json => {
        if (json.success && Array.isArray(json.data)) {
          const normalizedId = orderLookupKey(id);
          const matched = json.data.find((item: OrderSummaryOverride) =>
            orderLookupKey(item.orderId ?? item.order_id) === normalizedId
          );
          setSummaryOverride(matched ?? json.data[0] ?? null);
          setSummaryError("");
        }
      })
      .catch(() => setSummaryError("Discount metadata could not be loaded; stored order totals remain visible."));
  }, [id, orderAccessDealerId, isPostgresDetail, orderAccessVerified]);

  useEffect(() => {
    if (!orderAccessVerified || isPostgresDetail || !id || !currentUser?.id) return;

    fetch(`/api/order-dispatch?orderId=${encodeURIComponent(id)}`, {
      cache: "no-store",
      headers: buildDispatchHeaders(currentUser),
    })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((json) => {
        if (json.success && Array.isArray(json.data)) {
          setDispatchRecords(json.data);
          setDispatchRecordsLoaded(true);
          setDispatchRecordsOrderId(id);
          setDispatchRecordsError("");
        } else {
          setDispatchRecords([]);
          setDispatchRecordsLoaded(true);
          setDispatchRecordsOrderId(id);
          setDispatchRecordsError("Dispatch data could not be verified.");
        }
      })
      .catch(() => {
        setDispatchRecords([]);
        setDispatchRecordsLoaded(true);
        setDispatchRecordsOrderId(id);
        setDispatchRecordsError("Dispatch data could not be verified.");
      });
  }, [currentUser, id, isPostgresDetail, orderAccessVerified]);

  // Load product pack sizes (catNo -> packSize) from local nested product data
  useEffect(() => {
    fetch('/data/nested_omsons_products.json')
      .then(r => r.json())
      .then((data: Array<Record<string, unknown>>) => {
        const map: Record<string, number> = {};
        (data ?? []).forEach(product => {
          const variants = Array.isArray(product.variants) ? product.variants as Array<Record<string, unknown>> : [];
          variants.forEach((variant) => {
            const catNo = String(variant.sku ?? variant.id ?? "").trim();
            const pack = Number(variant.pack ?? variant.packSize ?? variant.pack_size);
            if (catNo && Number.isFinite(pack) && pack > 0) map[catNo] = pack;
          });
        });
        setPackLookup(map);
      })
      .catch(() => {});
  }, []);

  const displayOrders = useMemo(() => {
    const summaryItems = Array.isArray(summaryOverride?.items)
      ? normalizeOrderDetailResponse({ data: { ...(summaryOverride ?? {}), items: summaryOverride.items } }, id).items as OrderData[]
      : [];
    const localItems = Array.isArray(localOrderFallback?.items)
      ? normalizeOrderDetailResponse({ data: { ...(localOrderFallback ?? {}), items: localOrderFallback.items } }, id).items as OrderData[]
      : [];
    const sourceItems = phpOrders.length > 0 ? phpOrders : summaryItems.length > 0 ? summaryItems : localItems;
    const hasEffectiveOverlay = !!overlayState?.isEdited || (overlayItems?.length ?? 0) > 0;
    const effectiveItems = resolveEffectiveOrderDetailItems(sourceItems, !hasEffectiveOverlay || overlayItems === null ? null : {
      effectiveItems: overlayItems,
      itemContract: "complete",
    }) as OrderData[];
    const withProductNotes = mergeFallbackProductNotes(effectiveItems, fallbackProductNotes) as OrderData[];
    return mergeOrderItemsWithDispatchRecords(withProductNotes, dispatchRecords) as OrderData[];
  }, [dispatchRecords, fallbackProductNotes, id, localOrderFallback, overlayItems, overlayState?.isEdited, phpOrders, summaryOverride]);

  const handleDispatchRecordsSaved = (records: OrderDispatchRecord[]) => {
    setDispatchRecords((previous) => {
      const copy = [...previous];

      for (const record of records) {
        const nextRecord = record as DispatchRecordResponse;
        const index = copy.findIndex((entry) =>
          String(entry.orderItemId ?? "") && String(record.orderItemId ?? "")
            ? entry.orderItemId === record.orderItemId
            : buildDispatchRecordFallbackKey(entry) === buildDispatchRecordFallbackKey(record)
        );

        if (index === -1) {
          copy.unshift(nextRecord);
        } else {
          copy[index] = nextRecord;
        }
      }

      return copy;
    });
  };

  const handleDispatchRecordSaved = (record: OrderDispatchRecord) => {
    handleDispatchRecordsSaved([record]);
  };

  const handleExport = () => {
    if (!tableRef.current) return;
    const wb = XLSX.utils.table_to_book(tableRef.current, { sheet: "Order Details" });
    XLSX.writeFile(wb, `order-${id}-${moment().format("YYYY-MM-DD")}.xlsx`);
  };

  const firstOrder = displayOrders[0];
  const resolvedSummary = useMemo(
    () => mergeOrderSummarySources(summaryOverride ?? localOrderFallback, overlayTotals) as OrderSummaryOverride,
    [localOrderFallback, overlayTotals, summaryOverride]
  );
  const displayOrderMeta = useMemo(
    () => ({ ...(activeOrderHeader ?? {}), ...(orderMeta ?? {}), ...resolvedSummary }) as OrderMeta,
    [activeOrderHeader, orderMeta, resolvedSummary]
  );
  // Settlement is written by the Accountant onto the order's ledger bills; the
  // API rolls it up into `settlement` on the order payload.
  const settlementSummary = useMemo(
    () => (displayOrderMeta as any)?.settlement ?? (firstOrder as any)?.settlement ?? null,
    [displayOrderMeta, firstOrder]
  );

  const assignedStaffId = firstNonEmptyString(
    orderAccessMeta?.assignedstaff,
    orderAccessMeta?.staffid,
    firstOrder?.assignedstaff,
    firstOrder?.staffid,
    displayOrderMeta?.assignedstaff,
    displayOrderMeta?.staffid
  );
  const acceptOrder = resolveOrderAcceptance({
    phpValues: [orderAccessMeta?.accept_order, firstOrder?.accept_order, displayOrderMeta?.accept_order],
    mongoAccepted: overlayState?.acceptance?.rawStatus,
    deleted: orderAccessMeta?.del_status ?? firstOrder?.del_status ?? displayOrderMeta?.del_status,
    terminalValues: [orderAccessMeta?.order_status, displayOrderMeta?.order_status, displayOrderMeta?.status, displayOrderMeta?.mtstatus, overlayState?.isCancelled ? "cancelled" : ""],
  });
  const orderDeleted = firstNonEmptyString(
    orderAccessMeta?.del_status,
    firstOrder?.del_status,
    displayOrderMeta?.del_status,
    "0"
  );
  const dealerIdForDispatch = firstNonEmptyString(
    orderAccessMeta?.order_dealer,
    firstOrder?.order_dealer,
    firstOrder?.orderdata_dealerid,
    displayOrderMeta?.order_dealer,
    displayOrderMeta?.orderdata_dealerid,
    dealer?.Dealer_Id
  );
  useEffect(() => {
    if (!dealerIdForDispatch || dealer?.Dealer_Id === dealerIdForDispatch) {
      setOrderDealerProfile(null);
      return;
    }

    let cancelled = false;
    fetchLegacyDealerProfile(dealerIdForDispatch)
      .then((json) => {
        if (cancelled) return;
        const payload = json && typeof json === "object" ? json as Record<string, unknown> : {};
        const data = payload.data;
        const record = data && typeof data === "object" ? data as Record<string, unknown> : null;
        setOrderDealerProfile(record?.Dealer_Id ? record as DealerInfo : null);
      })
      .catch(() => {
        if (!cancelled) setOrderDealerProfile(null);
      });

    return () => {
      cancelled = true;
    };
  }, [dealer?.Dealer_Id, dealerIdForDispatch]);
  const resolvedDealer = dealer ?? orderDealerProfile;
  const canEditDispatchDetails = canUserEditDispatch(currentUser, {
    dealerId: dealerIdForDispatch,
    assignedStaffId,
    acceptOrder,
    delStatus: orderDeleted,
  });
  const canEditDispatchTracking = canUserEditDispatchTracking(currentUser, {
    dealerId: dealerIdForDispatch,
    assignedStaffId,
    acceptOrder,
    delStatus: orderDeleted,
  }) && !overlayState?.isCancelled;
  // Saved value wins until the order reloads with the stored tracking info.
  const dispatchTracking = dispatchTrackingOverride
    ?? readDispatchTrackingInfo(displayOrderMeta as unknown as Record<string, unknown>);
  const canUseDispatchAll = canUserBulkDispatch(currentUser, {
    dealerId: dealerIdForDispatch,
    assignedStaffId,
    acceptOrder,
    delStatus: orderDeleted,
  }) && !overlayState?.isCancelled && dispatchRecordsLoaded && dispatchRecordsOrderId === id;
  const dispatchAllPlan = useMemo(() => buildBulkDispatchPlan(displayOrders), [displayOrders]);
  const showDispatchAllControl = canUseDispatchAll;
  const dispatchableByKey = useMemo(
    () => new Map(dispatchAllPlan.lines.map((line) => [buildBulkDispatchLineKey(line), line])),
    [dispatchAllPlan]
  );
  const selectedDispatchLines = useMemo(
    () => dispatchAllPlan.lines.filter((line) => selectedDispatchKeys.has(buildBulkDispatchLineKey(line))),
    [dispatchAllPlan, selectedDispatchKeys]
  );
  const dispatchAllHasLines = selectedDispatchLines.length > 0;
  const baseRowPricings = useMemo(
    () => displayOrders.map((o) => getRowPricing(o, packLookup, displayOrderMeta)),
    [displayOrders, packLookup, displayOrderMeta]
  );
  // Compute totals from the same row pricing used by the table and cards.
  const calculatedTotals = baseRowPricings.reduce((acc, pricing) => {
    return {
      qty: acc.qty + pricing.orderedQuantity,
      pieces: acc.pieces + pricing.pieces,
      gross: acc.gross + pricing.gross,
      discount: acc.discount + pricing.discount,
      final: acc.final + pricing.final,
    };
  }, { qty: 0, pieces: 0, gross: 0, discount: 0, final: 0 });
  const hasOrderLevelTotals = [
    displayOrderMeta?.grossAmount,
    displayOrderMeta?.gross_amount,
    displayOrderMeta?.order_amount,
    displayOrderMeta?.discountAmount,
    displayOrderMeta?.discount_amount,
    displayOrderMeta?.order_discount_amount,
    displayOrderMeta?.order_discount,
    displayOrderMeta?.netPayableAmount,
    displayOrderMeta?.net_payable_amount,
    displayOrderMeta?.finalPayableAmount,
    displayOrderMeta?.order_net_amount,
  ].some((value) => value !== undefined && value !== null && value !== "");
  const orderLevelAmounts = hasOrderLevelTotals ? resolveOrderAmounts(displayOrderMeta) : null;
  const overrideAmounts = Object.keys(resolvedSummary).length > 0
    ? resolveOrderAmounts(orderLevelAmounts ? {
        grossAmount: orderLevelAmounts.gross,
        discountAmount: orderLevelAmounts.discountAmount,
        netPayableAmount: orderLevelAmounts.netPayable,
      } : {
        grossAmount: calculatedTotals.gross,
        discountAmount: calculatedTotals.discount,
        netPayableAmount: calculatedTotals.final,
      }, resolvedSummary)
    : orderLevelAmounts;
  const totals = overrideAmounts
  ? {
      ...calculatedTotals,
      gross: overrideAmounts.gross,
      discount: overrideAmounts.discountAmount,
      final: overrideAmounts.netPayable,
    }
  : calculatedTotals;
  const discountBreakdown = resolveOrderDiscountBreakdown({
    ...(displayOrderMeta ?? {}),
    grossAmount: totals.gross,
    discountAmount: totals.discount,
    netPayableAmount: totals.final,
  }, undefined, { itemDiscountTotal: calculatedTotals.discount });
  const discountSummaryRows = getOrderDiscountSummaryRows(discountBreakdown);
  const additionalDiscountBadge = formatAdditionalDiscountBadge(discountBreakdown);
  const rowPricings = (() => {
    if (!overrideAmounts || closeTo(calculatedTotals.discount, totals.discount)) return baseRowPricings;
    return rebalanceRowDiscounts(baseRowPricings, totals.discount);
  })();

  const buildInvoiceOrder = () => ({
    ...(displayOrderMeta ?? {}),
    order_id: id,
    order_dealer: dealerIdForDispatch,
    order_date: firstOrder?.orderdata_datetime || displayOrderMeta?.order_date || new Date().toISOString(),
    order_amount: totals.gross,
    order_discount: totals.discount,
    order_discount_amount: totals.discount,
    order_net_amount: totals.final,
    grossAmount: totals.gross,
    discountAmount: totals.discount,
    netPayableAmount: totals.final,
    discountPercent: displayOrderMeta?.discountPercent,
    baseDiscountAmount: discountBreakdown.baseDiscountAmount,
    baseDiscountPercent: discountBreakdown.baseDiscountPercent,
    postBaseAmount: discountBreakdown.postBaseAmount,
    additionalDiscountType: discountBreakdown.additionalDiscountType,
    additionalDiscountAmount: discountBreakdown.additionalDiscountAmount,
    customDiscountAmount: discountBreakdown.customDiscountAmount,
    customDiscountPercent: discountBreakdown.customDiscountPercent,
    slabDiscountAmount: discountBreakdown.slabDiscountAmount,
    slabDiscountPercent: discountBreakdown.slabDiscountPercent,
    approvedDiscountPercent: displayOrderMeta?.approvedDiscountPercent,
    allocatedDiscountPercent: displayOrderMeta?.allocatedDiscountPercent,
    Dealer_Name: resolvedDealer?.Dealer_Name || firstOrder?.Dealer_Name || displayOrderMeta?.Dealer_Name || "",
    Dealer_Id: resolvedDealer?.Dealer_Id || dealerIdForDispatch || "",
    Dealer_Email: resolvedDealer?.Dealer_Email || (displayOrderMeta as any)?.Dealer_Email || "",
    Dealer_Address: resolvedDealer?.Dealer_Address || firstOrder?.Dealer_Address || displayOrderMeta?.Dealer_Address || "",
    Dealer_Number: resolvedDealer?.Dealer_Number || firstOrder?.Dealer_Number || displayOrderMeta?.Dealer_Number || "",
    Dealer_shipto: resolvedDealer?.Dealer_shipto || (displayOrderMeta as any)?.Dealer_shipto || "",
    Dealer_City: resolvedDealer?.Dealer_City || (displayOrderMeta as any)?.Dealer_City || "",
    Dealer_Pincode: resolvedDealer?.Dealer_Pincode || (displayOrderMeta as any)?.Dealer_Pincode || "",
    Dealer_Dealercode: resolvedDealer?.Dealer_Dealercode || (displayOrderMeta as any)?.Dealer_Dealercode || "",
    Dealer_Notes: resolvedDealer?.Dealer_Notes || (displayOrderMeta as any)?.Dealer_Notes || "",
    gst: resolvedDealer?.gst || firstOrder?.gst || displayOrderMeta?.gst || "",
    creditdays: (resolvedDealer as any)?.creditdays || (displayOrderMeta as any)?.creditdays || "",
    orderdata_item_quantity: String(totals.qty),
    mtstatus: displayOrderMeta?.mtstatus || firstOrder?.orderdata_status || "",
    outstandingDate: displayOrderMeta?.outstandingDate || "",
    __source: displayOrderMeta?.__source,
    orderNotes: (displayOrderMeta as any)?.orderNotes,
    orderProductNotes: (displayOrderMeta as any)?.orderProductNotes,
    summaryOverrides: (displayOrderMeta as any)?.summaryOverrides,
    dispatchRecords: (displayOrderMeta as any)?.dispatchRecords,
    settlement: settlementSummary,
    items: displayOrders.map((o, index) => {
      const pricing = rowPricings[index] ?? getRowPricing(o, packLookup, displayOrderMeta);
      return {
        id: o.orderdata_id,
        productId: o.orderdata_cat_no,
        catNo: o.orderdata_cat_no,
        productName: o.product_name,
        productDescription: o.product_discription,
        quantityPacks: pricing.packs,
        totalPieces: pricing.pieces,
        packSize: pricing.packSize,
        unitPrice: pricing.unitPrice,
        discountAmount: pricing.discount,
        finalPrice: pricing.final,
        totalDiscountPercent: pricing.pct,
        unit: o.product_unit || "Pcs",
        remark: o.displayRemark ?? o.remark,
        remarks: o.displayRemark ?? o.remarks,
        priority: o.priority,
        isPriority: o.isPriority,
        is_priority: o.is_priority,
      };
    }),
  });

  const handleDownloadInvoice = async () => {
    if (overlayState?.isCancelled) {
      setInvoiceToast({ type: "error", text: "Cancelled orders cannot generate an active invoice." });
      window.setTimeout(() => setInvoiceToast(null), 3000);
      return;
    }
    if (displayOrders.length === 0 || invoiceLoading) return;
    setInvoiceLoading(true);
    const result = await downloadOrderInvoice(buildInvoiceOrder() as OrderInvoiceData, {
      normalizedRole: currentUser?.role,
      actorId: currentUser?.id,
    });
    setInvoiceLoading(false);
    setInvoiceToast({
      type: result.success ? "success" : "error",
      text: result.success ? "PDF downloaded" : result.error || "Download failed",
    });
    window.setTimeout(() => setInvoiceToast(null), 3000);
  };

  const openDispatchAllDialog = () => {
    if (selectedDispatchLines.length === 0) return;
    setDispatchAllRemark("");
    setDispatchAllError("");
    setDispatchSelectedStatus("dispatched");
    setDispatchSelectedQuantities(Object.fromEntries(
      selectedDispatchLines.map((line) => [buildBulkDispatchLineKey(line), String(line.remainingQuantity)])
    ));
    setDispatchAllIdempotencyKey(`${id}:${Date.now()}:${Math.random().toString(36).slice(2)}`);
    setDispatchAllDialogOpen(true);
  };

  const submitDispatchAll = async () => {
    const remark = dispatchAllRemark.trim();
    if (!canUseDispatchAll) {
      setDispatchAllError(dispatchRecordsError || "Multi-item dispatch is not available for this order.");
      return;
    }
    if (selectedDispatchLines.length === 0) {
      setDispatchAllError("Select at least one dispatchable product.");
      return;
    }
    if (!remark) {
      setDispatchAllError("Operational Remark is required.");
      return;
    }
    const requestedItems = selectedDispatchLines.map((line) => {
      const key = buildBulkDispatchLineKey(line);
      return { ...line, key, dispatchQuantity: Number(dispatchSelectedQuantities[key]), status: dispatchSelectedStatus };
    });
    const invalidLine = requestedItems.find((line) =>
      !Number.isFinite(line.dispatchQuantity)
      || !Number.isInteger(line.dispatchQuantity)
      || line.dispatchQuantity <= 0
      || line.dispatchQuantity > line.remainingQuantity
    );
    if (invalidLine) {
      setDispatchAllError(`Enter a whole dispatch quantity between 1 and ${invalidLine.remainingQuantity} for ${invalidLine.productName || invalidLine.sku}.`);
      return;
    }

    setDispatchAllSaving(true);
    setDispatchAllError("");

    try {
      const response = await fetch("/api/order-dispatch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildDispatchHeaders(currentUser),
        },
        body: JSON.stringify({
          action: "dispatch_selected",
          orderId: id,
          items: requestedItems.map((line) => ({
            orderItemId: line.orderItemId,
            sku: line.sku,
            occurrence: line.occurrence,
            dispatchQuantity: line.dispatchQuantity,
            status: line.status,
          })),
          remark,
          idempotencyKey: dispatchAllIdempotencyKey,
        }),
      });

      const json = await response.json().catch(() => null);
      const records = Array.isArray(json?.data) ? json.data as OrderDispatchRecord[] : Array.isArray(json?.data?.records) ? json.data.records as OrderDispatchRecord[] : [];
      if (records.length > 0) {
        handleDispatchRecordsSaved(records);
      }

      if (!response.ok || !json?.success) {
        const failures = Array.isArray(json?.data?.failures) ? json.data.failures : [];
        if (failures.length > 0) {
          const failedKeys = new Set<string>(failures.map((failure: { orderItemId?: string | null; sku?: string; occurrence?: number }) =>
            buildBulkDispatchLineKey({ orderItemId: failure.orderItemId, sku: failure.sku, occurrence: failure.occurrence })
          ));
          setSelectedDispatchKeys(failedKeys);
        }
        const failedLabels = failures.map((failure: { sku?: string; orderItemId?: string | null }) =>
          failure.sku || failure.orderItemId || "Unknown product"
        );
        setDispatchAllError(`${json?.message || "Failed to dispatch selected products."}${failedLabels.length ? ` Failed: ${failedLabels.join(", ")}.` : ""}`);
        return;
      }

      setSelectedDispatchKeys(new Set());
      setDispatchAllDialogOpen(false);
      setInvoiceToast({ type: "success", text: `${records.length} selected product${records.length === 1 ? "" : "s"} dispatched.` });
      window.setTimeout(() => setInvoiceToast(null), 3000);
      window.dispatchEvent(new CustomEvent("orderDispatchUpdated", {
        detail: { orderId: id, bulk: true },
      }));
    } catch {
      setDispatchAllError("Failed to dispatch selected products.");
    } finally {
      setDispatchAllSaving(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled) setIsRsm(String(json?.data?.role ?? "").toLowerCase() === "rsm");
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const rsmStatus = String(
    (activeOrderHeader?.rsmApprovalStatus as string) ??
    (activeOrderHeader?.rsm_approval_status as string) ??
    (phpOrders[0] as Record<string, unknown> | undefined)?.rsmApprovalStatus ?? ""
  ).toUpperCase();
  const canRsmReview = isRsm && !overlayState?.isCancelled && (rsmStatus === "AWAITING" || rsmStatus === "");

  const submitRsmReview = async (approve: boolean, note?: string) => {
    if (rsmSaving) return;
    setRsmSaving(true);
    try {
      const response = await fetch(`/api/order-overlays/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...buildDispatchHeaders(currentUser) },
        body: JSON.stringify({
          action: approve ? "mirror_acceptance" : "decline",
          acceptOrder: approve ? "1" : "2",
          ...(note ? { note } : {}),
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || json?.success === false) throw new Error(json?.message || "Approval update failed.");
      setRsmDeclineOpen(false);
      setRsmDeclineNote("");
      setInvoiceToast({ type: "success", text: approve ? "Order approved." : "Order disapproved." });
      setReloadKey((k) => k + 1);
    } catch (error) {
      setInvoiceToast({ type: "error", text: error instanceof Error ? error.message : "Action failed." });
    } finally {
      setRsmSaving(false);
    }
  };

  const submitCancellation = async (reason: string) => {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setCancelError("Cancellation reason is required.");
      return;
    }
    if (!currentUser || currentUser.role !== "dealer") {
      setCancelError("Only the Dealer who owns this order can cancel it.");
      return;
    }
    setCancelSaving(true);
    setCancelError("");
    try {
      const response = await fetch(`/api/order-overlays/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildDispatchHeaders(currentUser),
        },
        body: JSON.stringify({
          action: "cancel",
          reason: trimmedReason,
          formattedOrderNumber: formatDisplayOrderNumber(id),
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.success) {
        setCancelError(json?.message || "Unable to cancel this order.");
        return;
      }
      setOverlayState((current) => json.requested ? ({
        ...(current ?? { isCancelled: false, isEdited: false, latestRevision: 0 }),
        changeRequests: Array.isArray(json.data?.overlay?.changeRequests) ? json.data.overlay.changeRequests : current?.changeRequests ?? [],
      }) : ({
        ...(current ?? { isEdited: false, latestRevision: 0 }),
        isCancelled: true,
        cancellation: json.data?.cancellation,
        eligibility: { canDealerChange: false, reason: "order_already_cancelled" },
      }));
      setCancelDialogOpen(false);
      setInvoiceToast({ type: "success", text: json.requested ? "Cancellation request sent for approval." : "Order cancelled. The PHP order was preserved." });
      window.setTimeout(() => setInvoiceToast(null), 3000);
    } finally {
      setCancelSaving(false);
    }
  };

  const submitEdit = async (payload: { expectedRevision: number; items: Array<Record<string, unknown>>; note?: string }) => {
    if (!currentUser || currentUser.role !== "dealer") {
      setEditError("Only the Dealer who owns this order can edit it.");
      return;
    }
    setEditSaving(true);
    setEditError("");
    try {
      const response = await fetch(`/api/order-overlays/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildDispatchHeaders(currentUser),
        },
        body: JSON.stringify({
          action: "edit",
          expectedRevision: payload.expectedRevision,
          idempotencyKey: `${id}:${payload.expectedRevision}:${Date.now()}`,
          items: payload.items,
          note: payload.note,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.success) {
        setEditError(json?.message || "Unable to save this edit.");
        return;
      }
      if (json.requested) {
        setOverlayState((current) => ({
          ...(current ?? { isCancelled: false, isEdited: false, latestRevision: 0 }),
          changeRequests: Array.isArray(json.data?.overlay?.changeRequests) ? json.data.overlay.changeRequests : current?.changeRequests ?? [],
        }));
        setEditDialogOpen(false);
        setInvoiceToast({ type: "success", text: "Edit request sent for approval." });
        window.setTimeout(() => setInvoiceToast(null), 3000);
        return;
      }
      // The route returns the resolved effective order (effectiveItems/effectiveTotals/changeHistory),
      // the same shape the GET loader consumes -- not the overlay document's `edits` array.
      const saved = json.data ?? {};
      if (Array.isArray(saved.effectiveItems)) {
        setOverlayItems(normalizeOrderDetailResponse({ data: { ...saved, items: saved.effectiveItems } }, id).items as OrderData[]);
      }
      if (saved.effectiveTotals) {
        setOverlayTotals({
          grossAmount: saved.effectiveTotals.grossAmount,
          discountAmount: saved.effectiveTotals.discountAmount,
          netPayableAmount: saved.effectiveTotals.netPayableAmount,
        });
      }
      setOverlayState((current) => ({
        ...(current ?? { isCancelled: false }),
        isCancelled: !!saved.isCancelled,
        isEdited: true,
        latestRevision: Number(saved.latestRevision ?? payload.expectedRevision + 1),
        cancellation: saved.cancellation ?? current?.cancellation,
        changeHistory: saved.changeHistory ?? current?.changeHistory ?? [],
        changeRequests: Array.isArray(saved.overlay?.changeRequests) ? saved.overlay.changeRequests : current?.changeRequests ?? [],
        acceptance: saved.overlay?.acceptance ?? current?.acceptance ?? null,
        eligibility: saved.eligibility ?? current?.eligibility ?? { canDealerChange: true, reason: "eligible" },
      }));
      setEditDialogOpen(false);
      setInvoiceToast({ type: "success", text: "Order edit saved. The PHP order was preserved." });
      window.setTimeout(() => setInvoiceToast(null), 3000);
    } finally {
      setEditSaving(false);
    }
  };


  const reviewChangeRequest = async (requestId: string, action: "approve_change_request" | "reject_change_request") => {
    if (!currentUser || currentUser.role !== "admin") return;
    const response = await fetch(`/api/order-overlays/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildDispatchHeaders(currentUser),
      },
      body: JSON.stringify({ action, requestId }),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.success) {
      setInvoiceToast({ type: "error", text: json?.message || "Unable to review request." });
      window.setTimeout(() => setInvoiceToast(null), 3000);
      return;
    }
    setOverlayState((current) => ({
      ...(current ?? { isCancelled: false, isEdited: false, latestRevision: 0 }),
      isCancelled: !!json.data?.isCancelled,
      isEdited: !!json.data?.isEdited,
      latestRevision: Number(json.data?.latestRevision ?? current?.latestRevision ?? 0),
      cancellation: json.data?.cancellation ?? current?.cancellation,
      changeHistory: json.data?.changeHistory ?? current?.changeHistory,
      changeRequests: Array.isArray(json.data?.overlay?.changeRequests) ? json.data.overlay.changeRequests : current?.changeRequests ?? [],
    }));
    if (Array.isArray(json.data?.effectiveItems)) setOverlayItems(json.data.effectiveItems as OrderData[]);
    setInvoiceToast({ type: "success", text: action === "approve_change_request" ? "Request approved." : "Request rejected." });
    window.setTimeout(() => setInvoiceToast(null), 3000);
  };

  // Dealer fields to show — in display order, only truthy ones render
  const dealerFields: { label: string; value?: string }[] = resolvedDealer ? [
    { label: "Dealer Name",    value: resolvedDealer.Dealer_Name      },
    { label: "Dealer Code",    value: resolvedDealer.Dealer_Dealercode},
    { label: "City",           value: resolvedDealer.Dealer_City      },
    { label: "Address",        value: resolvedDealer.Dealer_Address   },
    { label: "Ship To",        value: resolvedDealer.Dealer_shipto    },
    { label: "Email",          value: resolvedDealer.Dealer_Email     },
    { label: "Phone",          value: resolvedDealer.Dealer_Number    },
    { label: "GST",            value: resolvedDealer.gst              },
    // { label: "Credit Days",    value: dealer.creditdays       },
    { label: "Discount",       value: resolvedDealer.discount ? `${resolvedDealer.discount}%` : undefined },
    // { label: "Annual Target",  value: dealer.annualtarget ? `₹${Number(dealer.annualtarget).toLocaleString("en-IN")}` : undefined },
    // { label: "Current Limit",  value: dealer.currentlimit     },
    { label: "Assigned Staff", value: resolvedDealer.staffname        },
    // { label: "Notes",          value: dealer.Dealer_Notes     },
  ] : [];

  const visibleDealerFields = dealerFields.filter(f => f.value);
  const orderNote = extractOrderNote(displayOrders, localOrderNote);
  const dealerChangeRequiresApproval = currentUser?.role === "dealer" && !!overlayState?.eligibility?.accepted && !overlayState?.isCancelled;
  const dealerCanChangeOrder = currentUser?.role === "dealer" && !overlayState?.isCancelled;
  const canReviewChangeRequests = currentUser?.role === "admin";
  const pendingChangeRequests = (overlayState?.changeRequests ?? []).filter((request) => request.status === "pending");

  return (
    <>
      <style>{`
        @keyframes popIn {
          from { transform: scale(0.95) translateY(8px); opacity: 0; }
          to   { transform: scale(1) translateY(0); opacity: 1; }
        }
        .track-btn { opacity: 0; transition: opacity 0.1s; }
        tr:hover .track-btn { opacity: 1; }
      `}</style>

      <div className="min-h-screen bg-gray-50" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>

        {/* Top bar */}
        <div className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-[12.5px] font-medium text-gray-600 hover:bg-gray-100 transition-all">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
              Back
            </button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-[18px] font-bold text-gray-900">Order Details</h1>
                {firstOrder?.orderdata_orderid && (
                  <span className="font-mono text-[12px] font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg">
                    {formatDisplayOrderNumber(firstOrder.orderdata_orderid)}
                  </span>
                )}
                {overlayState?.isCancelled && (
                  <span className="font-mono text-[12px] font-semibold text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-lg">
                    Cancelled
                  </span>
                )}
                {overlayState?.isEdited && !overlayState.isCancelled && (
                  <span className="font-mono text-[12px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                    Edited
                  </span>
                )}
              </div>
              {dealer?.Dealer_Name && (
                <p className="text-[13px] text-gray-500 mt-0.5">{dealer.Dealer_Name}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ViewToggle mode={viewMode} onChange={setViewMode} />
            {showDispatchAllControl && (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setSelectedDispatchKeys(new Set(dispatchableByKey.keys()))}
                  disabled={dispatchableByKey.size === 0 || dispatchAllSaving}
                  className="px-3 py-2 text-[12px] font-semibold text-indigo-700 border border-indigo-200 rounded-xl hover:bg-indigo-50 disabled:opacity-40">
                  Select All Dispatchable
                </button>
                <button type="button" onClick={() => setSelectedDispatchKeys(new Set())}
                  disabled={selectedDispatchKeys.size === 0 || dispatchAllSaving}
                  className="px-3 py-2 text-[12px] font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-40">
                  Clear Selection
                </button>
                <button
                  type="button"
                  onClick={openDispatchAllDialog}
                  disabled={!dispatchAllHasLines || dispatchAllSaving}
                  className="flex items-center gap-2 px-4 py-2 text-[13px] font-semibold rounded-xl border bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Dispatch Selected ({selectedDispatchLines.length})
                </button>
              </div>
            )}
            {canRsmReview && (
              <>
                <button onClick={() => submitRsmReview(true)} disabled={rsmSaving}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[13px] font-semibold rounded-xl transition-colors">
                  {rsmSaving ? "Saving..." : "Approve Order"}
                </button>
                <button onClick={() => { setRsmDeclineNote(""); setRsmDeclineOpen(true); }} disabled={rsmSaving}
                  className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-[13px] font-semibold rounded-xl transition-colors">
                  Disapprove Order
                </button>
              </>
            )}
            {dealerCanChangeOrder && (
              <>
                <button onClick={() => setEditDialogOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-[13px] font-semibold rounded-xl transition-colors">
                <PenLine /> {dealerChangeRequiresApproval ? "Request Edit" : "Edit Order"}
                </button>
                <button onClick={() => setCancelDialogOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-[13px] font-semibold rounded-xl transition-colors">
                 <Trash2 /> {dealerChangeRequiresApproval ? "Request Cancellation" : "Cancel Order"}
                </button>
              </>
            )}
            <button onClick={handleDownloadInvoice} disabled={invoiceLoading || loading || displayOrders.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 text-[13px] font-semibold rounded-xl border border-gray-200 transition-colors">
              {invoiceLoading ? (
                <div className="w-3.5 h-3.5 border-2 border-gray-200 border-t-gray-700 rounded-full animate-spin" />
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3" />
                </svg>
              )}
              Get a copy
            </button>
            <button onClick={handleExport}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-700 text-white text-[13px] font-semibold rounded-xl transition-colors">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Export
            </button>
          </div>
        </div>

        <div className="px-8 py-6 max-w-[1600px] mx-auto space-y-5">
          {/* ── Dealer Info Card ── */}
          {visibleDealerFields.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Dealer Information</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-8 gap-y-4">
                {visibleDealerFields.map(f => (
                  <DealerField key={f.label} label={f.label} value={f.value} />
                ))}
              </div>
            </div>
          )}

          {orderNote && (
            <div className="bg-white border border-indigo-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round">
                    <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                  </svg>
                </div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Order Note</p>
              </div>
              <p className="whitespace-pre-wrap text-[13px] leading-6 text-gray-700">{orderNote}</p>
            </div>
          )}

          {/* Dispatch Details — staff/admin edit, dealer read-only */}
          {!loading && (
            <DispatchTrackingCard
              orderId={id}
              canEdit={canEditDispatchTracking}
              editingSupported={isPostgresDetail}
              value={dispatchTracking}
              onSaved={setDispatchTrackingOverride}
            />
          )}

          {overlayState?.isCancelled && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-5">
              <p className="text-[11px] font-bold text-red-500 uppercase tracking-widest">Cancellation</p>
              <p className="mt-2 text-[13px] leading-6 text-red-800">{overlayState.cancellation?.reason || "This order was cancelled."}</p>
              <p className="mt-2 text-[12px] text-red-600">
                Cancelled by {overlayState.cancellation?.cancelledBy?.name || overlayState.cancellation?.cancelledBy?.id || "Dealer"}
                {overlayState.cancellation?.cancelledAt ? ` on ${moment(overlayState.cancellation.cancelledAt).format("DD MMM YYYY, hh:mm A")}` : ""}
              </p>
            </div>
          )}

          {overlayState?.isEdited && overlayState.changeHistory && overlayState.changeHistory.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-2xl p-5">
              <p className="text-[11px] font-bold text-amber-600 uppercase tracking-widest">Order Changes</p>
              <div className="mt-3 space-y-2">
                {overlayState.changeHistory.map((change, index) => (
                  <p key={index} className="text-[13px] leading-6 text-gray-700">{change.summary || change.type}</p>
                ))}
              </div>
            </div>
          )}


          {pendingChangeRequests.length > 0 && (
            <div className="bg-white border border-sky-200 rounded-2xl p-5">
              <p className="text-[11px] font-bold text-sky-600 uppercase tracking-widest">Pending Order Change Requests</p>
              <div className="mt-3 space-y-3">
                {pendingChangeRequests.map((request) => (
                  <div key={String(request.id)} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{request.type === "edit_request" ? "Edit request" : "Cancellation request"}</p>
                        <p className="mt-1 text-[13px] leading-6 text-slate-600">{String(request.note || "No note provided")}</p>
                      </div>
                      {canReviewChangeRequests && (
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => reviewChangeRequest(String(request.id), "approve_change_request")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700">Approve</button>
                          <button type="button" onClick={() => reviewChangeRequest(String(request.id), "reject_change_request")} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Reject</button>
                        </div>
                      )}
                    </div>
                    {request.type === "edit_request" && Array.isArray(request.originalItems) && Array.isArray(request.proposedItems) && (
                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        {[{ label: "Original order", rows: request.originalItems }, { label: "Proposed edit", rows: request.proposedItems }].map((group) => (
                          <div key={group.label} className="rounded-lg border border-slate-200">
                            <p className="border-b border-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">{group.label}</p>
                            <div className="divide-y divide-slate-100">
                              {group.rows.map((item, index) => (
                                <div key={index} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 text-[12px] text-slate-700">
                                  <span className="font-mono font-semibold text-amber-700">{String(item.orderdata_cat_no ?? "-")}</span>
                                  <span>Qty {String(item.orderdata_item_quantity ?? item.quantityPacks ?? "-")}</span>
                                  <span>Pack {String(item.packSize ?? item.pack_size ?? "-")}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {request.type === "edit_request" && Array.isArray(request.revision?.changes) && (
                      <div className="mt-3 space-y-1 text-[13px] text-slate-700">
                        {request.revision.changes.map((change, index) => <p key={index}>{change.summary || change.type}</p>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Totals ── */}
          {!loading && (displayOrders.length > 0 || Object.keys(resolvedSummary).length > 0) && (
            <div className="space-y-3">
              {additionalDiscountBadge && (
                <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[12px] font-semibold text-emerald-700">
                  {additionalDiscountBadge}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                {discountSummaryRows.map((row) => (
                  <div key={row.key} className="bg-white border border-gray-200 rounded-2xl px-5 py-4">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{row.label}</p>
                    <p className={`text-[20px] font-bold font-mono mt-1 ${
                      row.key === "gross" ? "text-gray-900"
                        : row.key === "net" ? "text-emerald-700"
                          : "text-amber-700"
                    }`}>
                      ₹{row.amount.toLocaleString("en-IN")}
                    </p>
                  </div>
                ))}
              </div>

              {/* Wallet settlement applied by the Accountant against this order. */}
              {settlementSummary && Number(settlementSummary.paidAmount) > 0 && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                        {settlementSummary.status === "settled" ? "Settled from wallet advance" : "Partly settled from wallet advance"}
                      </p>
                      <p className="mt-1 font-mono text-[20px] font-bold text-emerald-800">
                        &#8377;{Number(settlementSummary.paidAmount).toLocaleString("en-IN")}
                        <span className="ml-2 text-[13px] font-semibold text-emerald-700">paid</span>
                      </p>
                    </div>
                    {Number(settlementSummary.dueAmount) > 0 && (
                      <div className="text-right">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Balance due</p>
                        <p className="mt-1 font-mono text-[20px] font-bold text-amber-800">
                          &#8377;{Number(settlementSummary.dueAmount).toLocaleString("en-IN")}
                        </p>
                      </div>
                    )}
                  </div>
                  {settlementSummary.lastPaymentAt && (
                    <p className="mt-2 text-[12px] text-emerald-800">
                      Last settled {moment(settlementSummary.lastPaymentAt).format("DD MMM YYYY")}
                    </p>
                  )}
                  {Array.isArray(settlementSummary.bills) && settlementSummary.bills.length > 0 && (
                    <p className="mt-1 text-[12px] text-emerald-700">
                      Against {settlementSummary.bills.map((bill: any) => bill.orderNumber).filter(Boolean).join(", ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Loading ── */}
          {loading && (
            <div className="bg-white border border-gray-200 rounded-2xl flex items-center justify-center py-20 gap-3 text-gray-500">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
              <span className="text-[14px]">Loading order details…</span>
            </div>
          )}

          {/* ── Empty ── */}
          {!loading && displayOrders.length === 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
              </svg>
              <p className="text-[14px]">No order items found.</p>
            </div>
          )}

          {orderRevisions.length > 0 && (
            <div className="bg-white border border-rose-200 rounded-2xl p-5">
              <p className="text-[11px] font-bold text-rose-600 uppercase tracking-widest">Resubmitted after disapproval</p>
              {orderRevisions.map((revision, index) => (
                <div key={index} className={index > 0 ? "mt-4 border-t border-rose-100 pt-4" : "mt-3"}>
                  <p className="text-[13px] leading-6 text-gray-800">
                    Replaces order <span className="font-mono font-bold">{revision.previousOrderNumber || revision.previousOrderId}</span>
                    {revision.rejectedByName ? `, disapproved by ${revision.rejectedByName}` : ""}
                    {revision.rejectedAt ? ` on ${moment(revision.rejectedAt).format("DD MMM YYYY, hh:mm A")}` : ""}.
                  </p>
                  {revision.rejectionNote && (
                    <p className="mt-1 text-[13px] leading-6 text-rose-700">Reason: {revision.rejectionNote}</p>
                  )}
                  <p className="mt-3 text-[11px] font-bold uppercase tracking-widest text-gray-400">
                    Changes made by the dealer ({revision.changes?.length ?? 0})
                  </p>
                  {(revision.changes?.length ?? 0) === 0 ? (
                    <p className="mt-1 text-[13px] leading-6 text-gray-600">Resubmitted with the same products.</p>
                  ) : (
                    <ul className="mt-1 list-disc pl-5">
                      {revision.changes!.map((change, changeIndex) => (
                        <li key={changeIndex} className="text-[13px] leading-6 text-gray-700">{change.summary}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Card View ── */}
          {!loading && displayOrders.length > 0 && viewMode === "cards" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {displayOrders.map((o, idx) => {
                const selectionKey = buildBulkDispatchLineKey(o);
                return (
                  <ItemCard key={o.orderdata_id} o={o} idx={idx}
                    pricing={rowPricings[idx] ?? getRowPricing(o, packLookup, displayOrderMeta)}
                    additionalDiscountType={discountBreakdown.additionalDiscountType}
                    dispatchLabel={canEditDispatchDetails ? "Update Dispatch" : "View Dispatch"}
                    selectable={showDispatchAllControl && dispatchableByKey.has(selectionKey)}
                    selected={selectedDispatchKeys.has(selectionKey)}
                    onSelectedChange={(checked) => setSelectedDispatchKeys((previous) => {
                      const next = new Set(previous);
                      if (checked) next.add(selectionKey); else next.delete(selectionKey);
                      return next;
                    })}
                    onDispatch={() => setActiveDispatchItemId(o.orderdata_id)} />
                );
              })}
            </div>
          )}

          {/* ── Table View ── */}
          {!loading && displayOrders.length > 0 && viewMode === "table" && (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table ref={tableRef} className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {showDispatchAllControl && <th className="px-4 py-3.5 bg-gray-50/80"><span className="sr-only">Select</span></th>}
                      {["#","Order No","Cat No.","Product","Description","Qty","Pack Size","Pieces","Dispatched","Left","Unit","Price","Disc %","Amount","Discount","Final","Status","Date",""].map(h => (
                        <th key={h} className="px-4 py-3.5 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 whitespace-nowrap bg-gray-50/80">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {displayOrders.map((o, idx) => {
                      const pricing = rowPricings[idx] ?? getRowPricing(o, packLookup, displayOrderMeta);
                      const left = pricing.left;
                      const isDeleted = o.del_status === "1";
                      const selectionKey = buildBulkDispatchLineKey(o);
                      const selectable = showDispatchAllControl && dispatchableByKey.has(selectionKey);
                      const isPriority = hasPriorityTag(o.priority, o.isPriority, o.is_priority, o.remark, o.remarks);
                      return (
                        <tr key={o.orderdata_id} className={`group hover:bg-gray-50/80 transition-colors ${isDeleted ? "opacity-40" : ""}`}>
                          {showDispatchAllControl && (
                            <td className="px-4 py-3.5">
                              <input
                                type="checkbox"
                                checked={selectedDispatchKeys.has(selectionKey)}
                                disabled={!selectable}
                                onChange={(event) => setSelectedDispatchKeys((previous) => {
                                  const next = new Set(previous);
                                  if (event.target.checked) next.add(selectionKey); else next.delete(selectionKey);
                                  return next;
                                })}
                                aria-label={`Select ${o.product_name || o.orderdata_cat_no || "product"} for dispatch`}
                                className="h-4 w-4 rounded border-slate-300 text-indigo-600 disabled:opacity-30"
                              />
                            </td>
                          )}
                          <td className="px-4 py-3.5 text-[11px] text-gray-400 font-mono font-semibold">{String(idx + 1).padStart(2, "0")}</td>
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span className="font-mono text-[11px] font-bold text-indigo-600">{formatDisplayOrderNumber(o.orderdata_orderid)}</span>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-[12px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg w-fit">{o.orderdata_cat_no || "—"}</span>
                              {isPriority && (
                                <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full w-fit">
                                  Priority
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 max-w-[160px]">
                            <span className="block truncate text-[13px] font-semibold text-gray-900">{o.product_name || "—"}</span>
                          </td>
                          <td className="px-4 py-3.5 max-w-[140px]">
                            <span className="block truncate text-[12px] text-gray-600">{o.product_discription || "—"}</span>
                            {o.fallbackProductNote && (
                              <span className="mt-1 block text-[11px] leading-5 text-indigo-700">Product Note: {o.fallbackProductNote}</span>
                            )}
                            {([o.remark, o.remarks].filter(Boolean).join(" | ")) && (
                              <span className="mt-1 block text-[11px] leading-5 text-gray-500">{[o.remark, o.remarks].filter(Boolean).join(" | ")}</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 font-mono font-bold text-gray-900">{pricing.packs}</td>
                          <td className="px-4 py-3.5 font-mono font-bold text-amber-700">{pricing.packs} × {pricing.packSize}</td>
                          <td className="px-4 py-3.5 font-mono font-bold text-gray-900">{pricing.pieces}</td>
                          <td className="px-4 py-3.5 font-mono font-semibold text-emerald-600">{pricing.ready}</td>
                          <td className="px-4 py-3.5 font-mono font-bold" style={{ color: left > 0 ? "#dc2626" : "#9ca3af" }}>{left}</td>
                          <td className="px-4 py-3.5 text-[12px] text-gray-600">{o.product_unit || "—"}</td>
                          <td className="px-4 py-3.5 font-mono text-gray-900 font-semibold">₹{pricing.unitPrice.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-3.5 font-mono text-gray-900">
                            <div>{pricing.pct}%</div>
                            {discountBreakdown.additionalDiscountType && (
                              <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                                incl. {discountBreakdown.additionalDiscountType}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3.5 font-mono text-gray-500 line-through text-[12px]">₹{pricing.gross.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-3.5 font-mono text-amber-700 font-semibold">
                            <div>-&#8377;{pricing.discount.toLocaleString("en-IN")}</div>
                            {discountBreakdown.additionalDiscountType && (
                              <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                                incl. {discountBreakdown.additionalDiscountType}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3.5 font-mono font-bold text-emerald-700">&#8377;{pricing.final.toLocaleString("en-IN")}</td>
                          <td className="px-4 py-3.5"><StatusPill code={resolveItemStatusCode(o, pricing)} /></td>
                          <td className="px-4 py-3.5 text-[11px] text-gray-500 font-mono whitespace-nowrap">{o.orderdata_datetime || "—"}</td>
                          <td className="px-4 py-3.5 w-px">
                            <div className="track-btn">
                              <button
                                onClick={() => !isDeleted && setActiveDispatchItemId(o.orderdata_id)}
                                disabled={isDeleted}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all whitespace-nowrap ${isDeleted ? "opacity-30 cursor-not-allowed bg-gray-50 text-gray-400 border-gray-100" : "bg-white text-gray-600 border-gray-200 hover:border-indigo-200 hover:text-indigo-600 hover:bg-indigo-50"}`}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                                </svg>
                                {canEditDispatchDetails ? "Update Dispatch" : "View Dispatch"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>

                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {invoiceToast && (
        <div className={`fixed bottom-4 right-4 z-50 rounded-xl px-4 py-3 text-[13px] font-semibold shadow-lg border ${
          invoiceToast.type === "success"
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : "bg-red-50 text-red-700 border-red-200"
        }`}>
          {invoiceToast.text}
        </div>
      )}

      <TrackingModal
        isOpen={!!activeDispatchItemId}
        orderId={id}
        dealerId={dealerIdForDispatch}
        assignedStaffId={assignedStaffId}
        acceptOrder={acceptOrder}
        delStatus={orderDeleted}
        items={displayOrders}
        currentUser={currentUser}
        selectedItemId={activeDispatchItemId}
        onClose={() => setActiveDispatchItemId(null)}
        onRecordSaved={handleDispatchRecordSaved}
      />
      {dispatchAllDialogOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/25 p-4 backdrop-blur-[2px]"
          onClick={() => !dispatchAllSaving && setDispatchAllDialogOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Multi-item Dispatch</p>
                <h2 className="mt-1 text-[20px] font-bold text-slate-900">{formatDisplayOrderNumber(id)}</h2>
                <p className="mt-1 text-[13px] text-slate-500">
                  {selectedDispatchLines.length} selected product line{selectedDispatchLines.length === 1 ? "" : "s"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => !dispatchAllSaving && setDispatchAllDialogOpen(false)}
                disabled={dispatchAllSaving}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
                aria-label="Close selected products dispatch"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="max-h-[calc(90vh-96px)] overflow-y-auto p-6">
              <div className="rounded-2xl border border-slate-200">
                <div className="border-b border-slate-200 px-4 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Selected Products</p>
                </div>
                <div className="max-h-80 overflow-auto divide-y divide-slate-100">
                  {selectedDispatchLines.map((line) => {
                    const lineKey = buildBulkDispatchLineKey(line);
                    return (
                    <div key={lineKey} className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[1fr_repeat(5,minmax(72px,auto))] md:items-end">
                      <div>
                        <p className="mt-1 font-mono text-[12px] text-amber-700">Catalogue Number: {line.sku || "-"}</p>
                      </div>
                      <div><p className="text-[10px] font-bold uppercase text-slate-400">Ordered</p><p className="font-mono text-[13px] font-bold">{line.orderedQuantity}</p></div>
                      <div><p className="text-[10px] font-bold uppercase text-slate-400">Dispatched</p><p className="font-mono text-[13px] font-bold">{line.dispatchedQuantity}</p></div>
                      <div><p className="text-[10px] font-bold uppercase text-slate-400">Remaining</p><p className="font-mono text-[13px] font-bold text-indigo-700">{line.remainingQuantity}</p></div>
                      <div><p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Current status</p><StatusPill code={line.currentStatus} /></div>
                      <label className="text-[10px] font-bold uppercase text-slate-500">
                        Dispatch qty
                        <input
                          type="number"
                          min={1}
                          max={line.remainingQuantity}
                          step={1}
                          value={dispatchSelectedQuantities[lineKey] ?? ""}
                          onChange={(event) => {
                            setDispatchSelectedQuantities((previous) => ({ ...previous, [lineKey]: event.target.value }));
                            setDispatchAllError("");
                          }}
                          disabled={dispatchAllSaving}
                          className="mt-1 w-24 rounded-xl border border-slate-200 px-3 py-2 font-mono text-[13px] text-slate-900 outline-none focus:border-indigo-300"
                        />
                      </label>
                    </div>
                  )})}
                </div>
              </div>

              <div className="mt-5">
                <label htmlFor="dispatch-selected-status" className="mb-1.5 block text-[12px] font-semibold text-slate-700">Dispatch Status</label>
                <select id="dispatch-selected-status" value={dispatchSelectedStatus}
                  onChange={(event) => setDispatchSelectedStatus(event.target.value as Exclude<DispatchStatus, "pending">)}
                  disabled={dispatchAllSaving}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-[13px] text-slate-900 outline-none focus:border-indigo-300">
                  {DISPATCH_MUTATION_STATUSES.map((status) => <option key={status} value={status}>{DISPATCH_STATUS_LABELS[status]}</option>)}
                </select>
              </div>

              <div className="mt-5">
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="dispatch-all-remark" className="block text-[12px] font-semibold text-slate-700">
                    Operational Remark
                  </label>
                  <span className="text-[11px] font-medium text-slate-400">{dispatchAllRemark.length}/500</span>
                </div>
                <textarea
                  id="dispatch-all-remark"
                  rows={4}
                  maxLength={500}
                  value={dispatchAllRemark}
                  onChange={(event) => {
                    setDispatchAllRemark(event.target.value);
                    setDispatchAllError("");
                  }}
                  disabled={dispatchAllSaving}
                  className="w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-[13px] leading-6 text-slate-900 outline-none transition focus:border-indigo-300"
                  placeholder="Add the operational dispatch remark"
                />
              </div>

              {dispatchAllError && (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-700">
                  {dispatchAllError}
                </div>
              )}

              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDispatchAllDialogOpen(false)}
                  disabled={dispatchAllSaving}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={submitDispatchAll}
                  disabled={dispatchAllSaving || selectedDispatchLines.length === 0}
                  className="rounded-2xl bg-slate-900 px-4 py-3 text-[13px] font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {dispatchAllSaving ? "Dispatching..." : "Dispatch Selected Products"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {rsmDeclineOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          onClick={(event) => { if (event.target === event.currentTarget && !rsmSaving) setRsmDeclineOpen(false); }}>
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <h2 className="text-base font-bold text-gray-900">Disapprove this order?</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">The dealer sees this reason and can revise the order before sending it back.</p>
            <textarea
              value={rsmDeclineNote}
              onChange={(event) => setRsmDeclineNote(event.target.value.slice(0, 1000))}
              disabled={rsmSaving}
              placeholder="Why is this order being disapproved?"
              className="mt-4 text-gray-900 h-28 w-full resize-none rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setRsmDeclineOpen(false)} disabled={rsmSaving}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Keep Order</button>
              <button type="button" onClick={() => submitRsmReview(false, rsmDeclineNote.trim())} disabled={rsmSaving || !rsmDeclineNote.trim()}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                {rsmSaving ? "Disapproving..." : "Disapprove Order"}
              </button>
            </div>
          </div>
        </div>
      )}
      {cancelDialogOpen && (
        <CancelOrderDialog
          orderId={id}
          requestMode={dealerChangeRequiresApproval}
          saving={cancelSaving}
          error={cancelError}
          onClose={() => setCancelDialogOpen(false)}
          onConfirm={submitCancellation}
        />
      )}
      {editDialogOpen && (
        <EditOrderDialog
          items={displayOrders}
          packLookup={packLookup}
          latestRevision={overlayState?.latestRevision ?? 0}
          requestMode={dealerChangeRequiresApproval}
          saving={editSaving}
          error={editError}
          onClose={() => setEditDialogOpen(false)}
          onSave={submitEdit}
        />
      )}
    </>
  );
}
