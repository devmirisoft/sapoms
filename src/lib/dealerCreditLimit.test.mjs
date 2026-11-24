import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

async function loadModule(relativePath) {
  const filePath = path.resolve(relativePath);
  const source = await readFile(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`);
}

const { billAgeing, creditOwedPaise, dealerTerms, getDealerCreditStatus, tempCreditDraw } = await loadModule("src/lib/dealerCreditLimit.ts");

test("an active wallet makes a dealer advance even with credit days saved", () => {
  const on = { status: "ACTIVE" };
  const off = { status: "INACTIVE" };
  assert.equal(dealerTerms({ creditDays: 30 }, on), "advance");
  assert.equal(dealerTerms({ creditDays: null }, on), "advance");
  assert.equal(dealerTerms({ creditDays: 30 }, off), "credit");
  assert.equal(dealerTerms({ creditDays: 0 }, null), "credit");
  assert.equal(dealerTerms({ creditDays: null }, off), "unset");
  assert.equal(dealerTerms({ creditDays: null }, null), "unset");
});

const DAY = 86_400_000;
// Orders placed now (after the opening-balance cutoff); bills name order 1, as the bill form stores it.
const client = (orderPaise, bills = []) => ({
  order: { findMany: async () => orderPaise.map((finalPayableAmountPaise, i) => ({ id: BigInt(i + 1), legacyPhpId: null, orderNumber: `DMS-${i + 1}`, orderDate: new Date(), status: "ACCEPTED", finalPayableAmountPaise })) },
  ledgerBill: { findMany: async () => bills.map((bill) => ({ orderId: null, orderNumber: "1", debitNotePaise: 0n, extraCreditDays: 0, billDate: new Date(), ...bill })) },
});
const dealer = (over = {}) => ({ id: 1n, creditDays: 30, creditLimitPaise: 50_000n, tempCreditLimitPaise: 0n, ...over });

test("advance dealers (no credit days) are not credit-checked", async () => {
  assert.equal(await getDealerCreditStatus(client([]), dealer({ creditDays: null })), null);
});

test("advance dealers with credit days saved are not credit-checked either", async () => {
  assert.equal(await getDealerCreditStatus(client([]), dealer({ wallet: { status: "ACTIVE" } })), null);
  assert.notEqual(await getDealerCreditStatus(client([]), dealer({ wallet: { status: "INACTIVE" } })), null);
});

test("limit is ordered minus paid: recording a payment frees that much again", async () => {
  const limit = dealer({ creditLimitPaise: 10_000n });
  assert.equal((await getDealerCreditStatus(client([10_000n]), limit)).remainingPaise, 0n);
  // 2k dispatched, billed and paid -> 2k back.
  const paid = { billAmountPaise: 2_000n, paidAmountPaise: 2_000n };
  assert.equal((await getDealerCreditStatus(client([10_000n], [paid]), limit)).remainingPaise, 2_000n);
  // Billed but unpaid frees nothing.
  assert.equal((await getDealerCreditStatus(client([10_000n], [{ ...paid, paidAmountPaise: 0n }]), limit)).remainingPaise, 0n);
  // An unpaid debit note counts as owed.
  assert.equal((await getDealerCreditStatus(client([8_000n], [{ billAmountPaise: 2_500n, paidAmountPaise: 0n, debitNotePaise: 500n }]), limit)).remainingPaise, 1_500n);
});

test("opening bills (no order number) count in full, and paying one frees only that bill", async () => {
  // 4L limit, 3.55L of app orders, 6.11L of opening bills: nothing available.
  const limit = dealer({ creditLimitPaise: 400_000n });
  const opening = (paid) => [{ orderNumber: "", billAmountPaise: 611_107n, paidAmountPaise: paid }];
  const unpaid = await getDealerCreditStatus(client([355_414n], opening(0n)), limit);
  assert.equal(unpaid.usedPaise, 966_521n);
  assert.equal(unpaid.remainingPaise, 0n);
  // Clearing the opening bills leaves the app orders still owed.
  assert.equal((await getDealerCreditStatus(client([355_414n], opening(611_107n)), limit)).usedPaise, 355_414n);
  // A debit note is already inside an opening bill's amount, so it is not added twice.
  assert.equal((await getDealerCreditStatus(client([], [{ orderNumber: " ", billAmountPaise: 2_500n, paidAmountPaise: 0n, debitNotePaise: 500n }]), limit)).usedPaise, 2_500n);
});

test("temporary limit, once used, leaves the dealer on the base limit even after payments", async () => {
  // 50k base, 60k ordered (10k temp spent): paying 10k only brings it back to the 50k line.
  const bills = (paid) => [{ billAmountPaise: 60_000n, paidAmountPaise: paid }];
  assert.equal((await getDealerCreditStatus(client([60_000n], bills(10_000n)), dealer())).remainingPaise, 0n);
  assert.equal((await getDealerCreditStatus(client([60_000n], bills(60_000n)), dealer())).remainingPaise, 50_000n);
});

test("temporary limit is drawn only past base headroom, then the base limit is back", async () => {
  // 50k base, 45k used, 10k temp -> 15k available; a 12k order takes 7k from temp.
  const before = await getDealerCreditStatus(client([45_000n]), dealer({ tempCreditLimitPaise: 10_000n }));
  assert.equal(before.remainingPaise, 15_000n);
  assert.equal(tempCreditDraw(before, 12_000n), 7_000n);

  // After that order: temp 3k left, 7k consumed; base is fully spent.
  const after = await getDealerCreditStatus(client([45_000n, 12_000n]), dealer({ tempCreditLimitPaise: 3_000n }));
  assert.equal(after.baseHeadroomPaise, 0n);
  assert.equal(after.remainingPaise, 3_000n);

  // A fresh 10k grant later gives exactly 10k more, not 10k minus the overshoot.
  const regrant = await getDealerCreditStatus(client([45_000n, 12_000n, 3_000n]), dealer({ tempCreditLimitPaise: 10_000n }));
  assert.equal(regrant.remainingPaise, 10_000n);
});

test("overdue uses per-bill extra days, and paid bills never block", async () => {
  const billDate = new Date(Date.now() - 35 * DAY);
  const unpaid = { billAmountPaise: 100n, paidAmountPaise: 0n, billDate, extraCreditDays: 0 };
  assert.equal((await getDealerCreditStatus(client([], [unpaid]), dealer())).isOverdue, true);
  assert.equal((await getDealerCreditStatus(client([], [{ ...unpaid, extraCreditDays: 10 }]), dealer())).isOverdue, false);
  assert.equal((await getDealerCreditStatus(client([], [{ ...unpaid, paidAmountPaise: 100n }]), dealer())).isOverdue, false);
});

test("ageing report: unpaid balance counts as due only past credit days", () => {
  const now = Date.parse("2026-09-25T10:00:00Z");
  const bill = (date, paise, paid = 0n, extra = 0) =>
    billAgeing({ billDate: new Date(`${date}T00:00:00Z`), billAmountPaise: paise, paidAmountPaise: paid, extraCreditDays: extra }, 45, now);
  assert.deepEqual(bill("2026-07-25", 570000n), { ageDays: 62, duePaise: 570000n });
  assert.deepEqual(bill("2026-09-05", 350000n), { ageDays: 20, duePaise: 0n });
  assert.deepEqual(bill("2026-07-25", 570000n, 70000n), { ageDays: 62, duePaise: 500000n });
  assert.deepEqual(bill("2026-07-25", 570000n, 0n, 20), { ageDays: 62, duePaise: 0n });
});

// Owed since the 31 Oct opening balance (imported bills have orderNumber "").
const rs = (n) => BigInt(Math.round(n * 100));
const mkOrder = (id, date, amount, extra = {}) => ({ id: BigInt(id), legacyPhpId: null, orderNumber: `OM/26-27/DMS-${id}`, orderDate: new Date(date), status: "ACCEPTED", finalPayableAmountPaise: rs(amount), ...extra });
const mkBill = (date, amount, extra = {}) => ({ orderId: null, orderNumber: "", billDate: new Date(`${date}T00:00:00Z`), billAmountPaise: rs(amount), paidAmountPaise: 0n, debitNotePaise: 0n, ...extra });

test("opening bills count in full, less what's paid", () => {
  const bills = [mkBill("2026-10-01", 14509, { paidAmountPaise: rs(10000) }), mkBill("2026-10-30", 18139)];
  assert.equal(creditOwedPaise([], bills), rs(4509 + 18139));
});

test("orders before the cutoff are inside the opening balance", () => {
  const orders = [mkOrder(1, "2026-10-31T23:59:00+05:30", 500), mkOrder(2, "2026-11-01T00:00:00+05:30", 700)];
  assert.equal(creditOwedPaise(orders, []), rs(700));
});

test("cancelled and declined orders never count", () => {
  const orders = [mkOrder(1, "2026-11-05", 100, { status: "CANCELLED" }), mkOrder(2, "2026-11-05", 200, { status: "DECLINED" }), mkOrder(3, "2026-11-05", 300)];
  assert.equal(creditOwedPaise(orders, []), rs(300));
});

test("a later bill for a counted order adds only its debit note, less paid", () => {
  const orders = [mkOrder(5, "2026-11-06", 92217)];
  const bills = [mkBill("2026-11-13", 128843, { orderId: 5n, orderNumber: "5", debitNotePaise: rs(1000), paidAmountPaise: rs(20000) })];
  assert.equal(creditOwedPaise(orders, bills), rs(92217 + 1000 - 20000));
});

test("a later bill for an earlier order counts in full", () => {
  const orders = [mkOrder(2220, "2026-10-29", 120106)];
  const bills = [mkBill("2026-11-14", 307382, { orderId: 2220n, orderNumber: "2220", paidAmountPaise: rs(7382) })];
  assert.equal(creditOwedPaise(orders, bills), rs(300000));
});

test("app bills dated before the cutoff are inside the opening balance", () => {
  assert.equal(creditOwedPaise([], [mkBill("2026-10-12", 25500, { orderNumber: "1592, 1554" })]), 0n);
});

test("the opening balance ends at midnight 1 Nov IST", () => {
  // An app bill for an order not on the books, either side of the cutoff instant.
  const appBill = (iso) => ({ ...mkBill("2026-11-01", 100, { orderNumber: "9" }), billDate: new Date(iso) });
  assert.equal(creditOwedPaise([], [appBill("2026-10-31T23:59:59+05:30")]), 0n);
  assert.equal(creditOwedPaise([], [appBill("2026-11-01T00:00:00+05:30")]), rs(100));
  // As bill dates are stored (UTC midnight): 31 Oct is inside the opening balance, 1 Nov is not.
  assert.equal(creditOwedPaise([], [mkBill("2026-10-31", 100, { orderNumber: "9" })]), 0n);
  assert.equal(creditOwedPaise([], [mkBill("2026-11-01", 100, { orderNumber: "9" })]), rs(100));
});

test("multi-order bills resolve orders by id or legacy id", () => {
  const orders = [mkOrder(288, "2026-09-10", 1000, { legacyPhpId: "288", id: 9000n }), mkOrder(2211, "2026-11-02", 5000)];
  // one counted order on the bill -> covered, so only the debit note adds
  assert.equal(creditOwedPaise(orders, [mkBill("2026-11-06", 271166, { orderNumber: "2211, 288", debitNotePaise: rs(66) })]), rs(5000 + 66));
  // only earlier orders on the bill -> counts in full
  assert.equal(creditOwedPaise(orders.slice(0, 1), [mkBill("2026-11-06", 271166, { orderNumber: "288" })]), rs(271166));
});
