export const PRODUCT_NOTE_LIMIT = 500;

const EXPECTED_ORDER_NUMBER_PATTERN = /^OM\/\d{4}\//i;

/**
 * @param {unknown} value
 */
export function normalizeSku(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * @param {unknown} value
 * @param {number} [max]
 */
export function normalizeProductNote(value, max = PRODUCT_NOTE_LIMIT) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * @param {unknown} value
 */
export function isExpectedOrderNumber(value) {
  return EXPECTED_ORDER_NUMBER_PATTERN.test(String(value ?? "").trim());
}

/**
 * @param {string} priorityRemarks
 * @param {string} orderNote
 */
export function buildOrderRemarks(priorityRemarks, orderNote) {
  const generalNote = String(orderNote ?? "").trim();

  return [
    String(priorityRemarks ?? "").trim(),
    generalNote ? `Order note: ${generalNote}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

/**
 * @param {unknown} row
 */
export function getCombinedRemarkText(row) {
  if (!row || typeof row !== "object") return "";

  return [row.remark, row.remarks]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" | ");
}

/**
 * @param {unknown} remarks
 * @param {unknown} note
 */
export function remarksContainProductNote(remarks, note) {
  const normalizedRemarks = String(remarks ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  const normalizedNote = normalizeProductNote(note)
    .replace(/\s+/g, " ")
    .toLowerCase();

  return normalizedNote ? normalizedRemarks.includes(normalizedNote) : false;
}

/**
 * @param {unknown} row
 */
export function resolveNormalizedSku(row) {
  if (!row || typeof row !== "object") return "";

  const candidates = [
    row.normalizedSku,
    row.orderdata_cat_no,
    row.product_cat,
    row.variantCode,
    row.catalogueVariantSku,
    row.catalogueProductSku,
    row.sku,
    row.productname,
    row.productId,
    row.catNo,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeSku(candidate);
    if (normalized) return normalized;
  }

  return "";
}

/**
 * @param {unknown} value
 */
export function normalizeOrderItemId(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

/**
 * @param {unknown} row
 */
export function resolveOrderId(row) {
  if (!row || typeof row !== "object") return "";

  const candidates = [
    row.orderId,
    row.order_id,
    row.orderdata_orderid,
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized) return normalized;
  }

  return "";
}

/**
 * @param {unknown[]} rows
 */
export function matchSubmittedRowsToPhpRows(rows) {
  /** @type {Map<string, Array<{ row: any, index: number }>>} */
  const submittedGroups = new Map();
  /** @type {Map<string, Array<{ row: any, index: number }>>} */
  const phpGroups = new Map();

  rows.forEach((entry, index) => {
    const normalizedSku = resolveNormalizedSku(entry?.submittedRow);
    if (!normalizedSku) return;
    const bucket = submittedGroups.get(normalizedSku) ?? [];
    bucket.push({ row: entry.submittedRow, index });
    submittedGroups.set(normalizedSku, bucket);
  });

  rows.forEach((entry, index) => {
    const normalizedSku = resolveNormalizedSku(entry?.phpRow);
    if (!normalizedSku) return;
    const bucket = phpGroups.get(normalizedSku) ?? [];
    bucket.push({ row: entry.phpRow, index });
    phpGroups.set(normalizedSku, bucket);
  });

  return rows.map((entry) => {
    const normalizedSku = resolveNormalizedSku(entry?.submittedRow);
    if (!normalizedSku) {
      return { ...entry, normalizedSku: "", occurrence: 1, matchedPhpRow: entry?.phpRow ?? null };
    }

    const submittedGroup = submittedGroups.get(normalizedSku) ?? [];
    const occurrence = submittedGroup.findIndex((candidate) => candidate.row === entry.submittedRow) + 1;
    const phpGroup = phpGroups.get(normalizedSku) ?? [];
    const matchedPhpRow = phpGroup[occurrence - 1]?.row ?? null;

    return { ...entry, normalizedSku, occurrence, matchedPhpRow };
  });
}

/**
 * @param {unknown[]} submittedRows
 * @param {unknown[]} phpRows
 */
export function buildMatchedOrderRows(submittedRows, phpRows) {
  /** @type {Map<string, Array<Record<string, any>>>} */
  const phpGroups = new Map();

  for (const phpRow of phpRows ?? []) {
    const normalizedSku = resolveNormalizedSku(phpRow);
    if (!normalizedSku) continue;
    const bucket = phpGroups.get(normalizedSku) ?? [];
    bucket.push(phpRow);
    phpGroups.set(normalizedSku, bucket);
  }

  /** @type {Map<string, number>} */
  const occurrenceCounts = new Map();

  return (submittedRows ?? []).map((submittedRow) => {
    const normalizedSku = resolveNormalizedSku(submittedRow);
    const occurrence = normalizedSku
      ? (occurrenceCounts.get(normalizedSku) ?? 0) + 1
      : 1;

    if (normalizedSku) occurrenceCounts.set(normalizedSku, occurrence);

    return {
      submittedRow,
      phpRow: (phpGroups.get(normalizedSku) ?? [])[occurrence - 1] ?? null,
      normalizedSku,
      occurrence,
    };
  });
}

/**
 * @param {unknown} payload
 * @param {string} fallbackOrderId
 */
export function normalizePhpOrderItems(payload, fallbackOrderId = "") {
  const raw = payload && typeof payload === "object" ? payload.data : [];
  const items = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray(raw.items)
      ? raw.items
      : [];

  return items.map((item, index) => ({
    ...item,
    orderdata_id: String(item?.orderdata_id ?? item?.productId ?? item?.id ?? `item-${index}`),
    orderdata_orderid: String(item?.orderdata_orderid ?? item?.orderId ?? fallbackOrderId),
    orderdata_cat_no: String(item?.orderdata_cat_no ?? item?.product_cat ?? item?.variantCode ?? item?.productId ?? ""),
    remark: item?.remark ?? item?.remarks ?? "",
    remarks: item?.remarks ?? item?.remark ?? "",
  }));
}

/**
 * @param {unknown} value
 */
export function buildOccurrenceKey(value) {
  return String(value ?? "").trim();
}

/**
 * @param {string} orderId
 * @param {string} normalizedSku
 * @param {number} occurrence
 */
export function buildFallbackLookupKey(orderId, normalizedSku, occurrence) {
  return [String(orderId ?? "").trim(), normalizedSku, String(occurrence)].join("::");
}

/**
 * @param {unknown} value
 */
export function extractLegacyProductNote(value) {
  if (typeof value !== "string") return "";

  const match = value.match(/(?:^|\|)\s*Product note:\s*([^|]+)/i);
  return match?.[1]?.trim() || "";
}

/**
 * @param {string} productName
 * @param {string} productNote
 */
export function buildInvoiceProductName(productName, productNote) {
  const normalizedName = String(productName ?? "").trim();
  const normalizedNote = normalizeProductNote(productNote);

  return normalizedName && normalizedNote
    ? `${normalizedName}\n(${normalizedNote})`
    : normalizedName;
}

/**
 * Invoice description cell: "<Cat. No> - <Product name>" plus the product note
 * on its own line (rendered bold + italic by the PDF generator).
 *
 * @param {{ productName?: unknown, catalogueNumber?: unknown, productNote?: unknown, isPriority?: boolean }} input
 * @returns {{ mainText: string, noteText: string }}
 */
export function buildInvoiceDescriptionMeta(input) {
  const productName = String(input?.productName ?? "").trim();
  const catNumber = String(input?.catalogueNumber ?? "").trim();
  const baseName = productName || catNumber || "-";

  const mainLines = [
    catNumber && productName ? catNumber + " - " + productName : baseName,
    input?.isPriority ? "[PRIORITY DELIVERY]" : "",
  ].filter(Boolean);

  return {
    mainText: mainLines.join(String.fromCharCode(10)),
    noteText: normalizeProductNote(input?.productNote),
  };
}

/**
 * @param {Array<Record<string, any>>} items
 * @param {Array<Record<string, any>>} fallbackNotes
 */
export function mergeFallbackProductNotes(items, fallbackNotes) {
  const byOrderItemId = new Map();
  const bySkuOccurrence = new Map();

  for (const note of fallbackNotes ?? []) {
    const noteText = normalizeProductNote(note?.note);
    if (!noteText) continue;

    const orderItemId = normalizeOrderItemId(note?.orderItemId);
    if (orderItemId) byOrderItemId.set(orderItemId, noteText);

    const normalizedSku = normalizeSku(note?.normalizedSku ?? note?.sku);
    const orderId = String(note?.orderId ?? "").trim();
    const occurrence = Number(note?.occurrence) || 1;
    if (orderId && normalizedSku) {
      bySkuOccurrence.set(buildFallbackLookupKey(orderId, normalizedSku, occurrence), noteText);
    }
  }

  /** @type {Map<string, number>} */
  const occurrenceCounts = new Map();

  return (items ?? []).map((item) => {
    const normalizedSku = resolveNormalizedSku(item);
    const currentOccurrence = normalizedSku
      ? (occurrenceCounts.get(normalizedSku) ?? 0) + 1
      : 1;

    if (normalizedSku) occurrenceCounts.set(normalizedSku, currentOccurrence);

    const orderId = resolveOrderId(item);
    const orderItemId = normalizeOrderItemId(item?.orderdata_id ?? item?.orderItemId ?? item?.id);
    const fallbackNote = orderItemId && byOrderItemId.has(orderItemId)
      ? byOrderItemId.get(orderItemId)
      : bySkuOccurrence.get(buildFallbackLookupKey(orderId, normalizedSku, currentOccurrence)) ?? "";

    return {
      ...item,
      fallbackProductNote: fallbackNote,
      displayRemark: resolveDisplayRemark({
        remark: item?.remark,
        remarks: item?.remarks,
        fallbackNote,
      }),
    };
  });
}

/**
 * @param {Array<Record<string, any>>} items
 * @param {Array<Record<string, any>>} fallbackNotes
 */
export function mergeProductNotesIntoInvoiceItems(items, fallbackNotes) {
  const byOrderItemId = new Map();
  const bySkuOccurrence = new Map();

  for (const note of fallbackNotes ?? []) {
    const noteText = normalizeProductNote(note?.note);
    if (!noteText) continue;

    const orderItemId = normalizeOrderItemId(note?.orderItemId);
    if (orderItemId) byOrderItemId.set(orderItemId, noteText);

    const orderId = String(note?.orderId ?? "").trim();
    const normalizedSku = normalizeSku(note?.normalizedSku ?? note?.sku);
    const occurrence = Number(note?.occurrence) || 1;
    if (orderId && normalizedSku) {
      bySkuOccurrence.set(buildFallbackLookupKey(orderId, normalizedSku, occurrence), noteText);
    }
  }

  /** @type {Map<string, number>} */
  const occurrenceCounts = new Map();

  return (items ?? []).map((item) => {
    const normalizedSku = resolveNormalizedSku(item);
    const occurrence = normalizedSku
      ? (occurrenceCounts.get(normalizedSku) ?? 0) + 1
      : 1;

    if (normalizedSku) occurrenceCounts.set(normalizedSku, occurrence);

    const orderId = resolveOrderId(item);
    const orderItemId = normalizeOrderItemId(item?.orderdata_id ?? item?.orderItemId ?? item?.id);
    const mongoNote = orderItemId && byOrderItemId.has(orderItemId)
      ? byOrderItemId.get(orderItemId)
      : bySkuOccurrence.get(buildFallbackLookupKey(orderId, normalizedSku, occurrence)) ?? "";
    const legacyNote = extractLegacyProductNote(getCombinedRemarkText(item));
    const productNote = mongoNote || legacyNote;

    return {
      ...item,
      productNote,
    };
  });
}

/**
 * @param {{ remark?: unknown, remarks?: unknown, fallbackNote?: unknown }} input
 */
export function resolveDisplayRemark(input) {
  const phpRemark = getCombinedRemarkText(input);
  const fallbackNote = normalizeProductNote(input?.fallbackNote);

  if (!fallbackNote) return phpRemark;
  if (remarksContainProductNote(phpRemark, fallbackNote)) return phpRemark;

  const fallbackRemark = `Product note: ${fallbackNote}`;
  return phpRemark ? `${phpRemark} | ${fallbackRemark}` : fallbackRemark;
}

/**
 * @param {number} attempt
 */
function delayForAttempt(attempt) {
  return 250 * attempt;
}

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {{
 *   fetchImpl: typeof fetch,
 *   backendUrl: string,
 *   actualOrderId: string,
 *   dealerId: string,
 *   submittedRows: Array<Record<string, any>>,
 *   fallbackApiPath?: string,
 *   maxAttempts?: number,
 * }} input
 */
export async function verifyOrderProductNotesPersistence(input) {
  const {
    fetchImpl,
    actualOrderId,
    dealerId,
    submittedRows,
    fallbackApiPath = "/api/order-product-notes",
  } = input;

  const normalizedOrderId = String(actualOrderId ?? "").trim();
  if (!normalizedOrderId || isExpectedOrderNumber(normalizedOrderId)) {
    throw new Error("Actual order ID is required for product note verification");
  }

  const normalizedDealerId = String(dealerId ?? "").trim();
  const rowsWithNotes = (submittedRows ?? [])
    .map((row) => ({ ...row, productNote: normalizeProductNote(row?.productNote) }))
    .filter((row) => row.productNote);

  let savedToFallback = 0;
  let failed = 0;

  for (const row of rowsWithNotes) {
    const fallbackPayload = {
      orderId: normalizedOrderId,
      orderItemId: normalizeOrderItemId(row?.orderdata_id ?? row?.orderItemId ?? row?.id),
      sku: String(row?.variantCode ?? row?.productname ?? row?.orderdata_cat_no ?? "").trim(),
      occurrence: Number(row?.occurrence) || 1,
      dealerId: normalizedDealerId,
      note: row.productNote,
    };

    try {
      const response = await fetchImpl(fallbackApiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fallbackPayload),
      });

      if (!response.ok) {
        failed += 1;
        continue;
      }

      savedToFallback += 1;
    } catch {
      failed += 1;
    }
  }

  return { verifiedInPhp: 0, savedToFallback, failed };
}