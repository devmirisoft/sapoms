// Integration test for the Orders list "Order No." filter, run against a real, throwaway
// Postgres database (created, migrated, seeded, then dropped). Legacy orders can be stored
// with leading zeros ("02269") but the list shows them stripped ("DMS-2269"); the filter
// must find them by the number the user sees.
//
// Run: IT_DATABASE_URL=postgresql://user:pass@localhost:5432/anydb npm run test:order-search
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

let prisma;
let exitCode = 0;
try {
  console.log(`Creating ${DB_NAME} …`);
  await server.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
  const migrate = spawnSync(process.execPath, [resolvePath(ROOT, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: ROOT, env: { ...process.env, DATABASE_URL: TEST_URL, DIRECT_URL: TEST_URL }, encoding: 'utf8', // prisma.config.ts migrates DIRECT_URL first
  });
  assert.equal(migrate.status, 0, `${migrate.stdout}\n${migrate.stderr}`);

  // The app's prisma singleton reads DATABASE_URL when first imported, so point it at the test DB first.
  process.env.DATABASE_URL = TEST_URL;
  process.env.PROJ_ROOT ??= ROOT;
  register(pathToFileURL(resolvePath(HERE, 'invoice-ts-loader.mjs')).href);
  // next/server ships no "exports" map, so plain-node ESM needs the file name.
  register(`data:text/javascript,${encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/server" || s === "next/headers" ? s + ".js" : s, c); }')}`);

  ({ prisma } = await import('@/server/db/prisma'));
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  assert.equal(db, DB_NAME, 'the app client must be connected to the throwaway database');
  const { listPostgresOrderPage } = await import('@/lib/postgresOrders');
  const { displayOrderNumber, formatDisplayOrderNumber, highlightOrderNumber } = await import('@/lib/orderDisplay');

  // ── Seed: legacy orders, plus app orders (no legacy id) on fixed ids that miss every search input ──
  console.log('Seeding …');
  const dealerUser = await prisma.user.create({ data: { email: 'it-dealer@example.test', normalizedEmail: 'it-dealer@example.test', passwordHash: 'x', role: 'DEALER', status: 'ACTIVE' } });
  const dealer = await prisma.dealerProfile.create({ data: { userId: dealerUser.id, businessName: 'IT Search Dealer', dealerCode: '9101', discountPercent: 0, termsAcceptedAt: new Date() } });
  const order = (label, legacyPhpId, { status = 'ACCEPTED', id } = {}) => prisma.order.create({
    data: { id, orderNumber: `IT/26-27/${label}`, legacyPhpId, dealerId: dealer.id, createdByUserId: dealerUser.id, status },
  });
  for (const legacyPhpId of ['7', '70', '10', '230', '02269']) await order(`L-${legacyPhpId}`, legacyPhpId);
  await order('L-CANCELLED', '022690', { status: 'CANCELLED' });
  // Like production, an app order's row id and its number differ (row 2263 is OM/26-27/DMS-1096).
  const appOrder = (number, id) => prisma.order.create({ data: { id, orderNumber: `OM/26-27/DMS-${number}`, legacyPhpId: null, dealerId: dealer.id, createdByUserId: dealerUser.id, status: 'ACCEPTED' } });
  const A = await appOrder('1083', 900n);
  const B = await appOrder('1096', 901n);

  const admin = { role: 'admin', actorId: '1' };
  const search = async (orderId) => {
    const { rows } = await listPostgresOrderPage({ actor: admin, page: 1, pageSize: 100, filters: { orderId } });
    return rows.map((row) => String(row.order_id)).sort();
  };
  const sorted = (...ids) => ids.map(String).sort();

  console.log('\nOrder No. filter');
  const cases = [
    ['2269', ['02269'], 'the reported bug: the number shown in the list finds the zero-padded order'],
    ['02269', ['02269'], 'the zero-padded form still works'],
    ['007', ['7'], 'a padded number is complete (exact)'],
    ['7', ['7', '70'], 'a bare number is a prefix'],
    ['010', ['10'], 'padded 010 is order 10 only'],
    ['23', ['230'], 'prefix inside legacy ids'],
    ['%', [], 'LIKE wildcards are literal'],
  ];
  for (const [input, expected, why] of cases) {
    await check(`${JSON.stringify(input)} → [${expected.join(', ')}]: ${why}`, async () => {
      assert.deepEqual(await search(input), sorted(...expected));
    });
  }
  await check('"0" does not filter (mid-typing): every non-cancelled order, never the cancelled one', async () => {
    assert.deepEqual(await search('0'), sorted('7', '70', '10', '230', '02269', A.id, B.id));
  });
  await check('an app order (no legacy id) is found by its own number, not its row id', async () => {
    assert.deepEqual(await search('1083'), sorted(A.id));
    assert.deepEqual(await search('109'), sorted(B.id));
    assert.deepEqual(await search(String(A.id)), [], 'the row id 900 must find nothing');
  });
  await check('a bare prefix finds legacy ids and app numbers alike', async () => {
    assert.deepEqual(await search('10'), sorted('10', A.id, B.id));
  });

  console.log('\nWhat the list renders for the match');
  await check('the 2269 row displays as DMS-2269 with the search highlighted, not DMS-mark>', async () => {
    const { rows } = await listPostgresOrderPage({ actor: admin, page: 1, pageSize: 100, filters: { orderId: '2269' } });
    assert.equal(rows.length, 1);
    assert.match(displayOrderNumber(rows[0]), /\/DMS-2269$/);
    const html = highlightOrderNumber(displayOrderNumber(rows[0]), '2269');
    assert.match(html, /DMS-<mark [^>]*>2269<\/mark>$/);
    assert.doesNotMatch(html.replace(/<[^>]+>/g, ''), /mark>/);
  });
  await check('an app order displays its own number, not one built from its row id', async () => {
    const { rows } = await listPostgresOrderPage({ actor: admin, page: 1, pageSize: 100, filters: { orderId: '1083' } });
    assert.equal(displayOrderNumber(rows[0]), 'OM/26-27/DMS-1083');
    assert.equal(formatDisplayOrderNumber(rows[0].order_id), 'OM/26-27/DMS-900', 'the old id-based number, for contrast');
  });
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
