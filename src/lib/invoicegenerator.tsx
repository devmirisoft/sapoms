import { formatDisplayOrderNumber } from '@/lib/orderDisplay';
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/ban-ts-comment */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import moment from "moment";
import { hasPriorityTag } from "@/lib/orderPriority";
import {
    getOrderDiscountSummaryRows,
    getReadableAdditionalDiscountText,
    resolveOrderAmounts,
    resolveOrderDiscountBreakdown,
    type OrderAmountSource,
} from "@/lib/orderAmounts";
import {
    reconcileInvoiceRowAmounts,
    type InvoiceRowStage,
} from "@/lib/invoiceRowReconciliation";
import {
    buildInvoiceDescriptionMeta,
    mergeProductNotesIntoInvoiceItems,
} from "@/lib/orderProductNotes.mjs";
import { resolveStoredAuth } from "@/lib/roleAccess";
import { normalizeScopeId, resolveOrderDealerId } from "@/lib/staffOrderScope.js";

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface OrderInvoiceData {
    order_id: string;
    order_date: string;
    order_amount: string | number;
    order_discount: string | number;
    Dealer_Name: string;
    orderdata_item_quantity: string;
    mtstatus: string;
    outstandingDate?: string;
    reason?: string;
    order_note?: string;
    note?: string;
    remark?: string;
    remarks?: string;
    product_name?: string;
    order_discount_amount?: string | number;
    order_net_amount?: string | number;
    grossAmount?: string | number;
    discountAmount?: string | number;
    netPayableAmount?: string | number;
    baseDiscountAmount?: string | number;
    baseDiscountPercent?: string | number;
    customDiscountAmount?: string | number;
    customDiscountPercent?: string | number;
    approvedDiscountPercent?: string | number;
    allocatedDiscountPercent?: string | number;
    slabDiscountAmount?: string | number;
    slabDiscountPercent?: string | number;
    amountBeforeSlab?: string | number;
    order_dealer?: string | number;
    orderdata_dealerid?: string | number;
    Dealer_Id?: string | number;
    Dealer_Email?: string;
    Dealer_Number?: string;
    Dealer_Address?: string;
    Dealer_shipto?: string;
    Dealer_City?: string;
    Dealer_Pincode?: string;
    Dealer_Dealercode?: string;
    Dealer_Notes?: string;
    gst?: string;
    creditdays?: string;

}

export interface DealerProfile {
    Dealer_Id?: string;
    Dealer_Name?: string;
    Dealer_Email?: string;
    Dealer_Number?: string;
    Dealer_Address?: string;
    Dealer_shipto?: string;
    Dealer_City?: string;
    Dealer_Pincode?: string;
    Dealer_Dealercode?: string;
    Dealer_Notes?: string;
    gst?: string;
    creditdays?: string;
    discount?: string;
    staffname?: string;
}

export interface InvoiceResult {
    success: boolean;
    message: string;
    url?: string;
    invoiceId?: string;
    error?: string;
}

export type InvoiceDownloadOptions = {
    normalizedRole?: string | null;
    actorId?: string | number | null;
};

function resolveInvoiceActor(options?: InvoiceDownloadOptions) {
    const explicitRole = normalizeScopeId(options?.normalizedRole).toLowerCase();
    const explicitActorId = normalizeScopeId(options?.actorId);
    if (explicitRole) return { role: explicitRole, actorId: explicitActorId };
    if (typeof window === "undefined") return { role: "", actorId: "" };

    const auth = resolveStoredAuth(localStorage);
    if (auth.status !== "authenticated") return { role: "", actorId: "" };
    const actorId = auth.role === "dealer"
        ? normalizeScopeId(auth.user.Dealer_Id)
        : auth.role === "staff"
            ? normalizeScopeId(auth.user.staff_id)
            : normalizeScopeId(auth.user.id ?? auth.user.admin_id ?? auth.user.Admin_Id);
    return { role: auth.role, actorId };
}

export function canGenerateOrderInvoiceForActor(order: OrderInvoiceData, options?: InvoiceDownloadOptions) {
    const actor = resolveInvoiceActor(options);
    if (actor.role !== "dealer") return true;
    const ownerId = resolveOrderDealerId(order as unknown as Record<string, unknown>);
    return Boolean(actor.actorId && ownerId && actor.actorId === ownerId);
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface OrderItem {
    orderdata_id: string;
    orderdata_orderid?: string;
    orderdata_cat_no: string;
    orderdata_item_quantity: string;
    orderdata_price: string;
    orderdata_discount: string;
    orderdata_afterDisPrice: string;
    product_name: string;
    product_discription?: string;
    product_unit?: string;
    discount?: string;
    remark?: string;
    remarks?: string;
    priority?: string | boolean;
    isPriority?: string | boolean;
    is_priority?: string | boolean;
    productNote?: string;
}

type InvoiceDescriptionMeta = {
    mainText: string;
    noteText: string;
};

type InvoiceDisplayRow = InvoiceRowStage & {
    descriptionMainText: string;
    descriptionNoteText: string;
    catNo: string;
    unitPrice: number;
};

async function fetchOrderSummaryOverride(order: OrderInvoiceData): Promise<Record<string, any> | null> {
    try {
        const params = new URLSearchParams();
        params.set("order_id", String(order.order_id));

        const dealerId = (order as any).dealerId ?? (order as any).dealer_id ?? (order as any).order_dealer;
        if (dealerId) params.set("dealer_id", String(dealerId));

        const res = await fetch(`/api/order-summary-overrides?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) return null;

        const json = await res.json();
        if (!json?.success || !Array.isArray(json.data)) return null;
        return json.data[0] ?? null;
    } catch {
        return null;
    }
}

async function fetchOrderDetail(orderId: string): Promise<Record<string, any> | null> {
    try {
        const normalized = await fetch(`/api/order-access/${encodeURIComponent(orderId)}`, { cache: "no-store" }).catch(() => null);
        if (!normalized?.ok) return null;
        const payload = await normalized.json().catch(() => null);
        return payload?.data ?? null;
    } catch {
        return null;
    }
}


export function extractOrderNoteFromRemarks(value: unknown): string {
    if (typeof value !== "string") return "";

    const match = value.match(/Order note:\s*([^|]+)/i);
    return match?.[1]?.trim() || "";
}

/**
 * Pure helper that resolves the invoice remark from multiple sources,
 * following the priority order:
 *
 *   1. orderNote   (displayOrder.order_note)
 *   2. note        (displayOrder.note)
 *   3. savedNote   (from /api/order-notes)
 *   4. orderRemark (order-level "Order note:" text)
 *   5. itemRemarks (item-level "Order note:" text â€” first match only)
 *   6. reason      (displayOrder.reason)
 *   7. "N/A"
 */
export function resolveInvoiceRemark({
    orderNote,
    note,
    savedNote,
    orderRemark,
    itemRemarks,
    reason,
    discountBreakdown,
}: {
    orderNote?: unknown;
    note?: unknown;
    savedNote?: unknown;
    orderRemark?: unknown;
    itemRemarks?: unknown[];
    reason?: unknown;
    discountBreakdown?: Parameters<typeof getReadableAdditionalDiscountText>[0];
}): string {
    // 1 & 2: direct order note fields
    const direct = String(orderNote || note || "").trim();
    if (direct) return direct;

    // 3: saved note from MongoDB
    const saved = typeof savedNote === "string" ? savedNote.trim() : "";
    if (saved) return saved;

    // 4: order-level "Order note:" extraction
    const fromOrderRemark = extractOrderNoteFromRemarks(orderRemark);
    if (fromOrderRemark) return fromOrderRemark;

    // 5: item-level "Order note:" â€” first unique match
    if (Array.isArray(itemRemarks)) {
        const fromItems = itemRemarks
            .map((r) => extractOrderNoteFromRemarks(r))
            .find(Boolean);
        if (fromItems) return fromItems;
    }

    // 6: reason fallback
    const reasonStr = typeof reason === "string" ? reason.trim() : "";
    if (reasonStr === "slab_or_approved_discount") {
        const readable = discountBreakdown ? getReadableAdditionalDiscountText(discountBreakdown) : null;
        if (readable) return readable;
    }
    if (reasonStr) return reasonStr;

    // 7: nothing found
    return "N/A";
}

async function fetchSavedOrderNote(orderId: string): Promise<string> {
    try {
        const response = await fetch(
            `/api/order-notes?order_id=${encodeURIComponent(orderId)}`,
            { cache: "no-store" }
        );

        if (!response.ok) return "";

        const json = await response.json();
        const note = json?.data?.[0]?.note;

        return typeof note === "string" ? note.trim() : "";
    } catch {
        return "";
    }
}

async function fetchOrderProductNotes(orderId: string): Promise<Array<Record<string, any>>> {
    try {
        const response = await fetch(
            `/api/order-product-notes?orderId=${encodeURIComponent(orderId)}`,
            { cache: "no-store" }
        );

        if (!response.ok) return [];

        const json = await response.json();
        return Array.isArray(json?.data) ? json.data : [];
    } catch {
        return [];
    }
}

// Parse PACK OF column from description HTML table: returns { catNo â†’ packSize }
function parsePackSizes(html: string): Record<string, number> {
    const result: Record<string, number> = {};
    if (!html) return result;

    const theadMatch = html.match(/<thead>([\s\S]*?)<\/thead>/i);
    if (!theadMatch) return result;
    const headers = [...theadMatch[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)]
        .map(m => m[1].replace(/<[^>]*>/g, "").trim());
    const packIdx = headers.findIndex(h => /pack|qty|quantity/i.test(h));
    if (packIdx === -1) return result;

    const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
    if (!tbodyMatch) return result;

    [...tbodyMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].forEach(tr => {
        const cells = [...tr[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)]
            .map(m => m[1].replace(/<[^>]*>/g, "").trim());
        const catNo = cells[0];
        const packStr = cells[packIdx] ?? "1";
        const n = parseInt(packStr, 10);
        if (catNo) result[catNo] = isNaN(n) ? 1 : n;
    });
    return result;
}

function invoiceNumber(orderId: string): string {
    return formatDisplayOrderNumber(orderId);
}

function fmt(n: number): string {
    return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getDealerProfile(): DealerProfile | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = localStorage.getItem("UserData");
        if (!raw) return null;
        const p = JSON.parse(raw);
        return p?.Dealer_Id ? (p as DealerProfile) : null;
    } catch {
        return null;
    }
}

const OMSONS_LOGO_URL = "data:image/jpeg;base64,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";

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
        img.src = src;
    });
}

function toWords(amount: number): string {
    const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    function words(n: number): string {
        if (n === 0) return "";
        if (n < 20) return ones[n] + " ";
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "") + " ";
        if (n < 1_000) return ones[Math.floor(n / 100)] + " Hundred " + words(n % 100);
        if (n < 1_00_000) return words(Math.floor(n / 1_000)) + "Thousand " + words(n % 1_000);
        if (n < 1_00_00_000) return words(Math.floor(n / 1_00_000)) + "Lakh " + words(n % 1_00_000);
        return words(Math.floor(n / 1_00_00_000)) + "Crore " + words(n % 1_00_00_000);
    }
    const rupees = Math.floor(amount);
    const paise = Math.round((amount - rupees) * 100);
    let out = (words(rupees).trim() || "Zero") + " Rupees";
    if (paise > 0) out += " and " + words(paise).trim() + " Paise";
    return out + " Only";
}

// Discount is shown as a percentage of the row's list price.
export function pctText(discountAmount: number, grossAmount: number): string {
    if (!(grossAmount > 0)) return "0%";
    const value = (discountAmount / grossAmount) * 100;
    return `${Number.isInteger(value) ? value : value.toFixed(2)}%`;
}


function resolveCatalogueNumber(item: any): string {
    const directValue =
        item.orderdata_cat_no ??
        item.variantCode ??
        item.variant_code ??
        item.product_cat ??
        item.catNo ??
        item.cat_no ??
        item.catalogueNumber ??
        item.catalogue_number ??
        item.catalogue_no ??
        item.sku ??
        "";

    if (String(directValue).trim()) {
        return String(directValue).trim();
    }

    const remarks = String(item.remark ?? item.remarks ?? "");

    const match = remarks.match(
        /Cat\.?\s*No\.?\s*:\s*([^|,\n]+)/i
    );

    return match?.[1]?.trim() || "";
}


// â”€â”€â”€ Main PDF Generator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function generateOrderInvoicePDF(order: OrderInvoiceData, options?: InvoiceDownloadOptions): Promise<Blob> {
    if (!canGenerateOrderInvoiceForActor(order, options)) throw new Error("Unauthorized invoice access");
    const dp = getDealerProfile();
    // Callers often pass a shallow list row (no items, no dealer address, no notes).
    // Hydrate from the normalized detail endpoint before rendering.
    const hasInlineItems = Array.isArray((order as any).items)
        ? (order as any).items.length > 0
        : Array.isArray((order as any).productorder) && (order as any).productorder.length > 0;
    const detail = hasInlineItems ? null : await fetchOrderDetail(String(order.order_id));
    const fullOrder: OrderInvoiceData = detail ? { ...(order as any), ...detail } : order;
    const inlineSummaryOverride = (fullOrder as any).__source === "postgres" && Array.isArray((fullOrder as any).summaryOverrides)
        ? (fullOrder as any).summaryOverrides[0] ?? null
        : null;
    const summaryOverride = inlineSummaryOverride ?? ((fullOrder as any).__source === "postgres" ? null : await fetchOrderSummaryOverride(fullOrder));
    const displayOrder = summaryOverride ? { ...(fullOrder as any), ...summaryOverride } : fullOrder;
    const dealerSource = { ...(displayOrder as any), ...(dp ?? {}) };

    const isPostgresOrder = (displayOrder as any).__source === "postgres";

    // PostgreSQL detail is already normalized by /api/order-access; do not
    // refetch legacy detail or recalculate row amounts from another source.
    let orderItems: OrderItem[] = [];
    const inlineItems = Array.isArray((displayOrder as any).items)
        ? (displayOrder as any).items as any[]
        : Array.isArray((displayOrder as any).productorder)
            ? (displayOrder as any).productorder as any[]
            : [];
    if (inlineItems.length > 0) {
        const raw = inlineItems;
        orderItems = raw.map((it: any, idx: number) => ({
            orderdata_id: String(it.productId ?? it.id ?? `i-${idx}`),
            orderdata_orderid: String(it.orderdata_orderid ?? it.orderId ?? displayOrder.order_id),
            orderdata_cat_no: String(it.catNo ?? it.orderdata_cat_no ?? it.catalogueNumber ?? it.productId ?? ""),
            orderdata_item_quantity: String(it.quantityPacks ?? it.quantity ?? it.orderdata_item_quantity ?? 0),
            orderdata_price: String(it.unitPrice ?? it.unit_price ?? it.orderdata_price ?? 0),
            orderdata_discount: String(it.discountAmount ?? it.orderdata_discount ?? 0),
            orderdata_afterDisPrice: String(it.finalAmount ?? it.finalPrice ?? it.final_price ?? it.orderdata_afterDisPrice ?? 0),
            product_name: String(it.productName ?? it.product_name ?? ""),
            product_discription: String(it.productDescription ?? it.product_discription ?? ""),
            product_unit: String(it.unit ?? it.product_unit ?? "Pcs"),
            discount: String(it.totalDiscountPercent ?? it.discountPercent ?? it.discount ?? 0),
            remark: it.remark ?? it.remarks ?? undefined,
            remarks: it.remarks ?? it.remark ?? undefined,
            priority: it.priority ?? false,
            isPriority: it.isPriority ?? undefined,
            is_priority: it.is_priority ?? undefined,
            // @ts-ignore
            packSize: it.packSize ?? it.pack_size ?? undefined,
            // @ts-ignore
            totalPieces: it.totalPieces ?? it.total_pieces ?? undefined,
            // @ts-ignore
            quantityPacks: it.quantityPacks ?? it.quantity_packs ?? undefined,
            // @ts-ignore
            listPriceTotal: it.grossAmount ?? it.listPriceTotal ?? it.list_price_total ?? undefined,
            // @ts-ignore
            discountAmount: it.discountAmount ?? it.discount_amount ?? undefined,
            // @ts-ignore
            finalPrice: it.finalAmount ?? it.finalPrice ?? it.final_price ?? undefined,
            productNote: it.productNote ?? it.product_note ?? undefined,
        }));
    }

    const productNotes = Array.isArray((displayOrder as any).orderProductNotes)
        ? (displayOrder as any).orderProductNotes
        : isPostgresOrder
            ? []
            : await fetchOrderProductNotes(String(displayOrder.order_id));
    orderItems = mergeProductNotesIntoInvoiceItems(orderItems, productNotes) as OrderItem[];

    // Resolve the order note used in the invoice Remarks section.
    const savedNote = isPostgresOrder
        ? String((displayOrder as any).order_note ?? (displayOrder as any).note ?? (displayOrder as any).orderNotes?.[0]?.note ?? "")
        : await fetchSavedOrderNote(String(displayOrder.order_id));

    // Collect item-level remark strings for the helper.
    const itemRemarkStrings = orderItems.flatMap((item) =>
        [item.remark, item.remarks].filter(Boolean)
    );

    // One source of truth for the item grid: the table, the page-total bar and
    // its separators all measure from this.
    const COL_W = [10, 15, 58, 10, 16, 12, 10, 20, 17, 22];
    const colX = (index: number) => 10 + COL_W.slice(0, index).reduce((a, b) => a + b, 0);

    const doc = new jsPDF("p", "mm", "a4");
    const PW = doc.internal.pageSize.getWidth();   // 210
    const PH = doc.internal.pageSize.getHeight();  // 297
    const ML = 10;
    const MR = 10;
    const CW = PW - ML - MR;

    const amounts = resolveOrderAmounts(displayOrder);
    const gross = amounts.gross;
    const discount = amounts.discountAmount;
    const net = amounts.netPayable;
    const invNo = invoiceNumber(displayOrder.order_id);
    let discountBreakdown = resolveOrderDiscountBreakdown(displayOrder as OrderAmountSource);
    let invoiceRemark = "N/A";

    // ── Theme ────────────────────────────────────────────────────────────────
    const BLUE: [number, number, number] = [13, 92, 196];
    const BLUE_TINT: [number, number, number] = [232, 241, 253];
    const PANEL: [number, number, number] = [248, 250, 253];
    const BORDER: [number, number, number] = [205, 220, 240];
    const MUTED: [number, number, number] = [95, 110, 130];
    const INK: [number, number, number] = [17, 24, 39];
    const WHITE: [number, number, number] = [255, 255, 255];
    const PAD = 3;

    const fill = (c: number[]) => doc.setFillColor(c[0], c[1], c[2]);
    const stroke = (c: number[]) => doc.setDrawColor(c[0], c[1], c[2]);
    const ink = (c: number[]) => doc.setTextColor(c[0], c[1], c[2]);
    const font = (style: "normal" | "bold" | "italic" | "bolditalic", size: number) => {
        doc.setFont("Helvetica", style);
        doc.setFontSize(size);
    };
    const box = (
        x: number, y: number, w: number, h: number,
        opts: { fill?: number[]; border?: number[]; r?: number; lw?: number } = {}
    ) => {
        if (opts.fill) fill(opts.fill);
        if (opts.border) { stroke(opts.border); doc.setLineWidth(opts.lw ?? 0.2); }
        const style = opts.fill && opts.border ? "FD" : opts.fill ? "F" : "S";
        const r = opts.r ?? 1.5;
        doc.roundedRect(x, y, w, h, r, r, style);
    };
    /* Stroked line icons drawn straight into the PDF. jsPDF has no icon font
       and an image per glyph would bloat every file, so each one is a handful
       of primitives inside an s x s box. */
    type IconName = "calendar" | "calendarCheck" | "clock" | "user" | "users" | "truck"
        | "clipboard" | "rupee" | "card" | "shield" | "pin" | "mail" | "doc" | "box" | "qr";
    const icon = (name: IconName, x: number, y: number, s = 4.2, color: number[] = BLUE) => {
        stroke(color); fill(color); doc.setLineWidth(0.26);
        const cx = x + s / 2;
        const cy = y + s / 2;
        switch (name) {
            case "calendar":
            case "calendarCheck":
                doc.roundedRect(x, y + s * 0.14, s, s * 0.86, 0.4, 0.4, "S");
                doc.line(x, y + s * 0.42, x + s, y + s * 0.42);
                doc.line(x + s * 0.28, y, x + s * 0.28, y + s * 0.26);
                doc.line(x + s * 0.72, y, x + s * 0.72, y + s * 0.26);
                if (name === "calendarCheck") {
                    doc.line(x + s * 0.28, y + s * 0.7, x + s * 0.44, y + s * 0.84);
                    doc.line(x + s * 0.44, y + s * 0.84, x + s * 0.76, y + s * 0.54);
                }
                break;
            case "clock":
                doc.circle(cx, cy, s * 0.46, "S");
                doc.line(cx, cy, cx, cy - s * 0.26);
                doc.line(cx, cy, cx + s * 0.2, cy + s * 0.12);
                break;
            case "user":
                doc.circle(cx, y + s * 0.3, s * 0.19, "S");
                doc.line(x + s * 0.14, y + s * 0.95, x + s * 0.32, y + s * 0.6);
                doc.line(x + s * 0.86, y + s * 0.95, x + s * 0.68, y + s * 0.6);
                doc.line(x + s * 0.14, y + s * 0.95, x + s * 0.86, y + s * 0.95);
                break;
            case "users":
                doc.circle(x + s * 0.34, y + s * 0.3, s * 0.17, "S");
                doc.circle(x + s * 0.76, y + s * 0.34, s * 0.13, "S");
                doc.line(x + s * 0.06, y + s * 0.95, x + s * 0.62, y + s * 0.95);
                doc.line(x + s * 0.06, y + s * 0.95, x + s * 0.2, y + s * 0.62);
                doc.line(x + s * 0.62, y + s * 0.95, x + s * 0.48, y + s * 0.62);
                doc.line(x + s * 0.7, y + s * 0.86, x + s * 0.98, y + s * 0.86);
                break;
            case "truck":
                doc.rect(x, y + s * 0.24, s * 0.56, s * 0.48, "S");
                doc.line(x + s * 0.58, y + s * 0.44, x + s * 0.82, y + s * 0.44);
                doc.line(x + s * 0.82, y + s * 0.44, x + s, y + s * 0.62);
                doc.line(x + s, y + s * 0.62, x + s, y + s * 0.72);
                doc.line(x + s * 0.58, y + s * 0.72, x + s, y + s * 0.72);
                doc.line(x + s * 0.58, y + s * 0.24, x + s * 0.58, y + s * 0.72);
                doc.circle(x + s * 0.24, y + s * 0.82, s * 0.13, "S");
                doc.circle(x + s * 0.8, y + s * 0.82, s * 0.13, "S");
                break;
            case "clipboard":
                doc.roundedRect(x + s * 0.1, y + s * 0.12, s * 0.8, s * 0.88, 0.4, 0.4, "S");
                doc.rect(x + s * 0.32, y, s * 0.36, s * 0.22, "S");
                doc.line(x + s * 0.26, y + s * 0.48, x + s * 0.74, y + s * 0.48);
                doc.line(x + s * 0.26, y + s * 0.68, x + s * 0.62, y + s * 0.68);
                break;
            case "rupee": {
                doc.circle(cx, cy, s * 0.5, "S");
                const prev = doc.getFontSize();
                font("bold", 3.4); ink(color);
                doc.text("Rs", cx, cy + s * 0.14, { align: "center" });
                doc.setFontSize(prev);
                break;
            }
            case "card":
                doc.roundedRect(x, y + s * 0.18, s, s * 0.64, 0.4, 0.4, "S");
                doc.rect(x, y + s * 0.34, s, s * 0.14, "F");
                doc.line(x + s * 0.14, y + s * 0.66, x + s * 0.42, y + s * 0.66);
                break;
            case "shield":
                doc.line(cx, y, x, y + s * 0.22);
                doc.line(x, y + s * 0.22, x + s * 0.12, y + s * 0.7);
                doc.line(x + s * 0.12, y + s * 0.7, cx, y + s);
                doc.line(cx, y + s, x + s * 0.88, y + s * 0.7);
                doc.line(x + s * 0.88, y + s * 0.7, x + s, y + s * 0.22);
                doc.line(x + s, y + s * 0.22, cx, y);
                break;
            case "pin":
                doc.circle(cx, y + s * 0.36, s * 0.32, "S");
                doc.circle(cx, y + s * 0.36, s * 0.12, "F");
                doc.line(x + s * 0.24, y + s * 0.6, cx, y + s);
                doc.line(x + s * 0.76, y + s * 0.6, cx, y + s);
                break;
            case "mail":
                doc.rect(x, y + s * 0.2, s, s * 0.6, "S");
                doc.line(x, y + s * 0.2, cx, y + s * 0.56);
                doc.line(x + s, y + s * 0.2, cx, y + s * 0.56);
                break;
            case "doc":
                doc.line(x + s * 0.12, y, x + s * 0.68, y);
                doc.line(x + s * 0.68, y, x + s * 0.9, y + s * 0.24);
                doc.line(x + s * 0.9, y + s * 0.24, x + s * 0.9, y + s);
                doc.line(x + s * 0.9, y + s, x + s * 0.12, y + s);
                doc.line(x + s * 0.12, y + s, x + s * 0.12, y);
                doc.line(x + s * 0.28, y + s * 0.52, x + s * 0.74, y + s * 0.52);
                doc.line(x + s * 0.28, y + s * 0.74, x + s * 0.62, y + s * 0.74);
                break;
            case "box":
                doc.rect(x, y + s * 0.28, s, s * 0.66, "S");
                doc.line(x, y + s * 0.28, cx, y);
                doc.line(x + s, y + s * 0.28, cx, y);
                doc.line(cx, y, cx, y + s * 0.94);
                break;
            case "qr": {
                const u = s / 5;
                ([[0, 0], [3, 0], [0, 3]] as const).forEach(([gx, gy]) => {
                    doc.rect(x + gx * u, y + gy * u, u * 2, u * 2, "S");
                    doc.rect(x + gx * u + u * 0.6, y + gy * u + u * 0.6, u * 0.8, u * 0.8, "F");
                });
                ([[3, 3], [4.2, 3], [3, 4.2], [4.2, 4.2]] as const)
                    .forEach(([gx, gy]) => doc.rect(x + gx * u, y + gy * u, u * 0.7, u * 0.7, "F"));
                break;
            }
        }
        doc.setLineWidth(0.2);
    };

    /* Icon + small-caps label + value: the unit every meta cell and footer line
       in the design is built from, so they all align on the same grid. */
    const iconLine = (
        name: IconName, x: number, y: number, label: string, value: string | string[],
        opts: { width?: number; labelSize?: number; valueSize?: number; valueBold?: boolean; maxLines?: number } = {},
    ) => {
        icon(name, x, y - 3.4, 4.2);
        font("bold", opts.labelSize ?? 5.6); ink(MUTED);
        doc.text(label.toUpperCase(), x + 6, y);
        font(opts.valueBold === false ? "normal" : "bold", opts.valueSize ?? 7);
        ink(INK);
        const lines = Array.isArray(value)
            ? value
            : opts.width
                ? (doc.splitTextToSize(value, opts.width) as string[]).slice(0, opts.maxLines ?? 2)
                : [value];
        doc.text(lines, x + 6, y + 4.2);
        return lines.length;
    };

    const cardTitle = (x: number, y: number, text: string, align?: "center") => {
        font("bold", 6.2);
        ink(BLUE);
        doc.text(text.toUpperCase(), x, y, align ? { align } : undefined);
    };

    doc.setLineWidth(0.2);

    // ── Document identity ────────────────────────────────────────────────────
    const isApproved = (displayOrder as any).accept_order === "1"
        || Number(displayOrder.mtstatus ?? 0) >= 2
        || String(displayOrder.mtstatus ?? "").toLowerCase().includes("completed");
    const normalizedRole = String(options?.normalizedRole ?? "").trim().toLowerCase();
    const titleStr = isApproved
        ? "ORDER INVOICE"
        : normalizedRole === "staff" ? "SALES ORDER" : "PURCHASE ORDER";
    const titleWords = titleStr.split(" ");
    const titleTail = titleWords.pop() as string;
    const titleHead = titleWords.join(" ");
    const docNoLabel = isApproved ? "Invoice No." : "PO No.";

    // ── Item rows ────────────────────────────────────────────────────────────
    const itemRows: any[][] = [];
    const rowMeta: Array<{ quantity: number; pieces: number; netAmount: number }> = [];
    const stagedRows: InvoiceDisplayRow[] = [];

    // Build pack lookup from products.json (public data)
    const packLookup: Record<string, number> = {};
    try {
        const resp = await fetch("/data/products.json");
        if (resp.ok) {
            const plist = await resp.json();
            for (const p of plist) {
                Object.assign(packLookup, parsePackSizes(p.Description ?? ""));
            }
        }
    } catch {
        // ignore errors - default pack size = 1 will be used
    }

    if (orderItems.length > 0) {
        orderItems.forEach((item) => {
            const qty = Number(item.orderdata_item_quantity);
            const itemAny: any = item as any;
            const payloadPieces = Number(itemAny.totalPieces ?? itemAny.total_pieces ?? 0);
            const pack = Number(itemAny.packSize ?? packLookup[item.orderdata_cat_no] ?? 1) || 1;
            const pieces = (!isNaN(payloadPieces) && payloadPieces > 0) ? payloadPieces : qty * pack;

            // Compute rowGross (list price)
            const lpField = itemAny.listPriceTotal ?? itemAny.list_price_total ?? itemAny.listPrice ?? itemAny.list_price;
            let rowGross = 0;
            if (lpField !== undefined && lpField !== null && String(lpField).trim() !== "") {
                rowGross = Number(lpField) || 0;
            } else if (!isNaN(Number(itemAny.unitPrice)) && !isNaN(Number(pieces)) && Number(pieces) > 0) {
                rowGross = Number(itemAny.unitPrice) * Number(pieces);
            } else {
                rowGross = Number(item.orderdata_price) * qty;
            }

            const explicitItemDiscountAmount = Number(
                itemAny.discountAmount ?? itemAny.orderdata_discount_amount ?? itemAny.orderdata_discount
            );
            const hasExplicitItemDiscountAmount = Number.isFinite(explicitItemDiscountAmount) && explicitItemDiscountAmount >= 0;

            let rowDiscount = hasExplicitItemDiscountAmount ? explicitItemDiscountAmount : 0;
            if (!hasExplicitItemDiscountAmount) {
                const perItemPct = Number(itemAny.totalDiscountPercent ?? itemAny.total_discount_percentage ?? itemAny.total_discount ?? itemAny.discount ?? NaN);
                const orderPct = Number((displayOrder as any)?.totalDiscountPercentage ?? (displayOrder as any)?.discountPercent ?? (displayOrder as any)?.allocatedDiscountPercent ?? (displayOrder as any)?.allocatedDiscount ?? NaN);
                const pct = !isNaN(perItemPct) ? perItemPct : (!isNaN(orderPct) ? orderPct : 0);
                rowDiscount = rowGross * (pct / 100);
            }
            rowDiscount = Math.min(rowGross, Math.max(0, rowDiscount));
            const rowNet = Math.max(0, rowGross - rowDiscount);

            const isPriority = hasPriorityTag(item.priority, item.isPriority, item.is_priority, item.remark, item.remarks);
            const productName = String(item.product_name || "").trim();
            const catalogueNumber = resolveCatalogueNumber(itemAny);
            // Cat. No. has its own column now, so it stays out of the description.
            const descriptionMeta = buildInvoiceDescriptionMeta({
                productName,
                catalogueNumber: "",
                productNote: String(item.productNote ?? ""),
                isPriority,
            });

            stagedRows.push({
                grossAmount: rowGross,
                stagedDiscountAmount: rowDiscount,
                stagedNetAmount: rowNet,
                quantity: qty,
                packSize: pack,
                pieces,
                description: [descriptionMeta.mainText, descriptionMeta.noteText].filter(Boolean).join("\n"),
                descriptionMainText: descriptionMeta.mainText,
                descriptionNoteText: descriptionMeta.noteText,
                productUnit: item.product_unit || "Pcs",
                catNo: catalogueNumber || "-",
                unitPrice: Number(itemAny.unitPrice) || (pieces > 0 ? rowGross / pieces : 0),
            });
        });

        const stageDiscountTotal = stagedRows.reduce((sum, row) => sum + row.stagedDiscountAmount, 0);
        discountBreakdown = resolveOrderDiscountBreakdown(
            displayOrder as OrderAmountSource,
            undefined,
            { itemDiscountTotal: stageDiscountTotal }
        );
        const reconciled = reconcileInvoiceRowAmounts({
            rows: stagedRows,
            amounts,
            discountBreakdown,
            useAuthoritativeTotals: Boolean(summaryOverride),
        });

        reconciled.rows.forEach((row, idx) => {
            const displayRow = stagedRows[idx];
            itemRows.push([
                { content: String(idx + 1), styles: { halign: "center" } },
                { content: displayRow.catNo, styles: { halign: "center" } },
                {
                    content: row.description,
                    styles: { halign: "left", textColor: WHITE },
                    customDescription: {
                        mainText: displayRow.descriptionMainText,
                        noteText: displayRow.descriptionNoteText,
                    },
                },
                { content: String(row.quantity), styles: { halign: "center" } },
                { content: `${row.quantity} x ${row.packSize}`, styles: { halign: "center" } },
                { content: String(row.pieces), styles: { halign: "center" } },
                { content: row.productUnit, styles: { halign: "center" } },
                { content: fmt(displayRow.unitPrice), styles: { halign: "right" } },
                { content: pctText(row.discountAmount, row.grossAmount), styles: { halign: "center" } },
                { content: fmt(row.netAmount), styles: { halign: "right" } },
            ]);
            rowMeta.push({ quantity: row.quantity, pieces: row.pieces, netAmount: row.netAmount });
        });
    } else {
        // Fallback: single row with whatever info we have
        const totalQty = Number(displayOrder.orderdata_item_quantity);
        const fpack = Number(packLookup[(displayOrder as any).orderdata_cat_no] ?? 1) || 1;
        const fpieces = totalQty * fpack;
        const fallbackDescription = buildInvoiceDescriptionMeta({
            productName: String(displayOrder.product_name || "").trim(),
            catalogueNumber: "",
            productNote: String((displayOrder as any).productNote ?? ""),
            isPriority: hasPriorityTag(
                (displayOrder as any).priority,
                (displayOrder as any).isPriority,
                (displayOrder as any).is_priority,
                (displayOrder as any).remark,
                (displayOrder as any).remarks,
            ),
        });
        itemRows.push([
            { content: "1", styles: { halign: "center" } },
            { content: String((displayOrder as any).orderdata_cat_no || "-"), styles: { halign: "center" } },
            {
                content: [fallbackDescription.mainText, fallbackDescription.noteText].filter(Boolean).join("\n"),
                styles: { halign: "left", textColor: WHITE },
                customDescription: fallbackDescription,
            },
            { content: String(totalQty), styles: { halign: "center" } },
            { content: `${totalQty} x ${fpack}`, styles: { halign: "center" } },
            { content: String(fpieces), styles: { halign: "center" } },
            { content: "Pcs", styles: { halign: "center" } },
            { content: fmt(fpieces > 0 ? gross / fpieces : gross), styles: { halign: "right" } },
            { content: pctText(discount, gross), styles: { halign: "center" } },
            { content: fmt(net), styles: { halign: "right" } },
        ]);
        rowMeta.push({ quantity: totalQty, pieces: fpieces, netAmount: net });
    }

    invoiceRemark = resolveInvoiceRemark({
        orderNote: (displayOrder as any).order_note,
        note: (displayOrder as any).note,
        savedNote,
        orderRemark: (displayOrder as any).remark ?? (displayOrder as any).remarks,
        itemRemarks: itemRemarkStrings,
        reason: displayOrder.reason,
        discountBreakdown,
    });

    // ── Footer content (repeated identically on every page) ──────────────────
    const wordsText = toWords(net);
    const paymentTerms = dealerSource.creditdays ? `Net ${dealerSource.creditdays} days` : "Net 30 days";
    const DISPATCH_FROM = "Ambala Warehouse";
    const grandQuantity = rowMeta.reduce((sum, row) => sum + row.quantity, 0);
    const grandPieces = rowMeta.reduce((sum, row) => sum + row.pieces, 0);
    const settlementInfo = (displayOrder as any)?.settlement;
    const settledPaid = Number(settlementInfo?.paidAmount ?? 0);

    const summaryLines: Array<{ label: string; value: string; bold?: boolean }> =
        getOrderDiscountSummaryRows(discountBreakdown, { net: "Net Amount" }).map((row) => ({
            label: row.label,
            value: `Rs. ${fmt(row.amount)}`,
            bold: row.key === "net",
        }));
    if (settlementInfo && settledPaid > 0) {
        const settledDue = Number(settlementInfo.dueAmount ?? Math.max(0, net - settledPaid));
        summaryLines.push({ label: "Amount Paid", value: `Rs. ${fmt(settledPaid)}` });
        summaryLines.push({
            label: settledDue > 0 ? "Balance Due" : "Status",
            value: settledDue > 0 ? `Rs. ${fmt(settledDue)}` : "Fully settled",
        });
    }

    const logoImg = await loadImage(OMSONS_LOGO_URL).catch(() => null);

    const HEADER_H = 48;          // header band, repeated on every page
    const FOOT_TOP = PH - 82;     // bottom card band, drawn in full on the last page
    const TOTAL_PAGES = "{tp}";

    const drawHeader = () => {
        if (logoImg) doc.addImage(logoImg, "JPEG", ML, 9, 26, 15);

        font("bold", 13.5); ink(INK);
        doc.text("Omsons Glassware Pvt. Ltd.", ML + 30, 15);
        const addressLines: Array<[IconName | null, string]> = [
            ["pin", "KHATA No. 278/364 AND 285/372 HADBAST No. 66 Khuda Kalan to Sapehra Road,"],
            [null, "P.O. Pilkhani, Ambala, Haryana 133104, India"],
            ["mail", "Email: info@omsonsglass.com   |   Phone: +91-1234567890"],
            ["doc", "PAN: AAACO1234F   |   GSTIN: 06AAACO1234F1Z5   |   CIN: U12345HR2000PTC012345"],
        ];
        addressLines.forEach(([glyph, line], i) => {
            const ly = 20 + i * 3.6;
            if (glyph) icon(glyph, ML + 30, ly - 2.4, 3);
            font("normal", 6.2); ink(MUTED);
            doc.text(line, ML + 34.5, ly);
        });

        font("bold", 15); ink(INK);
        doc.text(titleHead, PW - MR, 16, { align: "right" });
        ink(BLUE);
        doc.text(titleTail, PW - MR, 24, { align: "right" });
        stroke(BLUE); doc.setLineWidth(0.6);
        doc.line(PW - MR - 44, 26.5, PW - MR, 26.5);

        box(PW - MR - 46, 29, 46, 12, { fill: BLUE_TINT, border: BLUE, lw: 0.3 });
        cardTitle(PW - MR - 23, 33.5, docNoLabel, "center");
        font("bold", 9.5); ink(BLUE);
        doc.text(invNo, PW - MR - 23, 38.5, { align: "center" });

        stroke(BLUE); doc.setLineWidth(0.8);
        doc.line(ML, 44, PW - MR, 44);
        doc.setLineWidth(0.2);
    };

    /* Continuation pages pin the page total to the foot of the sheet so every
       sheet ends on the same line; the last page tucks it straight under the
       final row, where the summary picks up. */
    const drawTotalBar = (
        atY: number,
        page: { quantity: number; pieces: number; netAmount: number },
        isLastPage: boolean,
    ) => {
        if (!isLastPage) {
            stroke(BORDER); doc.setLineWidth(0.3);
            doc.setLineDashPattern([1, 1], 0);
            doc.line(ML, atY + 3, PW - MR, atY + 3);
            doc.setLineDashPattern([], 0);
            const label = "More items on next page";
            font("bold", 6);
            const lw = doc.getTextWidth(label) + 6;
            fill(WHITE);
            doc.rect(PW / 2 - lw / 2, atY + 0.6, lw, 4.4, "F");
            ink(BLUE);
            doc.text(label, PW / 2, atY + 3.8, { align: "center" });
        }
        const barY = isLastPage ? atY + 2 : FOOT_TOP - 11;
        box(ML, barY, CW, 8, { fill: BLUE_TINT, border: BORDER, r: 1 });
        // Separators and figures sit on the item grid, not on eyeballed offsets.
        stroke(BORDER); doc.setLineWidth(0.2);
        [3, 4, 5, 9].forEach((col) => doc.line(colX(col), barY + 0.6, colX(col), barY + 7.4));
        font("bold", 7); ink(BLUE);
        doc.text(isLastPage ? "TOTAL" : "TOTAL (This Page)", colX(3) - 4, barY + 5.2, { align: "right" });
        doc.text(String(page.quantity), colX(3) + COL_W[3] / 2, barY + 5.2, { align: "center" });
        doc.text(String(page.pieces), colX(5) + COL_W[5] / 2, barY + 5.2, { align: "center" });
        doc.text(fmt(page.netAmount), PW - MR - 2, barY + 5.2, { align: "right" });
    };

    const drawPageFoot = (pageNumber: number, isLastPage: boolean) => {
        font("normal", 5.8); ink(MUTED);
        doc.text(`Page ${pageNumber} of ${TOTAL_PAGES}`, PW / 2, PH - 12, { align: "center" });
        font("italic", 5.5);
        doc.text("Powered by Teemers ERP", ML, PH - 12);
        if (!isLastPage) {
            const label = `Continued on Page ${pageNumber + 1}`;
            font("bold", 6);
            const w = doc.getTextWidth(label) + 10;
            box(PW - MR - w, PH - 17, w, 6.5, { fill: BLUE, r: 1 });
            ink(WHITE);
            doc.text(label, PW - MR - w / 2, PH - 12.7, { align: "center" });
        }
        fill(BLUE_TINT); doc.rect(0, PH - 9, PW, 3, "F");
        fill(BLUE); doc.rect(0, PH - 6, PW, 6, "F");
        doc.setLineWidth(0.2);
    };

    /* Footer band, four cards on the item grid. Continuation pages lead with
       the words / payment pair; the last page swaps that column for the money
       summary, exactly as the printed design does. */
    const drawBottomBand = (pageNumber: number, isLastPage: boolean) => {
        const y = FOOT_TOP;
        const CARD_H = 38;
        const c1 = { x: ML, w: 58 };
        const c2 = { x: ML + 60, w: 44 };
        const c3 = { x: ML + 106, w: 52 };
        const c4 = { x: ML + 160, w: 30 };

        if (isLastPage) {
            box(c1.x, y, c1.w, CARD_H, { fill: PANEL, border: BORDER });
            cardTitle(c1.x + PAD, y + 5, "Order Summary");
            const rows = [
                { label: "Total Quantity", value: String(grandQuantity) },
                { label: "Total Pieces", value: String(grandPieces) },
                ...summaryLines,
            ];
            const step = Math.min(4.6, (CARD_H - 10) / Math.max(1, rows.length));
            rows.forEach((line, i) => {
                const ly = y + 9 + i * step + step * 0.62;
                if (line.bold) box(c1.x + 1, ly - step * 0.72, c1.w - 2, step, { fill: BLUE_TINT, r: 0.8 });
                font(line.bold ? "bold" : "normal", line.bold ? 7 : 5.8);
                ink(line.bold ? BLUE : MUTED);
                doc.text(line.label, c1.x + PAD, ly);
                ink(line.bold ? BLUE : INK);
                doc.text(line.value, c1.x + c1.w - PAD, ly, { align: "right" });
            });
        } else {
            box(c1.x, y, c1.w, 20, { fill: BLUE_TINT, border: BORDER });
            iconLine("rupee", c1.x + PAD, y + 5, "Amount in Words", wordsText,
                { labelSize: 5.6, valueSize: 6, valueBold: false, width: c1.w - PAD - 8, maxLines: 3 });

            box(c1.x, y + 22, c1.w, CARD_H - 22, { fill: PANEL, border: BORDER });
            iconLine("card", c1.x + PAD, y + 27, "Payment Terms", paymentTerms,
                { labelSize: 5.6, valueSize: 6, valueBold: false });
        }

        box(c2.x, y, c2.w, CARD_H, { fill: PANEL, border: BORDER });
        cardTitle(c2.x + PAD, y + 5, "Other Details");
        const details: Array<[IconName, string, string | string[]]> = [
            ["box", "Dispatch From", DISPATCH_FROM],
            ["truck", "Delivery Terms", "As Disclosed"],
            ["card", "Payment Terms", paymentTerms],
        ];
        if (isLastPage) details.unshift(["rupee", "Amount in Words", wordsText]);
        // Four entries have to fit inside CARD_H, so the step is measured, not guessed.
        else if (invoiceRemark && invoiceRemark !== "N/A") details.push(["doc", "Remarks", invoiceRemark]);
        let dy = y + 9.5;
        details.forEach(([glyph, label, value]) => {
            const lines = iconLine(glyph, c2.x + PAD, dy, label, value,
                { labelSize: 5.4, valueSize: 6, valueBold: false, width: c2.w - PAD - 8, maxLines: 2 });
            dy += 3.4 + lines * 2.6;
        });

        box(c3.x, y, c3.w, CARD_H, { fill: PANEL, border: BORDER });
        icon("shield", c3.x + PAD, y + 1.6, 3.6);
        cardTitle(c3.x + PAD + 5, y + 5, "Terms & Conditions");
        font("normal", 5.2); ink(MUTED);
        let ty = y + 10;
        tcLines().forEach((t, i) => {
            const lines = doc.splitTextToSize(`${i + 1}. ${t}`, c3.w - PAD * 2) as string[];
            doc.text(lines, c3.x + PAD, ty);
            ty += lines.length * 2.6;
        });

        // ponytail: the code is drawn, not encoded - a real QR needs a Reed-Solomon
        // encoder (`qrcode` dep). The PO number below it stays the readable token.
        box(c4.x, y, c4.w, CARD_H, { fill: BLUE_TINT, border: BORDER });
        cardTitle(c4.x + c4.w / 2, y + 5, "Scan to Verify", "center");
        box(c4.x + c4.w / 2 - 9, y + 7.5, 18, 18, { fill: WHITE, border: BLUE, lw: 0.3, r: 1 });
        icon("qr", c4.x + c4.w / 2 - 6, y + 10.5, 12);
        cardTitle(c4.x + c4.w / 2, y + 30, docNoLabel, "center");
        font("bold", 6.5); ink(BLUE);
        doc.text(invNo, c4.x + c4.w / 2, y + 34, { align: "center" });

        // Signature row, stamp centred between the two signatories.
        const sy = y + CARD_H + 9;
        font("bold", 6.5); ink(INK);
        doc.text("Checked By", ML + 6, sy);
        stroke(BORDER); doc.setLineWidth(0.3);
        doc.line(ML + 6, sy + 6, ML + 60, sy + 6);
        font("normal", 5.8); ink(MUTED);
        doc.text("Signature & Date", ML + 6, sy + 9.5);

        stroke(BLUE); doc.setLineWidth(0.5);
        doc.circle(PW / 2, sy + 3, 9, "S");
        doc.circle(PW / 2, sy + 3, 7.2, "S");
        font("bold", 4.4); ink(BLUE);
        doc.text("OMSONS GLASSWARE", PW / 2, sy + 1.4, { align: "center" });
        doc.text("PVT. LTD.", PW / 2, sy + 6.4, { align: "center" });
        icon("box", PW / 2 - 1.8, sy + 2, 3.6);

        font("bold", 6.5); ink(BLUE);
        doc.text("For Omsons Glassware Pvt. Ltd.", PW - MR - 6, sy, { align: "right" });
        stroke(BORDER); doc.setLineWidth(0.3);
        doc.line(PW - MR - 60, sy + 6, PW - MR - 6, sy + 6);
        font("normal", 5.8); ink(MUTED);
        doc.text("Authorized Signatory", PW - MR - 6, sy + 9.5, { align: "right" });

        drawPageFoot(pageNumber, isLastPage);
    };

    // ── Page 1: meta strip, dealer panels, items label ───────────────────────
    const META_Y = HEADER_H + 2;
    const metaCols: [string, string, IconName][] = [
        ["Order Date", moment(displayOrder.order_date).format("DD-MM-YYYY"), "calendar"],
        [isApproved ? "Invoice Date" : "PO Date", moment(displayOrder.order_date).format("DD-MM-YYYY"), "calendar"],
        ["Order Time", moment(displayOrder.order_date).format("hh:mm A"), "clock"],
        ["Dealer", dealerSource.Dealer_Name || displayOrder.Dealer_Name || "-", "user"],
        ["Outstanding Date", displayOrder.outstandingDate ? moment(displayOrder.outstandingDate).format("DD-MM-YYYY") : "-", "calendarCheck"],
    ];
    box(ML, META_Y, CW, 15, { fill: WHITE, border: BORDER });
    const metaW = CW / metaCols.length;
    metaCols.forEach(([label, value, glyph], i) => {
        const cx = ML + i * metaW;
        if (i > 0) {
            stroke(BORDER); doc.setLineWidth(0.2);
            doc.line(cx, META_Y + 3, cx, META_Y + 12);
        }
        iconLine(glyph, cx + PAD, META_Y + 6.2, label, value, { width: metaW - PAD - 7, valueSize: 7, maxLines: 2 });
    });

    // Dealer / ship-to panels
    const panelY = META_Y + 19;
    const half = (CW - 4) / 2;
    const dealerLines: [string, string][] = [];
    if (dealerSource.Dealer_Name) dealerLines.push(["Name", dealerSource.Dealer_Name]);
    if (dealerSource.Dealer_Address) dealerLines.push(["Address", dealerSource.Dealer_Address]);
    if (dealerSource.Dealer_City) dealerLines.push(["City", dealerSource.Dealer_City]);
    if (dealerSource.gst) dealerLines.push(["GST No.", dealerSource.gst]);
    if (dealerSource.Dealer_Number) dealerLines.push(["Phone", dealerSource.Dealer_Number]);
    if (dealerSource.Dealer_Email) dealerLines.push(["Email", dealerSource.Dealer_Email]);
    if (dealerLines.length === 0 && displayOrder.Dealer_Name)
        dealerLines.push(["Name", displayOrder.Dealer_Name]);

    const shipAddr = dealerSource.Dealer_shipto
        || "Omsons Glassware Pvt. Ltd., KHATA No. 278/364 AND 285/372 HADBAST No. 66, Ambala, Haryana 133104";
    const LAB_W = 20;
    const ROW_STEP = 5;
    const wrapValue = (text: string) => doc.splitTextToSize(text, half - PAD * 2 - LAB_W) as string[];
    const dealerRowCount = dealerLines.reduce(
        (sum, [, value]) => sum + Math.min(3, wrapValue(value).length), 0
    );
    const shipRowCount = 1 + Math.min(3, wrapValue(shipAddr).length);
    const bodyH = Math.max(30, Math.max(dealerRowCount, shipRowCount) * ROW_STEP + 8);

    // Label, colon and value each keep their own column so the two panels read
    // as one grid instead of drifting with label length.
    const panel = (x: number, title: string, glyph: IconName, rows: [string, string][]) => {
        box(x, panelY, Math.min(64, half), 7, { fill: BLUE, r: 1.5 });
        icon(glyph, x + 3.5, panelY + 1.6, 3.6, WHITE);
        font("bold", 6.6); ink(WHITE);
        doc.text(title.toUpperCase(), x + 9, panelY + 4.7);
        box(x, panelY + 7, half, bodyH, { fill: PANEL, border: BORDER });
        let ry = panelY + 12.5;
        rows.forEach(([label, value]) => {
            font("bold", 6.4); ink(MUTED);
            doc.text(label, x + PAD + 1, ry);
            doc.text(":", x + PAD + LAB_W - 4, ry);
            font("normal", 6.8); ink(INK);
            const wrapped = wrapValue(value).slice(0, 3);
            doc.text(wrapped, x + PAD + LAB_W, ry);
            ry += Math.max(1, wrapped.length) * ROW_STEP;
        });
    };

    panel(ML, "Supplier / Dealer Details", "users", dealerLines);
    panel(ML + half + 4, "Ship To Details", "truck", [
        ["Name", dealerSource.Dealer_Name || displayOrder.Dealer_Name || "-"],
        ["Address", shipAddr],
    ]);

    const itemsY = panelY + 7 + bodyH + 7;
    icon("clipboard", ML, itemsY - 4.4, 4.6);
    font("bold", 8.5); ink(BLUE);
    doc.text("ITEMS", ML + 6.5, itemsY);
    stroke(BLUE); doc.setLineWidth(0.4);
    doc.line(ML + 21, itemsY - 1.2, PW - MR, itemsY - 1.2);
    doc.setLineWidth(0.2);

    // ── Items table ──────────────────────────────────────────────────────────
    const pageTotals = new Map<number, { quantity: number; pieces: number; netAmount: number }>();
    let drawnRows = 0;

    autoTable(doc, {
        startY: itemsY + 3,
        margin: { left: ML, right: MR, top: HEADER_H + 2, bottom: 94 },
        rowPageBreak: "avoid",
        head: [[
            { content: "Sr.\nNo.", styles: { halign: "center" } },
            { content: "Cat.\nNo.", styles: { halign: "center" } },
            { content: "Product Description", styles: { halign: "left" } },
            { content: "Qty", styles: { halign: "center" } },
            { content: "Pack\nSize", styles: { halign: "center" } },
            { content: "Pieces", styles: { halign: "center" } },
            { content: "UOM", styles: { halign: "center" } },
            { content: "Unit Price\n(Rs.)", styles: { halign: "right" } },
            { content: "Discount\n(%)", styles: { halign: "center" } },
            { content: "Net Amount\n(Rs.)", styles: { halign: "right" } },
        ]],
        body: itemRows,
        styles: {
            font: "Helvetica", fontSize: 7,
            cellPadding: { top: 2.4, right: 2, bottom: 2.4, left: 2 },
            textColor: INK, lineColor: BORDER, lineWidth: 0.15,
            fillColor: WHITE, overflow: "linebreak", valign: "middle",
        },
        headStyles: {
            fillColor: BLUE, textColor: WHITE, fontStyle: "bold", fontSize: 6.2,
            lineColor: BLUE, lineWidth: 0.15, valign: "middle", minCellHeight: 9,
        },
        alternateRowStyles: { fillColor: WHITE },
        columnStyles: Object.fromEntries(COL_W.map((w, i) => [i, { cellWidth: w }])),
        didDrawCell: (data) => {
            if (data.section !== "body") return;

            if (data.column.index === 0) {
                const meta = rowMeta[data.row.index];
                const acc = pageTotals.get(data.pageNumber) ?? { quantity: 0, pieces: 0, netAmount: 0 };
                if (meta) {
                    acc.quantity += meta.quantity;
                    acc.pieces += meta.pieces;
                    acc.netAmount += meta.netAmount;
                }
                pageTotals.set(data.pageNumber, acc);
                drawnRows += 1;
            }

            const rawCell = data.cell.raw as { customDescription?: InvoiceDescriptionMeta } | undefined;
            const descriptionMeta = rawCell?.customDescription;
            if (data.column.index !== 2 || !descriptionMeta) return;

            const availableWidth = data.cell.width - data.cell.padding("left") - data.cell.padding("right");
            const mainLines = doc.splitTextToSize(descriptionMeta.mainText, availableWidth) as string[];
            const noteLines = descriptionMeta.noteText
                ? doc.splitTextToSize(descriptionMeta.noteText, availableWidth) as string[]
                : [];
            const fontSize = data.cell.styles.fontSize ?? 7;
            const lineHeight = (fontSize * 0.352778) * 1.15;
            let cursorY = data.cell.y + data.cell.padding("top") + (fontSize * 0.352778);
            const textX = data.cell.x + data.cell.padding("left");

            doc.setFontSize(fontSize);
            doc.setFont("Helvetica", "normal");
            ink(INK);
            mainLines.forEach((line) => {
                doc.text(line, textX, cursorY);
                cursorY += lineHeight;
            });
            if (noteLines.length > 0) {
                doc.setFont("Helvetica", "bolditalic");
                ink(BLUE);
                noteLines.forEach((line) => {
                    doc.text(line, textX, cursorY);
                    cursorY += lineHeight;
                });
                doc.setFont("Helvetica", "normal");
            }
        },
        didDrawPage: (data) => {
            drawHeader();
            const totals = pageTotals.get(data.pageNumber) ?? { quantity: 0, pieces: 0, netAmount: 0 };
            const isLastPage = drawnRows >= rowMeta.length;
            drawTotalBar(data.cursor?.y ?? FOOT_TOP - 12, totals, isLastPage);
            drawBottomBand(data.pageNumber, isLastPage);
        },
    });

    if (typeof (doc as any).putTotalPages === "function") {
        (doc as any).putTotalPages(TOTAL_PAGES);
    }

    return doc.output("blob");
}

// â”€â”€ T&C lines extracted so they can be reused for height calc â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function tcLines(): string[] {
    return [
        "Goods once sold will not be taken back.",
        "Delivery timeline as discussed.",
        "Payment terms as agreed.",
        "Any damage must be reported within 48 hours.",
        "Taxes as applicable.",
        "Subject to Ambala, Haryana jurisdiction.",
    ];
}

// --- Upload to cloud storage --------------------------------------------------
// Posts the rendered PDF to /api/invoices, which stores the file in Cloudinary
// and the metadata in Postgres. The dealer id, duplicate check, and access
// control are all resolved server-side; the browser no longer writes either.
export async function uploadOrderInvoice(
    pdfBlob: Blob,
    order: OrderInvoiceData,
    options?: InvoiceDownloadOptions
): Promise<InvoiceResult> {
    if (!canGenerateOrderInvoiceForActor(order, options)) return { success: false, message: "Unauthorized invoice access" };
    try {
        const inlineSummaryOverride = (order as any).__source === "postgres" && Array.isArray((order as any).summaryOverrides)
            ? (order as any).summaryOverrides[0] ?? null
            : null;
        const summaryOverride = inlineSummaryOverride ?? ((order as any).__source === "postgres" ? null : await fetchOrderSummaryOverride(order));
        const displayOrder = summaryOverride ? { ...(order as any), ...summaryOverride } : order;
        const invNo = invoiceNumber(order.order_id);
        const net = resolveOrderAmounts(displayOrder).netPayable;

        const dp = getDealerProfile();
        const dealerId = resolveOrderDealerId(order as unknown as Record<string, unknown>) || dp?.Dealer_Id || "";
        if (!dealerId) return { success: false, message: "Upload failed", error: "Could not determine the dealer for this order" };

        const form = new FormData();
        form.append("file", pdfBlob, `${invNo.replace(/\//g, "-")}.pdf`);
        form.append("dealerId", String(dealerId));
        form.append("invoiceNumber", invNo);
        form.append("orderNumber", String(order.order_id ?? ""));
        form.append("buyerName", String(dp?.Dealer_Name || displayOrder.Dealer_Name || ""));
        form.append("invoiceDate", String(displayOrder.order_date ?? ""));
        form.append("totalAmount", String(net));

        const response = await fetch("/api/invoices", { method: "POST", body: form });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
            return { success: false, message: "Upload failed", error: payload?.message || `Upload failed (${response.status})` };
        }

        return {
            success: true,
            message: "Invoice uploaded",
            url: payload.invoice?.downloadUrl,
            invoiceId: payload.invoice?.id,
        };
    } catch (err) {
        return { success: false, message: "Error", error: err instanceof Error ? err.message : "Unknown" };
    }
}

// â”€â”€â”€ Download to device â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function downloadOrderInvoice(order: OrderInvoiceData, options?: InvoiceDownloadOptions): Promise<InvoiceResult> {
    if (!canGenerateOrderInvoiceForActor(order, options)) throw new Error("Unauthorized invoice access");
    try {
        const blob = await generateOrderInvoicePDF(order, options);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${invoiceNumber(order.order_id).replace(/\//g, "-")}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return { success: true, message: "Downloaded" };
    } catch (err) {
        return { success: false, message: "Download failed", error: err instanceof Error ? err.message : "Unknown" };
    }
}

// â”€â”€â”€ List invoices â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function listInvoices(dealerId: string, limit = 100) {
    try {
        const params = new URLSearchParams({ limit: String(limit) });
        if (dealerId) params.set("dealerId", dealerId);

        const response = await fetch(`/api/invoices?${params.toString()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
            return { success: false, message: "Failed", error: payload?.message || `Failed (${response.status})`, data: [] };
        }
        return { success: true, message: "OK", data: payload.invoices || [] };
    } catch (err) {
        return { success: false, message: "Error", error: err instanceof Error ? err.message : "Unknown", data: [] };
    }
}

// â”€â”€â”€ Delete invoice â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// The stored file is resolved from the invoice row server-side, so callers no
// longer pass a storage path.
export async function deleteInvoice(invoiceId: string) {
    try {
        const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}`, { method: "DELETE" });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
            return { success: false, message: "Delete failed", error: payload?.message || `Delete failed (${response.status})` };
        }
        return { success: true, message: "Deleted" };
    } catch (err) {
        return { success: false, message: "Error", error: err instanceof Error ? err.message : "Unknown" };
    }
}
