import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

// dispatchTracking.ts only imports types, so it transpiles on its own.
const source = await fs.readFile(path.resolve("src/lib/dispatchTracking.ts"), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tracking = await import(`data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`);

function line(overrides) {
  return {
    productKey: `sku:${overrides.catalogueNumber}`,
    catalogueNumber: "",
    normalizedCatalogueNumber: "",
    productName: "Product",
    specification: "",
    category: "Glassware",
    image: "",
    orderId: "1",
    orderNumber: "OM/26-27/DMS-001",
    orderDate: "2026-10-01T00:00:00.000Z",
    orderDateMs: Date.parse("2026-10-01T00:00:00.000Z"),
    dealerId: "41",
    dealerName: "Dealer",
    dealerCode: "D41",
    assignedStaffIds: [],
    assignedStaffNames: [],
    orderItemId: overrides.catalogueNumber,
    dispatchStatus: "dispatched",
    latestDispatchUpdateAt: "",
    latestDispatchUpdateMs: null,
    packSize: 1,
    totalPieces: overrides.orderedQuantity,
    productUnit: "Units",
    acceptOrder: "1",
    delStatus: "0",
    orderStatus: "ACCEPTED",
    mtstatus: "DISPATCHED",
    reason: "",
    malformedIdentity: false,
    pendingQuantity: Math.max(0, overrides.orderedQuantity - overrides.dispatchedQuantity),
    dispatches: [],
    ...overrides,
  };
}

const dispatch = (at, quantity, shipmentId = null) => ({ at, quantity, shipmentId, shipment: "", trackingLink: null, remark: "" });

test("allocateOrderValue lands the order net on the lines exactly", () => {
  assert.deepEqual(tracking.allocateOrderValue([1000n, 2000n, 3000n], 5000n), [833n, 1666n, 2501n]);
  // The remainder skips unpriced trailing lines.
  assert.deepEqual(tracking.allocateOrderValue([1000n, 0n], 900n), [900n, 0n]);
  // No stored net (legacy orders): line values stand.
  assert.deepEqual(tracking.allocateOrderValue([1000n, 2000n], 0n), [1000n, 2000n]);
});

test("splitLineValue rounds the dispatched share and caps over-dispatch", () => {
  assert.deepEqual(tracking.splitLineValue(1000n, 3, 1), { dispatchedPaise: 333n, leftPaise: 667n });
  assert.deepEqual(tracking.splitLineValue(1000n, 3, 5), { dispatchedPaise: 1000n, leftPaise: 0n });
});

test("an order rolls its lines up with the discount spread and shipments grouped", () => {
  const lines = [
    line({ catalogueNumber: "A", orderedQuantity: 2, dispatchedQuantity: 2, valuePaise: 2000n, dispatches: [dispatch("2026-10-05T00:00:00.000Z", 2, "s1")] }),
    line({ catalogueNumber: "B", orderedQuantity: 4, dispatchedQuantity: 1, valuePaise: 4000n, dispatches: [dispatch("2026-10-07T00:00:00.000Z", 1)] }),
    line({ catalogueNumber: "C", orderedQuantity: 1, dispatchedQuantity: 0, valuePaise: null }),
  ];
  const meta = new Map([["1", {
    finalPayablePaise: 5400n,
    shipments: [{ id: "s1", dispatchPartner: "DTDC", trackingNumber: "AWB1", trackingLink: null, createdAt: "2026-10-05T00:00:00.000Z" }],
  }]]);

  const [order] = tracking.buildDispatchTrackingOrders(lines, meta);
  assert.equal(order.status, "partial");
  assert.equal(order.leftQuantity, 4);
  // 10% order discount: A nets 1800 (all dispatched), B nets 3600 (a quarter dispatched).
  assert.equal(order.dispatchedValue, 27);
  assert.equal(order.leftValue, 27);
  assert.equal(order.dispatchedValue + order.leftValue, 54);
  assert.equal(order.lines[0].leftQuantity, 0, "fully dispatched lines stay on the order");
  assert.equal(order.lines[2].priced, false);
  assert.equal(order.lastDispatchAt, "2026-10-07T00:00:00.000Z");
  assert.deepEqual(order.shipments.map((shipment) => [shipment.id, shipment.items.map((item) => item.quantity)]), [["s1", [2]], ["", [1]]]);
});

test("filters, sort and summary work on whole orders", () => {
  const meta = new Map();
  const orders = tracking.buildDispatchTrackingOrders([
    line({ orderId: "1", catalogueNumber: "CAT-ONE", orderedQuantity: 1, dispatchedQuantity: 1, valuePaise: 500n, dispatches: [dispatch("2026-10-02T00:00:00.000Z", 1)] }),
    line({ orderId: "2", catalogueNumber: "CAT-TWO", orderedQuantity: 3, dispatchedQuantity: 1, valuePaise: 300n, dispatches: [dispatch("2026-10-09T00:00:00.000Z", 1)] }),
  ], meta);

  assert.deepEqual(tracking.filterDispatchTrackingOrders(orders, {}).map((order) => order.orderId), ["2"]);
  assert.deepEqual(tracking.filterDispatchTrackingOrders(orders, { status: "complete" }).map((order) => order.orderId), ["1"]);
  assert.deepEqual(tracking.filterDispatchTrackingOrders(orders, { status: "all", search: "one" }).map((order) => order.orderId), ["1"]);
  assert.deepEqual(tracking.sortDispatchTrackingOrders(orders, "latest_dispatch").map((order) => order.orderId), ["2", "1"]);
  assert.deepEqual(tracking.summarizeDispatchTrackingOrders(orders), {
    orders: 2, fullyDispatched: 1, unitsDispatched: 2, unitsLeft: 2, valueDispatched: 6, valueLeft: 2,
  });
});
