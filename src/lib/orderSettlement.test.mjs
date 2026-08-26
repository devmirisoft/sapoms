import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

// The repo has no TS loader for tests, so transpile the module the same way
// orderAmounts.test.mjs does and import the result.
async function loadModule(relativePath) {
  const filePath = path.resolve(relativePath);
  const source = await readFile(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`);
}

const { summarizeOrderSettlement, orderSettlementLabel } = await loadModule("src/lib/orderSettlement.ts");

const orders = await readFile(new URL("./postgresOrders.ts", import.meta.url), "utf8");
const ledger = await readFile(new URL("./ledgerSystem.ts", import.meta.url), "utf8");
const invoice = await readFile(new URL("./invoicegenerator.tsx", import.meta.url), "utf8");

const bill = (billed, paid, date = "2026-08-20") => ({
  id: 1n, orderNumber: "OM/26-27/DMS-001",
  billAmountPaise: billed, paidAmountPaise: paid, lastPaymentDate: date,
});

test("an order with no bills is unbilled, not unpaid", () => {
  const summary = summarizeOrderSettlement([], 50000n);
  assert.equal(summary.status, "unbilled");
  assert.equal(summary.paidAmount, 0);
  assert.equal(orderSettlementLabel(summary.status), "");
});

test("a fully settled order reports zero due", () => {
  const summary = summarizeOrderSettlement([bill(50000n, 50000n)], 50000n);
  assert.equal(summary.status, "settled");
  assert.equal(summary.isSettled, true);
  assert.equal(summary.paidAmount, 500);
  assert.equal(summary.dueAmount, 0);
});

test("a partial settlement reports the remaining balance", () => {
  const summary = summarizeOrderSettlement([bill(50000n, 20000n)], 50000n);
  assert.equal(summary.status, "part_settled");
  assert.equal(summary.paidAmount, 200);
  assert.equal(summary.dueAmount, 300);
  assert.equal(orderSettlementLabel(summary.status), "Part settled");
});

test("the order payable wins over the billed total as the denominator", () => {
  // A bill raised for part of the order must not read as fully settled.
  const summary = summarizeOrderSettlement([bill(20000n, 20000n)], 50000n);
  assert.equal(summary.status, "part_settled");
  assert.equal(summary.dueAmount, 300);
});

test("multiple bills roll up, and the latest payment date wins", () => {
  const summary = summarizeOrderSettlement(
    [bill(30000n, 30000n, "2026-08-01"), { ...bill(20000n, 20000n, "2026-08-22"), id: 2n }],
    50000n,
  );
  assert.equal(summary.status, "settled");
  assert.equal(summary.paidAmount, 500);
  assert.match(summary.lastPaymentAt, /^2026-08-22/);
  assert.equal(summary.bills.length, 2);
});

test("missing or malformed bill data degrades to unbilled rather than throwing", () => {
  assert.equal(summarizeOrderSettlement(undefined, 0).status, "unbilled");
  assert.equal(summarizeOrderSettlement(null, null).status, "unbilled");
});

test("every order query that maps to legacy includes ledgerBills", () => {
  // The mapper reads order.ledgerBills; an include that omits it silently
  // reports "unbilled" because the cast hides it from the typechecker.
  assert.match(orders, /ledgerBills: \{ orderBy: \{ billDate: "desc" as const \} \}/);
  assert.match(ledger, /ledgerBills: \{ orderBy: \{ billDate: "desc" as const \} \}/);
  assert.match(orders, /settlement: summarizeOrderSettlement\(/);
});

test("the invoice prints paid and balance only when something was settled", () => {
  assert.match(invoice, /const settledPaid = Number\(settlementInfo\?\.paidAmount \?\? 0\)/);
  assert.match(invoice, /if \(settlementInfo && settledPaid > 0\)/);
  assert.match(invoice, /Amount Paid:/);
});

test("ledger totals still exclude settlement transactions", () => {
  // Counting them would drop the dealer's outstanding twice for one payment.
  assert.match(ledger, /if \(isSettlementTransaction\(tx\.metadata\)\) return totals/);
});
