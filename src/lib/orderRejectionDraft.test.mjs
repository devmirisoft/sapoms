import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildEditLogEntry,
  buildOrderRejectionSnapshot,
  diffOrderRows,
  orderItemsToDraftRows,
  ORDER_REJECTION_SOURCE,
} from "./orderRejectionDraft.mjs";

const orderItems = [
  { catalogueNumberSnapshot: "CAT-1", productNameSnapshot: "Beaker 100ml", quantityPacks: 2, packSize: 10, unitPricePaise: BigInt(12500), isPriority: false, productNote: "" },
  { catalogueNumberSnapshot: "CAT-2", productNameSnapshot: "Flask 250ml", quantityPacks: 1, packSize: 6, unitPricePaise: BigInt(30000), isPriority: true, productNote: "handle with care" },
];

const declinedOrder = { id: BigInt(41), orderNumber: "OM/25-26/DMS-041", shipTo: "Plant 2", refNo: "PO-9", note: "urgent" };

test("order items become editable draft rows in rupees and packs", () => {
  const rows = orderItemsToDraftRows(orderItems);
  assert.deepEqual(rows[0], {
    key: 1,
    productname: "CAT-1",
    displayName: "Beaker 100ml",
    variantCode: "CAT-1",
    producQuanity: 2,
    price: 125,
    packSize: 10,
    isPriority: false,
    productNote: "",
  });
  assert.equal(rows[1].price, 300);
  assert.equal(rows[1].isPriority, true);
});

test("the rejection snapshot carries the reviewer, role, note, and source order", () => {
  const snapshot = buildOrderRejectionSnapshot({
    order: declinedOrder,
    items: orderItems,
    rejectedBy: { role: "RSM", name: "Priya Nair" },
    note: "Quantity exceeds the approved credit limit.",
    rejectedAt: "2026-08-29T10:00:00.000Z",
  });

  assert.equal(snapshot.source, ORDER_REJECTION_SOURCE);
  assert.equal(snapshot.source_order_id, "41");
  assert.equal(snapshot.source_order_number, "OM/25-26/DMS-041");
  assert.deepEqual(snapshot.rejection_notes, {
    rejected_by: "RSM",
    rejected_by_name: "Priya Nair",
    rejected_at: "2026-08-29T10:00:00.000Z",
    reason: "Quantity exceeds the approved credit limit.",
  });
  assert.match(snapshot.order_note, /ORDER DISAPPROVED BY RSM/);
  assert.match(snapshot.order_note, /credit limit/);
  assert.equal(snapshot.rows.length, 2);
  // The first rejection sets the baseline every later revision is diffed against.
  assert.deepEqual(snapshot.original_rows, snapshot.rows);
  assert.deepEqual(snapshot.edit_log, []);
});

test("a second rejection keeps the first order's rows and the edit history", () => {
  const first = buildOrderRejectionSnapshot({ order: declinedOrder, items: orderItems, rejectedBy: { role: "RSM", name: "Priya" }, note: "no" });
  const withEdits = { ...first, edit_log: [buildEditLogEntry({ orderNumber: "OM/25-26/DMS-042", changes: [], at: "2026-08-29T11:00:00.000Z" })] };
  const second = buildOrderRejectionSnapshot({
    order: { ...declinedOrder, id: BigInt(42), orderNumber: "OM/25-26/DMS-042" },
    items: [orderItems[0]],
    rejectedBy: { role: "STAFF", name: "Arun" },
    note: "still wrong",
    previousSnapshot: withEdits,
  });

  assert.equal(second.rows.length, 1);
  assert.equal(second.original_rows.length, 2, "baseline stays the order the dealer first placed");
  assert.equal(second.edit_log.length, 1);
  assert.equal(second.rejection_notes.rejected_by_name, "Arun");
  assert.equal(second.source_order_number, "OM/25-26/DMS-042");
});

test("a missing note never leaves the dealer without a reason", () => {
  const snapshot = buildOrderRejectionSnapshot({ order: declinedOrder, items: orderItems, rejectedBy: { role: "STAFF", name: "" }, note: "   " });
  assert.equal(snapshot.rejection_notes.reason, "No reason was recorded.");
  assert.equal(snapshot.rejection_notes.rejected_by_name, null);
});

test("the diff names every kind of edit the dealer can make", () => {
  const before = orderItemsToDraftRows(orderItems);
  const after = [
    { ...before[0], producQuanity: 5, price: 130 },
    { key: 3, productname: "CAT-3", displayName: "Pipette", variantCode: "CAT-3", producQuanity: 4, price: 50, packSize: 1, isPriority: false, productNote: "" },
  ];
  const changes = diffOrderRows(before, after);
  const summaries = changes.map((change) => change.summary).join(" | ");

  assert.equal(changes.filter((change) => change.type === "added").length, 1);
  assert.equal(changes.filter((change) => change.type === "removed").length, 1);
  assert.match(summaries, /Added CAT-3/);
  assert.match(summaries, /Removed CAT-2/);
  assert.match(summaries, /CAT-1: quantity 2 → 5/);
  assert.match(summaries, /CAT-1: unit price ₹125 → ₹130/);
});

test("an untouched resubmission reports no changes", () => {
  const rows = orderItemsToDraftRows(orderItems);
  assert.deepEqual(diffOrderRows(rows, rows), []);
  assert.deepEqual(buildEditLogEntry({ orderNumber: "OM/1", changes: [], at: "2026-08-29T12:00:00.000Z" }), {
    at: "2026-08-29T12:00:00.000Z",
    order_number: "OM/1",
    changes: [],
  });
});

test("note and priority edits are logged, and cat no matching ignores case", () => {
  const before = orderItemsToDraftRows(orderItems);
  const after = before.map((row) => ({ ...row, variantCode: row.variantCode.toLowerCase() }));
  after[1] = { ...after[1], productNote: "leave at gate", isPriority: false };
  const changes = diffOrderRows(before, after);

  assert.equal(changes.filter((change) => change.type === "added" || change.type === "removed").length, 0);
  assert.equal(changes.filter((change) => change.type === "note").length, 1);
  assert.equal(changes.filter((change) => change.type === "priority").length, 1);
});

// ── Wiring contract: the flow only works if the server paths call the helpers ──

async function read(file) {
  return fs.readFile(path.resolve(file), "utf8");
}

test("a declined order creates the draft, refunds the debit, and is retired on acceptance", async () => {
  const [status, drafts] = await Promise.all([
    read("src/lib/postgresOrderStatus.ts"),
    read("src/lib/orderRejectionDrafts.ts"),
  ]);

  // Both review stages (RSM and staff) must push the order back to drafts.
  assert.equal((status.match(/createOrderRejectionDraft\(tx, order/g) ?? []).length, 2);
  assert.equal((status.match(/refundDeclinedOrderWallet\(tx, order\)/g) ?? []).length, 2);
  assert.match(status, /orderDraft\.updateMany\(\{ where: \{ orderId: order\.id, dealerId: order\.dealerId, status: "ACTIVE" \}, data: \{ status: "CONVERTED" \} \}\)/);
  assert.match(drafts, /idempotencyKey: `order:\$\{order\.id\.toString\(\)\}:decline-refund`/);
  assert.match(drafts, /WalletTransactionType\.REFUND/);
});

test("a resubmission records the revision and keeps the draft until acceptance", async () => {
  const create = await read("src/lib/dealerOrderCreate.ts");

  assert.match(create, /acceptanceStatus: "DECLINED".*rsmApprovalStatus: "DECLINED"/s);
  assert.match(create, /invalid_resubmission/);
  assert.match(create, /type: "revision"/);
  assert.match(create, /changes: revisionChanges/);
  assert.match(create, /snapshot\.source === ORDER_REJECTION_SOURCE/);
  assert.match(create, /status: "CONVERTED", orderId: order\.id/);
});

test("the dealer form sends the draft and rejected-order links", async () => {
  const form = await read("src/app/dashboard/dealer/AddOrderForm/page.tsx");

  assert.match(form, /fd\.append\("orderDraftId", activeDraftId\)/);
  assert.match(form, /fd\.append\("rejectedFromOrderId", rejectedOrderDraft\.source_order_id\)/);
  assert.match(form, /This resubmitted order is already awaiting approval/);
});

test("drafts keep rejected orders separate from discount disapprovals", async () => {
  const [page, helpers] = await Promise.all([
    read("src/app/drafts/page.tsx"),
    read("src/lib/postgresDiscountDrafts.ts"),
  ]);

  assert.match(page, /rejected_order: \{ label: "Rejected Order"/);
  assert.match(page, /rejected: \{ label: "Rejected Discount"/);
  assert.match(page, /resubmitted: \{ label: "Resubmitted"/);
  // Dealer edits go through draftSnapshot, so it must carry the rejection trail.
  for (const key of ["source_order_id", "source_order_number", "original_rows", "edit_log"]) {
    assert.match(helpers, new RegExp(`${key}:`), key);
  }
});
