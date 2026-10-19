import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function loadOrderTotals() {
  const source = await fs.readFile(path.resolve("src/lib/orderTotals.ts"), "utf8");
  const keyStub = `data:text/javascript;base64,${Buffer.from('export function normalizeApprovalProductKey(value){ return String(value ?? "").trim().toLowerCase(); }').toString("base64")}`;
  const rewritten = source
    .replace(/from\s+["']@\/lib\/customDiscountRequests["']/, `from "${keyStub}"`)
    .replace(/from\s+["']@\/lib\/discount["']/, `from "${pathToFileURL(path.resolve("src/lib/discount.js")).href}"`);
  const js = ts.transpileModule(rewritten, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js, "utf8").toString("base64")}`);
}

const { orderTotals } = await loadOrderTotals();
const line = (catNo, grossPaise) => ({ catNo, listPriceTotalPaise: grossPaise, saleSavedPaise: 0n, discountPercent: 0, discountAmountPaise: 0n, finalAmountPaise: 0n });

test("50% base on ₹9,600 takes ₹4,800 off and leaves ₹4,800 to pay", () => {
  const items = [line("OM260-020", 960000n)];
  const totals = orderTotals(items, 50, []);
  assert.equal(totals.grossAmountPaise, 960000n);
  assert.equal(totals.baseDiscountAmountPaise, 480000n);
  assert.equal(totals.finalPayableAmountPaise, 480000n);
  assert.equal(totals.additionalDiscountType, "NONE");
  assert.equal(items[0].discountPercent, 50);
  assert.equal(items[0].finalAmountPaise, 480000n);
});

test("an edit that doubles the quantity doubles the base discount and the amount owed", () => {
  // The Mirisoft case: the order row has to carry the new base discount and final, or credit stays stale.
  const totals = orderTotals([line("OM260-020", 1920000n)], 50, []);
  assert.equal(totals.baseDiscountAmountPaise, 960000n);
  assert.equal(totals.finalPayableAmountPaise, 960000n);
});

test("the slab is read from the amount after the base discount: 2% from ₹2,50,000, 5% from ₹5,00,000", () => {
  const two = orderTotals([line("A", 60000000n)], 50, []);
  assert.equal(two.postBaseAmountPaise, 30000000n);
  assert.equal(two.slabDiscountPercent, 2);
  assert.equal(two.slabDiscountAmountPaise, 600000n);
  assert.equal(two.finalPayableAmountPaise, 29400000n);
  assert.equal(two.additionalDiscountType, "SLAB");

  const five = orderTotals([line("A", 50000000n)], 0, []);
  assert.equal(five.slabDiscountPercent, 5);
  assert.equal(five.finalPayableAmountPaise, 47500000n);
});

test("total discount never exceeds the gross", () => {
  const totals = orderTotals([line("A", 100000n)], 50, [{ scope: "ORDER", requestedDiscountAmountPaise: 2000000n, requestedOrderDiscountPercent: 100, requestedDiscountPercent: 100, requestedProductDiscounts: null }]);
  assert.equal(totals.totalDiscountAmountPaise, 100000n);
  assert.equal(totals.finalPayableAmountPaise, 0n);
});

test("a new order is priced through the same calculation", async () => {
  const create = await fs.readFile(path.resolve("src/lib/dealerOrderCreate.ts"), "utf8");
  assert.match(create, /const totals = orderTotals\(items, clampPercent\(num\(dealer\.discountPercent \?\? 0\) \+ couponDiscountPercent\), customRequests\);/);
});
