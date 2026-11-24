// Integration test for scripts/import-opening-bills.mjs (the 31 Oct 2026 balance sheet) and
// the Outstanding it feeds (getDealerCreditStatus), run against a real, throwaway Postgres
// database (created, migrated, seeded, then dropped). The sheet is built here in the real
// file's column order, and the import script is run exactly as on production.
//
// Run: IT_DATABASE_URL=postgresql://user:pass@localhost:5432/anydb npm run test:opening-bills
//   IT_DATABASE_URL  any database on a LOCAL server (used only to CREATE/DROP the test DB)
//   IT_KEEP_DB=1     keep the seeded DB afterwards
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire, register } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, '..');
const XLSX = createRequire(import.meta.url)('xlsx');

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

const DAY = 86_400_000;
const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
// An Excel date cell: days since 30 Dec 1899, as the real sheet's date column holds them.
const serial = (iso) => (day(iso).getTime() - Date.UTC(1970, 0, 1)) / DAY + 25569;

let prisma;
let work;
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
  const { getDealerCreditStatus, reserveDealerCredit } = await import('@/lib/dealerCreditLimit');
  const { recordLedgerPayment } = await import('@/lib/ledgerSystem');

  // ── Seed: credit dealers as the sheet names them, more or less ──────────────────
  console.log('Seeding …');
  const user = (email, status = 'ACTIVE') => prisma.user.create({ data: { email, normalizedEmail: email, passwordHash: 'it', role: 'DEALER', status } });
  const dealer = async (email, data, status) => prisma.dealerProfile.create({ data: {
    userId: (await user(email, status)).id, discountPercent: 50, creditDays: 30, creditLimitPaise: 100_000_000n, termsAcceptedAt: new Date(), ...data,
  } });
  const alpha = await dealer('it-alpha@example.test', { businessName: 'IT Alpha Scientific', dealerCode: '9401', city: 'Pune', gstin: '27AAAAA0000A1Z5' });
  // Matched by name only (case and punctuation differ), and its login is deactivated.
  const beta = await dealer('it-beta@example.test', { businessName: 'I.T. Beta Traders', dealerCode: '9402', city: 'Delhi' }, 'INACTIVE');
  // Two branches sharing one GST: the sheet's city decides.
  const gammaHyd = await dealer('it-gamma-hyd@example.test', { businessName: 'IT Gamma Labs', dealerCode: '9403', city: 'Hyderabad', gstin: '36GGGGG0000G1Z5' });
  const gammaVizag = await dealer('it-gamma-vizag@example.test', { businessName: 'IT Gamma Labs', dealerCode: '9404', city: 'Vizag', gstin: '36GGGGG0000G1Z5' });
  const accountantUser = await prisma.user.create({ data: { email: 'it-accountant@example.test', normalizedEmail: 'it-accountant@example.test', passwordHash: 'it', role: 'ACCOUNTANT', status: 'ACTIVE' } });
  const accountant = { userId: accountantUser.id, sessionId: 'it', role: 'ACCOUNTANT', displayName: 'IT Accountant' };

  // ── The sheet: _, name, city, gst, 31 Oct balance, bill no, date, amount ─────────
  const row = (billNo, date, amount) => [null, null, null, null, null, billNo, date, amount];
  const sheet = [
    ['SR', 'DEALER NAME', 'CITY', 'GST', '31 OCT BAL', 'BILL NO', 'DATE', 'AMOUNT'],
    [1, 'IT ALPHA SCIENTIFIC', 'PUNE', '27aaaaa0000a1z5', '15000', 4101, serial('2026-09-01'), 10000],
    row(4102, '15/10/2026', 2500), // typed as text, dd/mm/yyyy
    row(4103, serial('2026-10-20'), 1000), // one bill split over two lines
    row(4103, serial('2026-10-20'), 500),
    row('25-26 OPENING DIFF', null, 300), // carried over from FY 25-26
    row(4108, '10/10/20264', 700), // the sheet's typo, fixed by the script
    row(4109, '05/11/2026', 900), // problem: after 31 Oct
    row('CASH', serial('2026-10-01'), 100), // problem: not a bill number
    row(4102, '16/10/2026', 50), // problem: bill number repeated
    [2, 'IT BETA TRADERS', 'DELHI', null, '4000', 5001, serial('2026-10-25'), 4000],
    [3, 'IT GAMMA LABS', 'VIZAG', '36GGGGG0000G1Z5', '800', 6001, serial('2026-10-28'), 800],
    [4, 'IT NOWHERE STORES', 'GOA', null, '1200', 7001, serial('2026-10-02'), 1200], // problem: no such dealer
    [5, 'IT EMPTY DEALER', 'GOA', null, '999', null, null, null], // problem: a balance with no bills
    [6, 'IT NIL DEALER', 'GOA', null, 'NIL', null, null, null], // nothing owed, nothing to do
  ];
  work = await mkdtemp(resolvePath(tmpdir(), 'sapoms-opening-bills-'));
  const file = resolvePath(work, 'Balance Amount Dealer list.xlsx');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheet), 'Sheet1');
  XLSX.writeFile(book, file);

  const runImport = (...args) => {
    const run = spawnSync(process.execPath, [resolvePath(ROOT, 'scripts/import-opening-bills.mjs'), file, ...args], {
      cwd: ROOT, env: { ...process.env, DATABASE_URL: TEST_URL, DIRECT_URL: TEST_URL }, encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  };
  const saved = async () => (await prisma.ledgerBill.findMany({ orderBy: { id: 'asc' } }))
    .map((b) => `${b.dealerId} ${b.billNumber} ${b.billDate.toISOString().slice(0, 10)} ${b.billAmountPaise} [${b.orderNumber}]`).sort();
  const expected = [
    `${alpha.id} 4101 2026-09-01 1000000 []`,
    `${alpha.id} 4102 2026-10-15 250000 []`,
    `${alpha.id} 4103 2026-10-20 150000 []`,
    `${alpha.id} 4108 2026-10-10 70000 []`,
    `${alpha.id} 25-26 OPENING DIFF 2026-03-31 30000 []`,
    `${beta.id} 5001 2026-10-25 400000 []`,
    `${gammaVizag.id} 6001 2026-10-28 80000 []`,
  ].sort();

  // ── The import ──────────────────────────────────────────────────────────────────
  console.log('\nscripts/import-opening-bills.mjs');
  await check('a dry run names the database it reads and writes nothing', async () => {
    const out = runImport();
    assert.match(out, new RegExp(`^DRY RUN -> localhost/${DB_NAME}\\n`));
    assert.match(out, /nothing written; 5 row\(s\) need fixing in the sheet/);
    assert.equal(await prisma.ledgerBill.count(), 0);
  });
  await check('--dealer imports that dealer alone, even with its login deactivated', async () => {
    const out = runImport('--dealer', 'IT BETA TRADERS', '--apply');
    assert.match(out, /inserted 1;/);
    assert.deepEqual(await saved(), [`${beta.id} 5001 2026-10-25 400000 []`]);
  });
  await check('--apply saves one opening bill per sheet bill and skips every problem row', async () => {
    const out = runImport('--apply');
    assert.match(out, /inserted 6; 5 row\(s\) need fixing in the sheet/);
    assert.deepEqual(await saved(), expected);
    for (const problem of ['dated 2026-11-05, after 31 Oct', 'not a bill number', 'bill number repeated in sheet', 'IT NOWHERE STORES: no dealer matches', 'IT EMPTY DEALER: balance 999 has no bills listed']) {
      assert.ok(out.includes(problem), `reported: ${problem}`);
    }
    assert.equal(await prisma.ledgerBill.count({ where: { dealerId: gammaHyd.id } }), 0, 'the other branch gets nothing');
  });
  await check('running it again saves nothing new', async () => {
    const out = runImport('--apply');
    assert.match(out, /inserted 0;/);
    assert.match(out, /already saved, skip/);
    assert.deepEqual(await saved(), expected);
  });

  // ── What Outstanding makes of it ─────────────────────────────────────────────────
  console.log('\nOutstanding');
  const status = async (d) => getDealerCreditStatus(prisma, await prisma.dealerProfile.findUniqueOrThrow({ where: { id: d.id } }));
  await check("after the import, Outstanding is the sheet's balance and an overdue bill blocks ordering", async () => {
    const alphaStatus = await status(alpha);
    assert.equal(alphaStatus.usedPaise, 1_500_000n);
    assert.equal(alphaStatus.isOverdue, true, 'bill 4101 of 1 Sep is past its 30 days');
    assert.equal((await prisma.$transaction((tx) => reserveDealerCredit(tx, alpha.id, 100n)))?.code, 'credit_overdue');
    assert.equal((await status(beta)).usedPaise, 400_000n);
  });
  await check('later orders, bills and payments move Outstanding by the rule, on the real query', async () => {
    const order = (orderDate, rupees, status = 'ACCEPTED') => prisma.order.create({ data: { orderNumber: `IT-${orderDate}-${status}`, dealerId: alpha.id, orderDate: new Date(orderDate), status, finalPayableAmountPaise: BigInt(rupees * 100) } });
    const earlier = await order('2026-10-29T12:00:00+05:30', 2000); // inside the opening balance
    await order('2026-11-05T12:00:00+05:30', 3000); // counts
    await order('2026-11-06T12:00:00+05:30', 4000, 'DECLINED'); // never counts
    // A bill dated after 31 Oct for the earlier order counts in full, less paid.
    await prisma.ledgerBill.create({ data: { dealerId: alpha.id, orderId: earlier.id, orderNumber: String(earlier.id), billNumber: '4201', billAmountPaise: 250_000n, paidAmountPaise: 50_000n, billDate: day('2026-11-14') } });
    // Rs 1,000 paid against opening bill 4102, through the accountant's Pay Money.
    const bill4102 = await prisma.ledgerBill.findFirstOrThrow({ where: { dealerId: alpha.id, billNumber: '4102' } });
    await recordLedgerPayment(accountant, String(alpha.id), { idempotencyKey: 'it-opening-pay', billId: String(bill4102.id), amount: 1000, paymentMode: 'NEFT', narration: 'IT payment' });

    const alphaStatus = await status(alpha);
    assert.equal(alphaStatus.usedPaise, 1_900_000n, 'Rs 15,000 + 3,000 + 2,000 - 1,000');
    assert.equal(alphaStatus.remainingPaise, 100_000_000n - 1_900_000n);
  });

  if (process.env.IT_KEEP_DB === '1') console.log(`\nKept ${DB_NAME}.`);
} catch (error) {
  exitCode = 1;
  console.error('\nAborted:', error);
} finally {
  if (work) await rm(work, { recursive: true, force: true });
  await prisma?.$disconnect();
  if (process.env.IT_KEEP_DB !== '1') await server.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`);
  await server.$disconnect();
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${process.env.IT_KEEP_DB === '1' ? '' : `; ${DB_NAME} dropped`}.`);
process.exit(failed.length || exitCode ? 1 : 0);
