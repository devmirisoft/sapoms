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

const { billAgeing, getDealerCreditStatus, tempCreditDraw } = await loadModule("src/lib/dealerCreditLimit.ts");

const DAY = 86_400_000;
const client = (orderPaise, bills = []) => ({
  order: { findMany: async () => orderPaise.map((finalPayableAmountPaise) => ({ finalPayableAmountPaise })) },
  ledgerBill: { findMany: async () => bills.map((bill) => ({ debitNotePaise: 0n, extraCreditDays: 0, billDate: new Date(), ...bill })) },
});
const dealer = (over = {}) => ({ id: 1n, creditDays: 30, creditLimitPaise: 50_000n, tempCreditLimitPaise: 0n, ...over });

test("advance dealers (no credit days) are not credit-checked", async () => {
  assert.equal(await getDealerCreditStatus(client([]), dealer({ creditDays: null })), null);
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
