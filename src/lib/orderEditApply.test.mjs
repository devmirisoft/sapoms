import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;
const transpile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;

// Stubs record what applyOrderEdit asks of credit, wallet and the catalogue on globalThis.__edit.
const stubs = {
  "server-only": "",
  "@prisma/client": 'export const Prisma = { Decimal: class { constructor(v) { this.value = String(v); } } }; export const WalletTransactionType = { ORDER_DEBIT: "ORDER_DEBIT", REFUND: "REFUND" };',
  "@/lib/dealerCreditLimit": "export async function reserveDealerCredit(tx, dealerId, paise) { globalThis.__edit.credit.push({ dealerId, paise }); return globalThis.__edit.creditBlock ?? null; }",
  "@/lib/dealerOrderCreate": 'export class OrderError extends Error { constructor(message, status = 400, code = "order_error") { super(message); this.status = status; this.code = code; } } export function parseItems(rows) { globalThis.__edit.parsed.push(rows); return rows.map((row) => ({ ...globalThis.__edit.catalogue[row.catNo], quantityPacks: row.quantityPacks, listPriceTotalPaise: globalThis.__edit.catalogue[row.catNo].packPricePaise * BigInt(row.quantityPacks), saleDiscountPercent: 0, saleSavedPaise: 0n })); }',
  "@/lib/orderOverlays": "export class OrderOverlayError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }",
  "@/lib/orderRejectionDrafts": "export async function walletDebitRemaining() { return globalThis.__edit.walletRemaining; }",
  "@/lib/postgresWallet": 'export class WalletError extends Error { constructor(message, status = 400, code = "wallet_error") { super(message); this.status = status; this.code = code; } } export async function applyWalletChange(tx, dealerId, type, amount, options) { globalThis.__edit.wallet.push({ dealerId, type, amount, key: options.idempotencyKey }); }',
  "@/server/modules/products/catalogue": "export async function loadCatalogue() { return { index: {} }; }",
  "@/server/todays-sale": "export async function liveSalePercents() { return new Map(); }",
};

async function loadApplyOrderEdit() {
  const totalsSource = (await fs.readFile(path.resolve("src/lib/orderTotals.ts"), "utf8"))
    .replace(/from\s+["']@\/lib\/customDiscountRequests["']/, `from "${dataUrl('export function normalizeApprovalProductKey(v) { return String(v ?? "").trim().toLowerCase(); }')}"`)
    .replace(/from\s+["']@\/lib\/discount["']/, `from "${pathToFileURL(path.resolve("src/lib/discount.js")).href}"`);
  let source = (await fs.readFile(path.resolve("src/lib/orderEditApply.ts"), "utf8"))
    .replace(/from\s+["']@\/lib\/orderTotals["']/, `from "${dataUrl(transpile(totalsSource))}"`);
  for (const [specifier, code] of Object.entries(stubs)) {
    source = source.replace(new RegExp(`(import\\s+|from\\s+)["']${specifier.replace(/[/@-]/g, "\\$&")}["']`), `$1"${dataUrl(code)}"`);
  }
  return import(dataUrl(transpile(source)));
}

const { applyOrderEdit } = await loadApplyOrderEdit();

function setup({ creditDays = 30, walletRemaining = 0n, creditBlock = null, approvedCustom = 0, items } = {}) {
  globalThis.__edit = { credit: [], wallet: [], parsed: [], creditBlock, walletRemaining, catalogue: {
    "OM262-020": { catNo: "OM262-020", productName: "Nylon Syringe Filters 50", packSize: 50, priceBasis: "pack", unitPricePaise: 6800n, packPricePaise: 340000n },
  } };
  const order = {
    id: 500n, dealerId: 137n, orderNumber: "OM/26-27/DMS-1017", baseDiscountPercent: "50", finalPayableAmountPaise: 480000n,
    dealer: { creditDays },
    items: items ?? [
      { id: 9001n, legacyPhpOrderItemId: null, catalogueNumberSnapshot: "OM260-020", productNameSnapshot: "Nylon Syringe Filters", quantityPacks: 2, packSize: 100, priceBasis: "pack", unitPricePaise: 4800n, packPricePaise: 480000n, listPriceTotalPaise: 960000n, saleDiscountPercent: "0" },
    ],
  };
  const calls = { orderUpdate: [], itemUpdate: [], itemDeleteMany: [] };
  const tx = {
    order: { findUniqueOrThrow: async () => order, update: async (args) => { calls.orderUpdate.push(args); } },
    customDiscountRequest: { count: async () => approvedCustom },
    orderItem: { update: async (args) => { calls.itemUpdate.push(args); }, deleteMany: async (args) => { calls.itemDeleteMany.push(args); } },
  };
  return { tx, calls };
}

const revisionWith = (effectiveItems) => ({ revision: 1, effectiveItems, changes: [], totals: { grossAmount: 0, discountAmount: 0, netPayableAmount: 0 } });

test("raising the quantity reserves the extra credit and rewrites gross, base discount and final on the order", async () => {
  const { tx, calls } = setup();
  const { revision, delta } = await applyOrderEdit(tx, 500n, revisionWith([{ orderdata_id: "9001", orderdata_cat_no: "OM260-020", quantityPacks: 4 }]));

  assert.equal(delta, 480000n);
  assert.deepEqual(globalThis.__edit.credit, [{ dealerId: 137n, paise: 480000n }]);
  const data = calls.orderUpdate[0].data;
  assert.equal(data.grossAmountPaise, 1920000n);
  assert.equal(data.baseDiscountAmountPaise, 960000n);
  assert.equal(data.finalPayableAmountPaise, 960000n);
  assert.equal(calls.itemUpdate[0].data.quantityPacks, 4);
  assert.equal(calls.itemUpdate[0].data.totalPieces, 400);
  assert.equal(calls.itemUpdate[0].data.listPriceTotalPaise, 1920000n);
  assert.equal(revision.totals.netPayableAmount, 9600);
  assert.equal(revision.effectiveItems[0].packSize, 100);
});

test("a credit block stops the edit before anything is written", async () => {
  const { tx, calls } = setup({ creditBlock: { code: "credit_limit_exceeded", message: "Credit limit exceeded." } });
  await assert.rejects(
    applyOrderEdit(tx, 500n, revisionWith([{ orderdata_id: "9001", orderdata_cat_no: "OM260-020", quantityPacks: 40 }])),
    (error) => error.code === "credit_limit_exceeded" && error.status === 409,
  );
  assert.equal(calls.orderUpdate.length, 0);
  assert.equal(calls.itemUpdate.length, 0);
});

test("a wallet dealer pays the increase and is refunded a decrease", async () => {
  const up = setup({ creditDays: null, walletRemaining: 480000n });
  await applyOrderEdit(up.tx, 500n, revisionWith([{ orderdata_id: "9001", orderdata_cat_no: "OM260-020", quantityPacks: 4 }]));
  assert.deepEqual(globalThis.__edit.wallet, [{ dealerId: 137n, type: "ORDER_DEBIT", amount: 4800, key: "order:500:edit-r1" }]);

  const down = setup({ creditDays: null, walletRemaining: 480000n });
  await applyOrderEdit(down.tx, 500n, revisionWith([{ orderdata_id: "9001", orderdata_cat_no: "OM260-020", quantityPacks: 1 }]));
  assert.deepEqual(globalThis.__edit.wallet, [{ dealerId: 137n, type: "REFUND", amount: 2400, key: "order:500:edit-r1" }]);
  assert.equal(globalThis.__edit.credit.length, 0);
});

test("an order with an approved custom discount cannot be edited", async () => {
  const { tx, calls } = setup({ approvedCustom: 1 });
  await assert.rejects(
    applyOrderEdit(tx, 500n, revisionWith([{ orderdata_id: "9001", orderdata_cat_no: "OM260-020", quantityPacks: 4 }])),
    (error) => error.code === "custom_discount_order",
  );
  assert.equal(calls.orderUpdate.length, 0);
});

test("a removed line is deleted and a swapped catalogue number is priced from the catalogue", async () => {
  const { tx, calls } = setup({ items: [
    { id: 9001n, legacyPhpOrderItemId: null, catalogueNumberSnapshot: "OM260-020", productNameSnapshot: "Nylon 100", quantityPacks: 2, packSize: 100, priceBasis: "pack", unitPricePaise: 4800n, packPricePaise: 480000n, listPriceTotalPaise: 960000n, saleDiscountPercent: "0" },
    { id: 9002n, legacyPhpOrderItemId: "77", catalogueNumberSnapshot: "92/1", productNameSnapshot: "Legacy line", quantityPacks: 1, packSize: 10, priceBasis: null, unitPricePaise: 16900n, packPricePaise: 0n, listPriceTotalPaise: 67600n, saleDiscountPercent: "0" },
  ] });
  await applyOrderEdit(tx, 500n, revisionWith([{ orderdata_id: "9001", orderdata_cat_no: "OM262-020", quantityPacks: 1 }]));

  assert.deepEqual(calls.itemDeleteMany[0].where.id.in, [9002n]);
  const swapped = calls.itemUpdate[0].data;
  assert.equal(swapped.catalogueNumberSnapshot, "OM262-020");
  assert.equal(swapped.packSize, 50);
  assert.equal(swapped.listPriceTotalPaise, 340000n);
  assert.equal(calls.orderUpdate[0].data.grossAmountPaise, 340000n);
});

test("a legacy line without a stored pack price keeps the price it was charged at", async () => {
  const { tx, calls } = setup({ items: [
    { id: 9002n, legacyPhpOrderItemId: "77", catalogueNumberSnapshot: "92/1", productNameSnapshot: "Legacy line", quantityPacks: 1, packSize: 10, priceBasis: null, unitPricePaise: 16900n, packPricePaise: 0n, listPriceTotalPaise: 67600n, saleDiscountPercent: "0" },
  ] });
  await applyOrderEdit(tx, 500n, revisionWith([{ orderdata_id: "77", orderdata_cat_no: "92/1", quantityPacks: 3 }]));
  assert.equal(calls.itemUpdate[0].data.packPricePaise, 67600n);
  assert.equal(calls.itemUpdate[0].data.listPriceTotalPaise, 202800n);
});
