/**
 * Shared, database-free logic for the "rejected order goes back to drafts" flow.
 *
 * A declined order is rebuilt as an editable draft; the dealer edits and
 * resubmits it, and every resubmission carries a diff against the order it
 * replaces so the order detail page can show what changed. Kept in plain JS so
 * the node:test suite exercises the same code the server routes import.
 */

export const ORDER_REJECTION_SOURCE = "order_rejection";

function text(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function num(value) {
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Cat no is the line identity across a revision - product names are display text. */
export function rowKey(row) {
  return text(row?.variantCode || row?.productname, 160).toLowerCase();
}

/**
 * Order items (Prisma rows or the priced items of a submission) as draft rows.
 * @param {Array<Record<string, unknown>>} items
 */
export function orderItemsToDraftRows(items) {
  return (items ?? []).map((item, index) => {
    const catNo = text(item.catalogueNumberSnapshot ?? item.catNo ?? item.skuSnapshot, 160);
    const packSize = Math.max(1, Math.trunc(num(item.packSize)) || 1);
    const unitPaise = num(item.unitPricePaise);
    return {
      key: index + 1,
      productname: catNo,
      displayName: text(item.productNameSnapshot ?? item.productName ?? catNo, 300),
      variantCode: catNo,
      producQuanity: Math.max(1, Math.trunc(num(item.quantityPacks)) || 1),
      price: unitPaise ? Math.round(unitPaise) / 100 : num(item.unitPrice ?? item.price),
      packSize,
      isPriority: item.isPriority === true,
      productNote: text(item.productNote, 500),
    };
  });
}

/**
 * Human-readable change list between two row sets, ordered added → removed → changed.
 * @returns {Array<{ type: string; catNo: string; summary: string }>}
 */
export function diffOrderRows(before, after) {
  const beforeRows = new Map((before ?? []).filter((r) => rowKey(r)).map((r) => [rowKey(r), r]));
  const afterRows = new Map((after ?? []).filter((r) => rowKey(r)).map((r) => [rowKey(r), r]));
  const changes = [];

  for (const [key, row] of afterRows) {
    if (beforeRows.has(key)) continue;
    changes.push({ type: "added", catNo: row.variantCode || row.productname, summary: `Added ${row.variantCode || row.productname} - ${row.producQuanity} pack(s)` });
  }
  for (const [key, row] of beforeRows) {
    if (afterRows.has(key)) continue;
    changes.push({ type: "removed", catNo: row.variantCode || row.productname, summary: `Removed ${row.variantCode || row.productname}` });
  }
  for (const [key, row] of beforeRows) {
    const next = afterRows.get(key);
    if (!next) continue;
    const catNo = next.variantCode || next.productname;
    if (num(row.producQuanity) !== num(next.producQuanity)) {
      changes.push({ type: "quantity", catNo, summary: `${catNo}: quantity ${num(row.producQuanity)} → ${num(next.producQuanity)} pack(s)` });
    }
    if (Math.round(num(row.price) * 100) !== Math.round(num(next.price) * 100)) {
      changes.push({ type: "price", catNo, summary: `${catNo}: unit price ₹${num(row.price)} → ₹${num(next.price)}` });
    }
    if (text(row.productNote, 500) !== text(next.productNote, 500)) {
      changes.push({ type: "note", catNo, summary: `${catNo}: note "${text(row.productNote, 120) || "—"}" → "${text(next.productNote, 120) || "—"}"` });
    }
    if (!!row.isPriority !== !!next.isPriority) {
      changes.push({ type: "priority", catNo, summary: `${catNo}: priority ${row.isPriority ? "on → off" : "off → on"}` });
    }
  }
  return changes;
}

/**
 * Snapshot for the draft a declined order goes back to.
 *
 * `original_rows` and `edit_log` are carried from a previous rejection draft so
 * a second decline still diffs against the order the dealer first placed.
 */
export function buildOrderRejectionSnapshot(input) {
  const previous = input.previousSnapshot && typeof input.previousSnapshot === "object" ? input.previousSnapshot : {};
  const rows = orderItemsToDraftRows(input.items);
  const reason = text(input.note, 1500) || "No reason was recorded.";
  return {
    rows,
    shipto: text(input.order?.shipTo, 1000) || null,
    refno: text(input.order?.refNo, 160) || null,
    order_note: [
      text(input.order?.note, 1500),
      `--- ORDER DISAPPROVED BY ${text(input.rejectedBy?.role, 40) || "REVIEWER"} ---`,
      reason,
      "Edit this order and resubmit it for approval.",
    ].filter(Boolean).join("\n\n"),
    coupon_code: previous.coupon_code ?? null,
    coupon_pct: previous.coupon_pct ?? null,
    source: ORDER_REJECTION_SOURCE,
    source_request_id: null,
    source_order_id: text(input.order?.id, 40),
    source_order_number: text(input.order?.orderNumber, 80),
    rejection_notes: {
      rejected_by: text(input.rejectedBy?.role, 40) || null,
      rejected_by_name: text(input.rejectedBy?.name, 200) || null,
      rejected_at: input.rejectedAt ?? new Date().toISOString(),
      reason,
    },
    // The first rejection fixes the baseline every later revision diffs against.
    original_rows: Array.isArray(previous.original_rows) && previous.original_rows.length ? previous.original_rows : rows,
    edit_log: Array.isArray(previous.edit_log) ? previous.edit_log : [],
  };
}

/** One entry appended to the draft's edit log each time the dealer resubmits. */
export function buildEditLogEntry({ orderNumber, changes, at = new Date().toISOString() }) {
  return {
    at,
    order_number: text(orderNumber, 80),
    changes: (changes ?? []).map((change) => change.summary),
  };
}
