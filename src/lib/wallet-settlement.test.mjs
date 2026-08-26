import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

const settlement = read("./walletSettlement.ts");
const ledger = read("./ledgerSystem.ts");
const repo = read("../server/modules/admin/dealers/dealers.repository.ts");
const prismaSchema = read("../../prisma/schema.prisma");
const migration = read("../../prisma/migrations/20260825120000_wallet_settlements/migration.sql");

const listRoute = read("../app/api/settlements/route.ts");
const detailRoute = read("../app/api/settlements/[settlementId]/route.ts");
const applyRoute = read("../app/api/settlements/[settlementId]/apply/route.ts");
const settlePage = read("../app/dashboard/accountant/settle/page.tsx");

test("switching a dealer advance -> credit zeroes the wallet into a settlement", () => {
  // The residual must leave the wallet, and it must leave through the audited
  // wallet path rather than a bare balance write.
  assert.match(settlement, /WalletTransactionType\.DEBIT/);
  assert.match(settlement, /applyWalletChange\(/);
  assert.match(settlement, /originalPaise: balancePaise/);
  assert.match(settlement, /remainingPaise: balancePaise/);

  // The dealer edit path has to call it when walletActive flips to false.
  assert.match(repo, /openSettlementForWalletClosure\(/);
  assert.match(repo, /if \(!input\.walletActive\)/);
});

test("a dealer with an empty wallet does not open a settlement", () => {
  assert.match(settlement, /if \(!wallet \|\| balancePaise <= BigInt\(0\)\) return null;/);
});

test("credit -> advance is blocked while money is unsettled", () => {
  assert.match(settlement, /export async function assertNoOpenSettlement/);
  assert.match(settlement, /code: "settlement_open"/);
  assert.match(repo, /assertNoOpenSettlement\(tx, dealerId\)/);
});

test("settlement transactions stay out of the dealer's outstanding", () => {
  // Both legs are internal movements of money the dealer already paid; counting
  // either would swing the ledger by the residual.
  assert.match(ledger, /export function isSettlementTransaction/);
  assert.match(ledger, /walletSettlementClosing/);
  assert.match(ledger, /walletSettlementApplication/);
  assert.match(ledger, /if \(isSettlementTransaction\(tx\.metadata\)\) return totals;/);
});

test("applying a settlement cannot overdraw the settlement or the bill", () => {
  assert.match(settlement, /amountPaise > settlement\.remainingPaise/);
  assert.match(settlement, /amountPaise > billDuePaise/);
  assert.match(settlement, /code: "amount_exceeds_remaining"/);
  assert.match(settlement, /code: "amount_exceeds_bill"/);
});

test("applying a settlement moves the bill and closes at zero", () => {
  assert.match(settlement, /tx\.ledgerBill\.update/);
  assert.match(settlement, /paidAmountPaise: bill\.paidAmountPaise \+ amountPaise/);
  assert.match(settlement, /WalletSettlementStatus\.SETTLED/);
  assert.match(settlement, /const fullySettled = remainingPaise <= BigInt\(0\)/);
});

test("settlement writes are idempotent", () => {
  // A retried request must not settle the same money twice.
  assert.match(settlement, /Idempotency key is required/);
  assert.match(settlement, /walletSettlementApplication\.findUnique\(\{\s*where: \{ idempotencyKey \}/);
  assert.match(settlement, /duplicate: true/);
  assert.match(applyRoute, /idempotency-key/);
  assert.match(settlePage, /idempotency-key/);
});

test("settlement reads and writes are accountant-only", () => {
  assert.match(settlement, /actor\.role !== "ACCOUNTANT"/);
  for (const route of [listRoute, detailRoute, applyRoute]) {
    assert.match(route, /requireAuth\(\)/);
  }
});

test("schema and migration agree on the settlement tables", () => {
  assert.match(prismaSchema, /model WalletSettlement \{/);
  assert.match(prismaSchema, /model WalletSettlementApplication \{/);
  assert.match(prismaSchema, /enum WalletSettlementStatus \{/);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS "wallet_settlements"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "wallet_settlement_applications"/);
  // Prisma cannot express a partial unique index, so this guard lives only in
  // SQL: at most one OPEN settlement per dealer.
  assert.match(migration, /wallet_settlements_one_open_per_dealer/);
  assert.match(migration, /WHERE "status" = 'OPEN'/);
});

test("the settle screen shows what the accountant needs to act", () => {
  // Dealer name, id, previous wallet amount, and the settle balance.
  assert.match(settlePage, /Dealer ID/);
  assert.match(settlePage, /Prev\. wallet/);
  assert.match(settlePage, /Settle balance/);
  assert.match(settlePage, /Order \/ Invoice/);
});
