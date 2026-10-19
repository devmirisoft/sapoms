import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;

const stubs = {
  "server-only": "",
  "@prisma/client": 'export const Prisma = {}; export const WalletTransactionType = { ORDER_DEBIT: "ORDER_DEBIT", REFUND: "REFUND" };',
  "@/lib/postgresWallet": "export async function applyWalletChange(tx, dealerId, type, amount, options) { globalThis.__refunds.push({ dealerId, type, amount, key: options.idempotencyKey, note: options.note }); return { amount }; }",
  "@/lib/orderRejectionDraft.mjs": 'export function buildOrderRejectionSnapshot() { return {}; } export const ORDER_REJECTION_SOURCE = "order_rejection";',
};

async function loadRefunds() {
  let source = await fs.readFile(path.resolve("src/lib/orderRejectionDrafts.ts"), "utf8");
  for (const [specifier, code] of Object.entries(stubs)) {
    source = source.replace(new RegExp(`(import\\s+|from\\s+)["']${specifier.replace(/[/@.-]/g, "\\$&")}["']`), `$1"${dataUrl(code)}"`);
  }
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(dataUrl(js));
}

const { refundOrderWallet } = await loadRefunds();
const order = { id: 500n, dealerId: 137n, orderNumber: "OM/26-27/DMS-1017" };

function walletWith(rows) {
  globalThis.__refunds = [];
  return { walletTransaction: { findMany: async ({ where }) => rows.filter((row) => where.orderId === 500n && where.type.in.includes(row.type)) } };
}

test("cancelling refunds the order's wallet debit in full", async () => {
  await refundOrderWallet(walletWith([{ type: "ORDER_DEBIT", amountPaise: 100000n }]), order, "cancel");
  assert.deepEqual(globalThis.__refunds, [{ dealerId: 137n, type: "REFUND", amount: 1000, key: "order:500:cancel-refund", note: "Refund for cancelled order" }]);
});

test("a declined order that is cancelled later is not refunded twice", async () => {
  const result = await refundOrderWallet(walletWith([{ type: "ORDER_DEBIT", amountPaise: 100000n }, { type: "REFUND", amountPaise: 100000n }]), order, "cancel");
  assert.equal(result, null);
  assert.equal(globalThis.__refunds.length, 0);
});

test("money taken by an edit is refunded with the original debit", async () => {
  await refundOrderWallet(walletWith([{ type: "ORDER_DEBIT", amountPaise: 100000n }, { type: "ORDER_DEBIT", amountPaise: 50000n }, { type: "REFUND", amountPaise: 20000n }]), order, "cancel");
  assert.equal(globalThis.__refunds[0].amount, 1300);
});

test("an order the wallet never paid for refunds nothing", async () => {
  assert.equal(await refundOrderWallet(walletWith([]), order, "decline"), null);
  assert.equal(globalThis.__refunds.length, 0);
});

test("the decline refund keeps its existing idempotency key", async () => {
  await refundOrderWallet(walletWith([{ type: "ORDER_DEBIT", amountPaise: 100000n }]), order, "decline");
  assert.equal(globalThis.__refunds[0].key, "order:500:decline-refund");
});
