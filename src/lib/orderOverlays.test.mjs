import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function loadOverlayModule() {
  const filePath = path.resolve("src/lib/orderOverlays.ts");
  const source = await fs.readFile(filePath, "utf8");
  const mongoStubUrl = `data:text/javascript;base64,${Buffer.from('export async function getDb(){ throw new Error("not used"); }').toString("base64")}`;
  const amountStubUrl = `data:text/javascript;base64,${Buffer.from('export function resolveOrderAmounts(order){ const gross = Number(order?.grossAmount ?? order?.order_amount ?? order?.total ?? 0) || 0; const discount = Number(order?.discountAmount ?? order?.order_discount_amount ?? 0) || 0; const net = Number(order?.netPayableAmount ?? order?.order_net_amount ?? (gross - discount)) || 0; return { gross, discountAmount: discount || Math.max(0, gross - net), netPayable: net || Math.max(0, gross - discount) }; }').toString("base64")}`;
  const rewrittenSource = source
    .replace(/from\s+["']@\/lib\/mongodb["']/, `from "${mongoStubUrl}"`)
    .replace(/from\s+["']@\/lib\/orderProductNotes\.mjs["']/, `from "${pathToFileURL(path.resolve("src/lib/orderProductNotes.mjs")).href}"`)
    .replace(/from\s+["']@\/lib\/orderAmounts["']/, `from "${amountStubUrl}"`);
  const transpiled = ts.transpileModule(rewrittenSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;

  return import(`data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`);
}

const overlays = await loadOverlayModule();

test("PHP overlay normalization keeps duplicate catalogue lines distinct by occurrence", () => {
  const normalized = overlays.normalizeOrderItems({
    data: {
      items: Array.from({ length: 10 }, (_, index) => ({ productId: "DUP", productName: `Line ${index + 1}` })),
    },
  }, "7001");

  assert.equal(normalized.items.length, 10);
  assert.equal(new Set(normalized.items.map((item) => item.orderdata_id)).size, 10);
  assert.equal(normalized.items[0].orderdata_id, "php:7001:dup:1");
  assert.equal(normalized.items[9].orderdata_id, "php:7001:dup:10");
});

const baseOrder = {
  order_id: "5001",
  order_dealer: "D-1",
  Dealer_Name: "Dealer One",
  accept_order: "0",
  del_status: "0",
  order_amount: "1000",
  order_discount_amount: "100",
  order_net_amount: "900",
};

const baseItems = [
  {
    orderdata_id: "L-1",
    orderdata_orderid: "5001",
    orderdata_cat_no: "ABC-100",
    product_name: "Volumetric Flask",
    orderdata_item_quantity: "10",
    orderdata_price: "50",
    packSize: "1",
    readyquantity: "0",
    orderdata_status: "0",
  },
  {
    orderdata_id: "L-2",
    orderdata_orderid: "5001",
    orderdata_cat_no: "TT-20",
    product_name: "Test Tube",
    orderdata_item_quantity: "20",
    orderdata_price: "25",
    packSize: "1",
    readyquantity: "0",
    orderdata_status: "0",
  },
];

test("pending unaccepted order is eligible for Dealer cancellation and editing", () => {
  const eligibility = overlays.resolveOrderOverlayEligibility({
    order: baseOrder,
    items: baseItems,
  });

  assert.equal(eligibility.canDealerChange, true);
  assert.equal(eligibility.reason, "eligible");
});

test("accepted order is the discovered edit cutoff", () => {
  const eligibility = overlays.resolveOrderOverlayEligibility({
    order: { ...baseOrder, accept_order: "1" },
    items: baseItems,
  });

  assert.equal(eligibility.canDealerChange, false);
  assert.equal(eligibility.reason, "order_already_accepted");
});

test("legacy or MongoDB dispatch blocks Dealer changes", () => {
  assert.equal(overlays.resolveOrderOverlayEligibility({
    order: baseOrder,
    items: [{ ...baseItems[0], readyquantity: "1" }],
  }).reason, "dispatch_already_started");

  assert.equal(overlays.resolveOrderOverlayEligibility({
    order: baseOrder,
    items: baseItems,
    dispatchRecords: [{ dispatchedQuantity: 1, updates: [] }],
  }).reason, "dispatch_already_started");
});

test("cancelled overlay marks effective order cancelled without mutating original items", () => {
  const effective = overlays.resolveEffectiveOrder({
    orderId: "5001",
    originalOrder: baseOrder,
    originalItems: baseItems,
    overlay: {
      orderId: "5001",
      dealerId: "D-1",
      status: "cancelled",
      cancellation: {
        status: "cancelled",
        reason: "Ordered by mistake",
        cancelledBy: { id: "D-1", role: "dealer" },
        cancelledAt: "2026-07-20T00:00:00.000Z",
      },
      edits: [],
      latestRevision: 0,
      source: overlays.ORDER_OVERLAY_VERSION,
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    },
  });

  assert.equal(effective.isCancelled, true);
  assert.equal(effective.cancellation.reason, "Ordered by mistake");
  assert.deepEqual(effective.effectiveItems, baseItems);
});

test("edit revision records removal, replacement, and quantity changes", () => {
  const revision = overlays.buildOrderEditRevision({
    orderId: "5001",
    baseOrder,
    originalItems: baseItems,
    requestedItems: [
      {
        originalLineId: "L-1",
        orderdata_id: "L-1",
        orderdata_cat_no: "XYZ-200",
        product_name: "Conical Flask",
        orderdata_item_quantity: "10",
        orderdata_price: "60",
      },
      {
        originalLineId: "L-2",
        orderdata_id: "L-2",
        orderdata_cat_no: "TT-20",
        product_name: "Test Tube",
        orderdata_item_quantity: "30",
        orderdata_price: "25",
      },
    ],
    expectedRevision: 0,
    idempotencyKey: "edit-1",
    actor: { role: "dealer", actorId: "D-1" },
  });

  assert.equal(revision.revision, 1);
  assert.deepEqual(revision.changes.map((change) => change.type), ["replaced", "quantity_changed"]);
  assert.match(revision.changes[0].summary, /Replaced/);
  assert.match(revision.changes[1].summary, /from 20 to 30/);
});

test("edit revision rejects empty edited orders", () => {
  assert.throws(() => overlays.buildOrderEditRevision({
    orderId: "5001",
    baseOrder,
    originalItems: baseItems,
    requestedItems: [],
    expectedRevision: 0,
    actor: { role: "dealer", actorId: "D-1" },
  }), /must keep at least one item/);
});

test("latest edit revision supplies effective items and change history", () => {
  const revision = overlays.buildOrderEditRevision({
    orderId: "5001",
    baseOrder,
    originalItems: baseItems,
    requestedItems: [
      { ...baseItems[0], originalLineId: "L-1" },
      { ...baseItems[1], originalLineId: "L-2", orderdata_item_quantity: "25" },
    ],
    expectedRevision: 0,
    idempotencyKey: "edit-2",
    actor: { role: "dealer", actorId: "D-1" },
  });

  const effective = overlays.resolveEffectiveOrder({
    orderId: "5001",
    originalOrder: baseOrder,
    originalItems: baseItems,
    overlay: {
      orderId: "5001",
      dealerId: "D-1",
      status: "active",
      edits: [revision],
      latestRevision: 1,
      source: overlays.ORDER_OVERLAY_VERSION,
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    },
  });

  assert.equal(effective.isEdited, true);
  assert.equal(effective.latestRevision, 1);
  assert.equal(effective.effectiveItems[1].orderdata_item_quantity, "25");
  assert.equal(effective.changeHistory[0].type, "quantity_changed");
});

test("PostgreSQL edit normalization preserves packs, pack size, and total pieces", () => {
  const normalized = overlays.normalizeOrderItems({
    data: {
      items: [
        {
          orderdata_id: "PG-1",
          orderdata_cat_no: "A-12",
          product_name: "Product A",
          quantityPacks: 4,
          packSize: 12,
          totalPieces: 48,
          orderdata_price: "10",
        },
        {
          orderdata_id: "PG-2",
          orderdata_cat_no: "B-5",
          product_name: "Product B",
          quantityPacks: 7,
          packSize: 5,
          totalPieces: 35,
          orderdata_price: "20",
        },
      ],
    },
  }, "9001");

  assert.equal(normalized.items[0].orderdata_item_quantity, "4");
  assert.equal(normalized.items[0].quantityPacks, 4);
  assert.equal(normalized.items[0].packSize, 12);
  assert.equal(normalized.items[0].totalPieces, 48);
  assert.equal(normalized.items[1].orderdata_item_quantity, "7");
  assert.equal(normalized.items[1].quantityPacks, 7);
  assert.equal(normalized.items[1].packSize, 5);
  assert.equal(normalized.items[1].totalPieces, 35);

  const revision = overlays.buildOrderEditRevision({
    orderId: "9001",
    baseOrder: { order_amount: "830", order_discount_amount: "0", order_net_amount: "830" },
    originalItems: normalized.items,
    requestedItems: [
      { ...normalized.items[0], originalLineId: "PG-1", orderdata_item_quantity: "6", quantityPacks: 6 },
      { ...normalized.items[1], originalLineId: "PG-2" },
    ],
    expectedRevision: 0,
    idempotencyKey: "edit-packs-1",
    actor: { role: "dealer", actorId: "D-1" },
  });

  assert.equal(revision.effectiveItems[0].orderdata_item_quantity, "6");
  assert.equal(revision.effectiveItems[0].quantityPacks, 6);
  assert.equal(revision.effectiveItems[0].packSize, 12);
  assert.equal(revision.effectiveItems[0].totalPieces, 72);
});

test("dealer quantity edit wins over the stale pack-count aliases carried by the loaded row", () => {
  const originalItems = overlays.normalizeOrderItems({
    data: [{
      orderdata_id: "9001",
      orderdata_cat_no: "CAT-1",
      product_name: "Widget",
      orderdata_item_quantity: "4",
      quantityPacks: 4,
      quantity_packs: 4,
      packs: 4,
      packSize: 10,
      totalPieces: 40,
      producQuanity: 40,
    }],
  }, "700").items;

  // The edit dialog only rewrites orderdata_item_quantity; every other alias is echoed back stale.
  const requestedItems = originalItems.map((item) => ({ ...item, originalLineId: item.orderdata_id, orderdata_item_quantity: "7" }));

  const revision = overlays.buildOrderEditRevision({
    orderId: "700",
    originalItems,
    requestedItems,
    expectedRevision: 0,
    actor: { actorId: "1", role: "dealer" },
  });

  assert.equal(revision.changes.length, 1);
  assert.equal(revision.changes[0].type, "quantity_changed");
  assert.equal(revision.changes[0].fromQuantity, 4);
  assert.equal(revision.changes[0].toQuantity, 7);
  assert.equal(revision.effectiveItems[0].orderdata_item_quantity, "7");
  assert.equal(revision.effectiveItems[0].quantityPacks, 7);
  assert.equal(revision.effectiveItems[0].totalPieces, 70);
});

test("pack-count aliases still drive the quantity when no explicit quantity field is submitted", () => {
  const originalItems = overlays.normalizeOrderItems({
    data: [{ orderdata_id: "9002", orderdata_cat_no: "CAT-2", orderdata_item_quantity: "2", packSize: 5 }],
  }, "701").items;

  const { orderdata_item_quantity: _omitted, ...withoutQuantityField } = originalItems[0];
  const revision = overlays.buildOrderEditRevision({
    orderId: "701",
    originalItems,
    requestedItems: [{ ...withoutQuantityField, originalLineId: "9002", quantityPacks: 3 }],
    expectedRevision: 0,
    actor: { actorId: "1", role: "dealer" },
  });

  assert.equal(revision.changes[0].toQuantity, 3);
  assert.equal(revision.effectiveItems[0].totalPieces, 15);
});

test("a pack-size only edit recomputes total pieces from the unchanged quantity", () => {
  const originalItems = overlays.normalizeOrderItems({
    data: [{ orderdata_id: "9003", orderdata_cat_no: "CAT-3", orderdata_item_quantity: "2", packSize: 5 }],
  }, "702").items;

  // Pack size alone is not a tracked change, so the edit is still rejected as "no changes".
  assert.throws(
    () => overlays.buildOrderEditRevision({
      orderId: "702",
      originalItems,
      requestedItems: [{ ...originalItems[0], originalLineId: "9003", packSize: 8, pack_size: 8 }],
      expectedRevision: 0,
      actor: { actorId: "1", role: "dealer" },
    }),
    (error) => error.code === "no_changes"
  );
});

test("the saved-edit response exposes effectiveItems/effectiveTotals, not an edits array", () => {
  const originalItems = overlays.normalizeOrderItems({
    data: [{ orderdata_id: "9100", orderdata_cat_no: "CAT-9", orderdata_item_quantity: "4", packSize: 2, orderdata_price: "10" }],
  }, "800").items;

  const revision = overlays.buildOrderEditRevision({
    orderId: "800",
    originalItems,
    requestedItems: [{ ...originalItems[0], originalLineId: "9100", orderdata_item_quantity: "6" }],
    expectedRevision: 0,
    actor: { actorId: "1", role: "dealer" },
  });

  // This mirrors what POST /api/order-overlays/[id] returns as `data` after saving an edit.
  const responseData = overlays.resolveEffectiveOrder({
    orderId: "800",
    originalOrder: {},
    originalItems,
    overlay: { edits: [revision], latestRevision: revision.revision, status: "active" },
  });

  assert.equal(responseData.edits, undefined, "response has no `edits` array for the client to read");
  assert.equal(responseData.isEdited, true);
  assert.equal(responseData.latestRevision, 1);
  assert.equal(responseData.effectiveItems[0].orderdata_item_quantity, "6");
  assert.equal(responseData.effectiveTotals.grossAmount, 120);
  assert.equal(responseData.changeHistory[0].type, "quantity_changed");
});
