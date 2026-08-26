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
};

function buildInvoiceDescriptionMeta({
    productName,
    catalogueNumber,
    productNote,
    isPriority,
}: {
    productName: string;
    catalogueNumber: string;
    productNote: string;
    isPriority: boolean;
}): InvoiceDescriptionMeta {
    const baseName = String(productName || catalogueNumber || "â€”").trim();
    const catNumber = String(catalogueNumber || "").trim();
    const normalizedNote = String(productNote || "").trim();

    const mainLines = [
        `${baseName}${productName && catNumber ? ` â€” Cat. No: ${catNumber}` : ""}`,
        isPriority ? "[PRIORITY DELIVERY]" : "",
    ].filter(Boolean);

    return {
        mainText: mainLines.join("\n"),
        noteText: normalizedNote ? `(${normalizedNote})` : "",
    };
}

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

async function fetchOrderItems(orderId: string): Promise<OrderItem[]> {
    try {
        const normalized = await fetch(`/api/order-access/${encodeURIComponent(orderId)}`, { cache: "no-store" }).catch(() => null);
        if (!normalized?.ok) return [];
        const payload = await normalized.json().catch(() => null);
        const normalizedOrder = payload?.data;
        const normalizedItems = Array.isArray(normalizedOrder?.items)
            ? normalizedOrder.items
            : Array.isArray(normalizedOrder?.productorder)
                ? normalizedOrder.productorder
                : [];
        return normalizedItems as OrderItem[];
    } catch {
        return [];
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

function cell(
    doc: jsPDF,
    x: number, y: number, w: number, h: number,
    text: string,
    opts: { bold?: boolean; align?: "left" | "right" | "center"; fontSize?: number; paddingX?: number } = {}
) {
    doc.rect(x, y, w, h);
    doc.setFont("Helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.fontSize ?? 7.5);
    const px = opts.paddingX ?? 2;
    const tx = opts.align === "right" ? x + w - px : opts.align === "center" ? x + w / 2 : x + px;
    doc.text(text, tx, y + h * 0.62, { align: opts.align ?? "left" });
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
    const inlineSummaryOverride = (order as any).__source === "postgres" && Array.isArray((order as any).summaryOverrides)
        ? (order as any).summaryOverrides[0] ?? null
        : null;
    const summaryOverride = inlineSummaryOverride ?? ((order as any).__source === "postgres" ? null : await fetchOrderSummaryOverride(order));
    const displayOrder = summaryOverride ? { ...(order as any), ...summaryOverride } : order;
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
    } else if (!isPostgresOrder) {
        orderItems = await fetchOrderItems(displayOrder.order_id);
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

    const doc = new jsPDF("p", "mm", "a4");
    const PW = doc.internal.pageSize.getWidth();
    const ML = 14;
    const MR = 14;
    const CW = PW - ML - MR;

    const amounts = resolveOrderAmounts(displayOrder);
    const gross = amounts.gross;
    const discount = amounts.discountAmount;
    const net = amounts.netPayable;
    const invNo = invoiceNumber(displayOrder.order_id);
    let discountBreakdown = resolveOrderDiscountBreakdown(displayOrder as OrderAmountSource);
    let invoiceRemark = "N/A";

    // Shared inner padding used consistently everywhere
    const PAD = 4;

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.2);

    let y = 12;

    // â”€â”€ LOGO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const LOGO_W = 28;
    const LOGO_H = 16;

    try {
        const logoImg = await loadImage(OMSONS_LOGO_URL);
        doc.addImage(logoImg, "JPEG", ML, y, LOGO_W, LOGO_H);
    } catch {
        console.warn("Logo could not be loaded; skipping.");
    }

    // â”€â”€ HEADER â€” 8 mm gap between logo right edge and company name â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const infoX = ML + LOGO_W + 8;   // â† was +5

    doc.setFont("Helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Omsons Glassware Pvt. Ltd.", infoX, y + 6);

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(7.5);
    [
        "KHATA No. 278/364 AND 285/372 HADBAST No. 66 Khuda Kalan to Sapehra Road, P.O. Pilkhani,",
        "Ambala, Haryana 133104, India",
        "Email: info@omsonsglass.com  |  Phone: +91-1234567890",
        "PAN: AAACO1234F  |  GSTIN: 06AAACO1234F1Z5  |  CIN: U12345HR2000PTC012345",
    ].forEach((line, i) => doc.text(line, infoX, y + 11 + i * 4));

    y += LOGO_H + 10;   // â† was +8; extra bottom room below header

    // â”€â”€ SEPARATOR â€” consistent left/right margins â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    doc.setDrawColor(160, 160, 160);
    doc.setLineWidth(0.4);
    doc.line(ML, y, PW - MR, y);   // ML â€¦ PW-MR â€” same as all boxes
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.2);
    y += 6;

    // â”€â”€ DOCUMENT TITLE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(11);
    const isApproved = (displayOrder as any).accept_order === "1" || Number(displayOrder.mtstatus ?? 0) >= 2 || String(displayOrder.mtstatus ?? "").toLowerCase().includes("completed");
    const normalizedRole = String(options?.normalizedRole ?? "").trim().toLowerCase();
    const documentTitle = normalizedRole === "staff" ? "SALES ORDER" : "PURCHASE ORDER";
    const titleStr = isApproved ? "ORDER INVOICE" : documentTitle;
    const titleW = doc.getTextWidth(titleStr);
    const titleX = PW / 2;
    doc.text(titleStr, titleX, y, { align: "center" });
    doc.setLineWidth(0.35);
    doc.line(titleX - titleW / 2, y + 0.8, titleX + titleW / 2, y + 0.8);
    doc.setLineWidth(0.2);
    y += 6;

    // â”€â”€ META TABLE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const half = CW / 2;
    const LBW = 32;
    const VW = half - LBW;
    const RH = 6;

    const metaRows: [string, string, string, string][] = [
        [isApproved ? "Invoice No" : "Purchase Order No", invNo,
        isApproved ? "Invoice Date" : "PO Date", moment(displayOrder.order_date).format("DD-MM-YYYY")],
        ["Order Date", moment(displayOrder.order_date).format("DD-MM-YYYY"),
            "Order Time", moment(displayOrder.order_date).format("hh:mm A")],
        ["Dealer", dealerSource.Dealer_Name || displayOrder.Dealer_Name || "â€”",
            "Outstanding Date", displayOrder.outstandingDate ? moment(displayOrder.outstandingDate).format("DD-MM-YYYY") : "â€”"],
    ];

    metaRows.forEach(([l1, v1, l2, v2], i) => {
        const ry = y + i * RH;
        cell(doc, ML, ry, LBW, RH, l1, { bold: true });
        cell(doc, ML + LBW, ry, VW, RH, v1);
        cell(doc, ML + half, ry, LBW, RH, l2, { bold: true });
        cell(doc, ML + half + LBW, ry, VW, RH, v2);
    });

    y += metaRows.length * RH + 5;

    // â”€â”€ DEALER / SHIP-TO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const SEC_HDR_H = 6;

    const dealerLines: [string, string][] = [];
    if (dealerSource.Dealer_Name) dealerLines.push(["Name", dealerSource.Dealer_Name]);
    if (dealerSource.Dealer_Address) dealerLines.push(["Address", dealerSource.Dealer_Address]);
    if (dealerSource.Dealer_City) dealerLines.push(["City", dealerSource.Dealer_City]);
    if (dealerSource.gst) dealerLines.push(["GST No", dealerSource.gst]);
    if (dealerSource.Dealer_Number) dealerLines.push(["Phone", dealerSource.Dealer_Number]);
    if (dealerSource.Dealer_Email) dealerLines.push(["Email", dealerSource.Dealer_Email]);
    if (dealerLines.length === 0 && displayOrder.Dealer_Name)
        dealerLines.push(["Name", displayOrder.Dealer_Name]);

    const ROW_STEP = 5.2;
    const DEALER_BOD_H = Math.max(28, dealerLines.length * ROW_STEP + 10);
    const LAB_W = 24;   // label column inside dealer boxes

    cell(doc, ML, y, half, SEC_HDR_H, "Details of Dealer / Vendor", { bold: true });
    cell(doc, ML + half, y, half, SEC_HDR_H, "Ship To Details", { bold: true });
    y += SEC_HDR_H;

    doc.rect(ML, y, half, DEALER_BOD_H);
    doc.rect(ML + half, y, half, DEALER_BOD_H);

    // Dealer rows â€” PAD from left, LAB_W for label column
    dealerLines.forEach(([label, value], i) => {
        const lineY = y + 7 + i * ROW_STEP;
        doc.setFont("Helvetica", "bold"); doc.setFontSize(7.5);
        doc.text(`${label} :`, ML + PAD, lineY);
        doc.setFont("Helvetica", "normal");
        const wrapped = doc.splitTextToSize(value, half - PAD - LAB_W - PAD);
        doc.text(wrapped[0], ML + PAD + LAB_W, lineY);
    });

    // Ship To â€” same PAD / LAB_W convention
    const shipAddr = dealerSource.Dealer_shipto
        || "Omsons Glassware Pvt. Ltd., KHATA No. 278/364 AND 285/372 HADBAST No. 66, Ambala, Haryana 133104";

    doc.setFont("Helvetica", "bold"); doc.setFontSize(7.5);
    doc.text("Name :", ML + half + PAD, y + 7);
    doc.text("Address :", ML + half + PAD, y + 13);
    doc.setFont("Helvetica", "normal"); doc.setFontSize(7);
    doc.text(dealerSource.Dealer_Name || displayOrder.Dealer_Name || "â€”", ML + half + PAD + LAB_W, y + 7);
    const shipWrapped = doc.splitTextToSize(shipAddr, half - PAD - LAB_W - PAD);
    doc.text(shipWrapped, ML + half + PAD + LAB_W, y + 13);

    y += DEALER_BOD_H + 5;

    // â”€â”€ ITEMS LABEL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text("Items", ML, y);
    y += 4;

    // â”€â”€ ITEMS TABLE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Build item rows from fetched order items, or fall back to a single row
    const itemRows: any[][] = [];
    let totalQty = 0;
    let totalPieces = 0;
    const stagedRows: InvoiceDisplayRow[] = [];

    // Build pack lookup from products.json (public data)
    const packLookup: Record<string, number> = {};
    try {
        const resp = await fetch("/data/products.json");
        if (resp.ok) {
            const plist = await resp.json();
            for (const p of plist) {
                const desc = p.Description ?? p.Description ?? "";
                const pmap = parsePackSizes(desc);
                Object.assign(packLookup, pmap);
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
            const descriptionMeta = buildInvoiceDescriptionMeta({
                productName,
                catalogueNumber,
                productNote: String(item.productNote ?? ""),
                isPriority,
            });

            totalQty += qty;
            totalPieces += pieces;
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
                { content: String(idx + 1).padStart(2, "0"), styles: { halign: "center" } },
                {
                    content: row.description,
                    styles: { halign: "left", textColor: [255, 255, 255] },
                    customDescription: {
                        mainText: displayRow.descriptionMainText,
                        noteText: displayRow.descriptionNoteText,
                    },
                },
                { content: String(row.quantity), styles: { halign: "center" } },
                { content: `${row.quantity} x ${row.packSize}`, styles: { halign: "center" } },
                { content: String(row.pieces), styles: { halign: "center" } },
                { content: row.productUnit, styles: { halign: "center" } },
                { content: fmt(row.grossAmount), styles: { halign: "right" } },
                { content: fmt(row.discountAmount), styles: { halign: "right" } },
                { content: fmt(row.netAmount), styles: { halign: "right" } },
            ]);
        });

        const totals = reconciled.totals;
        itemRows.push([
            { content: "Total", colSpan: 2, styles: { halign: "right", fontStyle: "bold" } },
            { content: String(totalQty), styles: { halign: "center", fontStyle: "bold" } },
            { content: "", styles: {} },
            { content: String(totalPieces), styles: { halign: "center", fontStyle: "bold" } },
            { content: "", styles: {} },
            { content: fmt(totals.grossAmount), styles: { halign: "right", fontStyle: "bold" } },
            { content: fmt(totals.discountAmount), styles: { halign: "right", fontStyle: "bold" } },
            { content: fmt(totals.netAmount), styles: { halign: "right", fontStyle: "bold" } },
        ]);
    } else {
        // Fallback: single row with whatever info we have
        totalQty = Number(displayOrder.orderdata_item_quantity);
        const fpack = Number(packLookup[(displayOrder as any).orderdata_cat_no] ?? 1) || 1;
        const fpieces = totalQty * fpack;
        totalPieces = fpieces;
        const fallbackDescription = buildInvoiceDescriptionMeta({
            productName: String(displayOrder.product_name || "").trim(),
            catalogueNumber: String((displayOrder as any).orderdata_cat_no || "").trim(),
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
            { content: "01", styles: { halign: "center" } },
            {
                content: [fallbackDescription.mainText, fallbackDescription.noteText].filter(Boolean).join("\n"),
                styles: { halign: "left", textColor: [255, 255, 255] },
                customDescription: fallbackDescription,
            },
            { content: String(totalQty), styles: { halign: "center" } },
            { content: `${totalQty} x ${fpack}`, styles: { halign: "center" } },
            { content: String(fpieces), styles: { halign: "center" } },
            { content: "Pcs", styles: { halign: "center" } },
            { content: fmt(gross), styles: { halign: "right" } },
            { content: fmt(discount), styles: { halign: "right" } },
            { content: fmt(net), styles: { halign: "right" } },
        ]);
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

    // Totals row (now includes pieces)
    if (orderItems.length === 0) {
        itemRows.push([
            { content: "Total", colSpan: 2, styles: { halign: "right", fontStyle: "bold" } },
            { content: String(totalQty), styles: { halign: "center", fontStyle: "bold" } },
            { content: "", styles: {} },
            { content: String(totalPieces), styles: { halign: "center", fontStyle: "bold" } },
            { content: "", styles: {} },
            { content: fmt(gross), styles: { halign: "right", fontStyle: "bold" } },
            { content: fmt(discount), styles: { halign: "right", fontStyle: "bold" } },
            { content: fmt(net), styles: { halign: "right", fontStyle: "bold" } },
        ]);
    }

    autoTable(doc, {
        startY: y,
        head: [[
            { content: "Sr\nNo", styles: { halign: "center", cellWidth: 9 } },
            { content: "Description", styles: { halign: "left", cellWidth: "auto" as const } },
            { content: "Qty", styles: { halign: "center", cellWidth: 12 } },
            { content: "Pack\nSize", styles: { halign: "center", cellWidth: 17 } },
            { content: "Pieces", styles: { halign: "center", cellWidth: 13 } },
            { content: "UOM", styles: { halign: "center", cellWidth: 11 } },
            { content: "Gross Amt\n(Rs.)", styles: { halign: "right", cellWidth: 23 } },
            { content: "Discount\n(Rs.)", styles: { halign: "right", cellWidth: 21 } },
            { content: "Net Amt\n(Rs.)", styles: { halign: "right", cellWidth: 21 } },
        ]],
        body: itemRows,
        margin: { left: ML, right: MR },
        styles: {
            font: "Helvetica", fontSize: 8,
            cellPadding: { top: 3, right: 2.5, bottom: 3, left: 2.5 },
            textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.2,
            fillColor: [255, 255, 255], overflow: "linebreak",
        },
        headStyles: {
            fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: "bold",
            lineColor: [0, 0, 0], lineWidth: 0.2, valign: "middle", minCellHeight: 10,
        },
        alternateRowStyles: { fillColor: [255, 255, 255] },
        didDrawCell: (data) => {
            const rawCell = data.cell.raw as { customDescription?: InvoiceDescriptionMeta } | undefined;
            const descriptionMeta = rawCell?.customDescription;

            if (data.section !== "body" || data.column.index !== 1 || !descriptionMeta) {
                return;
            }

            const availableWidth = data.cell.width - data.cell.padding("left") - data.cell.padding("right");
            const mainLines = doc.splitTextToSize(descriptionMeta.mainText, availableWidth) as string[];
            const noteLines = descriptionMeta.noteText
                ? doc.splitTextToSize(descriptionMeta.noteText, availableWidth) as string[]
                : [];
            const lineHeight = ((data.cell.styles.fontSize ?? 8) * 0.352778) * 1.15;
            let cursorY = data.cell.y + data.cell.padding("top") + ((data.cell.styles.fontSize ?? 8) * 0.352778);
            const textX = data.cell.x + data.cell.padding("left");

            doc.setTextColor(0, 0, 0);
            doc.setFont("Helvetica", "normal");
            mainLines.forEach((line) => {
                doc.text(line, textX, cursorY);
                cursorY += lineHeight;
            });

            if (noteLines.length > 0) {
                doc.setFont("Helvetica", "italic");
                noteLines.forEach((line) => {
                    doc.text(line, textX, cursorY);
                    cursorY += lineHeight;
                });
                doc.setFont("Helvetica", "normal");
            }
        },
    });

    y = (doc as any).lastAutoTable.finalY + 3;

    // â”€â”€ REMARKS + T&C (left) | SUMMARY (right) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const SUM_W = 78;
    const LEFT_W = CW - SUM_W;

    const remarkTextWidth = LEFT_W - PAD * 2 - 4;
    const allRemarkLines = doc.splitTextToSize(
        invoiceRemark || "N/A",
        remarkTextWidth
    ) as string[];

    // Prevent unusually long notes from breaking the invoice layout.
    const remarkLines = allRemarkLines.slice(0, 6);

    if (allRemarkLines.length > 6) {
        remarkLines[5] = `${remarkLines[5]}...`;
    }

    const REM_H = Math.max(
        22,
        PAD * 2 + 8 + remarkLines.length * 4
    );
    // T&C height: PAD top + header line + gap + lines + PAD bottom
    const TC_LINE_H = 4;
    const TC_H = PAD + 5 + 3 + tcLines().length * TC_LINE_H + PAD;
    const TOTAL_L_H = REM_H + TC_H;

    // Remarks
    doc.rect(ML, y, LEFT_W, REM_H);
    doc.setFont("Helvetica", "bold"); doc.setFontSize(8);
    doc.text("Remarks", ML + PAD, y + PAD + 2);
    doc.rect(ML + PAD, y + PAD + 4, LEFT_W - PAD * 2, REM_H - PAD * 2 - 4);
    doc.setFont("Helvetica", "normal"); doc.setFontSize(7.5);
    doc.text(
        remarkLines,
        ML + PAD + 2,
        y + PAD + 8
    );
    // T&C â€” all four sides use PAD
    const tcY = y + REM_H;
    doc.rect(ML, tcY, LEFT_W, TC_H);
    doc.setFont("Helvetica", "bold"); doc.setFontSize(8);
    doc.text("Terms & Conditions", ML + PAD, tcY + PAD + 3);
    doc.setFont("Helvetica", "normal"); doc.setFontSize(7.5);
    tcLines().forEach((t, i) =>
        doc.text(
            `${i + 1}. ${t}`,
            ML + PAD,                                       // â† left = PAD
            tcY + PAD + 3 + 4 + i * TC_LINE_H              // â† top = PAD
        )
    );

    // Summary
    const sx = ML + LEFT_W;
    const ROW_H = 6;
    const sumItems = getOrderDiscountSummaryRows(discountBreakdown, { net: "Net Amount" }).map((row) => ({
        label: row.label,
        value: fmt(row.amount),
        bold: row.key === "net",
    }));
    doc.rect(sx, y, SUM_W, TOTAL_L_H);
    doc.setFont("Helvetica", "bold"); doc.setFontSize(8.5);
    doc.text("Summary", sx + PAD, y + 6);
    const LW = SUM_W * 0.55;
    const VW2 = SUM_W - LW;
    let sy = y + 10;
    sumItems.forEach(item => {
        doc.rect(sx, sy, LW, ROW_H);
        doc.rect(sx + LW, sy, VW2, ROW_H);
        doc.setFont("Helvetica", item.bold ? "bold" : "normal"); doc.setFontSize(7.5);
        doc.text(item.label, sx + PAD, sy + ROW_H * 0.63);
        doc.text(`Rs. ${item.value}`, sx + SUM_W - PAD, sy + ROW_H * 0.63, { align: "right" });
        sy += ROW_H;
    });

    y += TOTAL_L_H;

    // â”€â”€ AMOUNT IN WORDS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const FRH = 6;
    doc.rect(ML, y, CW, FRH);
    doc.setFont("Helvetica", "bold"); doc.setFontSize(7.5);
    doc.text("Amount in Words:", ML + PAD, y + FRH * 0.63);
    doc.setFont("Helvetica", "normal");
    const wordsText = toWords(net);
    const wrappedWords = doc.splitTextToSize(wordsText, CW - 40);
    doc.text(wrappedWords[0], ML + 36, y + FRH * 0.63);
    y += FRH;

    // SETTLEMENT: shown only when the Accountant has settled against this order,
    // so an unsettled invoice renders exactly as before.
    const settlementInfo = (displayOrder as any)?.settlement;
    const settledPaid = Number(settlementInfo?.paidAmount ?? 0);
    if (settlementInfo && settledPaid > 0) {
        const settledDue = Number(settlementInfo.dueAmount ?? Math.max(0, net - settledPaid));
        doc.rect(ML, y, CW, FRH);
        doc.setFont("Helvetica", "bold"); doc.setFontSize(7.5);
        doc.text("Amount Paid:", ML + PAD, y + FRH * 0.63);
        doc.setFont("Helvetica", "normal");
        doc.text(fmt(settledPaid), ML + 32, y + FRH * 0.63);
        doc.setFont("Helvetica", "bold");
        doc.text(settledDue > 0 ? "Balance Due:" : "Status:", ML + CW / 2, y + FRH * 0.63);
        doc.setFont("Helvetica", "normal");
        doc.text(
            settledDue > 0 ? fmt(settledDue) : "Fully settled",
            ML + CW / 2 + 26,
            y + FRH * 0.63,
        );
        y += FRH;
    }

    // ââ PAYMENT TERMS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    doc.rect(ML, y, CW, FRH);
    doc.setFont("Helvetica", "bold"); doc.setFontSize(7.5);
    doc.text("Payment Terms:", ML + PAD, y + FRH * 0.63);
    doc.setFont("Helvetica", "normal");
    const pt = dealerSource.creditdays ? `Net ${dealerSource.creditdays} days` : "Net 30";
    doc.text(pt, ML + 32, y + FRH * 0.63);
    y += FRH + 14;

    // â”€â”€ SIGNATURES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    doc.setFont("Helvetica", "normal"); doc.setFontSize(7.5);
    doc.text("Checked By", ML, y);
    doc.setLineWidth(0.3);
    doc.line(ML, y + 8, ML + 50, y + 8);
    doc.setLineWidth(0.2);
    doc.text("Signature & Date", ML, y + 12);

    const PW_R = PW - MR;
    doc.setFont("Helvetica", "bold");
    doc.text("For Omsons Glassware Pvt. Ltd.", PW_R, y, { align: "right" });
    doc.setFont("Helvetica", "normal");
    doc.text("Authorized Signatory", PW_R, y + 14, { align: "right" });
    y += 22;

    // â”€â”€ PAGE FOOTER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    doc.setFont("Helvetica", "normal"); doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text("Page 1 of 1", PW_R, y, { align: "right" });
    doc.setFont("Helvetica", "italic");
    doc.text("Powered by Teemers ERP", PW_R, y + 4, { align: "right" });
    doc.setTextColor(0, 0, 0);

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
