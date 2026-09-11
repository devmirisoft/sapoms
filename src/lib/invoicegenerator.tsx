import { formatDisplayOrderNumber } from '@/lib/orderDisplay';
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/ban-ts-comment */
import jsPDF from "jspdf";
import moment from "moment";
import { hasPriorityTag } from "@/lib/orderPriority";
import {
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
import {
    chooseInvoiceSheet,
    fillInvoiceTemplate,
    invoiceTemplateUrl,
    type InvoiceSheet,
    type InvoiceTemplateData,
    type InvoiceTemplateRow,
} from "@/lib/invoiceTemplate";
import { resolveStoredAuth } from "@/lib/roleAccess";
import { normalizeScopeId, resolveOrderDealerId } from "@/lib/staffOrderScope.js";

// ─── Types ────────────────────────────────────────────────────────────────────
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

type InvoiceDisplayRow = InvoiceRowStage & {
    descriptionMainText: string;
    descriptionNoteText: string;
    catNo: string;
    capacity: string;
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

const OMSONS_LOGO_CDN = "https://res.cloudinary.com/zieluz7x/image/upload/v1788865694/omsons_green_logo_xki7cc.png";

// html2canvas cannot read a cross-origin image it did not fetch itself, so the
// logo travels into the template as a data URI, falling back to the embedded one.
async function resolveLogoSrc(): Promise<string> {
    if (typeof fetch !== "function" || typeof FileReader === "undefined") return OMSONS_LOGO_URL;
    try {
        const response = await fetch(OMSONS_LOGO_CDN, { mode: "cors" });
        if (!response.ok) return OMSONS_LOGO_URL;
        const blob = await response.blob();
        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    } catch {
        return OMSONS_LOGO_URL;
    }
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


// Capacity has no column of its own in the order tables, so fall back to the
// first volume-looking token in the product text.
function resolveCapacity(item: any): string {
    const direct = item?.capacity ?? item?.orderdata_capacity ?? item?.specs?.Capacity ?? item?.specs?.["Capacity (mL)"] ?? "";
    if (String(direct).trim()) return String(direct).trim();

    // Blank strings are common here, so take the first non-empty, not the first defined.
    const text = [item?.product_discription, item?.productDescription, item?.product_name]
        .map((value) => String(value ?? "").trim())
        .find(Boolean) ?? "";
    const match = text.match(/(\d+(?:\.\d+)?)\s*(ml|l|cc|mm|cm)\b/i);
    if (!match) return "-";
    const unit = match[2].toLowerCase();
    return `${match[1]}${unit === "ml" ? "mL" : unit === "l" ? "L" : unit}`;
}

// ─── Template data ───────────────────────────────────────────────────────
export async function buildInvoiceTemplateData(
    order: OrderInvoiceData,
    options?: InvoiceDownloadOptions,
): Promise<{ data: InvoiceTemplateData; sheet: InvoiceSheet }> {
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

    const amounts = resolveOrderAmounts(displayOrder);
    const gross = amounts.gross;
    const discount = amounts.discountAmount;
    const net = amounts.netPayable;
    const invNo = invoiceNumber(displayOrder.order_id);
    let discountBreakdown = resolveOrderDiscountBreakdown(displayOrder as OrderAmountSource);
    let invoiceRemark = "N/A";

    // ── Item rows ────────────────────────────────────────────────────────────
    const itemRows: InvoiceTemplateRow[] = [];
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
                capacity: resolveCapacity(itemAny),
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
            itemRows.push({
                srNo: String(idx + 1),
                catNo: displayRow.catNo,
                description: displayRow.descriptionMainText,
                productNote: displayRow.descriptionNoteText,
                capacity: displayRow.capacity,
                qty: String(row.quantity),
                packSize: `${row.quantity} x ${row.packSize}`,
                units: String(row.pieces),
                uom: row.productUnit,
                unitPrice: fmt(displayRow.unitPrice),
                discountPct: pctText(row.discountAmount, row.grossAmount),
                net: fmt(row.netAmount),
            });
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
        itemRows.push({
            srNo: "1",
            catNo: String((displayOrder as any).orderdata_cat_no || "-"),
            description: fallbackDescription.mainText,
            productNote: fallbackDescription.noteText,
            capacity: resolveCapacity(displayOrder as any),
            qty: String(totalQty),
            packSize: `${totalQty} x ${fpack}`,
            units: String(fpieces),
            uom: "Pcs",
            unitPrice: fmt(fpieces > 0 ? gross / fpieces : gross),
            discountPct: pctText(discount, gross),
            net: fmt(net),
        });
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

    // ── Template fields ─────────────────────────────────────────────────────
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

    const orderMoment = moment(displayOrder.order_date);
    const creditDays = String(dealerSource.creditdays ?? "").trim() || "30";
    const customerName = dealerSource.Dealer_Name || displayOrder.Dealer_Name || "-";
    const clientAddress = [dealerSource.Dealer_Address, dealerSource.Dealer_City, dealerSource.Dealer_Pincode]
        .map((part) => String(part ?? "").trim())
        .filter(Boolean)
        .join("\n") || "-";
    const gridTotalNet = rowMeta.reduce((sum, row) => sum + row.netAmount, 0);
    const pct = (value?: number) => `${Number(value ?? 0)}%`;
    const dash = (value: unknown) => String(value ?? "").trim() || "-";

    const data: InvoiceTemplateData = {
        logoSrc: await resolveLogoSrc(),
        titleLine1: titleHead,
        titleLine2: titleTail,
        docNoLabel: isApproved ? "Invoice No." : "PO No.",
        docNo: invNo,
        orderDate: orderMoment.format("DD-MM-YYYY"),
        docDateLabel: isApproved ? "Invoice Date" : "PO Date",
        docDate: orderMoment.format("DD-MM-YYYY"),
        orderTime: orderMoment.format("hh:mm A"),
        customerName,
        outstandingDate: displayOrder.outstandingDate
            ? moment(displayOrder.outstandingDate).format("DD-MM-YYYY")
            : "-",
        clientName: customerName,
        clientAddress,
        clientGst: dash(dealerSource.gst),
        clientPhone: dash(dealerSource.Dealer_Number),
        clientEmail: dash(dealerSource.Dealer_Email),
        shipName: customerName,
        shipAddress: String(dealerSource.Dealer_shipto ?? "").trim() || clientAddress,
        shipPhone: dash(dealerSource.Dealer_Number),
        rows: itemRows,
        lineItemCount: String(itemRows.length),
        totalQuantity: String(rowMeta.reduce((sum, row) => sum + row.quantity, 0)),
        totalNet: fmt(gridTotalNet),
        grossTotal: fmt(discountBreakdown.grossAmount),
        baseDiscountPct: pct(discountBreakdown.baseDiscountPercent),
        baseDiscount: fmt(discountBreakdown.baseDiscountAmount),
        slabDiscountPct: pct(discountBreakdown.slabDiscountPercent),
        slabDiscount: fmt(discountBreakdown.slabDiscountAmount),
        customDiscountPct: pct(discountBreakdown.customDiscountPercent),
        customDiscount: fmt(discountBreakdown.customDiscountAmount),
        // ponytail: no rewards ledger in this codebase yet, so the row reads zero.
        redeemRewards: fmt(0),
        totalDiscount: fmt(discountBreakdown.discountAmount),
        netAmount: fmt(discountBreakdown.netPayableAmount),
        amountInWords: toWords(net),
        paymentTerms: `Net ${creditDays} days from the date of invoice.`,
        remarks: invoiceRemark,
    };

    return { data, sheet: chooseInvoiceSheet(itemRows.length) };
}

// ─── Filled invoice markup ───────────────────────────────────────────────────
export async function generateOrderInvoiceHtml(
    order: OrderInvoiceData,
    options?: InvoiceDownloadOptions,
): Promise<{ html: string; sheet: InvoiceSheet }> {
    const { data, sheet } = await buildInvoiceTemplateData(order, options);
    const response = await fetch(invoiceTemplateUrl(sheet), { cache: "force-cache" });
    if (!response.ok) throw new Error(`Could not load the ${sheet} invoice template`);
    return { html: fillInvoiceTemplate(await response.text(), data), sheet };
}

/* html2canvas re-implements CSS painting and only understands
   `background-clip: border-box | padding-box | content-box`. The templates
   letter their headings with a gradient — `background-clip: text` plus a
   transparent `-webkit-text-fill-color`, a property html2canvas has never
   heard of — so it paints the gradient across the whole box and the text on
   top of it in the design's fallback colour: an unreadable green-on-green
   bar. Flatten those headings to plain coloured text before rasterising, so
   the sheet reads the way the template does. */
export function flattenUnpaintableCss(frameDoc: Document, view: Window | null) {
    const getStyle = view?.getComputedStyle?.bind(view);
    if (!getStyle) return;
    for (const el of Array.from(frameDoc.querySelectorAll<HTMLElement>("*"))) {
        const style = getStyle(el) as CSSStyleDeclaration & { webkitBackgroundClip?: string };
        if (style.webkitBackgroundClip !== "text" && style.backgroundClip !== "text") continue;
        // The design states its own fallback in `color`; if it leans entirely on
        // the gradient, borrow the gradient's first stop instead of going black.
        const fallback = style.color === "rgba(0, 0, 0, 0)" || style.color === "transparent"
            ? style.backgroundImage.match(/#[0-9a-f]{3,8}|rgba?\([^)]*\)/i)?.[0]
            : style.color;
        el.style.background = "none";
        el.style.setProperty("-webkit-text-fill-color", fallback || "currentColor");
        if (fallback) el.style.color = fallback;
    }
}

/* The sheets are the design's own HTML, so they are rendered rather than
   redrawn: each `.page` is painted to a canvas and dropped onto an A4 page.
   That trades selectable text for exact fidelity with the template. */
async function renderInvoiceHtmlToPdf(html: string): Promise<Blob> {
    if (typeof document === "undefined") throw new Error("Invoice rendering needs a browser");
    const html2canvas = (await import("html2canvas")).default;

    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1280px;height:1800px;border:0";
    document.body.appendChild(frame);
    try {
        const frameDoc = frame.contentDocument;
        if (!frameDoc) throw new Error("Could not open the invoice render frame");
        frameDoc.open();
        frameDoc.write(html);
        frameDoc.close();

        await Promise.all(Array.from(frameDoc.images).map((img) =>
            img.complete ? Promise.resolve() : img.decode().catch(() => undefined)
        ));
        await (frameDoc as any).fonts?.ready;
        flattenUnpaintableCss(frameDoc, frame.contentWindow);

        const sheets = Array.from(frameDoc.querySelectorAll<HTMLElement>(".page"));
        if (sheets.length === 0) throw new Error("The invoice template produced no pages");

        /* html2canvas lays its clone out at `windowWidth`, which defaults to the
           host page, not this frame. The sheet is centred with `margin: 0 auto`,
           so a different width moves it and the capture comes back offset - the
           page background running out partway across. Size the frame to the
           sheet and hand html2canvas the frame's own dimensions. */
        frame.style.width = `${Math.max(...sheets.map((sheet) => sheet.offsetWidth))}px`;
        frame.style.height = `${Math.max(...sheets.map((sheet) => sheet.offsetHeight))}px`;

        const doc = new jsPDF("p", "mm", "a4");
        for (let index = 0; index < sheets.length; index += 1) {
            const canvas = await html2canvas(sheets[index], {
                scale: 2,
                useCORS: true,
                backgroundColor: "#ffffff",
                logging: false,
                windowWidth: frameDoc.documentElement.clientWidth,
                windowHeight: frameDoc.documentElement.clientHeight,
            });
            if (index > 0) doc.addPage();
            doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297, undefined, "FAST");
        }
        return doc.output("blob");
    } finally {
        frame.remove();
    }
}

// ─── Main PDF Generator ──────────────────────────────────────────────────────
export async function generateOrderInvoicePDF(
    order: OrderInvoiceData,
    options?: InvoiceDownloadOptions,
): Promise<Blob> {
    const { html } = await generateOrderInvoiceHtml(order, options);
    return renderInvoiceHtmlToPdf(html);
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

// ─── Download to device ────────────────────────────────────────────────────────
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

// ─── List invoices ─────────────────────────────────────────────────────────────
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

// ─── Delete invoice ────────────────────────────────────────────────────────────
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
