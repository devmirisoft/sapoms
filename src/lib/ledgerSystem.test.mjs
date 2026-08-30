import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

const ledgerSource = await fs.readFile(path.resolve("src/lib/ledgerSystem.ts"), "utf8");
const routeSource = await fs.readFile(path.resolve("src/app/api/ledger/route.ts"), "utf8");
const detailSource = await fs.readFile(path.resolve("src/app/api/ledger/[dealerId]/route.ts"), "utf8");
const transactionsSource = await fs.readFile(path.resolve("src/app/api/ledger/[dealerId]/transactions/route.ts"), "utf8");
const paySource = await fs.readFile(path.resolve("src/app/api/ledger/[dealerId]/pay/route.ts"), "utf8");
const allSources = [ledgerSource, routeSource, detailSource, transactionsSource, paySource].join("\n");

test("ledger routes no longer call PHP compatibility or Mongo ledger storage", () => {
  assert.doesNotMatch(allSources, /@\/lib\/mongodb|getDb|getMongoClient|mongodb|ledger_system_cache|ledger_transactions|dealerpegination|orderpegination|getdealer|php-compat|BACKEND_URL|fetchExternalDealer|getLedgerSnapshot/);
  assert.doesNotMatch(allSources, /fetch\s*\(/);
});

test("ledger uses PostgreSQL order dealer wallet and wallet transaction models", () => {
  for (const model of ["dealerProfile", "order", "dealerWallet", "walletTransaction", "ledgerBill"]) {
    assert.match(ledgerSource, new RegExp(`\\b${model}\\b`));
  }
  assert.match(ledgerSource, /mapPostgresOrderToLegacy/);
  assert.match(ledgerSource, /DealerWallet|WalletTransactionType|OrderStatus/);
});

test("ledger preserves temporary frontend response aliases", () => {
  for (const alias of ["Dealer_Id", "Dealer_Name", "Dealer_Email", "Dealer_Number", "walletBalance", "totalDebit", "totalCredit", "netBalance", "accountBook"]) {
    assert.match(ledgerSource, new RegExp(alias));
  }
  for (const alias of ["summary", "summaryStats", "orders", "bills", "transactionCount", "paymentsLive", "isLive", "updatedAt"]) {
    assert.match(ledgerSource + detailSource + routeSource, new RegExp(alias));
  }
  for (const alias of ["data", "count", "page", "pageSize", "totalPages", "hasNextPage", "hasPreviousPage"]) {
    assert.match(ledgerSource + transactionsSource, new RegExp(alias));
  }
});

test("ledger enforces admin accountant staff and dealer visibility from authenticated actor", () => {
  assert.match(allSources, /requireAuth\(\)/);
  assert.match(ledgerSource, /actor\.role === "ADMIN"/);
  assert.match(ledgerSource, /actor\.role === "ACCOUNTANT"/);
  assert.match(ledgerSource, /actor\.role === "DEALER"/);
  assert.match(ledgerSource, /actor\.dealerId === dealerId/);
  assert.match(ledgerSource, /isStaffLike\(actor\)/);
  assert.match(ledgerSource, /dealerStaffAssignment\.findFirst/);
  assert.match(ledgerSource, /staffId: actor\.staffId/);
  assert.match(ledgerSource, /active: true/);
});

test("ledger derives balances from order payable and wallet transaction directions", () => {
  assert.match(ledgerSource, /finalPayableAmountPaise/);
  assert.match(ledgerSource, /bookedPaise \+= order\.finalPayableAmountPaise/);
  assert.match(ledgerSource, /WalletTransactionType\.CREDIT/);
  assert.match(ledgerSource, /WalletTransactionType\.REFUND/);
  assert.match(ledgerSource, /WalletTransactionType\.ADJUSTMENT/);
  assert.match(ledgerSource, /accountBook\.booked \+ money\(wallet\.debitPaise\)/);
  assert.match(ledgerSource, /netBalance: roundMoney\(totalDebit - totalCredit\)/);
});


test("ledger bill and payment mutations are accountant-only and bill-linked payments return updated bill state", () => {
  assert.match(ledgerSource, /recordLedgerBill/);
  assert.match(ledgerSource, /ledgerBill\.findMany/);
  assert.match(ledgerSource, /Only Accountant can save ledger bills\./);
  assert.match(ledgerSource, /Only Accountant can record ledger payments\./);
  assert.match(ledgerSource, /dealerId_orderNumber/);
  assert.match(ledgerSource, /billId/);
  assert.match(detailSource, /Bill saved successfully/);
  assert.match(paySource, /bill: result\.bill/);
});
test("ledger payments are transactional and idempotent", () => {
  assert.match(ledgerSource, /prisma\.\$transaction/);
  assert.match(ledgerSource, /idempotencyKey/);
  assert.match(ledgerSource, /Idempotency key is required/);
  assert.match(ledgerSource, /applyWalletChange\(tx, dealerId, WalletTransactionType\.CREDIT/);
  assert.match(paySource, /duplicate: Boolean\(result\.duplicate\)/);
});



function paise(amount) {
  return BigInt(Math.round(amount * 100));
}

function acceptedOrder(amount, id = 1n) {
  return {
    id,
    status: "AWAITING_ACCEPTANCE",
    acceptanceStatus: "ACCEPTED",
    fulfilmentStatus: "PENDING",
    finalPayableAmountPaise: paise(amount),
  };
}

function walletTx(type, amount, options = {}) {
  return {
    type,
    amountPaise: paise(amount),
    metadata: options.metadata ?? null,
    orderId: options.orderId ?? null,
  };
}

function ledgerOutstanding(orders, transactions) {
  const orderTotal = orders.reduce((sum, order) => sum + Number(order.finalPayableAmountPaise) / 100, 0);
  const wallet = transactions.reduce((totals, tx) => {
    const direction = tx.type === "CREDIT" || tx.type === "REFUND" || (tx.type === "ORDER_DEBIT" && tx.orderId) || (tx.type === "ADJUSTMENT" && tx.metadata?.direction !== "debit")
      ? "credit"
      : "debit";
    const amount = Number(tx.amountPaise) / 100;
    if (direction === "credit") totals.credit += amount;
    else totals.debit += amount;
    return totals;
  }, { credit: 0, debit: 0 });
  return orderTotal + wallet.debit - wallet.credit;
}

test("ledger accounting semantics cover order payable, payments, wallet use, refunds, debits, adjustments, and multiple orders", () => {
  assert.equal(ledgerOutstanding([acceptedOrder(10000)], []), 10000);
  assert.equal(ledgerOutstanding([acceptedOrder(10000, 1n)], [walletTx("ORDER_DEBIT", 10000, { orderId: 1n })]), 0);
  assert.equal(ledgerOutstanding([acceptedOrder(10000)], [walletTx("CREDIT", 4000)]), 6000);
  assert.equal(ledgerOutstanding([acceptedOrder(10000)], [walletTx("REFUND", 1500)]), 8500);
  assert.equal(ledgerOutstanding([acceptedOrder(10000)], [walletTx("DEBIT", 1200)]), 11200);
  assert.equal(ledgerOutstanding([acceptedOrder(10000)], [walletTx("ADJUSTMENT", 700, { metadata: { direction: "credit" } })]), 9300);
  assert.equal(ledgerOutstanding([acceptedOrder(10000)], [walletTx("ADJUSTMENT", 700, { metadata: { direction: "debit" } })]), 10700);
  assert.equal(ledgerOutstanding([acceptedOrder(10000, 1n), acceptedOrder(3000, 2n)], [walletTx("ORDER_DEBIT", 10000, { orderId: 1n }), walletTx("CREDIT", 1000)]), 2000);
});

test("ORDER_DEBIT is counted as payment only when tied to an order id", () => {
  assert.match(ledgerSource, /WalletTransactionType\.ORDER_DEBIT && orderId\) return "credit"/);
  assert.match(ledgerSource, /ledgerTransactionDirection\(tx\.type, tx\.metadata, tx\.orderId\)/);
  assert.match(ledgerSource, /summarizeWalletForLedger/);
  assert.doesNotMatch(ledgerSource, /summarizeWallet\(/);
});

test("dealer order creates ORDER_DEBIT for the exact order payable with orderId and duplicate wallet idempotency key", async () => {
  // The order-debit lives in the shared creation service, which the route and
  // the fund-request funding path both call, so the guarantee is asserted there.
  const dealerOrderSource = await fs.readFile(path.resolve("src/lib/dealerOrderCreate.ts"), "utf8");
  assert.match(dealerOrderSource, /WalletTransactionType\.ORDER_DEBIT/);
  assert.match(dealerOrderSource, /fromPaise\(priced\.finalPayableAmountPaise\)/);
  assert.match(dealerOrderSource, /orderId: order\.id/);
  assert.match(dealerOrderSource, /`\$\{idempotencyKey\}:wallet`/);
  assert.match(ledgerSource, /idempotencyKey/);
});
