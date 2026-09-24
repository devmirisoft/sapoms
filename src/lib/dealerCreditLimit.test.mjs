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

const { getDealerCreditStatus, tempCreditDraw } = await loadModule("src/lib/dealerCreditLimit.ts");

const DAY = 86_400_000;
const client = (orderPaise, bills = []) => ({
  order: { findMany: async () => orderPaise.map((finalPayableAmountPaise) => ({ finalPayableAmountPaise })) },
  ledgerBill: { findMany: async () => bills },
});
const dealer = (over = {}) => ({ id: 1n, creditDays: 30, creditLimitPaise: 50_000n, tempCreditLimitPaise: 0n, tempCreditConsumedPaise: 0n, ...over });

test("advance dealers (no credit days) are not credit-checked", async () => {
  assert.equal(await getDealerCreditStatus(client([]), dealer({ creditDays: null })), null);
});

test("limit is lifetime ordered total, paid or not", async () => {
  const status = await getDealerCreditStatus(client([30_000n, 20_000n]), dealer());
  assert.equal(status.remainingPaise, 0n);
});

test("temporary limit is drawn only past base headroom, then the base limit is back", async () => {
  // 50k base, 45k used, 10k temp -> 15k available; a 12k order takes 7k from temp.
  const before = await getDealerCreditStatus(client([45_000n]), dealer({ tempCreditLimitPaise: 10_000n }));
  assert.equal(before.remainingPaise, 15_000n);
  assert.equal(tempCreditDraw(before, 12_000n), 7_000n);

  // After that order: temp 3k left, 7k consumed; base is fully spent.
  const after = await getDealerCreditStatus(client([45_000n, 12_000n]), dealer({ tempCreditLimitPaise: 3_000n, tempCreditConsumedPaise: 7_000n }));
  assert.equal(after.baseHeadroomPaise, 0n);
  assert.equal(after.remainingPaise, 3_000n);

  // A fresh 10k grant later gives exactly 10k more, not 10k minus the overshoot.
  const regrant = await getDealerCreditStatus(client([45_000n, 12_000n, 3_000n]), dealer({ tempCreditLimitPaise: 10_000n, tempCreditConsumedPaise: 10_000n }));
  assert.equal(regrant.remainingPaise, 10_000n);
});

test("overdue uses per-bill extra days, and paid bills never block", async () => {
  const billDate = new Date(Date.now() - 35 * DAY);
  const unpaid = { billAmountPaise: 100n, paidAmountPaise: 0n, billDate, extraCreditDays: 0 };
  assert.equal((await getDealerCreditStatus(client([], [unpaid]), dealer())).isOverdue, true);
  assert.equal((await getDealerCreditStatus(client([], [{ ...unpaid, extraCreditDays: 10 }]), dealer())).isOverdue, false);
  assert.equal((await getDealerCreditStatus(client([], [{ ...unpaid, paidAmountPaise: 100n }]), dealer())).isOverdue, false);
});
