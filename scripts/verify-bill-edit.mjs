// Integration test for the accountant's bill correction (updateLedgerBill), run against a
// real, throwaway Postgres database (created, migrated, seeded, then dropped).
// Each check names the section of the "Correcting Entered Bills" proposal it proves.
//
// Run: IT_DATABASE_URL=postgresql://user:pass@localhost:5432/anydb npm run test:bill-edit
//   IT_DATABASE_URL  any database on a LOCAL server (used only to CREATE/DROP the test DB)
//   IT_KEEP_DB=1     keep the seeded DB afterwards
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
// The HTTP status a call fails with, or 'ok'.
const statusOf = async (promise) => { try { await promise; return 'ok'; } catch (error) { return error.status ?? String(error); } };
const isoDaysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

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
  const CLOUD = (process.env.CLOUDINARY_CLOUD_NAME ||= 'it-cloud');
  register(pathToFileURL(resolvePath(HERE, 'invoice-ts-loader.mjs')).href);
  // next/server ships no "exports" map, so plain-node ESM needs the file name.
  register(`data:text/javascript,${encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/server" || s === "next/headers" ? s + ".js" : s, c); }')}`);

  ({ prisma } = await import('@/server/db/prisma'));
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  assert.equal(db, DB_NAME, 'the app client must be connected to the throwaway database');
  const { updateLedgerBill, recordLedgerBill, recordLedgerPayment } = await import('@/lib/ledgerSystem');
  const { getDealerCreditStatus } = await import('@/lib/dealerCreditLimit');

  // ── Seed: a 30-day credit dealer with a Rs 5,000 bill, Rs 2,000 of it paid ──
  console.log('Seeding …');
  const user = (email, role) => prisma.user.create({ data: { email, normalizedEmail: email, passwordHash: 'it', role, status: 'ACTIVE' } });
  const accountantUser = await user('it-accountant@example.test', 'ACCOUNTANT');
  const adminUser = await user('it-admin@example.test', 'ADMIN');
  const dealer = await prisma.dealerProfile.create({ data: { userId: (await user('it-credit-dealer@example.test', 'DEALER')).id, businessName: 'IT Credit Dealer', dealerCode: '9002', discountPercent: 50, creditDays: 30, creditLimitPaise: 1_000_000_000n, termsAcceptedAt: new Date() } });
  const other = await prisma.dealerProfile.create({ data: { userId: (await user('it-other-dealer@example.test', 'DEALER')).id, businessName: 'IT Other Dealer', dealerCode: '9003', discountPercent: 50, creditDays: 30, termsAcceptedAt: new Date() } });
  const accountant = { userId: accountantUser.id, sessionId: 'it', role: 'ACCOUNTANT', displayName: 'IT Accountant' };
  const admin = { userId: adminUser.id, sessionId: 'it', role: 'ADMIN', displayName: 'IT Admin' };

  const upload = (name) => ({ name, url: `https://res.cloudinary.com/${CLOUD}/raw/upload/v1/sapoms/ledger-bills/${dealer.id}/${name}-it`, publicId: `sapoms/ledger-bills/${dealer.id}/${name}-it` });
  const today = isoDaysAgo(0);
  const past = isoDaysAgo(60); // past the 30 credit days
  const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
  const bill = await prisma.ledgerBill.create({ data: {
    dealerId: dealer.id, orderNumber: 'IT-1', billNumber: 'INV-1', billAmountPaise: 500_000n, gstPercent: 18, billDate: day(today),
    pdfFiles: [upload('a'), upload('b')], pdfName: 'a, b', pdfUrl: upload('a').url, paidAmountPaise: 200_000n,
  } });
  await prisma.ledgerBill.create({ data: { dealerId: dealer.id, orderNumber: 'IT-2', billNumber: 'INV-2', billAmountPaise: 100_000n, billDate: day(today) } });
  const legacyUrl = 'https://res.cloudinary.com/legacy-cloud/raw/upload/old';
  const legacy = await prisma.ledgerBill.create({ data: { dealerId: dealer.id, orderNumber: 'IT-4', billAmountPaise: 100_000n, billDate: day(today), pdfName: 'old.pdf', pdfUrl: legacyUrl } });

  const base = { billId: String(bill.id), billAmount: 5000, gstPercent: 18, billDate: today, billNumber: 'INV-1', keepPdfUrls: [upload('a').url, upload('b').url], newPdfFiles: [], reason: 'IT correction' };
  const edit = (body = {}, actor = accountant, dealerId = String(dealer.id)) => updateLedgerBill(actor, dealerId, { ...base, ...body });
  const row = () => prisma.ledgerBill.findUniqueOrThrow({ where: { id: bill.id } });
  const audits = () => prisma.authAuditLog.findMany({ where: { entity: 'INVOICE', entityId: String(bill.id) }, orderBy: { id: 'asc' } });

  // ── Safeguards ───────────────────────────────────────────────────────────────
  await check('Safeguards 2', 'amount below what was paid is refused (Rs 1,500 < Rs 2,000 paid)', async () => {
    assert.equal(await statusOf(edit({ billAmount: 1500 })), 422);
    assert.equal((await row()).billAmountPaise, 500_000n);
  });
  await check('Safeguards 1', 'only the accountant can edit (admin refused)', async () => assert.equal(await statusOf(edit({ billAmount: 6000 }, admin)), 403));
  await check('Safeguards 3', 'a bill number already used for this dealer is refused', async () => assert.equal(await statusOf(edit({ billNumber: 'INV-2' })), 409));
  await check('Decision 1', 'a reason is required', async () => assert.equal(await statusOf(edit({ billAmount: 6000, reason: '  ' })), 400));
  await check('Safeguards', "a bill can't be edited through another dealer's ledger", async () => assert.equal(await statusOf(edit({ billAmount: 6000 }, accountant, String(other.id))), 404));
  await check('Safeguards', 'a PDF URL outside this app\'s Cloudinary is refused, on edit and on create', async () => {
    assert.equal(await statusOf(edit({ newPdfFiles: [{ name: 'x', url: 'http://169.254.169.254/latest/meta-data' }] })), 400);
    assert.equal(await statusOf(recordLedgerBill(accountant, String(dealer.id), { orderNumbers: ['IT-3'], billAmount: 100, billDate: today, pdfFiles: [{ name: 'x', url: 'https://evil.example/x.pdf' }] })), 400);
  });
  await check('Safeguards 4', 'saving with nothing changed writes nothing', async () => {
    assert.equal((await edit()).changed, false);
    assert.equal((await audits()).length, 0);
  });

  // ── The correction itself ────────────────────────────────────────────────────
  await check('Effects', 'the dealer is not overdue before the edit', async () => assert.equal((await getDealerCreditStatus(prisma, dealer)).isOverdue, false));

  const corrected = { billAmount: 6000, gstPercent: 12, billDate: past, billNumber: 'INV-1A' };
  await check('What can change', 'amount, date, number, GST and PDFs are corrected; paid amount untouched', async () => {
    const result = await edit({ ...corrected, keepPdfUrls: [upload('a').url], newPdfFiles: [upload('c')] });
    assert.equal(result.changed, true);
    assert.equal(result.bill.billAmount, 6000);
    const saved = await row();
    assert.equal(saved.billAmountPaise, 600_000n);
    assert.equal(Number(saved.gstPercent), 12);
    assert.equal(saved.billDate.toISOString().slice(0, 10), past);
    assert.equal(saved.billNumber, 'INV-1A');
    assert.equal(saved.paidAmountPaise, 200_000n);
    assert.deepEqual(saved.pdfFiles.map((file) => file.name), ['a', 'c']);
    assert.equal(saved.pdfName, 'a, c');
    assert.equal(saved.pdfUrl, upload('a').url);
  });
  await check('Safeguards 4', 'one audit row with old and new values and the reason', async () => {
    const rows = await audits();
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].oldValues, { billAmount: 5000, gstPercent: 18, billDate: today, billNumber: 'INV-1', pdfs: ['a', 'b'] });
    assert.deepEqual(rows[0].newValues, { billAmount: 6000, gstPercent: 12, billDate: past, billNumber: 'INV-1A', pdfs: ['a', 'c'] });
    assert.equal(rows[0].metadata.change, 'bill_edited');
    assert.equal(rows[0].metadata.reason, 'IT correction');
  });
  await check('Effects', 'moving the date past due makes the credit dealer overdue', async () => assert.equal((await getDealerCreditStatus(prisma, dealer)).isOverdue, true));

  await check('What can change', 'removing every PDF puts the bill back to "PDF pending"', async () => {
    await edit({ ...corrected, keepPdfUrls: [] });
    const saved = await row();
    assert.equal(saved.pdfFiles, null);
    assert.equal(saved.pdfUrl, null);
    assert.equal(saved.pdfName, null);
  });
  await check('What can change', 'a legacy single-PDF bill keeps its file when another is attached', async () => {
    await updateLedgerBill(accountant, String(dealer.id), { billId: String(legacy.id), billAmount: 1000, gstPercent: 0, billDate: today, billNumber: '', keepPdfUrls: [legacyUrl], newPdfFiles: [upload('d')], reason: 'attach PDF' });
    const saved = await prisma.ledgerBill.findUniqueOrThrow({ where: { id: legacy.id } });
    assert.deepEqual(saved.pdfFiles.map((file) => file.name), ['old.pdf', 'd']);
  });

  // ── Pay Money: what the key every pay screen sends buys ─────────────────────────
  const credits = () => prisma.walletTransaction.count({ where: { dealerId: dealer.id, type: 'CREDIT' } });
  const pay = (idempotencyKey) => recordLedgerPayment(accountant, String(dealer.id), { idempotencyKey, billId: String(bill.id), amount: 500, paymentMode: 'Cash', narration: 'IT payment' });
  await check('Pay Money', 'a payment without a key is refused (400) and nothing is saved', async () => {
    const before = (await row()).paidAmountPaise;
    assert.equal(await statusOf(pay('')), 400);
    assert.equal(await credits(), 0);
    assert.equal((await row()).paidAmountPaise, before);
  });
  await check('Pay Money', 'the same key twice (a double click, or a retry after a lost reply) pays once', async () => {
    const before = (await row()).paidAmountPaise;
    assert.ok(!(await pay('it-pay-A')).duplicate);
    assert.equal((await pay('it-pay-A')).duplicate, true);
    assert.equal(await credits(), 1);
    assert.equal((await row()).paidAmountPaise, before + 50_000n);
  });
  await check('Pay Money', 'a new key is a new payment', async () => {
    const before = (await row()).paidAmountPaise;
    await pay('it-pay-B');
    assert.equal(await credits(), 2);
    assert.equal((await row()).paidAmountPaise, before + 50_000n);
  });

  // ── With the other changes in this push ──────────────────────────────────────────
  await check('With opening bills', 'correcting an imported opening bill moves Outstanding by the difference', async () => {
    const opening = await prisma.ledgerBill.create({ data: { dealerId: dealer.id, orderNumber: '', billNumber: '9101', billAmountPaise: 500_000n, billDate: day('2026-10-15') } });
    const before = (await getDealerCreditStatus(prisma, dealer)).usedPaise;
    await updateLedgerBill(accountant, String(dealer.id), { billId: String(opening.id), billAmount: 4000, gstPercent: 0, billDate: '2026-10-15', billNumber: '9101', keepPdfUrls: [], newPdfFiles: [], reason: 'sheet typo' });
    assert.equal((await getDealerCreditStatus(prisma, dealer)).usedPaise, before - 100_000n);
    assert.equal((await prisma.ledgerBill.findUniqueOrThrow({ where: { id: opening.id } })).orderNumber, '', 'still an opening bill');
  });
  await check('With shipment billing', "correcting a bill's amount keeps the shipments it covers", async () => {
    const order = await prisma.order.create({ data: { orderNumber: 'IT-SHIP', dealerId: dealer.id } });
    const parcel = await prisma.orderShipment.create({ data: { orderId: order.id, dispatchPartner: 'DTDC', trackingNumber: 'IT-AWB-1', ledgerBillId: bill.id } });
    const current = await row();
    await edit({ billAmount: Number(current.billAmountPaise) / 100 + 500, gstPercent: Number(current.gstPercent), billDate: current.billDate.toISOString().slice(0, 10), billNumber: current.billNumber, keepPdfUrls: [] });
    assert.equal((await row()).billAmountPaise, current.billAmountPaise + 50_000n);
    assert.equal((await prisma.orderShipment.findUniqueOrThrow({ where: { id: parcel.id } })).ledgerBillId, bill.id);
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
