import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const read = (file) => fs.readFile(path.resolve(file), "utf8");

const transpiled = ts.transpileModule(await read("src/server/modules/staff-dashboard-charts.ts"), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { breakdownForRole, buildStaffCharts, memberOrderWhere, orderGroup } = await import(`data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`);

const asm = { id: 7n, displayName: "Asha ASM" };
const manager = { id: 9n, displayName: "Sam Manager", parentAsm: asm };

function order(overrides = {}) {
  return {
    orderNumber: "OM/26-27/DMS-001",
    orderDate: new Date("2026-05-10T00:00:00Z"),
    finalPayableAmountPaise: 100000n,
    dealerId: 1n,
    salesManager: null,
    ...overrides,
    dealer: { businessName: "Dealer One", dealerCode: "D1", city: "Ambala", staffAssignments: [], ...overrides.dealer },
  };
}

const month = (date) => date.toISOString().slice(0, 7);

test("each role breaks down one level below itself", () => {
  assert.equal(breakdownForRole("RSM"), "asm");
  assert.equal(breakdownForRole("ASM"), "salesManager");
  assert.equal(breakdownForRole("STAFF"), "city");
});

test("an RSM's orders reach an ASM's line along the same paths as rsmOrderScope", () => {
  assert.equal(orderGroup(order({ salesManager: manager }), "asm").label, "Asha ASM");
  assert.equal(orderGroup(order({ salesManager: { ...manager, parentAsm: null } }), "asm").label, "Direct");
  assert.equal(orderGroup(order({ dealer: { staffAssignments: [{ staff: asm }] } }), "asm").label, "Asha ASM");
  assert.equal(orderGroup(order(), "asm").label, "Direct");
  // A sales manager's order stays on that path even when the dealer has an ASM.
  assert.equal(orderGroup(order({ salesManager: { ...manager, parentAsm: null }, dealer: { staffAssignments: [{ staff: asm }] } }), "asm").label, "Direct");
});

test("an ASM's orders go to the sales manager, or Direct without one", () => {
  assert.equal(orderGroup(order({ salesManager: manager }), "salesManager").label, "Sam Manager");
  assert.equal(orderGroup(order(), "salesManager").label, "Direct");
});

test("cities merge across case and spacing, and only the top 5 are charted", () => {
  assert.equal(orderGroup(order({ dealer: { city: "  NEW   delhi " } }), "city").label, "New Delhi");
  assert.equal(orderGroup(order({ dealer: { city: "" } }), "city").label, "No city");

  const charts = buildStaffCharts(
    [["Ambala", 700000n], ["AMBALA", 100000n], ["Delhi", 600000n], ["Pune", 500000n], ["Agra", 400000n], ["Kota", 300000n], ["Ooty", 200000n]]
      .map(([city, finalPayableAmountPaise]) => order({ finalPayableAmountPaise, dealer: { city } })),
    "city",
    month,
  );
  assert.deepEqual(charts.groups.map((group) => group.label), ["Ambala", "Delhi", "Pune", "Agra", "Kota"]);
  assert.equal(charts.netSales[0].g0, 8000);
});

test("amounts are whole rupees, not paise", () => {
  const charts = buildStaffCharts([order({ finalPayableAmountPaise: 1200000n })], "city", month);
  assert.equal(charts.topOrders[0].total, 12000);
  assert.equal(charts.topDealers[0].total, 12000);
  assert.equal(charts.topByGroup.g0[0].total, 12000);
  assert.deepEqual(charts.netSales, [{ period: "2026-05", g0: 12000 }]);
});

test("top lists are sorted and capped: 10 overall, 5 per group", () => {
  const orders = Array.from({ length: 12 }, (_, index) => order({
    orderNumber: `N${index}`,
    dealerId: BigInt(index + 1),
    finalPayableAmountPaise: BigInt((index + 1) * 100),
    dealer: { businessName: `D${index}` },
  }));
  const charts = buildStaffCharts(orders, "city", month);
  assert.equal(charts.topOrders.length, 10);
  assert.equal(charts.topOrders[0].order_id, "N11");
  assert.equal(charts.topDealers.length, 10);
  assert.equal(charts.topDealers[0].dealerName, "D11");
  assert.equal(charts.topByGroup.g0.length, 5);
});

test("the sale chart's member filter matches the chart lines and ignores bad ids", () => {
  assert.equal(memberOrderWhere("city", "7"), null);
  assert.equal(memberOrderWhere("asm", "7 OR 1=1"), null);
  assert.equal(memberOrderWhere("salesManager", ""), null);
  assert.deepEqual(memberOrderWhere("salesManager", "9"), { salesManagerId: 9n });
  assert.deepEqual(memberOrderWhere("asm", "7").OR[0], { salesManager: { parentAsmId: 7n } });
  assert.equal(memberOrderWhere("asm", "7").OR[1].salesManagerId, null);
});

test("staff never get finance figures or the sales report", async () => {
  const dashboardRoute = await read("src/app/api/staff/dashboard/route.ts");
  const summaryRoute = await read("src/app/api/staff/sales-summary/route.ts");
  const server = await read("src/server/modules/staff-dashboard.ts");
  const panels = await read("src/components/dashboard/StaffSalesPanels.tsx");
  const page = await read("src/app/dashboard/staff/page.tsx");

  assert.match(dashboardRoute, /isStaffLike\(actor\)/);
  assert.match(summaryRoute, /isStaffLike\(actor\)/);
  assert.match(server, /withBills: false/);
  assert.doesNotMatch(server, /withBills: true/);
  assert.doesNotMatch(server, /buildSalesReport/);
  for (const source of [panels, page]) {
    assert.doesNotMatch(source, /format=xlsx/);
    assert.doesNotMatch(source, /Financial Overview/);
    assert.doesNotMatch(source, /Total Billed|Total Payment/);
  }
});
