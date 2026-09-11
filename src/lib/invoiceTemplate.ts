/**
 * Fills the purchase-order HTML templates in `public/data`.
 *
 * The templates are the design as authored - their <head>/CSS is untouched and
 * the body carries `{{TOKEN}}` slots plus three repeat markers:
 *
 *   <!--ROW-->…<!--/ROW-->               one line-item <tr>
 *   <!--TOTAL_ROW-->…<!--/TOTAL_ROW-->   the grid total, last sheet only
 *   <!--ITEMS_PAGE-->…<!--/ITEMS_PAGE--> one sheet of line items (purchase1)
 *
 * Everything here is pure string work so it can be exercised without a browser.
 */

export type InvoiceSheet = "purchase1" | "purchase2";

export type InvoiceTemplateRow = {
    srNo: string;
    catNo: string;
    description: string;
    /** Optional per-order note, printed under the product in bold italic. */
    productNote: string;
    capacity: string;
    qty: string;
    packSize: string;
    units: string;
    uom: string;
    unitPrice: string;
    discountPct: string;
    net: string;
};

export type InvoiceTemplateData = {
    logoSrc: string;
    titleLine1: string;
    titleLine2: string;
    docNoLabel: string;
    docNo: string;
    orderDate: string;
    docDateLabel: string;
    docDate: string;
    orderTime: string;
    customerName: string;
    outstandingDate: string;
    clientName: string;
    clientAddress: string;
    clientGst: string;
    clientPhone: string;
    clientEmail: string;
    shipName: string;
    shipAddress: string;
    shipPhone: string;
    rows: InvoiceTemplateRow[];
    lineItemCount: string;
    totalQuantity: string;
    totalNet: string;
    grossTotal: string;
    baseDiscountPct: string;
    baseDiscount: string;
    slabDiscountPct: string;
    slabDiscount: string;
    customDiscountPct: string;
    customDiscount: string;
    redeemRewards: string;
    totalDiscount: string;
    netAmount: string;
    amountInWords: string;
    paymentTerms: string;
    remarks: string;
};

/* An items sheet in purchase1 is 1697px tall: 24px padding, a 242px letterhead,
   the "continued" note and section rule (~129px), a 48px table head, a 70px
   table margin and the page number. That leaves room for 24 rows of 45px plus
   the total row. */
export const ROWS_PER_ITEMS_SHEET = 24;

// purchase2 is a single sheet, so it only holds a short order.
export const SINGLE_SHEET_MAX_ITEMS = 8;

export function chooseInvoiceSheet(itemCount: number): InvoiceSheet {
    return itemCount > SINGLE_SHEET_MAX_ITEMS ? "purchase1" : "purchase2";
}

export function invoiceTemplateUrl(sheet: InvoiceSheet): string {
    return `/data/${sheet}.html`;
}

// Dealer names, addresses and notes are user data going into markup.
function escapeHtml(value: unknown): string {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function escapeMultiline(value: unknown): string {
    return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

/** Lifts a `<!--NAME-->…<!--/NAME-->` block out, leaving `replacement` behind. */
function block(template: string, name: string, replacement = ""): { body: string; rest: string } {
    const open = `<!--${name}-->`;
    const close = `<!--/${name}-->`;
    const start = template.indexOf(open);
    const end = template.indexOf(close);
    if (start === -1 || end === -1) return { body: "", rest: template };
    return {
        body: template.slice(start + open.length, end),
        rest: template.slice(0, start) + replacement + template.slice(end + close.length),
    };
}

function applyTokens(html: string, values: Record<string, string>): string {
    return html.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key: string) =>
        Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
    );
}

function renderRow(rowTemplate: string, row: InvoiceTemplateRow): string {
    return applyTokens(rowTemplate, {
        SR_NO: escapeHtml(row.srNo),
        CAT_NO: escapeHtml(row.catNo),
        DESCRIPTION: escapeMultiline(row.description),
        // Styled inline so the design's own stylesheet stays untouched.
        PRODUCT_NOTE: String(row.productNote ?? "").trim()
            ? `<br><span style="font-style: italic; font-weight: 700;">${escapeMultiline(row.productNote)}</span>`
            : "",
        CAPACITY: escapeHtml(row.capacity),
        QTY: escapeHtml(row.qty),
        PACK_SIZE: escapeHtml(row.packSize),
        UNITS: escapeHtml(row.units),
        UOM: escapeHtml(row.uom),
        UNIT_PRICE: escapeHtml(row.unitPrice),
        DISCOUNT_PCT: escapeHtml(row.discountPct),
        NET: escapeHtml(row.net),
    });
}

function chunk<T>(items: T[], size: number): T[][] {
    if (items.length === 0) return [[]];
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

export function fillInvoiceTemplate(template: string, data: InvoiceTemplateData): string {
    // Both repeats leave a token behind, so the grid total stays inside <tbody>.
    const rowBlock = block(template, "ROW");
    const totalBlock = block(rowBlock.rest, "TOTAL_ROW", "{{TOTAL_ROW}}");
    const itemsPage = block(totalBlock.rest, "ITEMS_PAGE", "{{ITEMS_PAGES}}");
    const renderRows = (rows: InvoiceTemplateRow[]) =>
        rows.map((row) => renderRow(rowBlock.body, row)).join("\n");

    let html: string;
    if (itemsPage.body) {
        // purchase1: the grid gets its own sheets, repeated until the rows run out.
        const sheets = chunk(data.rows, ROWS_PER_ITEMS_SHEET);
        html = applyTokens(itemsPage.rest, {
            ITEMS_PAGES: sheets.map((sheetRows, index) => applyTokens(itemsPage.body, {
                ITEM_ROWS: renderRows(sheetRows),
                TOTAL_ROW: index === sheets.length - 1 ? totalBlock.body : "",
                CONTINUED_FROM: index === 0
                    ? "Continued from Page 1"
                    : `Line items continued from Page ${index + 1}`,
            })).join("\n"),
        });
    } else {
        // purchase2: one sheet, every row on it.
        html = applyTokens(itemsPage.rest, {
            ITEM_ROWS: renderRows(data.rows),
            TOTAL_ROW: totalBlock.body,
        });
    }

    html = applyTokens(html, {
        LOGO_SRC: escapeHtml(data.logoSrc),
        TITLE_1: escapeHtml(data.titleLine1),
        TITLE_2: escapeHtml(data.titleLine2),
        DOC_NO_LABEL: escapeHtml(data.docNoLabel),
        DOC_NO: escapeHtml(data.docNo),
        ORDER_DATE: escapeHtml(data.orderDate),
        DOC_DATE_LABEL: escapeHtml(data.docDateLabel),
        DOC_DATE: escapeHtml(data.docDate),
        ORDER_TIME: escapeHtml(data.orderTime),
        CUSTOMER_NAME: escapeHtml(data.customerName),
        OUTSTANDING_DATE: escapeHtml(data.outstandingDate),
        CLIENT_NAME: escapeHtml(data.clientName),
        CLIENT_ADDRESS: escapeMultiline(data.clientAddress),
        CLIENT_GST: escapeHtml(data.clientGst),
        CLIENT_PHONE: escapeHtml(data.clientPhone),
        CLIENT_EMAIL: escapeHtml(data.clientEmail),
        SHIP_NAME: escapeHtml(data.shipName),
        SHIP_ADDRESS: escapeMultiline(data.shipAddress),
        SHIP_PHONE: escapeHtml(data.shipPhone),
        LINE_ITEM_COUNT: escapeHtml(data.lineItemCount),
        TOTAL_QUANTITY: escapeHtml(data.totalQuantity),
        TOTAL_NET: escapeHtml(data.totalNet),
        GROSS_TOTAL: escapeHtml(data.grossTotal),
        BASE_DISCOUNT_PCT: escapeHtml(data.baseDiscountPct),
        BASE_DISCOUNT: escapeHtml(data.baseDiscount),
        SLAB_DISCOUNT_PCT: escapeHtml(data.slabDiscountPct),
        SLAB_DISCOUNT: escapeHtml(data.slabDiscount),
        CUSTOM_DISCOUNT_PCT: escapeHtml(data.customDiscountPct),
        CUSTOM_DISCOUNT: escapeHtml(data.customDiscount),
        REDEEM_REWARDS: escapeHtml(data.redeemRewards),
        TOTAL_DISCOUNT: escapeHtml(data.totalDiscount),
        NET_AMOUNT: escapeHtml(data.netAmount),
        AMOUNT_IN_WORDS: escapeMultiline(data.amountInWords),
        PAYMENT_TERMS: escapeMultiline(data.paymentTerms),
        REMARKS: escapeMultiline(data.remarks),
    });

    // Page numbers come last, once the sheet count is known.
    const pageCount = (html.match(/\{\{PAGE_NO\}\}/g) ?? []).length;
    let pageNo = 0;
    return html
        .replace(/\{\{PAGE_NO\}\}/g, () => String(++pageNo))
        .replace(/\{\{PAGE_COUNT\}\}/g, String(pageCount));
}
