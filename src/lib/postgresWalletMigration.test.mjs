import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const walletHelper = readFileSync(new URL("./postgresWallet.ts", import.meta.url), "utf8");
const walletRoute = readFileSync(new URL("../app/api/wallet/[dealerId]/route.ts", import.meta.url), "utf8");
const walletAdjustRoute = readFileSync(new URL("../app/api/wallet/[dealerId]/adjust/route.ts", import.meta.url), "utf8");
/* The order route delegates creation and the wallet debit to this shared
   service, which the fund-request funding path calls too, so the PostgreSQL
   wallet guarantees are asserted where the code actually lives. */
const dealerOrderRoute = readFileSync(new URL("./dealerOrderCreate.ts", import.meta.url), "utf8");

test("wallet routes use JWT auth and Prisma instead of Mongo", () => {
  for (const source of [walletRoute, walletAdjustRoute]) {
    assert.match(source, /requireAuth/);
    assert.match(source, /prisma/);
    assert.doesNotMatch(source, /getDb|mongodb|walletUtils|parseOrderActor|x-omsons-actor/i);
  }
});

test("wallet read permissions cover admin, own dealer, assigned staff, and block others", () => {
  assert.match(walletRoute, /actor\.role === "ADMIN"/);
  assert.match(walletRoute, /actor\.role === "DEALER"/);
  assert.match(walletRoute, /actor\.dealerId === dealerId/);
  assert.match(walletRoute, /actor\.role === "STAFF"/);
  assert.match(walletRoute, /dealerStaffAssignment\.findFirst/);
  assert.match(walletRoute, /active: true/);
  assert.match(walletRoute, /status: "ACTIVE"/);
});

test("admin adjustment route supports credit, debit, adjustment, refund and blocks non-admin mutation", () => {
  assert.match(walletAdjustRoute, /actor\.role !== "ADMIN"/);
  assert.match(walletAdjustRoute, /WalletTransactionType\.CREDIT/);
  assert.match(walletAdjustRoute, /WalletTransactionType\.DEBIT/);
  assert.match(walletAdjustRoute, /WalletTransactionType\.REFUND/);
  assert.match(walletAdjustRoute, /applyWalletAdjustment/);
  assert.match(walletAdjustRoute, /idempotency-key/);
});

test("wallet mutations are guarded against negative and concurrent balance changes", () => {
  assert.match(walletHelper, /nextBalance < BigInt\(0\)/);
  assert.match(walletHelper, /Insufficient wallet balance/);
  assert.match(walletHelper, /UPDATE dealer_wallets/);
  assert.match(walletHelper, /AND balance_paise =/);
  assert.match(walletHelper, /wallet_conflict/);
  assert.match(walletHelper, /walletTransaction\.create/);
});

test("order debit uses PostgreSQL wallet transaction history and no Mongo reservation calls", () => {
  assert.match(dealerOrderRoute, /applyWalletChange/);
  assert.match(dealerOrderRoute, /WalletTransactionType\.ORDER_DEBIT/);
  assert.match(walletHelper, /total_consumed_paise/);
  assert.match(dealerOrderRoute, /walletDebit\.transaction/);
  assert.doesNotMatch(dealerOrderRoute, /reserveOrderFunds|finalizeOrderDebit|releaseOrderReservation|getDb|mongodb/i);
});

test("response aliases are preserved for frontend wallet consumers", () => {
  for (const alias of ["availableBalance", "totalConsumed", "status", "transactions", "balanceBefore", "balanceAfter"]) {
    assert.match(walletHelper, new RegExp(alias));
  }
});
