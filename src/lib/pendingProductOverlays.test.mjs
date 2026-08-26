import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function transpileTypeScriptModule(filePath, replacements = []) {
  const source = await fs.readFile(filePath, "utf8");
  const rewritten = replacements.reduce((current, [pattern, next]) => current.replace(pattern, next), source);
  const transpiled = ts.transpileModule(rewritten, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`;
}

const orderProductNotesUrl = pathToFileURL(path.resolve("src/lib/orderProductNotes.mjs")).href;
const productSearchUrl = pathToFileURL(path.resolve("src/lib/productSearch.js")).href;

const orderDispatchUrl = await transpileTypeScriptModule(path.resolve("src/lib/orderDispatch.ts"), [
  [/from\s+["']@\/lib\/orderProductNotes\.mjs["']/g, `from "${orderProductNotesUrl}"`],
]);

const pendingProductsUrl = await transpileTypeScriptModule(path.resolve("src/lib/pendingProducts.ts"), [
  [/from\s+["']\.\/orderDispatch["']/g, `from "${orderDispatchUrl}"`],
  [/from\s+["']\.\/productSearch\.js["']/g, `from "${productSearchUrl}"`],
]);

const overlaysUrl = await transpileTypeScriptModule(path.resolve("src/lib/pendingProductOverlays.ts"));

const { alignDispatchRecordsToOverlayItems, overlayItemAlias, resolvePendingOverlayStates } = await import(overlaysUrl);
const { aggregatePendingProducts, buildPendingProductLines } = await import(pendingProductsUrl);

const ORDER_ID = "5001";
const orderKeys = new Map([["9001", ORDER_ID]]);

const order = {
  order_id: ORDER_ID,
  order_date: "2026-02-01T00:00:00.000Z",
  order_dealer: "77",
  Dealer_Name: "Acme Labs",
  accept_order: "1",
  del_status: "0",
  order_status: "ACCEPTED",
  mtstatus: "IN_PROCESS",
};

// The pre-edit truth as it still sits in order_items.
const originalItems = [
  { orderdata_id: "1", orderdata_orderid: ORDER_ID, orderdata_cat_no: "OM285-020", product_name: "PES Syringe Filters", orderdata_item_quantity: 10, readyquantity: 4, packSize: 100, totalPieces: 1000 },
  { orderdata_id: "2", orderdata_orderid: ORDER_ID, orderdata_cat_no: "OM100-010", product_name: "Beaker", orderdata_item_quantity: 6, readyquantity: 0, packSize: 10, totalPieces: 60 },
];

const dispatchRecords = [
  { id: "pg:1", orderId: ORDER_ID, orderItemId: "1", sku: "OM285-020", normalizedSku: "om285020", occurrence: 1, dealerId: "77", assignedStaffId: null, orderedQuantity: 10, dispatchedQuantity: 4, currentStatus: "dispatched", updates: [{ id: "d1", quantity: 4, remark: "", status: "dispatched", actorId: "1", actorRole: "staff", createdAt: "2026-02-03T00:00:00.000Z" }] },
  { id: "pg:2", orderId: ORDER_ID, orderItemId: "2", sku: "OM100-010", normalizedSku: "om100010", occurrence: 1, dealerId: "77", assignedStaffId: null, orderedQuantity: 6, dispatchedQuantity: 0, currentStatus: "pending", updates: [] },
];

// An approved edit: line 1 cut from 10 to 6 packs, line 2 removed, a new line added.
const editRevision = {
  revision: 1,
  effectiveItems: [
    { orderdata_id: "1", orderdata_orderid: ORDER_ID, orderdata_cat_no: "OM285-020", product_name: "PES Syringe Filters", orderdata_item_quantity: "6", quantityPacks: 6, packSize: 100, totalPieces: 600, readyquantity: 0, category: "Filters & Membrane" },
    { orderdata_id: `overlay:${ORDER_ID}:new-1`, orderdata_orderid: ORDER_ID, orderdata_cat_no: "OM900-001", product_name: "Volumetric Flask", orderdata_item_quantity: "3", quantityPacks: 3, packSize: 5, totalPieces: 15, readyquantity: 0, category: "Glassware" },
  ],
};

function pendingByCatalogue(items, records) {
  const lines = buildPendingProductLines({
    orders: [order],
    orderItemsByOrderId: { [ORDER_ID]: items },
    dispatchRecordsByOrderId: { [ORDER_ID]: records },
    catalogueProducts: [],
  });
  return Object.fromEntries(
    aggregatePendingProducts(lines).map((aggregate) => [aggregate.catalogueNumber, aggregate.pendingQuantity])
  );
}

test("without an overlay the raw order items drive the pending totals", () => {
  assert.deepEqual(pendingByCatalogue(originalItems, dispatchRecords), { "OM285-020": 6, "OM100-010": 6 });
});

test("an approved edit replaces the item list: removed lines drop out and added lines appear", () => {
  const states = resolvePendingOverlayStates(
    [{ orderId: 9001n, type: "edit", status: "active", metadata: { revision: editRevision } }],
    orderKeys
  );
  const state = states.get(ORDER_ID);
  assert.equal(state.cancelled, false);
  assert.equal(state.effectiveItems.length, 2);

  const pending = pendingByCatalogue(
    state.effectiveItems,
    alignDispatchRecordsToOverlayItems(dispatchRecords, state.effectiveItems)
  );
  // 6 ordered - 4 already dispatched = 2 pending; the removed beaker is gone; the new flask is pending in full.
  assert.deepEqual(pending, { "OM285-020": 2, "OM900-001": 3 });
});

test("edited quantities win over the pre-edit ordered quantity carried on dispatch records", () => {
  const aligned = alignDispatchRecordsToOverlayItems(dispatchRecords, editRevision.effectiveItems);
  assert.equal(aligned.length, 1);
  assert.equal(aligned[0].orderItemId, "1");
  assert.equal(aligned[0].orderedQuantity, 6);
  assert.equal(aligned[0].dispatchedQuantity, 4);
  // SKU fallback matching is disabled so a new line cannot inherit a removed line's dispatches.
  assert.equal(aligned[0].normalizedSku, "");
});

test("a pending edit_request does not move pending numbers", () => {
  const states = resolvePendingOverlayStates(
    [{ orderId: 9001n, type: "edit_request", status: "pending", metadata: { request: { revision: editRevision } } }],
    orderKeys
  );
  assert.equal(states.get(ORDER_ID).effectiveItems, null);
});

test("a cancel overlay marks the order cancelled so its lines can be skipped", () => {
  const states = resolvePendingOverlayStates(
    [
      { orderId: 9001n, type: "edit", status: "active", metadata: { revision: editRevision } },
      { orderId: 9001n, type: "cancel", status: "cancelled", metadata: {} },
    ],
    orderKeys
  );
  assert.equal(states.get(ORDER_ID).cancelled, true);
});

test("the newest approved edit wins and unrelated overlay rows are ignored", () => {
  const later = { revision: 2, effectiveItems: [{ ...editRevision.effectiveItems[0], orderdata_item_quantity: "9" }] };
  const states = resolvePendingOverlayStates(
    [
      { orderId: 9001n, type: "edit", status: "active", metadata: { revision: editRevision } },
      { orderId: 9999n, type: "edit", status: "active", metadata: { revision: later } },
      { orderId: 9001n, type: "edit", status: "active", metadata: { revision: later } },
    ],
    orderKeys
  );
  assert.equal(states.get(ORDER_ID).effectiveItems.length, 1);
  assert.equal(states.get(ORDER_ID).effectiveItems[0].orderdata_item_quantity, 9);
});

test("malformed overlay payloads leave the raw items in place", () => {
  for (const metadata of [null, {}, { revision: {} }, { revision: { effectiveItems: [] } }, { revision: { effectiveItems: [{}, null] } }]) {
    const states = resolvePendingOverlayStates([{ orderId: 9001n, type: "edit", status: "active", metadata }], orderKeys);
    assert.equal(states.get(ORDER_ID).effectiveItems, null, JSON.stringify(metadata));
  }
});

test("overlay items are normalized into the pending item alias shape", () => {
  const alias = overlayItemAlias({ catNo: "OM1", productName: "Widget", quantityPacks: "4", pack_size: "12" }, ORDER_ID);
  assert.equal(alias.orderdata_cat_no, "OM1");
  assert.equal(alias.product_name, "Widget");
  assert.equal(alias.orderdata_orderid, ORDER_ID);
  assert.equal(alias.orderdata_item_quantity, 4);
  assert.equal(alias.packSize, 12);
  assert.equal(alias.totalPieces, 48);
  assert.equal(alias.readyquantity, 0);
});
