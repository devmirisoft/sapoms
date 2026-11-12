// Integration test for the product catalogue enable/disable toggle, run against a real,
// throwaway Postgres database (created, migrated, seeded, then dropped).
// Each check names the section of the feature proposal it proves.
//
// Run: IT_DATABASE_URL=postgresql://user:pass@localhost:5432/anydb npm run test:product-disable
//   IT_DATABASE_URL  any database on a LOCAL server (used only to CREATE/DROP the test DB)
//   IT_KEEP_DB=1     keep the seeded DB afterwards (for a manual UI pass) and print its logins
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { register } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, '..');

// ── Safety: only ever a fresh database on a local server ─────────────────────
if (!process.env.IT_DATABASE_URL) throw new Error('Set IT_DATABASE_URL to a database on a local Postgres server.');
const serverUrl = new URL(process.env.IT_DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(serverUrl.hostname)) {
  throw new Error(`Refusing to run against ${serverUrl.hostname}: IT_DATABASE_URL must point at localhost.`);
}
const DB_NAME = `sapoms_it_${Date.now()}`;
const testUrl = new URL(serverUrl);
testUrl.pathname = `/${DB_NAME}`;
const TEST_URL = testUrl.toString();
const server = new PrismaClient({ adapter: new PrismaPg({ connectionString: serverUrl.toString() }) });

// ── Check runner: every check runs, failures are collected and reported ───────
const results = [];
async function check(section, name, fn) {
  try {
    await fn();
    results.push({ section, name, ok: true });
    console.log(`  ✓ [${section}] ${name}`);
  } catch (error) {
    results.push({ section, name, ok: false });
    console.log(`  ✗ [${section}] ${name}\n      ${String(error?.stack ?? error).split('\n').slice(0, 6).join('\n      ')}`);
  }
}
const big = (_key, value) => (typeof value === 'bigint' ? value.toString() : value);
const rupees = (paise) => Number(paise) / 100;

let prisma;
let exitCode = 0;
try {
  console.log(`Creating ${DB_NAME} …`);
  await server.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);

  const migrate = spawnSync(process.execPath, [resolvePath(ROOT, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: ROOT, env: { ...process.env, DATABASE_URL: TEST_URL }, encoding: 'utf8',
  });
  await check('7', 'the full migration chain (incl. product_disable_note) applies to an empty database', async () => {
    assert.equal(migrate.status, 0, `${migrate.stdout}\n${migrate.stderr}`);
    assert.match(migrate.stdout + migrate.stderr, /20261106120000_product_disable_note/);
  });
  if (migrate.status !== 0) throw new Error('Migrations failed; nothing else can run.');

  // The app's prisma singleton reads DATABASE_URL when first imported, so point it at the test DB first.
  process.env.DATABASE_URL = TEST_URL;
  process.env.PROJ_ROOT ??= ROOT;
  register(pathToFileURL(resolvePath(HERE, 'invoice-ts-loader.mjs')).href);
  // next/server ships no "exports" map, so plain-node ESM needs the file name.
  register(`data:text/javascript,${encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/server" || s === "next/headers" ? s + ".js" : s, c); }')}`);

  ({ prisma } = await import('@/server/db/prisma'));
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  assert.equal(db, DB_NAME, 'the app client must be connected to the throwaway database');

  const { orderTotals } = await import('@/lib/orderTotals');
  const { applyWalletChange } = await import('@/lib/postgresWallet');
  const { setAdminVariantActive, listAdminProducts, updateAdminProduct, deleteAdminProduct } = await import('@/server/modules/admin/products/products.service');
  const { parseProductWriteInput } = await import('@/server/modules/products/product-write');
  const { listPostgresCatalogue } = await import('@/server/modules/products/postgres-catalogue');
  const { priceDealerOrder } = await import('@/lib/dealerOrderCreate');
  const { findPostgresOrderByLookupId, mapPostgresOrderToLegacy } = await import('@/lib/postgresOrders');
  const { applyPostgresOrderDispatch, getPostgresPendingProductParts } = await import('@/lib/postgresOrderDispatch');
  const { cancelPostgresOrder } = await import('@/lib/postgresOrderStatus');
  const { buildPendingProductLines } = await import('@/lib/pendingProducts');
  const { buildBulkDispatchPlan, mergeOrderItemsWithDispatchRecords } = await import('@/lib/orderDispatch');
  const { applyOrderEdit } = await import('@/lib/orderEditApply');
  const { buildOrderEditRevision } = await import('@/lib/orderOverlays');
  const { GET: overlayGET } = await import('@/app/api/order-overlays/[id]/route');

  // ── Seed ────────────────────────────────────────────────────────────────────
  console.log('Seeding …');
  const PASSWORD = 'ItTest#2026';
  const scrypt = promisify(scryptCallback);
  const passwordHash = async () => { const salt = randomBytes(16).toString('base64url'); return `scrypt:${salt}:${(await scrypt(PASSWORD, salt, 64)).toString('hex')}`; };
  const user = async (email, role) => prisma.user.create({ data: { email, normalizedEmail: email, passwordHash: await passwordHash(), role, status: 'ACTIVE' } });

  const adminUser = await user('it-admin@example.test', 'ADMIN');
  const adminProfile = await prisma.adminProfile.create({ data: { userId: adminUser.id, displayName: 'IT Admin' } });
  const staffUser = await user('it-staff@example.test', 'STAFF');
  const staff = await prisma.staffProfile.create({ data: { userId: staffUser.id, displayName: 'IT Staff', staffRoleType: '2' } });
  const dealerUser = await user('it-dealer@example.test', 'DEALER');
  const walletDealer = await prisma.dealerProfile.create({ data: { userId: dealerUser.id, businessName: 'IT Wallet Dealer', dealerCode: '9001', discountPercent: 50, creditDays: null, termsAcceptedAt: new Date() } });
  await prisma.dealerWallet.create({ data: { dealerId: walletDealer.id, status: 'ACTIVE', balancePaise: 2_000_000_000n } }); // ₹2 crore
  const creditUser = await user('it-credit-dealer@example.test', 'DEALER');
  const creditDealer = await prisma.dealerProfile.create({ data: { userId: creditUser.id, businessName: 'IT Credit Dealer', dealerCode: '9002', discountPercent: 50, creditDays: 30, creditLimitPaise: 1_000_000_000n, termsAcceptedAt: new Date() } });
  for (const dealer of [walletDealer, creditDealer]) await prisma.dealerStaffAssignment.create({ data: { dealerId: dealer.id, staffId: staff.id } }).catch(() => {});

  const variantSeed = (sku, packPricePaise) => ({ sku, catalogueNumber: sku, unitName: 'Pcs.', packSize: 10, priceBasis: 'pack', unitPricePaise: packPricePaise / 10n, packPricePaise });
  const flask = await prisma.product.create({
    data: { productCode: 'IT-FLASK', name: 'IT Volumetric Flask', variants: { create: [variantSeed('IT-FLASK-100', 10_000_000n), variantSeed('IT-FLASK-250', 10_000_000n)] } },
    include: { variants: { orderBy: { id: 'asc' } } },
  });
  const [X, Y] = flask.variants; // ₹1,00,000 a pack each
  const beaker = await prisma.product.create({
    data: { productCode: 'IT-BEAKER', name: 'IT Beaker', variants: { create: [variantSeed('IT-BEAKER-50', 1_000_000n)] } },
    include: { variants: true },
  });
  const [Z] = beaker.variants;
  const productName = new Map([[flask.id, flask.name], [beaker.id, beaker.name]]);

  async function seedOrder(label, { dealer = walletDealer, status = 'ACCEPTED', lines = [[X, 6], [Y, 6]], dispatched = [], wallet = dealer === walletDealer } = {}) {
    const acceptance = status === 'AWAITING_ACCEPTANCE' || status === 'DRAFT' ? 'AWAITING' : status === 'DECLINED' ? 'DECLINED' : 'ACCEPTED';
    const fulfilment = { PROCESSING: 'IN_PROCESS', PARTIALLY_READY: 'PARTIALLY_READY', READY: 'READY', DISPATCHED: 'DISPATCHED', COMPLETED: 'COMPLETED' }[status] ?? 'PENDING';
    const priced = lines.map(([variant, packs, opts = {}]) => ({
      variant, packs, opts, catNo: opts.catNo ?? variant.sku,
      listPriceTotalPaise: variant.packPricePaise * BigInt(packs), saleSavedPaise: 0n, discountPercent: 0, discountAmountPaise: 0n, finalAmountPaise: 0n,
    }));
    const t = orderTotals(priced, 50, []);
    const order = await prisma.order.create({
      data: {
        orderNumber: `IT/26-27/${label}`, dealerId: dealer.id, assignedStaffId: staff.id, createdByUserId: dealerUser.id,
        status, acceptanceStatus: acceptance, rsmApprovalStatus: acceptance === 'AWAITING' ? 'AWAITING' : 'ACCEPTED', fulfilmentStatus: fulfilment,
        acceptedAt: acceptance === 'ACCEPTED' ? new Date() : null, cancelledAt: status === 'CANCELLED' ? new Date() : null,
        baseDiscountPercent: 50, grossAmountPaise: t.grossAmountPaise, baseDiscountAmountPaise: t.baseDiscountAmountPaise, postBaseAmountPaise: t.postBaseAmountPaise,
        additionalDiscountType: t.additionalDiscountType, additionalDiscountAmountPaise: t.additionalDiscountAmountPaise,
        slabDiscountPercent: t.slabDiscountPercent, slabDiscountAmountPaise: t.slabDiscountAmountPaise,
        totalDiscountPercent: t.totalDiscountPercent, totalDiscountAmountPaise: t.totalDiscountAmountPaise, finalPayableAmountPaise: t.finalPayableAmountPaise,
        items: { create: priced.map((line) => ({
          productId: line.opts.unlinked ? null : line.variant.productId, productVariantId: line.opts.unlinked ? null : line.variant.id,
          productNameSnapshot: productName.get(line.variant.productId), catalogueNumberSnapshot: line.catNo, skuSnapshot: line.catNo,
          quantityPacks: line.packs, packSize: line.variant.packSize, totalPieces: line.packs * line.variant.packSize, priceBasis: 'pack',
          unitPricePaise: line.variant.unitPricePaise, packPricePaise: line.variant.packPricePaise, listPriceTotalPaise: line.listPriceTotalPaise,
          discountPercent: line.discountPercent, discountAmountPaise: line.discountAmountPaise, finalAmountPaise: line.finalAmountPaise,
        })) },
      },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    for (const [index, packs] of dispatched) {
      await prisma.orderItemDispatch.create({ data: { orderId: order.id, orderItemId: order.items[index].id, quantity: packs, status: 'DISPATCHED', remark: 'IT seed', actorUserId: staffUser.id, actorRole: 'STAFF' } });
    }
    if (wallet) await applyWalletChange(prisma, dealer.id, 'ORDER_DEBIT', rupees(t.finalPayableAmountPaise), { orderId: order.id, idempotencyKey: `it-seed:${order.id}`, reference: order.orderNumber });
    return { ...order, label, xId: String(order.items[0].id), yId: order.items[1] ? String(order.items[1].id) : null };
  }

  const OPEN = ['AWAITING_ACCEPTANCE', 'ACCEPTED', 'PROCESSING', 'PARTIALLY_READY', 'READY'];
  const S = {};
  for (const status of OPEN) S[status] = await seedOrder(`S-${status}`, { status });
  const T = {
    DRAFT: await seedOrder('T-DRAFT', { status: 'DRAFT', wallet: false }),
    DECLINED: await seedOrder('T-DECLINED', { status: 'DECLINED', wallet: false }),
    CANCELLED: await seedOrder('T-CANCELLED', { status: 'CANCELLED', wallet: false }),
    DISPATCHED: await seedOrder('T-DISPATCHED', { status: 'DISPATCHED', dispatched: [[0, 6], [1, 6]], wallet: false }),
    COMPLETED: await seedOrder('T-COMPLETED', { status: 'COMPLETED', dispatched: [[0, 6], [1, 6]], wallet: false }),
  };
  const A = await seedOrder('A');
  const B = await seedOrder('B', { status: 'PROCESSING', dispatched: [[0, 2]] });
  const I = await seedOrder('I', { status: 'PROCESSING', dispatched: [[0, 6]] });
  const D = await seedOrder('D', { status: 'PROCESSING', dispatched: [[1, 6]] });
  const E = await seedOrder('E', { status: 'AWAITING_ACCEPTANCE', lines: [[X, 6, { unlinked: true, catNo: 'it-flask-100' }], [Y, 6]] });
  const F = await seedOrder('F', { dealer: creditDealer });
  const H = await seedOrder('H', { lines: [[X, 6]] });
  const G = await seedOrder('G');
  const J = await seedOrder('J', { lines: [[Y, 6]] });
  const K = await seedOrder('K', { dealer: creditDealer, lines: [[Z, 1]] });

  // A and J look dealer-edited: their overlay holds a snapshot (marked) of the items and totals.
  async function seedEditOverlay(order) {
    const legacy = mapPostgresOrderToLegacy(await findPostgresOrderByLookupId(String(order.id)));
    const revision = {
      revision: 1, idempotencyKey: `it-edit-${order.id}`, editedBy: { id: String(dealerUser.id), role: 'dealer' }, editedAt: new Date().toISOString(),
      originalItems: legacy.items, effectiveItems: legacy.items.map((item) => ({ ...item, itSnapshot: true })), changes: [],
      totals: { grossAmount: legacy.grossAmount, discountAmount: legacy.discountAmount, netPayableAmount: legacy.finalPayableAmount },
    };
    await prisma.orderOverlay.create({ data: { orderId: order.id, type: 'edit', status: 'applied', actorUserId: dealerUser.id, actorRole: 'DEALER', metadata: JSON.parse(JSON.stringify({ revision }, big)) } });
  }
  await seedEditOverlay(A);
  await seedEditOverlay(J);
  await prisma.draftCart.create({ data: { dealerId: walletDealer.id, items: [{ catNo: 'IT-FLASK-100', quantityPacks: 2 }] } });

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const snap = async (order) => JSON.stringify(await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { items: { orderBy: { id: 'asc' }, include: { dispatches: { orderBy: { id: 'asc' } } } }, walletTransactions: { orderBy: { id: 'asc' } } },
  }), big);
  const orderRow = (order) => prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: { orderBy: { id: 'asc' } } } });
  const refunds = async (order) => (await prisma.walletTransaction.findMany({ where: { orderId: order.id, type: 'REFUND' } })).reduce((sum, row) => sum + row.amountPaise, 0n);
  const walletBalance = async () => (await prisma.dealerWallet.findUniqueOrThrow({ where: { dealerId: walletDealer.id } })).balancePaise;
  const price = (catNo) => priceDealerOrder(prisma, { productorder: JSON.stringify([{ catNo, quantityPacks: 1 }]) }, { id: walletDealer.id, discountPercent: walletDealer.discountPercent });
  const legacyOf = async (order) => mapPostgresOrderToLegacy(await findPostgresOrderByLookupId(String(order.id)));
  const overlayOf = async (order) => (await (await overlayGET(new Request('http://it.local'), { params: Promise.resolve({ id: String(order.id) }) })).json()).data;
  const staffActor = { userId: staffUser.id, sessionId: 'it', role: 'STAFF', profileId: staff.id, staffId: staff.id };
  const adminActor = { userId: adminUser.id, sessionId: 'it', role: 'ADMIN', profileId: adminProfile.id, adminId: adminProfile.id };
  const ship = (orderItemId, dispatchQuantity, trackingNumber) => ({ items: [{ orderItemId, dispatchQuantity, status: 'dispatched' }], remark: 'IT dispatch', dispatchPartner: 'Blue Dart', trackingNumber });

  const NOTE = 'Discontinued by the manufacturer (IT)';
  const ZEROED = [...Object.values(S), A, D, E, F, H, G];
  const WALLET_ZEROED = ZEROED.filter((order) => order !== F);
  const UNTOUCHED = [...Object.values(T), B, I, J, K];
  // X×6 + Y×6 = ₹12,00,000 gross; 50% base; ₹6,00,000 after base earns the 5% slab → ₹5,70,000.
  // X zeroed with the slab kept: ₹6,00,000 gross → ₹3,00,000 → 5% → ₹2,85,000 (re-reading the table would give 2% → ₹2,94,000).
  const DEFAULT_AFTER = 28_500_000n;
  const H_BEFORE = 29_400_000n; // X×6 alone: ₹3,00,000 after base → 2% slab → ₹2,94,000

  // ── Before the disable ──────────────────────────────────────────────────────
  console.log('\nBefore disabling');
  await check('2A', 'disabling without a note is refused and changes nothing', async () => {
    await assert.rejects(setAdminVariantActive(X.id, false, '   '), (error) => error.code === 'INVALID_REQUEST');
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: X.id } });
    assert.equal(variant.active, true);
    assert.equal(variant.disabledNote, null);
  });
  await check('2D', 'baseline: dealers can order X (priced from the live catalogue)', async () => {
    assert.equal((await price('IT-FLASK-100')).items[0].catNo, 'IT-FLASK-100');
  });

  const before = new Map();
  for (const order of UNTOUCHED) before.set(order.label, await snap(order));
  const yLines = () => prisma.orderItem.findMany({ where: { productVariantId: Y.id, order: { status: { notIn: ['CANCELLED'] } } }, orderBy: { id: 'asc' }, select: { id: true, quantityPacks: true, listPriceTotalPaise: true, discountAmountPaise: true, finalAmountPaise: true, disabledNote: true } });
  const yBefore = JSON.stringify(await yLines(), big);
  const cartBefore = JSON.stringify((await prisma.draftCart.findUniqueOrThrow({ where: { dealerId: walletDealer.id } })).items);
  const balanceBefore = await walletBalance();

  // ── Disable X ──────────────────────────────────────────────────────────────
  console.log('\nDisabling IT-FLASK-100');
  const disabled = await setAdminVariantActive(X.id, false, NOTE);

  await check('2A/4', 'the toggle reports how many open orders it updated', async () => {
    assert.deepEqual(disabled, { active: false, disabledNote: NOTE, affectedOrders: ZEROED.length, failedOrders: 0 });
  });
  await check('1/2A', 'the catalogue number is disabled with its note, not deleted', async () => {
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: X.id } });
    assert.equal(variant.active, false);
    assert.equal(variant.disabledNote, NOTE);
    assert.equal(await prisma.product.count({ where: { id: flask.id } }), 1);
  });
  await check('2A/5', 'other variants of the same product are unaffected (Y active, all Y lines unchanged)', async () => {
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: Y.id } })).active, true);
    assert.equal(JSON.stringify(await yLines(), big), yBefore);
  });
  await check('2A', 'it stays in the admin product list, flagged with its reason', async () => {
    const { items } = await listAdminProducts({ page: 1, pageSize: 50, search: 'IT-FLASK' });
    const variants = items.find((product) => product.productCode === 'IT-FLASK').variants;
    assert.deepEqual(variants.map((v) => [v.sku, v.active, v.disabledNote]), [['IT-FLASK-100', false, NOTE], ['IT-FLASK-250', true, '']]);
  });

  await check('2B/5', 'every open status is adjusted: Awaiting Acceptance, Accepted, Processing, Partially Ready, Ready', async () => {
    for (const status of OPEN) {
      const x = (await orderRow(S[status])).items[0];
      assert.equal(x.disabledNote, NOTE, status);
      assert.equal(x.quantityPacks, 0, status);
    }
  });
  await check('2B', 'each affected line stays on the order with qty 0, ₹0 value and the note', async () => {
    for (const order of ZEROED) {
      const row = await orderRow(order);
      assert.equal(row.items.length, order.items.length, `${order.label}: line kept`);
      const x = row.items[0];
      assert.deepEqual([x.quantityPacks, x.totalPieces, x.listPriceTotalPaise, x.discountAmountPaise, x.finalAmountPaise, x.disabledNote], [0, 0, 0n, 0n, 0n, NOTE], order.label);
    }
  });
  await check('2B/3', 'order totals are recalculated, keeping the slab the order earned (₹5,70,000 → ₹2,85,000)', async () => {
    for (const order of ZEROED.filter((o) => o !== H)) {
      const row = await orderRow(order);
      assert.equal(row.finalPayableAmountPaise, DEFAULT_AFTER, order.label);
      assert.equal(row.grossAmountPaise, 60_000_000n, order.label);
      assert.equal(Number(row.slabDiscountPercent), 5, order.label);
    }
  });
  await check('2B/3', 'wallet-paid orders are refunded the difference, and the wallet balance rises by exactly that', async () => {
    let total = 0n;
    for (const order of WALLET_ZEROED) {
      const expected = order === H ? H_BEFORE : 57_000_000n - DEFAULT_AFTER;
      assert.equal(await refunds(order), expected, order.label);
      total += expected;
    }
    assert.equal(await walletBalance(), balanceBefore + total);
  });
  await check('3', 'credit orders are adjusted without any wallet transaction', async () => {
    assert.equal((await orderRow(F)).finalPayableAmountPaise, DEFAULT_AFTER);
    assert.equal(await prisma.walletTransaction.count({ where: { orderId: F.id } }), 0);
  });
  await check('3', 'if every line of an order is disabled, it stays open at ₹0 (fully refunded)', async () => {
    const row = await orderRow(H);
    assert.equal(row.status, 'ACCEPTED');
    assert.equal(row.finalPayableAmountPaise, 0n);
  });
  await check('3', 'fulfilment is recalculated: an order whose only pending line was disabled becomes Dispatched', async () => {
    const row = await orderRow(D);
    assert.deepEqual([row.status, row.fulfilmentStatus, Boolean(row.dispatchedAt)], ['DISPATCHED', 'DISPATCHED', true]);
  });
  await check('2B', 'lines stored without a variant link are matched by catalogue number, ignoring case', async () => {
    assert.equal((await orderRow(E)).items[0].disabledNote, NOTE);
  });
  await check('5/extra', 'dispatched history is never touched: partially (B) and fully (I) dispatched lines, and finished/terminal orders', async () => {
    for (const order of UNTOUCHED) assert.equal(await snap(order), before.get(order.label), `${order.label} changed`);
  });
  await check('5', "the dealer's unsent cart is not touched", async () => {
    assert.equal(JSON.stringify((await prisma.draftCart.findUniqueOrThrow({ where: { dealerId: walletDealer.id } })).items), cartBefore);
  });
  await check('2B/7', 'the audit log records the disable and every zeroed line with its original quantity', async () => {
    const row = await prisma.authAuditLog.findFirstOrThrow({ where: { entity: 'PRODUCT', entityId: String(flask.id) }, orderBy: { id: 'desc' } });
    assert.equal(row.newValues.disabledNote, NOTE);
    assert.equal(row.metadata.zeroedOrderLines.length, ZEROED.length);
    assert.ok(row.metadata.zeroedOrderLines.every((line) => line.fromPacks === 6 && line.toPacks === 0));
  });

  await check('1/2A', "it disappears from the dealer's order catalogue; other variants still order", async () => {
    const catalogueFlask = (await listPostgresCatalogue()).find((product) => product.productCode === 'IT-FLASK');
    assert.deepEqual(catalogueFlask.variants.map((variant) => variant.sku), ['IT-FLASK-250']);
    await assert.rejects(price('IT-FLASK-100'), (error) => error.code === 'unknown_product');
    assert.equal((await price('IT-FLASK-250')).items[0].catNo, 'IT-FLASK-250');
  });
  await check('2B', 'the order page data carries the note and a zero quantity for the disabled line', async () => {
    const legacy = await legacyOf(A);
    const x = legacy.items.find((item) => item.orderdata_id === A.xId);
    const y = legacy.items.find((item) => item.orderdata_id === A.yId);
    assert.deepEqual([x.productDisabledNote, x.quantityPacks, x.finalAmount], [NOTE, 0, 0]);
    assert.equal(y.productDisabledNote, '');
  });
  await check('2B', 'an order the dealer had edited shows the disabled line and the new total, not the stale snapshot', async () => {
    const effective = await overlayOf(A);
    const x = effective.effectiveItems.find((item) => item.orderdata_id === A.xId);
    const y = effective.effectiveItems.find((item) => item.orderdata_id === A.yId);
    assert.deepEqual([x.productDisabledNote, Number(x.orderdata_item_quantity), x.itSnapshot], [NOTE, 0, undefined]);
    assert.equal(y.itSnapshot, true);
    assert.equal(effective.effectiveTotals.netPayableAmount, rupees(DEFAULT_AFTER));
  });

  // ── Restrictions ────────────────────────────────────────────────────────────
  console.log('\nRestrictions on disabled lines');
  await check('2C', 'quantity editing and removal are blocked; other lines stay editable', async () => {
    const effective = await overlayOf(A);
    const requested = effective.effectiveItems.map((item) => ({ ...item, originalLineId: item.orderdata_id, orderdata_item_quantity: item.orderdata_id === A.yId ? '5' : item.orderdata_item_quantity }));
    const revision = buildOrderEditRevision({ orderId: effective.orderId, baseOrder: effective.originalOrder, originalItems: effective.effectiveItems, requestedItems: requested, expectedRevision: effective.latestRevision, actor: { role: 'dealer', actorId: String(dealerUser.id) } });
    assert.deepEqual(revision.changes.map((change) => [change.type, change.originalLineId]), [['quantity_changed', A.yId]]);
    const ROLLBACK = new Error('rollback');
    await prisma.$transaction(async (tx) => {
      const tampered = { ...revision, effectiveItems: revision.effectiveItems.map((item) => (item.orderdata_id === A.xId ? { ...item, quantityPacks: 5, orderdata_item_quantity: '5' } : item)) };
      await applyOrderEdit(tx, A.id, tampered);
      const [x, y] = await tx.orderItem.findMany({ where: { orderId: A.id }, orderBy: { id: 'asc' } });
      assert.deepEqual([x.quantityPacks, x.listPriceTotalPaise, y.quantityPacks], [0, 0n, 5]);
      await assert.rejects(
        applyOrderEdit(tx, A.id, { ...revision, revision: revision.revision + 1, effectiveItems: revision.effectiveItems.filter((item) => item.orderdata_id !== A.xId) }),
        (error) => error.code === 'disabled_line' && error.status === 409,
      );
      throw ROLLBACK;
    }).catch((error) => { if (error !== ROLLBACK) throw error; });
    assert.equal((await orderRow(A)).items[1].quantityPacks, 6, 'the trial edit was rolled back');
  });
  await check('2C', 'bulk dispatch leaves out the disabled line and keeps the others', async () => {
    const legacy = await legacyOf(A);
    const plan = buildBulkDispatchPlan(mergeOrderItemsWithDispatchRecords(legacy.items, legacy.dispatchRecords));
    const ids = plan.lines.map((line) => String(line.orderItemId));
    assert.ok(!ids.includes(A.xId) && ids.includes(A.yId), JSON.stringify(ids));
  });
  await check('2C', 'pending products drop disabled lines and keep partially dispatched ones (B: 4 packs left)', async () => {
    const orders = await Promise.all([A, D, E, F, H, B].map(legacyOf));
    const lines = buildPendingProductLines({ orders, ...(await getPostgresPendingProductParts(orders)) });
    const zeroedIds = new Set([A, D, E, F, H].map((order) => order.xId));
    assert.ok(!lines.some((line) => zeroedIds.has(String(line.orderItemId))), 'a disabled line is still pending');
    assert.equal(lines.find((line) => line.orderItemId === B.xId)?.pendingQuantity, 4);
    assert.ok(lines.some((line) => line.orderItemId === A.yId), "A's other product is still pending");
  });
  await check('2C', 'a disabled line cannot be dispatched (409 product_disabled)', async () => {
    await assert.rejects(applyPostgresOrderDispatch(String(A.id), staffActor, ship(A.xId, 1, 'IT0001')), (error) => error.code === 'product_disabled' && error.status === 409);
    assert.equal(await prisma.orderItemDispatch.count({ where: { orderItemId: BigInt(A.xId) } }), 0);
  });
  await check('2C/3', 'the other products continue: dispatching all of Y completes order A', async () => {
    await applyPostgresOrderDispatch(String(A.id), staffActor, ship(A.yId, 6, 'IT0002'));
    const row = await orderRow(A);
    assert.deepEqual([row.status, row.fulfilmentStatus], ['DISPATCHED', 'DISPATCHED']);
  });
  await check('7', 'disabling again is a no-op: nothing more is zeroed or refunded', async () => {
    const walletRows = await prisma.walletTransaction.count();
    assert.equal((await setAdminVariantActive(X.id, false, NOTE)).affectedOrders, 0);
    assert.equal(await prisma.walletTransaction.count(), walletRows);
  });
  await check('2C', 'whole-order cancellation still works, and refunds never exceed what was paid', async () => {
    await cancelPostgresOrder(String(G.id), adminActor, 'IT cancel');
    assert.equal((await orderRow(G)).status, 'CANCELLED');
    assert.equal(await refunds(G), 57_000_000n);
  });

  // ── Re-enable ───────────────────────────────────────────────────────────────
  console.log('\nRe-enabling IT-FLASK-100');
  const enabled = await setAdminVariantActive(X.id, true, '');
  await check('2D', 're-enabling clears the note and brings it back for new orders', async () => {
    assert.deepEqual(enabled, { active: true, disabledNote: '', affectedOrders: 0, failedOrders: 0 });
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: X.id } });
    assert.deepEqual([variant.active, variant.disabledNote], [true, null]);
    assert.equal((await price('IT-FLASK-100')).items[0].catNo, 'IT-FLASK-100');
  });
  await check('2D', 'previously affected orders are not restored: their lines stay at ₹0 with the note', async () => {
    for (const order of ZEROED) {
      const x = (await orderRow(order)).items[0];
      assert.deepEqual([x.quantityPacks, x.finalAmountPaise, x.disabledNote], [0, 0n, NOTE], order.label);
    }
  });
  await check('7', 'the audit log also records the enable', async () => {
    const row = await prisma.authAuditLog.findFirstOrThrow({ where: { entity: 'PRODUCT', entityId: String(flask.id) }, orderBy: { id: 'desc' } });
    assert.deepEqual([row.oldValues.active, row.newValues.active, row.newValues.disabledNote], [false, true, null]);
  });

  // ── Regression: what existed before still works the same ────────────────────
  console.log('\nRegression: existing behaviour');
  await check('regression', 'an edited order with no disabled line still shows its own snapshot', async () => {
    const effective = await overlayOf(J);
    assert.equal(effective.isEdited, true);
    assert.ok(effective.effectiveItems.every((item) => item.itSnapshot === true));
    assert.equal(effective.effectiveTotals.netPayableAmount, rupees(H_BEFORE));
  });
  await check('regression', 'a normal dealer edit still reprices and refunds the wallet (J: Y 6 → 3)', async () => {
    const effective = await overlayOf(J);
    const requested = effective.effectiveItems.map((item) => ({ ...item, originalLineId: item.orderdata_id, orderdata_item_quantity: '3' }));
    const revision = buildOrderEditRevision({ orderId: effective.orderId, baseOrder: effective.originalOrder, originalItems: effective.effectiveItems, requestedItems: requested, expectedRevision: effective.latestRevision, actor: { role: 'dealer', actorId: String(dealerUser.id) } });
    await prisma.$transaction((tx) => applyOrderEdit(tx, J.id, revision));
    assert.equal((await orderRow(J)).finalPayableAmountPaise, 15_000_000n);
    const refund = await prisma.walletTransaction.findFirstOrThrow({ where: { orderId: J.id, type: 'REFUND' } });
    assert.deepEqual([refund.amountPaise, refund.idempotencyKey], [14_400_000n, `order:${J.id}:edit-r${revision.revision}`]);
  });
  await check('regression', 'normal dispatch still runs partial → full (B) on a line with dispatch history', async () => {
    await applyPostgresOrderDispatch(String(B.id), staffActor, ship(B.xId, 1, 'IT0003'));
    assert.equal((await orderRow(B)).fulfilmentStatus, 'IN_PROCESS');
    await applyPostgresOrderDispatch(String(B.id), staffActor, { ...ship(B.xId, 3, 'IT0004'), items: [{ orderItemId: B.xId, dispatchQuantity: 3, status: 'dispatched' }, { orderItemId: B.yId, dispatchQuantity: 6, status: 'dispatched' }] });
    const row = await orderRow(B);
    assert.deepEqual([row.status, row.fulfilmentStatus], ['DISPATCHED', 'DISPATCHED']);
  });
  await check('regression', 'the product form still saves; "Out of Stock" keeps a disable note, "In Stock" clears it', async () => {
    assert.equal((await setAdminVariantActive(X.id, false, 'Form check')).affectedOrders, 0);
    const form = (xActive) => parseProductWriteInput({
      name: 'IT Volumetric Flask (renamed)', productCode: 'IT-FLASK',
      variants: [X, Y].map((v) => ({ id: String(v.id), sku: v.sku, catalogueNumber: v.sku, unitName: 'Pcs.', packSize: 10, priceBasis: 'pack', printedPrice: 100000, active: v === X ? xActive : true })),
    });
    await updateAdminProduct(flask.id, form(false));
    let x = await prisma.productVariant.findUniqueOrThrow({ where: { id: X.id } });
    assert.deepEqual([x.active, x.disabledNote, x.packPricePaise], [false, 'Form check', 10_000_000n]);
    assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: flask.id } })).name, 'IT Volumetric Flask (renamed)');
    await updateAdminProduct(flask.id, form(true));
    x = await prisma.productVariant.findUniqueOrThrow({ where: { id: X.id } });
    assert.deepEqual([x.active, x.disabledNote, x.packPricePaise], [true, null, 10_000_000n]);
  });
  await check('regression', 'soft-deleting a product still hides it and touches no orders', async () => {
    const kBefore = await snap(K);
    await deleteAdminProduct(beaker.id);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: beaker.id }, include: { variants: true } });
    assert.deepEqual([row.active, row.variants.every((v) => !v.active)], [false, true]);
    assert.equal((await listPostgresCatalogue()).find((p) => p.productCode === 'IT-BEAKER').active, false);
    assert.equal(await snap(K), kBefore);
  });
  await check('regression', 'JSON-catalogue products still price for new orders', async () => {
    const priced = await price('OM285-020');
    assert.deepEqual([priced.items[0].packSize, rupees(priced.items[0].packPricePaise)], [100, 5200]);
  });

  // ── Existing verify scripts on the migrated schema ───────────────────────────
  console.log('\nExisting verify scripts on this database');
  for (const script of ['verify-order-pricing.mjs', 'verify-partial-discount.mjs']) {
    await check('regression', `${script} passes`, async () => {
      const run = spawnSync(process.execPath, ['-r', 'dotenv/config', resolvePath(HERE, script)], { cwd: ROOT, env: { ...process.env, DATABASE_URL: TEST_URL }, encoding: 'utf8' });
      assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`.trim().split('\n').slice(-12).join('\n'));
    });
  }

  if (process.env.IT_KEEP_DB === '1') {
    console.log(`\nKept ${DB_NAME}. Logins (password ${PASSWORD}): it-admin@example.test, it-staff@example.test, it-dealer@example.test, it-credit-dealer@example.test`);
  }
} catch (error) {
  exitCode = 1;
  console.error('\nAborted:', error);
} finally {
  await prisma?.$disconnect();
  if (process.env.IT_KEEP_DB !== '1') await server.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await server.$disconnect();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${process.env.IT_KEEP_DB === '1' ? '' : `; ${DB_NAME} dropped`}.`);
process.exit(failed.length || exitCode ? 1 : 0);
