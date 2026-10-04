// Order pricing must come from the catalogue + server rules, never from the submission.
// Run: npm run test:order-pricing
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.PROJ_ROOT ??= resolvePath(HERE, '..');
register(pathToFileURL(resolvePath(HERE, 'invoice-ts-loader.mjs')).href);

const { priceDealerOrder } = await import('@/lib/dealerOrderCreate');

const dealer = { id: 1n, discountPercent: 10 };
const noRequests = { customDiscountRequest: { findMany: async () => [] } };
const rupees = (paise) => Number(paise) / 100;
const order = (rows, extra = {}) => ({ productorder: JSON.stringify(rows), ...extra });

// OM285-020: syringe filter, catalogue price ₹5200 per pack of 100.
const tampered = order(
  [{ catNo: 'OM285-020', productName: 'x', quantityPacks: '2', packSize: '1', unitPrice: '1', price: '1', listPriceTotal: '1', discountPercent: '99', discount: '9999', afterDiscountPrice: '1' }],
  { baseDiscountPercent: '100', allocatedDiscountPercent: '100', additionalDiscountType: 'slab', slabDiscountPercent: '50', couponDiscountPercent: '90', customDiscountAmount: '9999' },
);
let p = await priceDealerOrder(noRequests, tampered, dealer);
assert.equal(p.items[0].packSize, 100);
assert.equal(p.items[0].totalPieces, 200);
assert.equal(rupees(p.items[0].unitPricePaise), 52);
assert.equal(rupees(p.grossAmountPaise), 10400);
assert.equal(p.baseDiscountPercent, 10);
assert.equal(p.slabDiscountPercent, 0);
assert.equal(p.couponDiscountPercent, 0);
assert.equal(rupees(p.finalPayableAmountPaise), 9360);
assert.equal(p.items[0].discountPercent, 10);
assert.equal(rupees(p.items[0].finalAmountPaise), 9360);

// Coupons are re-validated by code; an unknown code is worth nothing, a known one is counted once.
p = await priceDealerOrder(noRequests, order([{ catNo: 'OM285-020', quantityPacks: 2 }], { coupon_code: 'FAKE99' }), dealer);
assert.equal(p.baseDiscountPercent, 10);
p = await priceDealerOrder(noRequests, order([{ catNo: 'OM285-020', quantityPacks: 2 }], { coupon_code: 'SAVE50' }), dealer);
assert.equal(p.baseDiscountPercent, 60);
assert.equal(rupees(p.finalPayableAmountPaise), 4160);

// Slab comes from the table: 60 packs = ₹3,12,000 gross, ₹2,80,800 after base -> 2%.
p = await priceDealerOrder(noRequests, order([{ catNo: 'OM285-020', quantityPacks: 60 }]), dealer);
assert.equal(p.slabDiscountPercent, 2);
assert.equal(rupees(p.finalPayableAmountPaise), 275184);

// An approved custom request replaces the slab; its amount comes from the DB row.
const approved = { customDiscountRequest: { findMany: async () => [{ id: 7n, scope: 'ORDER', requestedOrderDiscountPercent: 15, requestedDiscountPercent: 15, requestedDiscountAmountPaise: 52000n }] } };
p = await priceDealerOrder(approved, order([{ catNo: 'OM285-020', quantityPacks: 2 }], { customDiscountRequestId: '7' }), dealer);
assert.equal(p.additionalDiscountType, 'CUSTOM');
assert.equal(p.slabDiscountPercent, 0);
assert.equal(rupees(p.finalPayableAmountPaise), 10400 - 1040 - 520);
assert.equal(p.items[0].discountPercent, 15);

await assert.rejects(priceDealerOrder(noRequests, order([{ catNo: 'NOPE-404', quantityPacks: 1 }]), dealer), { code: 'unknown_product' });
await assert.rejects(priceDealerOrder(noRequests, order([{ catNo: 'OM285-020', quantityPacks: 0 }]), dealer), { code: 'invalid_quantity' });

// A custom-discount request snapshot (what an approved request places) is repriced the same way.
// Uses the real dealer row (AGENT_CHECK_DEALER_ID, default 1) for the base discount.
const { buildCustomDiscountCreate } = await import('@/lib/postgresDiscountDrafts');
const { prisma } = await import('@/server/db/prisma');
const dealerId = BigInt(process.env.AGENT_CHECK_DEALER_ID ?? 1);
const base = Number((await prisma.dealerProfile.findUnique({ where: { id: dealerId } })).discountPercent ?? 0);
const req = await buildCustomDiscountCreate({
  orderDraftId: '1', discountScope: 'order', requestedDiscountPercent: base + 5, currentDiscountPercent: 99,
  products: [{ sku: 'OM285-020', productKey: 'om285-020', quantity: 2, packSize: 1, unitPrice: 1, grossAmount: 1 }],
}, dealerId, null);
const snap = req.orderSnapshot;
assert.equal(Number(req.currentDiscountPercent), base);
assert.equal(snap.grossAmount, 10400);
assert.equal(snap.products[0].packSize, 100);
assert.equal(snap.requestedNetPayableAmount, Math.round(10400 * (1 - (base + 5) / 100) * 100) / 100);
await assert.rejects(buildCustomDiscountCreate({ orderDraftId: '1', discountScope: 'order', requestedDiscountPercent: 50, products: [{ sku: 'NOPE-404', quantity: 1 }] }, dealerId, null), { status: 422 });

console.log('order pricing ok');
process.exit(0);
