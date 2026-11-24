// Integration test for order numbers and shipment billing in the ledger, run against a
// real, throwaway Postgres database (created, migrated, seeded, then dropped).
// The seed is Devarya Scientific Agencies' production case from 17 Nov 2026: rows 2250
// and 2263 were saved as OM/26-27/DMS-1083 and DMS-1096 while staff know them as
// DMS-2250 and DMS-2263; invoices #4644 and #4682 are saved and no shipment is linked.
// Add Invoice lists Dispatch Tracking's own To Bill parcels (shipments with no ledger
// bill), so "left to bill" here is that same query.
//
// Run: IT_DATABASE_URL=postgresql://user:pass@localhost:5432/anydb npm run test:shipment-billing
//   IT_DATABASE_URL  any database on a LOCAL server (used only to CREATE/DROP the test DB)
//   IT_KEEP_DB=1     keep the seeded DB afterwards
// Needs psql on PATH: the renumber script is run exactly as it is run on production.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}\n      ${String(error?.stack ?? error).split('\n').slice(0, 6).join('\n      ')}`);
  }
}
const statusOf = async (promise) => { try { await promise; return 'ok'; } catch (error) { return error.status ?? String(error); } };
// The scripts read and write old-invoice-parcels.csv in the folder psql runs from.
const runSql = (file, cwd) => spawnSync('psql', [TEST_URL, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', resolvePath(ROOT, file)], { encoding: 'utf8', cwd });
const renumber = () => runSql('scripts/sql/renumber-app-orders.sql');

let prisma;
let exitCode = 0;
try {
  console.log(`Creating ${DB_NAME} …`);
  await server.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
  const migrate = spawnSync(process.execPath, [resolvePath(ROOT, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: ROOT, env: { ...process.env, DATABASE_URL: TEST_URL, DIRECT_URL: TEST_URL }, encoding: 'utf8', // prisma.config.ts migrates DIRECT_URL first
  });
  if (migrate.status !== 0) throw new Error(`Migrations failed; nothing else can run.\n${migrate.stdout}\n${migrate.stderr}`);

  // The app's prisma singleton reads DATABASE_URL when first imported, so point it at the test DB first.
  process.env.DATABASE_URL = TEST_URL;
  process.env.PROJ_ROOT ??= ROOT;
  register(pathToFileURL(resolvePath(HERE, 'invoice-ts-loader.mjs')).href);
  register(`data:text/javascript,${encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/server" || s === "next/headers" ? s + ".js" : s, c); }')}`);

  ({ prisma } = await import('@/server/db/prisma'));
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  assert.equal(db, DB_NAME, 'the app client must be connected to the throwaway database');
  const { getDealerLedger, getDealerLedgerTransactions, recordLedgerBill, recordLedgerPayment } = await import('@/lib/ledgerSystem');
  const { listUnpaidBills } = await import('@/server/reports/billAgeing');
  const { displayOrderNumber, financialYearLabel } = await import('@/lib/orderDisplay');
  const { nextOrderIdentity } = await import('@/lib/orderIdentity');
  const { createDealerOrder } = await import('@/lib/dealerOrderCreate');
  const { placeOrderForApprovedDiscount } = await import('@/lib/discountApprovalOrder');

  // ── Seed: production as of 17 Nov 2026 ─────────────────────────────────────────
  console.log('Seeding …');
  const user = (email, role) => prisma.user.create({ data: { email, normalizedEmail: email, passwordHash: 'it', role, status: 'ACTIVE' } });
  const accountantUser = await user('it-accountant@example.test', 'ACCOUNTANT');
  const accountant = { userId: accountantUser.id, sessionId: 'it', role: 'ACCOUNTANT', displayName: 'IT Accountant' };
  const dealer = await prisma.dealerProfile.create({ data: {
    userId: (await user('it-devarya@example.test', 'DEALER')).id, businessName: 'IT Devarya', dealerCode: '9201',
    discountPercent: 50, creditDays: 60, creditLimitPaise: 50_000_000n, termsAcceptedAt: new Date(),
  } });
  const dealerId = String(dealer.id);
  const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

  const order = (id, orderNumber, orderDate, finalPayableAmountPaise, extra = {}) => prisma.order.create({ data: {
    id, orderNumber, orderDate: day(orderDate), dealerId: dealer.id, finalPayableAmountPaise, status: 'PROCESSING', acceptanceStatus: 'ACCEPTED', fulfilmentStatus: 'IN_PROCESS', ...extra,
  } });
  const item = (orderId, cat, quantityPacks, finalAmountPaise) => prisma.orderItem.create({ data: {
    orderId, productNameSnapshot: `Item ${cat}`, catalogueNumberSnapshot: cat, quantityPacks, packSize: 1, totalPieces: quantityPacks, finalAmountPaise,
  } });
  const shipment = (id, orderId, trackingNumber, iso) => prisma.orderShipment.create({ data: { id, orderId, dispatchPartner: 'DTDC', trackingNumber, createdAt: day(iso) } });
  const dispatch = (line, quantity, shipmentId) => prisma.orderItemDispatch.create({ data: { orderId: line.orderId, orderItemId: line.id, quantity, shipmentId, status: 'DISPATCHED' } });

  // Row 2250, saved as OM/26-27/DMS-1083: two parcels.
  await order(2250n, 'OM/26-27/DMS-1083', '2026-11-06', 9_221_750n);
  const a = await item(2250n, '139/6', 3, 274_500n);
  const b = await item(2250n, '50/9', 10, 500_000n);
  await shipment(129n, 2250n, 'D1026050672', '2026-11-14');
  await shipment(138n, 2250n, 'D1026050695', '2026-11-17');
  await dispatch(a, 2, 129n);
  await dispatch(b, 10, 138n);

  // Row 2263, saved as OM/26-27/DMS-1096: in the same parcel as shipment 138.
  await order(2263n, 'OM/26-27/DMS-1096', '2026-11-13', 695_750n, { status: 'DISPATCHED', fulfilmentStatus: 'COMPLETED' });
  await shipment(139n, 2263n, 'D1026050695', '2026-11-17');
  await dispatch(await item(2263n, '400/3', 2, 695_750n), 2, 139n);

  // An old PHP order: keeps its own number, stored on its bill by legacy id.
  await order(1505n, 'OM/2026/1505', '2026-09-17', 100_000n, { legacyPhpId: '1505', status: 'COMPLETED', fulfilmentStatus: 'COMPLETED' });

  // The account book's order debit for 2250, written with the number it was saved under.
  const wallet = await prisma.dealerWallet.create({ data: { dealerId: dealer.id, status: 'ACTIVE' } });
  const debit = await prisma.walletTransaction.create({ data: {
    dealerId: dealer.id, walletId: wallet.id, orderId: 2250n, type: 'ORDER_DEBIT', amountPaise: 1_000n, balanceBeforePaise: 1_000n, balanceAfterPaise: 0n,
    reference: 'OM/26-27/DMS-1083', note: 'Order wallet debit', metadata: { orderNumber: 'OM/26-27/DMS-1083' },
  } });

  // The invoices as saved in production: keyed by row id, GST included, no shipment linked.
  const bill = (id, orderId, orderNumber, billNumber, billAmountPaise, iso) => prisma.ledgerBill.create({ data: {
    id, dealerId: dealer.id, orderId, orderNumber, billNumber, billAmountPaise, gstPercent: 18, billDate: day(iso),
  } });
  await bill(16n, 2250n, '2250', '4644', 12_884_300n, '2026-11-13');
  await bill(17n, 2263n, '2263', '4682', 1_145_900n, '2026-11-14');
  await bill(18n, 1505n, '1505', 'L-1505', 100_000n, '2026-10-01');

  const numberOf = async (id) => (await prisma.order.findUniqueOrThrow({ where: { id } })).orderNumber;
  const ledger = () => getDealerLedger(accountant, dealerId);
  // Dispatch Tracking's To Bill, which Add Invoice now lists: shipments with no ledger bill.
  const toBill = async () => (await prisma.orderShipment.findMany({ where: { order: { dealerId: dealer.id }, ledgerBillId: null, dispatches: { some: {} } }, orderBy: { id: 'asc' } })).map((s) => String(s.id));

  // ── The renumber script ─────────────────────────────────────────────────────────
  console.log('\nscripts/sql/renumber-app-orders.sql');
  await check('before it runs, the old-invoice list already shows the numbers staff know', async () => {
    const early = await mkdtemp(resolvePath(tmpdir(), 'sapoms-old-invoices-'));
    const run = runSql('scripts/sql/old-invoice-parcels-list.sql', early);
    assert.equal(run.status, 0, run.stderr);
    const orderNos = (await readFile(resolvePath(early, 'old-invoice-parcels.csv'), 'utf8')).trim().split('\n').slice(1).map((row) => row.split(',')[5]);
    await rm(early, { recursive: true, force: true });
    assert.deepEqual(orderNos, ['OM/26-27/DMS-2250', 'OM/26-27/DMS-2250', 'OM/26-27/DMS-2263']);
    assert.equal(await numberOf(2250n), 'OM/26-27/DMS-1083', 'nothing renumbered yet');
  });
  await check('it stops and changes nothing when a new number already belongs to another order', async () => {
    await order(9999n, 'OM/26-27/DMS-2263', '2026-09-01', 0n, { legacyPhpId: '9999' });
    const run = renumber();
    assert.notEqual(run.status, 0, 'expected the script to fail');
    assert.match(run.stderr, /already belong to another order/);
    assert.equal(await numberOf(2250n), 'OM/26-27/DMS-1083');
    await prisma.order.delete({ where: { id: 9999n } });
  });
  await check('it gives app orders their id-based number and leaves the old PHP order alone', async () => {
    const run = renumber();
    assert.equal(run.status, 0, run.stderr);
    assert.equal(await numberOf(2250n), 'OM/26-27/DMS-2250');
    assert.equal(await numberOf(2263n), 'OM/26-27/DMS-2263');
    assert.equal(await numberOf(1505n), 'OM/2026/1505');
  });
  await check('it rewrites the account book copy of the number', async () => {
    const row = await prisma.walletTransaction.findUniqueOrThrow({ where: { id: debit.id } });
    assert.equal(row.reference, 'OM/26-27/DMS-2250');
    assert.equal(row.metadata.orderNumber, 'OM/26-27/DMS-2250');
  });
  await check('running it again changes nothing', async () => {
    const before = await prisma.order.findUniqueOrThrow({ where: { id: 2250n } });
    const run = renumber();
    assert.equal(run.status, 0, run.stderr);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: 2250n } });
    assert.equal(after.orderNumber, before.orderNumber);
    assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
  });

  // ── New orders ──────────────────────────────────────────────────────────────────
  console.log('\nNew orders');
  await check('a new order is numbered from its own id, in the financial year it was placed', async () => {
    const created = await prisma.$transaction(async (tx) => {
      const identity = await nextOrderIdentity(tx, new Date('2027-01-15T10:00:00+05:30'));
      return tx.order.create({ data: { id: identity.id, orderNumber: identity.orderNumber, dealerId: dealer.id } });
    });
    assert.equal(created.orderNumber, `OM/26-27/DMS-${String(created.id).padStart(3, '0')}`);
  });
  // The two real ways an order is created, for a dealer with no bills (so no credit block).
  const placerUser = await user('it-placer@example.test', 'DEALER');
  const placer = await prisma.dealerProfile.create({ data: { userId: placerUser.id, businessName: 'IT Placer', dealerCode: '9202', discountPercent: 50, creditDays: 30, creditLimitPaise: 50_000_000n, termsAcceptedAt: new Date() } });
  await prisma.product.create({ data: { productCode: 'IT-SB', name: 'IT Beaker', variants: { create: [{ sku: 'IT-SB-50', catalogueNumber: 'IT-SB-50', unitName: 'Pcs.', packSize: 10, priceBasis: 'pack', unitPricePaise: 10_000n, packPricePaise: 100_000n }] } } });
  const idBased = (o) => `OM/${financialYearLabel(new Date())}/DMS-${String(o.id).padStart(3, '0')}`;
  await check('an order the dealer places gets the number of its own id', async () => {
    const { order: placed } = await prisma.$transaction((tx) => createDealerOrder(tx, { productorder: JSON.stringify([{ catNo: 'IT-SB-50', quantityPacks: 1 }]) }, placer.id, { userId: placerUser.id, role: 'DEALER' }));
    assert.equal(placed.orderNumber, idBased(placed));
  });
  await check('an order placed when Admin approves a discount gets the number of its own id', async () => {
    const request = { id: 1n, dealerId: placer.id, orderId: null, orderDraftId: null, orderSnapshot: { products: [{ sku: 'IT-SB-50', productName: 'IT Beaker', quantity: 1, packSize: 10, grossAmount: 1000, finalAmount: 450 }] } };
    const placed = await prisma.$transaction((tx) => placeOrderForApprovedDiscount(tx, request, { userId: accountantUser.id }));
    assert.equal(placed.orderNumber, idBased(placed));
  });

  // ── What the ledger shows ───────────────────────────────────────────────────────
  console.log('\nThe ledger');
  await check('invoice rows show DMS-2250, DMS-2263 and the old order as DMS-1505', async () => {
    const labels = Object.fromEntries((await ledger()).bills.map((row) => [row.billNumber, row.orderLabel]));
    assert.deepEqual(labels, { 4644: 'OM/26-27/DMS-2250', 4682: 'OM/26-27/DMS-2263', 'L-1505': 'OM/26-27/DMS-1505' });
  });
  await check('order rows carry the number every screen shows', async () => {
    const row = (await ledger()).orders.find((o) => o.order_id === '2263');
    assert.equal(displayOrderNumber(row), 'OM/26-27/DMS-2263');
  });
  await check('the account book shows the order debit as DMS-2250', async () => {
    const { data } = await getDealerLedgerTransactions(accountant, dealerId, { page: 1, limit: 20 });
    assert.equal(data.find((tx) => tx.type === 'order_debit').invoice, 'OM/26-27/DMS-2250');
  });
  // ── Old invoices: accounts mark which parcels each includes, a script applies it ───
  console.log('\nOld invoices: old-invoice-parcels-list.sql, then link-old-invoice-parcels.sql');
  const work = await mkdtemp(resolvePath(tmpdir(), 'sapoms-old-invoices-'));
  const csvPath = resolvePath(work, 'old-invoice-parcels.csv');
  const billOf = async (id) => String((await prisma.orderShipment.findUniqueOrThrow({ where: { id } })).ledgerBillId);
  // The list's rows keyed by parcel id; the test seed has no commas inside fields.
  let header;
  let rows;
  const writeMarked = (marks) => writeFile(csvPath, [header, ...rows.map((row) => {
    const cells = row.split(',');
    cells[cells.length - 1] = marks[cells[6]] ?? '';
    return cells.join(',');
  })].join('\n') + '\n');
  const linkOld = () => runSql('scripts/sql/link-old-invoice-parcels.sql', work);

  await check('the list has one row per old invoice and parcel of its orders, with a blank "included"', async () => {
    const run = runSql('scripts/sql/old-invoice-parcels-list.sql', work);
    assert.equal(run.status, 0, run.stderr);
    [header, ...rows] = (await readFile(csvPath, 'utf8')).trim().split('\n');
    assert.equal(header, 'invoice_id,invoice_no,invoice_date,invoice_amount_incl_gst,dealer,order_no,parcel_id,courier,tracking,dispatched,parcel_value_before_gst,hint,included');
    assert.deepEqual(rows.map((row) => row.split(',')).map((c) => `#${c[1]} ${c[5]} parcel ${c[6]} ${c[11]} [${c[12]}]`), [
      '#4644 OM/26-27/DMS-2250 parcel 129 order has 2 parcels: check the invoice copy []',
      '#4644 OM/26-27/DMS-2250 parcel 138 order has 2 parcels: check the invoice copy []',
      '#4682 OM/26-27/DMS-2263 parcel 139 only parcel of this order []',
    ]);
  });
  await check('applying it stops and changes nothing while a row is left blank', async () => {
    await writeMarked({ 129: 'Y', 139: 'Y' });
    const run = linkOld();
    assert.notEqual(run.status, 0, 'expected the script to refuse');
    assert.match(run.stderr, /Fill "included" with Y or N for: invoice 4644 parcel 138/);
    assert.deepEqual(await toBill(), ['129', '138', '139']);
  });
  await check('it stops when a parcel is marked under an invoice of another order', async () => {
    rows.push(rows[2].replace(/^17,4682/, '17,4682').replace(/,139,/, ',138,'));
    await writeMarked({ 129: 'Y', 138: 'Y', 139: 'Y' });
    const run = linkOld();
    assert.notEqual(run.status, 0, 'expected the script to refuse');
    assert.match(run.stderr, /(not on the orders|more than one invoice)/);
    rows.pop();
    assert.deepEqual(await toBill(), ['129', '138', '139']);
  });
  await check('with every row marked, Y parcels go under their invoice and N parcels stay to bill', async () => {
    await writeMarked({ 129: 'Y', 138: 'N', 139: 'y' });
    const run = linkOld();
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual([await billOf(129n), await billOf(139n)], ['16', '17']);
    assert.deepEqual(await toBill(), ['138']);
  });
  await check('running it again changes nothing', async () => {
    const run = linkOld();
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(await toBill(), ['138']);
  });
  await rm(work, { recursive: true, force: true });

  // ── Billing the parcel no old invoice covers ───────────────────────────────────────
  console.log('\nBilling by shipment');
  await check('a shipment of another order is refused (409) and nothing is saved', async () => {
    const before = await prisma.ledgerBill.count();
    assert.equal(await statusOf(recordLedgerBill(accountant, dealerId, { orderNumbers: ['2263'], shipmentIds: ['138'], billAmount: 100, gstPercent: 18, billDate: '2026-11-17', billNumber: 'IT-X' })), 409);
    assert.equal(await prisma.ledgerBill.count(), before);
  });
  await check('saving links the shipment and shows the order as DMS-2250', async () => {
    const { bill: saved } = await recordLedgerBill(accountant, dealerId, { orderNumbers: ['2250'], shipmentIds: ['138'], billAmount: 10_225.29, gstPercent: 18, billDate: '2026-11-17', billNumber: 'IT-138' });
    assert.equal(saved.orderLabel, 'OM/26-27/DMS-2250');
    assert.equal(String((await prisma.orderShipment.findUniqueOrThrow({ where: { id: 138n } })).ledgerBillId), saved.id);
    assert.deepEqual(await toBill(), []);
  });
  await check('an already billed shipment is refused (409)', async () => {
    assert.equal(await statusOf(recordLedgerBill(accountant, dealerId, { orderNumbers: ['2250'], shipmentIds: ['138'], billAmount: 100, gstPercent: 18, billDate: '2026-11-17', billNumber: 'IT-Y' })), 409);
  });

  // ── Payments and reports ─────────────────────────────────────────────────────────
  console.log('\nPayments and reports');
  await check('a payment against #4644 shows DMS-2250 in the account book', async () => {
    await recordLedgerPayment(accountant, dealerId, { idempotencyKey: 'it-pay-1', billId: '16', amount: 1000, paymentMode: 'NEFT', paymentDate: '2026-11-17', referenceId: '2250', narration: 'Payment against bill OM/26-27/DMS-2250' });
    const { data } = await getDealerLedgerTransactions(accountant, dealerId, { page: 1, limit: 20 });
    assert.equal(data[0].invoice, 'OM/26-27/DMS-2250');
  });
  await check('a payment reference the accountant typed is left as typed', async () => {
    await recordLedgerPayment(accountant, dealerId, { idempotencyKey: 'it-pay-2', billId: '17', amount: 500, paymentMode: 'NEFT', paymentDate: '2026-11-17', referenceId: 'UTR2250', narration: 'x' });
    const { data } = await getDealerLedgerTransactions(accountant, dealerId, { page: 1, limit: 20 });
    assert.equal(data[0].invoice, 'UTR2250');
  });
  await check('the bill-ageing report shows the same numbers', async () => {
    const rows = await listUnpaidBills({ id: dealer.id });
    assert.deepEqual(rows.map((row) => row.billNo).sort(), ['OM/26-27/DMS-1505', 'OM/26-27/DMS-2250', 'OM/26-27/DMS-2250', 'OM/26-27/DMS-2263']);
  });

  if (process.env.IT_KEEP_DB === '1') console.log(`\nKept ${DB_NAME}.`);
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
