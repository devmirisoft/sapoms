// End-to-end check of the agent's order tools and the draft -> confirm flow, against the DB.
// WRITES REAL ROWS: it places one order and raises one custom-discount request for the order
// dealer, then cancels both (as that dealer) and prints their ids. Dev databases only.
// Run: npm run agent:e2e-check
//   AGENT_CHECK_READ_DEALER_ID  dealer with existing orders (default 20)
//   AGENT_CHECK_ORDER_DEALER_ID active credit dealer with headroom and nothing overdue (default 35)
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.PROJ_ROOT ??= resolvePath(HERE, '..');
register(pathToFileURL(resolvePath(HERE, 'invoice-ts-loader.mjs')).href);

const { prisma } = await import('@/server/db/prisma');
const { toolHandlers } = await import('@/lib/agent/tools');
const { confirmDraft, cancelDraft } = await import('@/lib/agent/drafts');
const { cancelPostgresOrder } = await import('@/lib/postgresOrderStatus');

const readDealer = BigInt(process.env.AGENT_CHECK_READ_DEALER_ID ?? 20);
const orderDealer = BigInt(process.env.AGENT_CHECK_ORDER_DEALER_ID ?? 35);
const call = (name, args, dealerId) => toolHandlers[name].handler(toolHandlers[name].argsSchema.parse(args), { dealerId });
const dealerUser = await prisma.dealerProfile.findUniqueOrThrow({ where: { id: orderDealer }, include: { user: true } });
const actor = { userId: dealerUser.userId, role: 'DEALER', displayName: dealerUser.businessName, sessionId: null };
const created = { orders: [], requests: [], orderDrafts: [] };

// ── Read tools ───────────────────────────────────────────────────────────────
const orders = await call('get_orders', { limit: 5 }, readDealer);
console.log('get_orders', orders.orders.slice(0, 2), 'hasMore', orders.hasMore);
assert.ok(orders.orders.length > 0 && orders.orders.length <= 5);
assert.ok(orders.orders.every((o) => o.orderId && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && typeof o.total === 'number'));

const awaiting = await call('get_orders', { status: 'awaiting_approval' }, readDealer);
assert.ok(awaiting.orders.every((o) => o.status === 'Awaiting approval'));

const full = orders.orders[0].orderId;
const status = await call('get_order_status', { orderId: full }, readDealer);
console.log('get_order_status', { ...status, items: status.items.length });
assert.equal(status.orderId, full);
const suffix = full.split('/').pop();
assert.equal((await call('get_order_status', { orderId: suffix }, readDealer)).orderId, full);
assert.equal((await call('get_order_status', { orderId: String(Number(suffix.replace(/\D/g, ''))) }, readDealer)).orderId, full);
// Another dealer's order is indistinguishable from a missing one.
assert.equal((await call('get_order_status', { orderId: full }, orderDealer)).error, 'ORDER_NOT_FOUND');
assert.equal((await call('get_orders', {}, orderDealer)).orders.some((o) => o.orderId === full), false);

const ledger = await call('get_ledger_summary', {}, readDealer);
console.log('get_ledger_summary', ledger);
assert.equal(ledger.accountType, 'credit');

// ── Drafts ───────────────────────────────────────────────────────────────────
if (ledger.overdue) {
  assert.equal((await call('draft_order', { items: [{ productId: 'OM285-020', packs: 1 }] }, readDealer)).error, 'CREDIT_OVERDUE');
}
assert.equal((await call('draft_order', { items: [{ productId: 'NOPE-404', packs: 1 }] }, orderDealer)).error, 'INVALID_ITEMS');
assert.throws(() => toolHandlers.draft_order.argsSchema.parse({ items: [{ productId: 'OM285-020', packs: 1 }], customDiscount: { percent: 3, amount: 100 } }));

const base = Number(dealerUser.discountPercent ?? 0);
const draft = await call('draft_order', { items: [{ productId: 'OM285-020', packs: 1 }, { productId: 'OM285-020', packs: 1 }] }, orderDealer);
console.log('draft_order', draft);
assert.equal(draft.items.length, 1, 'duplicate lines merge');
assert.equal(draft.items[0].packs, 2);
assert.equal(draft.subtotal, 10400);
assert.equal(draft.total, Math.round(10400 * (1 - base / 100) * 100) / 100);

try {
  // Someone else's draft is not found.
  assert.equal((await confirmDraft(draft.draftId, readDealer, actor)).status, 404);

  // Double click: both land at once, exactly one order.
  const [a, b] = await Promise.all([confirmDraft(draft.draftId, orderDealer, actor), confirmDraft(draft.draftId, orderDealer, actor)]);
  console.log('double confirm', a, b);
  const placed = [a, b].find((r) => r.status === 200 && r.body.status === 'ORDER_PLACED');
  assert.ok(placed, 'one confirm places the order');
  created.orders.push(placed.body.orderNumber);
  assert.ok([a, b].every((r) => (r.status === 200 && r.body.orderNumber === placed.body.orderNumber) || (r.status === 409 && r.body.error === 'IN_PROGRESS')));
  assert.equal(await prisma.order.count({ where: { idempotencyKey: `agent-draft:${draft.draftId}` } }), 1);
  const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: placed.body.orderNumber } });
  assert.equal(Number(order.finalPayableAmountPaise) / 100, draft.total, 'order charged what the card showed');
  // Confirming again just answers with the same order.
  assert.deepEqual((await confirmDraft(draft.draftId, orderDealer, actor)).body, placed.body);

  // Price changed under the dealer: refused with the new figures, never placed silently.
  const stale = await call('draft_order', { items: [{ productId: 'OM285-020', packs: 1 }] }, orderDealer);
  await prisma.agentDraft.update({ where: { id: stale.draftId }, data: { payablePaise: 1n } });
  const changed = await confirmDraft(stale.draftId, orderDealer, actor);
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error, 'PRICE_CHANGED');
  assert.equal(changed.body.draft.total, stale.total);
  assert.equal((await cancelDraft(stale.draftId, orderDealer)).body.status, 'CANCELLED');
  assert.equal((await confirmDraft(stale.draftId, orderDealer, actor)).body.error, 'DRAFT_CANCELLED');

  // Expired drafts cannot be confirmed.
  const old = await call('draft_order', { items: [{ productId: 'OM285-020', packs: 1 }] }, orderDealer);
  await prisma.agentDraft.update({ where: { id: old.draftId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await confirmDraft(old.draftId, orderDealer, actor)).body.error, 'DRAFT_EXPIRED');

  // "₹100 off" becomes the equivalent % on the net; "3%" stacks on the dealer's discount.
  const byAmount = await call('draft_order', { items: [{ productId: 'OM285-020', packs: 2 }], customDiscount: { amount: 100 } }, orderDealer);
  console.log('amount ask', byAmount.customDiscount);
  assert.ok(Math.abs(byAmount.customDiscount.extraDiscount - 100) < 1);
  await cancelDraft(byAmount.draftId, orderDealer);

  const ask = await call('draft_order', { items: [{ productId: 'OM285-020', packs: 2 }], customDiscount: { percent: 3 } }, orderDealer);
  console.log('percent ask', ask.customDiscount);
  const totalPercent = Math.round((base + (100 - base) * 0.03) * 100) / 100;
  assert.equal(ask.customDiscount.totalPercent, totalPercent);
  assert.equal(ask.customDiscount.totalIfApproved, Math.round(10400 * (1 - totalPercent / 100) * 100) / 100);
  const requested = await confirmDraft(ask.draftId, orderDealer, actor);
  console.log('discount confirm', requested);
  assert.equal(requested.body.status, 'DISCOUNT_REQUESTED');
  const request = await prisma.customDiscountRequest.findUniqueOrThrow({ where: { id: BigInt(requested.body.requestId) } });
  created.requests.push(request.id);
  created.orderDrafts.push(request.orderDraftId);
  assert.equal(request.status, 'PENDING');
  assert.equal(Number(request.requestedDiscountPercent), totalPercent);
  assert.equal(Number(request.requestedNetPayableAmountPaise) / 100, ask.customDiscount.totalIfApproved, 'reviewers see what the dealer saw');
  const orderDraft = await prisma.orderDraft.findUniqueOrThrow({ where: { id: request.orderDraftId } });
  assert.equal(orderDraft.snapshot.rows[0].variantCode, 'OM285-020');
  assert.equal(orderDraft.approvalState.status, 'pending');

  console.log('\nagent e2e check: OK');
} finally {
  // Undo the real rows as the dealer would: cancel the order, close the request and its draft.
  const authActor = { ...actor, dealerId: orderDealer, profileId: orderDealer, email: dealerUser.user.email };
  for (const orderNumber of created.orders) await cancelPostgresOrder(orderNumber, authActor, 'Ordering assistant automated test').catch((e) => console.error('cancel failed', orderNumber, e.message));
  if (created.requests.length) await prisma.customDiscountRequest.updateMany({ where: { id: { in: created.requests } }, data: { status: 'CANCELLED', adminNote: 'Ordering assistant automated test' } });
  if (created.orderDrafts.length) await prisma.orderDraft.updateMany({ where: { id: { in: created.orderDrafts } }, data: { status: 'CANCELLED' } });
  console.log('test rows (cancelled):', { orders: created.orders, discountRequests: created.requests.map(String), orderDrafts: created.orderDrafts.map(String) });
  await prisma.$disconnect();
}
process.exit(0);
