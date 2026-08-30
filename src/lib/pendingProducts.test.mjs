import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function transpileTypeScriptModule(filePath, replacements = []) {
  const source = await fs.readFile(filePath, "utf8");
  const rewrittenSource = replacements.reduce(
    (current, [pattern, nextValue]) => current.replace(pattern, nextValue),
    source
  );

  const transpiled = ts.transpileModule(rewrittenSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;

  return `data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`;
}

async function loadPendingProductsModule() {
  const orderProductNotesUrl = pathToFileURL(path.resolve("src/lib/orderProductNotes.mjs")).href;
  const productSearchUrl = pathToFileURL(path.resolve("src/lib/productSearch.js")).href;

  const orderDispatchPath = path.resolve("src/lib/orderDispatch.ts");
  const orderDispatchUrl = await transpileTypeScriptModule(orderDispatchPath, [
    [/from\s+["']@\/lib\/orderProductNotes\.mjs["']/g, `from "${orderProductNotesUrl}"`],
  ]);

  const pendingProductsPath = path.resolve("src/lib/pendingProducts.ts");
  const pendingProductsUrl = await transpileTypeScriptModule(pendingProductsPath, [
    [/from\s+["']\.\/orderDispatch["']/g, `from "${orderDispatchUrl}"`],
    [/from\s+["']\.\/productSearch\.js["']/g, `from "${productSearchUrl}"`],
  ]);

  return import(pendingProductsUrl);
}

const pendingProducts = await loadPendingProductsModule();

function buildFixtureLines() {
  const orders = [
    {
      order_id: "1001",
      order_date: "2026-08-01T00:00:00.000Z",
      order_dealer: "D-1",
      Dealer_Name: "Dealer A",
      accept_order: "1",
      del_status: "0",
      assignedstaff: "77",
      staffname: "Alice",
    },
    {
      order_id: "1002",
      order_date: "2026-08-04T00:00:00.000Z",
      order_dealer: "D-2",
      Dealer_Name: "Dealer B",
      accept_order: "1",
      del_status: "0",
      assignedstaff: "88",
      staffname: "Bob",
    },
    {
      order_id: "1003",
      order_date: "2026-08-02T00:00:00.000Z",
      order_dealer: "D-1",
      Dealer_Name: "Dealer A",
      accept_order: "1",
      del_status: "0",
      assignedstaff: "77",
      staffname: "Alice",
    },
    {
      order_id: "1004",
      order_date: "2026-08-03T00:00:00.000Z",
      order_dealer: "D-3",
      Dealer_Name: "Dealer C",
      accept_order: "0",
      del_status: "0",
      assignedstaff: "99",
      staffname: "Chris",
    },
    {
      order_id: "1005",
      order_date: "2026-08-05T00:00:00.000Z",
      order_dealer: "D-4",
      Dealer_Name: "Dealer D",
      accept_order: "1",
      del_status: "1",
      assignedstaff: "55",
      staffname: "Dana",
    },
    {
      order_id: "1006",
      order_date: "2026-08-06T00:00:00.000Z",
      order_dealer: "D-1",
      Dealer_Name: "Dealer A",
      accept_order: "1",
      del_status: "0",
      assignedstaff: "77",
      staffname: "Alice",
    },
  ];

  const orderItemsByOrderId = {
    "1001": [
      {
        orderdata_id: "501",
        orderdata_orderid: "1001",
        orderdata_cat_no: "50/8",
        product_name: "Volumetric Flask",
        product_discription: "100 ml",
        orderdata_item_quantity: "10",
        readyquantity: "0",
        packSize: "12",
      },
      {
        orderdata_id: "502",
        orderdata_orderid: "1001",
        orderdata_cat_no: "50/8",
        product_name: "Volumetric Flask",
        product_discription: "100 ml",
        orderdata_item_quantity: "5",
        readyquantity: "4",
        packSize: "12",
      },
    ],
    "1002": [
      {
        orderdata_id: "601",
        orderdata_orderid: "1002",
        orderdata_cat_no: "50/8",
        product_name: "Volumetric Flask",
        product_discription: "100 ml",
        orderdata_item_quantity: "8",
        readyquantity: "0",
        packSize: "12",
      },
    ],
    "1003": [
      {
        orderdata_id: "701",
        orderdata_orderid: "1003",
        orderdata_cat_no: "50/9",
        product_name: "Volumetric Flask",
        product_discription: "250 ml",
        orderdata_item_quantity: "6",
        readyquantity: "0",
        packSize: "6",
      },
    ],
    "1004": [
      {
        orderdata_id: "801",
        orderdata_orderid: "1004",
        orderdata_cat_no: "50/8",
        product_name: "Volumetric Flask",
        product_discription: "100 ml",
        orderdata_item_quantity: "20",
        readyquantity: "0",
      },
    ],
    "1005": [
      {
        orderdata_id: "901",
        orderdata_orderid: "1005",
        orderdata_cat_no: "50/8",
        product_name: "Volumetric Flask",
        product_discription: "100 ml",
        orderdata_item_quantity: "10",
        readyquantity: "0",
      },
    ],
    "1006": [
      {
        orderdata_id: "902",
        orderdata_orderid: "1006",
        orderdata_cat_no: "50/8",
        product_name: "Volumetric Flask",
        product_discription: "100 ml",
        orderdata_item_quantity: "3",
        readyquantity: "9",
      },
    ],
  };

  const dispatchRecordsByOrderId = {
    "1001": [
      {
        orderId: "1001",
        orderItemId: "501",
        sku: "50/8",
        normalizedSku: "50/8",
        occurrence: 1,
        orderedQuantity: 10,
        dispatchedQuantity: 4,
        currentStatus: "packing",
        updates: [{ id: "u1", quantity: 4, remark: "Packed", status: "packing", actorId: "77", actorRole: "staff", createdAt: "2026-08-02T12:00:00.000Z" }],
      },
      {
        orderId: "1001",
        orderItemId: "502",
        sku: "50/8",
        normalizedSku: "50/8",
        occurrence: 2,
        orderedQuantity: 5,
        dispatchedQuantity: 2,
        currentStatus: "dispatched",
        updates: [{ id: "u2", quantity: 2, remark: "Loaded", status: "dispatched", actorId: "1", actorRole: "admin", createdAt: "2026-08-03T12:00:00.000Z" }],
      },
    ],
  };

  const dealerDirectoryById = {
    "D-1": { Dealer_Id: "D-1", Dealer_Name: "Dealer A", assignedstaff: "77", staffname: "Alice" },
    "D-2": { Dealer_Id: "D-2", Dealer_Name: "Dealer B", assignedstaff: "88", staffname: "Bob" },
  };

  const catalogueProducts = [
    {
      sku: "flask",
      productName: "Volumetric Flask",
      category: "Glassware",
      variants: [
        { sku: "50/8", name: "Volumetric Flask 100 ml", specification: "100 ml", image: "flask-100.png" },
        { sku: "50/9", name: "Volumetric Flask 250 ml", specification: "250 ml", image: "flask-250.png" },
      ],
    },
  ];

  return pendingProducts.buildPendingProductLines({
    orders,
    orderItemsByOrderId,
    dispatchRecordsByOrderId,
    dealerDirectoryById,
    catalogueProducts,
  });
}

test("accepted non-deleted orders build pending product lines", () => {
  const lines = buildFixtureLines();
  assert.equal(lines.length, 4);
  assert.deepEqual(
    Array.from(new Set(lines.map((line) => line.orderId))).sort(),
    ["1001", "1002", "1003"]
  );
});

test("pending aggregation combines the exact same SKU across orders without double-counting Mongo and legacy dispatch", () => {
  const aggregates = pendingProducts.aggregatePendingProducts(buildFixtureLines());
  const flask100 = aggregates.find((entry) => entry.catalogueNumber === "50/8");

  assert.ok(flask100);
  assert.equal(flask100.orderedQuantity, 23);
  assert.equal(flask100.dispatchedQuantity, 6);
  assert.equal(flask100.pendingQuantity, 17);
  assert.equal(flask100.pendingOrders, 2);
  assert.equal(flask100.dealersAffected, 2);
});

test("different catalogue variants remain separate product groups", () => {
  const aggregates = pendingProducts.aggregatePendingProducts(buildFixtureLines());
  assert.equal(aggregates.length, 2);

  const catalogueNumbers = aggregates.map((entry) => entry.catalogueNumber).sort();
  assert.deepEqual(catalogueNumbers, ["50/8", "50/9"]);
});

test("ordered quantity uses the same dispatch unit as orderdata_item_quantity rather than pieces", () => {
  const aggregates = pendingProducts.aggregatePendingProducts(buildFixtureLines());
  const flask100 = aggregates.find((entry) => entry.catalogueNumber === "50/8");

  assert.ok(flask100);
  assert.equal(flask100.orderedQuantity, 23);
  assert.notEqual(flask100.orderedQuantity, 23 * 12);
});

test("fully dispatched or over-dispatched lines are clamped out of the pending view", () => {
  const lines = buildFixtureLines();
  assert.equal(lines.some((line) => line.orderId === "1006"), false);
});

test("staff and dealer scope filters only keep permitted line contributions", () => {
  const lines = buildFixtureLines();
  const staffLines = pendingProducts.filterPendingProductLines(lines, { assignedStaffId: "77" });
  const dealerLines = pendingProducts.filterPendingProductLines(lines, { dealerId: "D-2" });

  assert.deepEqual(
    Array.from(new Set(staffLines.map((line) => line.orderId))).sort(),
    ["1001", "1003"]
  );
  assert.deepEqual(
    Array.from(new Set(dealerLines.map((line) => line.orderId))).sort(),
    ["1002"]
  );
});

test("role order scope is applied before pending product aggregation", () => {
  const orders = [
    { order_id: "1001", order_date: "2026-08-01", order_dealer: "D-1", accept_order: "1", del_status: "0" },
    { order_id: "1002", order_date: "2026-08-02", order_dealer: "D-2", accept_order: "1", del_status: "0" },
  ];
  const scopedOrders = pendingProducts.filterPendingOrdersByRoleScope({
    role: "dealer",
    actorId: "D-1",
    orders,
  });

  const lines = pendingProducts.buildPendingProductLines({
    orders: scopedOrders,
    orderItemsByOrderId: {
      "1001": [{ orderdata_id: "501", orderdata_orderid: "1001", orderdata_cat_no: "50/8", product_name: "Flask", orderdata_item_quantity: "10" }],
      "1002": [{ orderdata_id: "601", orderdata_orderid: "1002", orderdata_cat_no: "50/8", product_name: "Flask", orderdata_item_quantity: "900" }],
    },
  });
  const summary = pendingProducts.buildPendingProductsSummaryFromLines(lines);

  assert.deepEqual(scopedOrders.map((order) => order.order_id), ["1001"]);
  assert.equal(summary.totalPendingUnits, 10);
});

test("dealer role scope excludes other dealer names, orders, and quantities from mixed endpoint rows", () => {
  const lines = buildFixtureLines();
  const scopedOrders = pendingProducts.filterPendingOrdersByRoleScope({
    role: "dealer",
    actorId: "D-1",
    orders: [
      { order_id: "1001", order_date: "2026-08-01", order_dealer: "D-1" },
      { order_id: "1002", order_date: "2026-08-02", order_dealer: "D-2" },
      { order_id: "1003", order_date: "2026-08-03", order_dealer: "D-1" },
    ],
  });
  const scopedOrderIds = new Set(scopedOrders.map((order) => order.order_id));
  const dealerLines = lines.filter((line) => scopedOrderIds.has(line.orderId));
  const detail = pendingProducts.buildPendingProductDrilldown(
    dealerLines,
    pendingProducts.aggregatePendingProducts(dealerLines).find((entry) => entry.catalogueNumber === "50/8").productKey
  );

  assert.equal(detail.aggregate.pendingQuantity, 9);
  assert.deepEqual(detail.orders.map((order) => order.orderId), ["1001"]);
  assert.equal(detail.orders.some((order) => order.dealerName === "Dealer B"), false);
});

test("staff role scope requires assigned dealer membership and excludes unassigned dealers", () => {
  const scopedOrders = pendingProducts.filterPendingOrdersByRoleScope({
    role: "staff",
    actorId: "77",
    assignedDealerIds: ["D-1"],
    orders: [
      { order_id: "1001", order_date: "2026-08-01", order_dealer: "D-1" },
      { order_id: "1002", order_date: "2026-08-02", order_dealer: "D-2" },
    ],
  });

  assert.deepEqual(scopedOrders.map((order) => order.order_id), ["1001"]);
});

test("missing staff assignments do not fall back to global admin scope", () => {
  const scopedOrders = pendingProducts.filterPendingOrdersByRoleScope({
    role: "staff",
    actorId: "77",
    orders: [
      { order_id: "1001", order_dealer: "D-1" },
      { order_id: "1002", order_dealer: "D-2" },
    ],
  });

  assert.deepEqual(scopedOrders, []);
});

test("summary metrics are computed from the full role-scoped line set, not a page slice", () => {
  const summary = pendingProducts.buildPendingProductsSummaryFromLines(buildFixtureLines());

  assert.deepEqual(summary, {
    productsPending: 2,
    totalPendingUnits: 23,
    ordersWithPendingItems: 3,
    dealersAffected: 2,
  });
});

test("product drill-down totals match the main aggregate and keep unique orders intact", () => {
  const lines = buildFixtureLines();
  const aggregates = pendingProducts.aggregatePendingProducts(lines);
  const flask100 = aggregates.find((entry) => entry.catalogueNumber === "50/8");

  assert.ok(flask100);

  const detail = pendingProducts.buildPendingProductDrilldown(lines, flask100.productKey);
  assert.ok(detail.aggregate);
  assert.equal(detail.aggregate.pendingQuantity, flask100.pendingQuantity);
  assert.equal(detail.orders.length, 2);

  const order1001 = detail.orders.find((entry) => entry.orderId === "1001");
  assert.ok(order1001);
  assert.equal(order1001.orderedQuantity, 15);
  assert.equal(order1001.dispatchedQuantity, 6);
  assert.equal(order1001.pendingQuantity, 9);
  assert.equal(order1001.lineCount, 2);
});

test("search can match product names and catalogue numbers", () => {
  const aggregates = pendingProducts.aggregatePendingProducts(buildFixtureLines());
  const byName = pendingProducts.filterPendingProducts(aggregates, { search: "flask" });
  const byCatalogue = pendingProducts.filterPendingProducts(aggregates, { search: "50/9" });

  assert.equal(byName.length, 2);
  assert.deepEqual(byCatalogue.map((entry) => entry.catalogueNumber), ["50/9"]);
});

test("default sort places the highest pending quantity first", () => {
  const sorted = pendingProducts.sortPendingProducts(
    pendingProducts.aggregatePendingProducts(buildFixtureLines()),
    "pending_desc"
  );

  assert.deepEqual(sorted.map((entry) => entry.catalogueNumber), ["50/8", "50/9"]);
});

test("staff mixed-date fixture produces exact pending totals after assignment scope is applied", () => {
  const orders = [
    { order_id: "13001", order_date: "2026-07-13", order_dealer: "101", Dealer_Name: "Dealer A", accept_order: "1", del_status: "0" },
    { order_id: "14001", order_date: "2026-07-14", order_dealer: 101, Dealer_Name: "Dealer A", accept_order: "1", del_status: "0" },
    { order_id: "14002", order_date: "2026-07-14", order_dealer: "202", Dealer_Name: "Dealer B", accept_order: "1", del_status: "0" },
    { order_id: "12001", order_date: "2026-07-12 23:59:59", order_dealer: "101", Dealer_Name: "Dealer A", accept_order: "1", del_status: "0" },
  ];
  const scopedOrders = pendingProducts.filterPendingOrdersByRoleScope({
    role: "staff",
    actorId: "29",
    assignedDealerIds: [101],
    orders,
  });
  const lines = pendingProducts.buildPendingProductLines({
    orders: scopedOrders,
    orderItemsByOrderId: {
      "13001": [
        { orderdata_id: "a1", orderdata_orderid: "13001", orderdata_cat_no: "F-1", product_name: "Flask", orderdata_item_quantity: "10" },
        { orderdata_id: "a2", orderdata_orderid: "13001", orderdata_cat_no: "B-1", product_name: "Burette", orderdata_item_quantity: "5" },
      ],
      "14001": [
        { orderdata_id: "b1", orderdata_orderid: "14001", orderdata_cat_no: " f-1 ", product_name: "Flask", orderdata_item_quantity: "8" },
        { orderdata_id: "b2", orderdata_orderid: "14001", orderdata_cat_no: "T-1", product_name: "Test Tube", orderdata_item_quantity: "20" },
      ],
      "14002": [{ orderdata_id: "c1", orderdata_orderid: "14002", orderdata_cat_no: "F-1", product_name: "Flask", orderdata_item_quantity: "100" }],
      "12001": [{ orderdata_id: "d1", orderdata_orderid: "12001", orderdata_cat_no: "F-1", product_name: "Flask", orderdata_item_quantity: "50" }],
    },
    dispatchRecordsByOrderId: {
      "13001": [
        { orderId: "13001", orderItemId: "a1", normalizedSku: "F-1", occurrence: 1, orderedQuantity: 10, dispatchedQuantity: 4, updates: [] },
        { orderId: "13001", orderItemId: "a2", normalizedSku: "B-1", occurrence: 1, orderedQuantity: 5, dispatchedQuantity: 5, updates: [] },
      ],
      "14001": [
        { orderId: "14001", orderItemId: "b1", normalizedSku: "F-1", occurrence: 1, orderedQuantity: 8, dispatchedQuantity: 3, updates: [] },
      ],
    },
  });
  const aggregates = pendingProducts.aggregatePendingProducts(lines);
  const flask = aggregates.find((entry) => entry.catalogueNumber === "F-1");
  const testTube = aggregates.find((entry) => entry.catalogueNumber === "T-1");

  assert.deepEqual(scopedOrders.map((order) => String(order.order_id)), ["13001", "14001", "12001"]);
  assert.ok(flask);
  assert.deepEqual(
    {
      ordered: flask.orderedQuantity,
      dispatched: flask.dispatchedQuantity,
      pending: flask.pendingQuantity,
      orders: flask.pendingOrders,
    },
    { ordered: 68, dispatched: 7, pending: 61, orders: 3 },
  );
  assert.equal(testTube.pendingQuantity, 20);
  assert.equal(aggregates.some((entry) => entry.catalogueNumber === "B-1"), false);
  assert.deepEqual(pendingProducts.buildPendingProductsSummaryFromLines(lines), {
    productsPending: 2,
    totalPendingUnits: 81,
    ordersWithPendingItems: 3,
    dealersAffected: 1,
  });

  const drilldown = pendingProducts.buildPendingProductDrilldown(lines, flask.productKey);
  assert.equal(drilldown.aggregate.pendingQuantity, 61);
  assert.deepEqual(drilldown.orders.map((order) => order.orderId).sort(), ["12001", "13001", "14001"]);
  assert.equal(drilldown.orders.some((order) => order.dealerName === "Dealer B"), false);
});

test("dealer pending-product results and independently cached role views remain isolated", () => {
  const mixedOrders = [
    { order_id: "A-NEW", order_date: "2026-07-15", order_dealer: "101", Dealer_Name: "Dealer A", accept_order: "1", del_status: "0" },
    { order_id: "A-OLD", order_date: "2026-07-12", order_dealer: "101", Dealer_Name: "Dealer A", accept_order: "1", del_status: "0" },
    { order_id: "B-NEW", order_date: "2026-07-15", order_dealer: "202", Dealer_Name: "Dealer B", accept_order: "1", del_status: "0" },
  ];
  const cache = new Map();
  for (const actorId of ["101", "202"]) {
    cache.set(actorId, pendingProducts.filterPendingOrdersByRoleScope({ role: "dealer", actorId, orders: mixedOrders }));
  }

  assert.deepEqual(cache.get("101").map((order) => order.order_id), ["A-NEW", "A-OLD"]);
  assert.deepEqual(cache.get("202").map((order) => order.order_id), ["B-NEW"]);
  assert.equal(cache.get("101").some((order) => order.Dealer_Name === "Dealer B"), false);
  assert.equal(cache.get("202").some((order) => order.Dealer_Name === "Dealer A"), false);
});

test("club view groups the same pending lines by dealer or category without changing the default product view", () => {
  const lines = buildFixtureLines();

  const byProduct = pendingProducts.aggregatePendingProducts(lines);
  assert.deepEqual(byProduct.map((entry) => entry.productKey).sort(), ["sku:508", "sku:509"]);

  const byDealer = pendingProducts.aggregatePendingProducts(lines, "dealer");
  const dealerA = byDealer.find((entry) => entry.productKey === "dealer:D-1");
  assert.equal(byDealer.length, 2);
  assert.equal(dealerA.productName, "Dealer A");
  assert.deepEqual(
    { ordered: dealerA.orderedQuantity, dispatched: dealerA.dispatchedQuantity, pending: dealerA.pendingQuantity, orders: dealerA.pendingOrders },
    { ordered: 21, dispatched: 6, pending: 15, orders: 2 },
  );

  const byCategory = pendingProducts.aggregatePendingProducts(lines, "category");
  assert.equal(byCategory.length, 1);
  assert.equal(byCategory[0].productKey, "category:Glassware");
  assert.equal(byCategory[0].pendingQuantity, 23);
  assert.equal(byCategory[0].dealersAffected, 2);

  const dealerDrilldown = pendingProducts.buildPendingProductDrilldown(lines, "dealer:D-1", "dealer");
  assert.equal(dealerDrilldown.aggregate.pendingQuantity, 15);
  assert.deepEqual(dealerDrilldown.orders.map((order) => order.orderId).sort(), ["1001", "1003"]);
});

test("report periods are rolling windows over the order date", () => {
  // Fixture orders sit on 2026-08-01, 08-02 and 08-04.
  const lines = buildFixtureLines();
  const now = Date.parse("2026-08-05T00:00:00.000Z");
  const orderIdsFor = (period) =>
    Array.from(new Set(pendingProducts.filterPendingLinesByPeriod(lines, period, now).map((line) => line.orderId))).sort();

  assert.equal(pendingProducts.pendingReportPeriodStartMs("all", now), null);
  assert.deepEqual(orderIdsFor("all"), ["1001", "1002", "1003"]);

  // Only 08-04 falls inside the 24h window ending 08-05.
  assert.deepEqual(orderIdsFor("day"), ["1002"]);
  assert.deepEqual(orderIdsFor("month"), ["1001", "1002", "1003"]);
  assert.deepEqual(orderIdsFor("year"), ["1001", "1002", "1003"]);

  // A year later every fixture order has aged out of the shorter windows.
  const muchLater = Date.parse("2027-08-05T00:00:00.000Z");
  assert.deepEqual(pendingProducts.filterPendingLinesByPeriod(lines, "quarter", muchLater), []);
  assert.equal(pendingProducts.filterPendingLinesByPeriod(lines, "all", muchLater).length, lines.length);
});

test("unknown report periods fall back to all time rather than an empty report", () => {
  assert.equal(pendingProducts.parsePendingReportPeriod("month"), "month");
  assert.equal(pendingProducts.parsePendingReportPeriod("HALF_YEAR"), "half_year");
  assert.equal(pendingProducts.parsePendingReportPeriod("fortnight"), "all");
  assert.equal(pendingProducts.parsePendingReportPeriod(undefined), "all");

  // An undated line cannot be placed in a window, so a bounded period drops it
  // instead of silently inflating the totals.
  const undated = [{ orderDateMs: null, orderId: "x", productKey: "sku:1" }];
  assert.deepEqual(pendingProducts.filterPendingLinesByPeriod(undated, "year", Date.now()), []);
  assert.equal(pendingProducts.filterPendingLinesByPeriod(undated, "all", Date.now()).length, 1);
});

test("club-view rows carry a unit, stay JSON-safe, and collapse to nothing when there is no pending stock", () => {
  const aggregates = pendingProducts.aggregatePendingProducts(buildFixtureLines());
  const flask100 = aggregates.find((entry) => entry.catalogueNumber === "50/8");

  // The clubbed row renders "<pending> <unit> pending", so the unit has to survive
  // aggregation rather than only existing on the drill-down contributions.
  assert.ok(flask100);
  assert.equal(flask100.productUnit, "Units");
  assert.equal(
    flask100.productUnit,
    pendingProducts.buildPendingProductDrilldown(buildFixtureLines(), flask100.productKey).orders[0].productUnit
  );

  // Order ids and quantities come back as strings/numbers, so the payload the
  // Club View fetches never trips BigInt serialization.
  assert.doesNotThrow(() => JSON.stringify(aggregates));
  assert.equal(typeof flask100.pendingQuantity, "number");

  assert.deepEqual(pendingProducts.aggregatePendingProducts([]), []);
  assert.deepEqual(pendingProducts.buildPendingProductDrilldown([], "sku:50/8"), { aggregate: null, orders: [] });
});
