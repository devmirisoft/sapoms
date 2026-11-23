// Integration test for "an active wallet makes a dealer advance" (dealerTerms in
// src/lib/dealerCreditLimit.ts), run against a throwaway Postgres database
// (created, migrated, seeded, then dropped). Every money path that used to treat
// "has credit days" as "credit dealer" is exercised through the real code.
//
// Run: IT_DATABASE_URL=postgresql://user:pass@localhost:5432/anydb npm run test:dealer-terms
//   IT_DATABASE_URL  any database on a LOCAL server (used only to CREATE/DROP the test DB)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { register } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`  ✓ ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`  ✗ ${name}\n      ${String(error?.stack ?? error).split('\n').slice(0, 6).join('\n      ')}`);
  }
}

let prisma;
let exitCode = 0;
try {
  console.log(`Creating ${DB_NAME} …`);
  await server.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
  const migrate = spawnSync(process.execPath, [resolvePath(ROOT, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: ROOT, env: { ...process.env, DATABASE_URL: TEST_URL, DIRECT_URL: TEST_URL }, encoding: 'utf8',
  });
  if (migrate.status !== 0) throw new Error(`Migrations failed:\n${migrate.stdout}\n${migrate.stderr}`);

  // The app's prisma singleton reads DATABASE_URL when first imported.
  process.env.DATABASE_URL = TEST_URL;
  process.env.PROJ_ROOT ??= ROOT;
  register(pathToFileURL(resolvePath(HERE, 'invoice-ts-loader.mjs')).href);
  register(`data:text/javascript,${encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/server" || s === "next/headers" ? s + ".js" : s, c); }')}`);

  ({ prisma } = await import('@/server/db/prisma'));
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  assert.equal(db, DB_NAME, 'the app client must be connected to the throwaway database');

  const { createDealerOrder } = await import('@/lib/dealerOrderCreate');
  const { placeOrderForApprovedDiscount } = await import('@/lib/discountApprovalOrder');
  const { findUnsetTermsDealers, getDealerCreditStatus, UNSET_TERMS_MESSAGE } = await import('@/lib/dealerCreditLimit');
  const { extendDealerCredit, recordLedgerPayment } = await import('@/lib/ledgerSystem');
  const { cancelPostgresOrder } = await import('@/lib/postgresOrderStatus');
  const { fillDealerFields } = await import('@/server/terms-content');
  const { DEFAULT_TERMS_BLOCKS } = await import('@/components/terms/TermsDocument');
  const { applyOrderEdit } = await import('@/lib/orderEditApply');
  const { buildOrderEditRevision } = await import('@/lib/orderOverlays');
  const { GET: overlayGET } = await import('@/app/api/order-overlays/[id]/route');

  // ── Seed ────────────────────────────────────────────────────────────────────
  console.log('Seeding …');
  const user = (email, role) => prisma.user.create({ data: { email, normalizedEmail: email, passwordHash: 'it-no-login', role, status: 'ACTIVE' } });
  const adminUser = await user('it-admin@example.test', 'ADMIN');
  const adminProfile = await prisma.adminProfile.create({ data: { userId: adminUser.id, displayName: 'IT Admin' } });
  const adminActor = { userId: adminUser.id, sessionId: 'it', role: 'ADMIN', profileId: adminProfile.id, adminId: adminProfile.id };
  const accountantActor = { userId: (await user('it-accountant@example.test', 'ACCOUNTANT')).id, sessionId: 'it', role: 'ACCOUNTANT' };
  const staffUser = await user('it-staff@example.test', 'STAFF');
  const staff = await prisma.staffProfile.create({ data: { userId: staffUser.id, displayName: 'IT Staff', staffRoleType: '2' } });

  async function seedDealer(businessName, dealerCode, { creditDays = null, creditLimitPaise = null, wallet = null } = {}) {
    const dealerUser = await user(`it-${dealerCode}@example.test`, 'DEALER');
    const dealer = await prisma.dealerProfile.create({ data: { userId: dealerUser.id, businessName, dealerCode, discountPercent: 50, creditDays, creditLimitPaise, termsAcceptedAt: new Date() } });
    if (wallet) await prisma.dealerWallet.create({ data: { dealerId: dealer.id, ...wallet } });
    await prisma.dealerStaffAssignment.create({ data: { dealerId: dealer.id, staffId: staff.id } });
    return dealer;
  }
  // A 1-paisa credit limit on the advance dealer: any credit check would block its orders.
  const ADV = await seedDealer('IT Advance (credit days saved)', '9101', { creditDays: 30, creditLimitPaise: 1n, wallet: { status: 'ACTIVE', balancePaise: 10_000_000n } });
  const BROKE = await seedDealer('IT Advance, empty wallet', '9102', { creditDays: 30, wallet: { status: 'ACTIVE', balancePaise: 0n } });
  const CRED = await seedDealer('IT Credit', '9103', { creditDays: 30, creditLimitPaise: 1_000_000_000n });
  const UNSET = await seedDealer('IT Unset', '9104');
  const UNSET_OFF = await seedDealer('IT Unset, wallet off', '9105', { wallet: { status: 'INACTIVE' } });

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const fields = (packs = 1) => ({ productorder: JSON.stringify([{ catNo: 'OM285-020', quantityPacks: packs }]) });
  const place = (dealer, packs) => prisma.$transaction((tx) => createDealerOrder(tx, fields(packs), dealer.id, { userId: dealer.userId, role: 'DEALER', displayName: 'IT' }));
  const balance = async (dealer) => (await prisma.dealerWallet.findUnique({ where: { dealerId: dealer.id } }))?.balancePaise ?? 0n;
  const walletTx = (orderId, type) => prisma.walletTransaction.findMany({ where: { orderId, ...(type ? { type } : {}) } });
  const orderCount = (dealer) => prisma.order.count({ where: { dealerId: dealer.id } });
  const rejectsWith = (code) => (error) => { assert.equal(error.code, code, error.message); return true; };
  let requestId = 990_000n;
  const approve = (dealer) => prisma.$transaction((tx) => placeOrderForApprovedDiscount(tx, {
    id: ++requestId, dealerId: dealer.id, orderId: null, orderDraftId: null,
    orderSnapshot: { products: [{ sku: 'IT-DISC', productName: 'IT Discounted', quantity: 1, packSize: 1, grossAmount: 1000, finalAmount: 800 }] },
    grossAmountPaise: 100_000n, requestedDiscountAmountPaise: 20_000n, requestedNetPayableAmountPaise: 80_000n,
  }, { userId: adminUser.id }));
  async function editPacks(order, packs, dealer) {
    const effective = (await (await overlayGET(new Request('http://it.local'), { params: Promise.resolve({ id: String(order.id) }) })).json()).data;
    const requestedItems = effective.effectiveItems.map((item) => ({ ...item, originalLineId: item.orderdata_id, orderdata_item_quantity: String(packs) }));
    const revision = buildOrderEditRevision({ orderId: effective.orderId, baseOrder: effective.originalOrder, originalItems: effective.effectiveItems, requestedItems, expectedRevision: effective.latestRevision, actor: { role: 'dealer', actorId: String(dealer.userId) } });
    await prisma.$transaction((tx) => applyOrderEdit(tx, order.id, revision));
  }

  // ── Placing an order ────────────────────────────────────────────────────────
  console.log('\nPlacing an order');
  let advOrder;
  await check('advance dealer with credit days saved pays from the wallet; credit limit ignored', async () => {
    const before = await balance(ADV);
    const { order, wallet } = await place(ADV);
    advOrder = order;
    assert.equal(wallet?.used, true);
    assert.equal(await balance(ADV), before - order.finalPayableAmountPaise);
    assert.equal((await walletTx(order.id, 'ORDER_DEBIT')).length, 1);
  });
  await check('advance dealer without enough balance is blocked', async () => {
    await assert.rejects(place(BROKE), rejectsWith('insufficient_balance'));
    assert.equal(await orderCount(BROKE), 0);
  });
  await check('credit dealer orders against the credit limit, wallet untouched', async () => {
    const { order } = await place(CRED);
    assert.equal((await walletTx(order.id)).length, 0);
    await prisma.dealerProfile.update({ where: { id: CRED.id }, data: { creditLimitPaise: 1n } });
    await assert.rejects(place(CRED), rejectsWith('credit_limit_exceeded'));
    await prisma.dealerProfile.update({ where: { id: CRED.id }, data: { creditLimitPaise: 1_000_000_000n } });
  });
  await check('dealer with neither wallet nor credit days is blocked with the message', async () => {
    for (const dealer of [UNSET, UNSET_OFF]) {
      await assert.rejects(place(dealer), (error) => { assert.deepEqual([error.code, error.message], ['credit_terms_missing', UNSET_TERMS_MESSAGE]); return true; });
      assert.equal(await orderCount(dealer), 0);
    }
  });

  // ── Credit status ───────────────────────────────────────────────────────────
  console.log('\nCredit status');
  await check('no credit status for the advance dealer; credit dealer still has one', async () => {
    const load = (dealer) => prisma.dealerProfile.findUniqueOrThrow({ where: { id: dealer.id }, select: { id: true, creditDays: true, creditLimitPaise: true, tempCreditLimitPaise: true, wallet: { select: { status: true } } } });
    assert.equal(await getDealerCreditStatus(prisma, await load(ADV)), null);
    assert.notEqual(await getDealerCreditStatus(prisma, await load(CRED)), null);
  });

  // ── Discount approval ───────────────────────────────────────────────────────
  console.log('\nDiscount approval');
  let discountOrder;
  await check('advance dealer: the approved order is paid from the wallet', async () => {
    const before = await balance(ADV);
    discountOrder = await approve(ADV);
    assert.equal(await balance(ADV), before - 80_000n);
    assert.equal((await walletTx(discountOrder.id, 'ORDER_DEBIT')).length, 1);
  });
  await check('advance dealer without enough balance: approval blocked and rolled back', async () => {
    await assert.rejects(approve(BROKE), rejectsWith('insufficient_balance'));
    assert.equal(await orderCount(BROKE), 0);
  });
  await check('dealer with neither: approval blocked with the dealer named', async () => {
    await assert.rejects(approve(UNSET), (error) => { assert.equal(error.code, 'credit_terms_missing'); assert.match(error.message, /Credit days for IT Unset are not set/); return true; });
    assert.equal(await orderCount(UNSET), 0);
  });
  await check('credit dealer: approved order goes on credit, wallet untouched', async () => {
    const order = await approve(CRED);
    assert.equal((await walletTx(order.id)).length, 0);
  });
  await check('cancelling the advance dealer\'s discount order refunds the wallet', async () => {
    const before = await balance(ADV);
    await cancelPostgresOrder(String(discountOrder.id), adminActor, 'IT cancel');
    assert.equal(await balance(ADV), before + 80_000n);
  });

  // ── Order edits ─────────────────────────────────────────────────────────────
  console.log('\nOrder edits');
  await check('editing the advance dealer\'s wallet-paid order moves wallet money despite saved credit days', async () => {
    const before = await balance(ADV);
    await editPacks(advOrder, 2, ADV);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: advOrder.id } });
    assert.equal(await balance(ADV), before - (after.finalPayableAmountPaise - advOrder.finalPayableAmountPaise));
  });
  await check('editing an old credit-era order of the advance dealer leaves the wallet alone', async () => {
    // Simulate an order placed while the dealer was still on credit (no wallet debit).
    await prisma.dealerWallet.update({ where: { dealerId: ADV.id }, data: { status: 'INACTIVE' } });
    await prisma.dealerProfile.update({ where: { id: ADV.id }, data: { creditLimitPaise: null } });
    const { order } = await place(ADV);
    await prisma.dealerWallet.update({ where: { dealerId: ADV.id }, data: { status: 'ACTIVE' } });
    await prisma.dealerProfile.update({ where: { id: ADV.id }, data: { creditLimitPaise: 1n } });
    const before = await balance(ADV);
    await editPacks(order, 2, ADV);
    assert.equal(await balance(ADV), before);
    assert.equal((await walletTx(order.id)).length, 0);
  });

  // ── Payments and credit extension ───────────────────────────────────────────
  console.log('\nPayments and credit extension');
  await check('advance dealer: a payment without a bill tops up the wallet', async () => {
    const before = await balance(ADV);
    await recordLedgerPayment(accountantActor, String(ADV.id), { amount: 500, paymentMode: 'NEFT' }, 'it-pay-adv');
    assert.equal(await balance(ADV), before + 50_000n);
  });
  await check('advance dealer: a payment against an old credit bill settles the bill only', async () => {
    const bill = await prisma.ledgerBill.create({ data: { dealerId: ADV.id, orderNumber: 'IT-OLD-1', billAmountPaise: 300_000n, billDate: new Date() } });
    const before = await balance(ADV);
    await recordLedgerPayment(accountantActor, String(ADV.id), { amount: 1000, paymentMode: 'NEFT', billId: String(bill.id) }, 'it-pay-adv-bill');
    assert.equal((await prisma.ledgerBill.findUniqueOrThrow({ where: { id: bill.id } })).paidAmountPaise, 100_000n);
    assert.equal(await balance(ADV), before);
  });
  await check('credit dealer: a payment never reaches a wallet', async () => {
    await recordLedgerPayment(accountantActor, String(CRED.id), { amount: 500, paymentMode: 'NEFT' }, 'it-pay-cred');
    const wallet = await prisma.dealerWallet.findUnique({ where: { dealerId: CRED.id } });
    assert.deepEqual([wallet?.status ?? 'INACTIVE', wallet?.balancePaise ?? 0n], ['INACTIVE', 0n]);
  });
  await check('extending credit is refused for the advance dealer, allowed for the credit dealer', async () => {
    await assert.rejects(extendDealerCredit(adminActor, String(ADV.id), { type: 'days', days: 5 }), /not on credit terms/);
    await prisma.ledgerBill.create({ data: { dealerId: CRED.id, orderNumber: 'IT-CRED-1', billAmountPaise: 100_000n, billDate: new Date() } });
    await extendDealerCredit(adminActor, String(CRED.id), { type: 'days', days: 5 });
  });

  // ── Terms document ──────────────────────────────────────────────────────────
  console.log('\nTerms document');
  await check('credit days are printed for the credit dealer only', async () => {
    const text = async (dealer) => (await fillDealerFields(DEFAULT_TERMS_BLOCKS, dealer.id)).map((block) => block.text).join('\n');
    assert.match(await text(CRED), /30 DAYS/);
    assert.doesNotMatch(await text(ADV), /30 DAYS/);
  });

  // ── Admin alert ─────────────────────────────────────────────────────────────
  console.log('\nAdmin alert');
  const unsetNames = async () => (await findUnsetTermsDealers(prisma)).map((dealer) => dealer.businessName);
  await check('the alert lists exactly the dealers who cannot order', async () => {
    assert.deepEqual(await unsetNames(), ['IT Unset', 'IT Unset, wallet off']);
  });
  await check('adding credit days (or turning the wallet on) clears the alert and ordering works', async () => {
    await prisma.dealerProfile.update({ where: { id: UNSET.id }, data: { creditDays: 15 } });
    await prisma.dealerWallet.update({ where: { dealerId: UNSET_OFF.id }, data: { status: 'ACTIVE', balancePaise: 10_000_000n } });
    assert.deepEqual(await unsetNames(), []);
    await place(UNSET);
    await place(UNSET_OFF);
  });
} catch (error) {
  exitCode = 1;
  console.error('\nAborted:', error);
} finally {
  await prisma?.$disconnect();
  await server.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await server.$disconnect();
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed; ${DB_NAME} dropped.`);
process.exit(failed || exitCode ? 1 : 0);
