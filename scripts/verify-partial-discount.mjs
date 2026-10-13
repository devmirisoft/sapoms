// Selective discount approval: approved + standard lines become the order, rejected lines split off.
// Run: npm run test:partial-discount
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.PROJ_ROOT ??= resolvePath(HERE, '..');
register(pathToFileURL(resolvePath(HERE, 'invoice-ts-loader.mjs')).href);

const { buildOrderApprovalSnapshot, splitApprovalSnapshot } = await import('@/lib/customDiscountRequests');

// 10 lines at ₹1000 each, 10% base; lines 0-4 ask for 20%.
const products = Array.from({ length: 10 }, (_, i) => ({ sku: `OM${i}`, quantity: 1, packSize: 1, unitPrice: 1000 }));
const requested = Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`om${i}`, 20]));
const snapshot = buildOrderApprovalSnapshot({ products, baseDiscountPercent: 10, requestedProductDiscounts: requested });
assert.equal(snapshot.products.filter((p) => p.usesCustomDiscount).length, 5);

const { approved, rejected, standardOnly } = splitApprovalSnapshot(snapshot, [3, 4]);
assert.equal(standardOnly, false);
assert.equal(approved.products.length, 8);
assert.deepEqual(rejected.map((p) => p.sku), ['OM3', 'OM4']);
assert.equal(approved.grossAmount, 8000);
assert.equal(approved.baseDiscountAmount, 800);
assert.equal(approved.requestedAdditionalDiscountAmount, 300);
assert.equal(approved.requestedNetPayableAmount, 6900);

// Every requested line rejected: the 5 standard lines go ahead as a normal order at base discount.
const normal = splitApprovalSnapshot(snapshot, [0, 1, 2, 3, 4]);
assert.equal(normal.standardOnly, true);
assert.equal(normal.approved.products.length, 5);
assert.equal(normal.rejected.length, 5);
assert.equal(normal.approved.requestedAdditionalDiscountAmount, 0);
assert.equal(normal.approved.requestedNetPayableAmount, 4500);

const throws = (snap, indexes) => assert.throws(() => splitApprovalSnapshot(snap, indexes), (e) => e.status === 400);
throws(snapshot, []);   // nothing rejected
throws(snapshot, [7]);  // standard line
throws(snapshot, [42]); // out of range
// Only discount lines, all rejected: nothing left → use Reject.
const allCustom = buildOrderApprovalSnapshot({ products: products.slice(0, 2), baseDiscountPercent: 10, requestedProductDiscounts: requested });
throws(allCustom, [0, 1]);

console.log('partial discount split: ok');
