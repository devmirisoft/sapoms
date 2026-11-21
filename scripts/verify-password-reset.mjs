// Integration test for forgot password: the request and confirm routes and the shared
// code check (verifyEmailOtpForUser), run against a real, throwaway Postgres database
// (created, migrated, seeded, then dropped).
// No email can leave: @/server/auth/email is swapped for a stub that only records
// { to, otp }, and the SMTP settings are blanked before anything loads.
//
// Run: IT_DATABASE_URL=postgresql://user:pass@localhost:5432/anydb npm run test:password-reset
//   IT_DATABASE_URL  any database on a LOCAL server (used only to CREATE/DROP the test DB)
//   IT_KEEP_DB=1     keep the seeded DB afterwards
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

// ── Safety: only ever a fresh database on a local server, and no real mail ───────
if (!process.env.IT_DATABASE_URL) throw new Error('Set IT_DATABASE_URL to a database on a local Postgres server.');
const serverUrl = new URL(process.env.IT_DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(serverUrl.hostname)) {
  throw new Error(`Refusing to run against ${serverUrl.hostname}: IT_DATABASE_URL must point at localhost.`);
}
for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM']) process.env[key] = '';
process.env.AUTH_OTP_PEPPER = randomBytes(24).toString('hex');
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
const json = (value) => JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? String(v) : v));

// The mailer stub: records every code, or fails while globalThis.__mailDown is set.
globalThis.__mail = [];
const mailStub = `
  async function send(to, otp, kind) {
    if (globalThis.__mailDown) throw new Error('IT: mail server down');
    globalThis.__mail.push({ to, otp, kind });
    return { accepted: [to] };
  }
  export const sendPasswordResetOtp = (to, otp) => send(to, otp, 'reset');
  export const sendLoginOtp = (to, otp) => send(to, otp, 'login');
  export async function sendEmail() { throw new Error('IT: real mail is stubbed out'); }
  export function getTransporter() { throw new Error('IT: real mail is stubbed out'); }
`;

let prisma;
let exitCode = 0;
try {
  console.log(`Creating ${DB_NAME} …`);
  await server.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
  const migrate = spawnSync(process.execPath, [resolvePath(ROOT, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: ROOT, env: { ...process.env, DATABASE_URL: TEST_URL }, encoding: 'utf8',
  });
  if (migrate.status !== 0) throw new Error(`Migrations failed; nothing else can run.\n${migrate.stdout}\n${migrate.stderr}`);

  // The app's prisma singleton reads DATABASE_URL when first imported, so point it at the test DB first.
  process.env.DATABASE_URL = TEST_URL;
  process.env.PROJ_ROOT ??= ROOT;
  register(pathToFileURL(resolvePath(HERE, 'invoice-ts-loader.mjs')).href);
  register(`data:text/javascript,${encodeURIComponent('export async function resolve(s, c, n) { return n(s === "next/server" || s === "next/headers" ? s + ".js" : s, c); }')}`);
  // Registered last, so it resolves first: the app's mailer becomes the stub.
  const stubUrl = `data:text/javascript,${encodeURIComponent(mailStub)}`;
  register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, n) { return s === '@/server/auth/email' ? { url: ${JSON.stringify(stubUrl)}, shortCircuit: true } : n(s, c); }`)}`);

  ({ prisma } = await import('@/server/db/prisma'));
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  assert.equal(db, DB_NAME, 'the app client must be connected to the throwaway database');
  await assert.rejects((await import('@/server/auth/email')).sendEmail(), /stubbed out/, 'the mailer must be the stub');

  const { POST: requestReset } = await import('@/app/api/auth/password-reset/request/route');
  const { POST: confirmReset } = await import('@/app/api/auth/password-reset/confirm/route');
  const { createEmailOtpForUser, verifyEmailOtpForUser, OTP_MAX_ATTEMPTS } = await import('@/server/auth/email-otp');
  const { verifyPassword } = await import('@/server/auth/password');
  const { postgresAuthenticationProvider } = await import('@/server/auth/providers/postgres-auth.provider');

  // ── Seed ──────────────────────────────────────────────────────────────────────
  console.log('Seeding …');
  const OLD_PASSWORD = 'OldPass#2026';
  const NEW_PASSWORD = 'NewPass#2026!';
  const scrypt = promisify(scryptCallback);
  const passwordHash = async (password) => { const salt = randomBytes(16).toString('base64url'); return `scrypt:${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`; };
  const user = async (email, role, status = 'ACTIVE') => prisma.user.create({ data: { email, normalizedEmail: email, passwordHash: await passwordHash(OLD_PASSWORD), role, status } });

  const dealerUser = await user('it-reset-dealer@example.test', 'DEALER');
  await prisma.dealerProfile.create({ data: { userId: dealerUser.id, businessName: 'IT Reset Dealer', dealerCode: '9301', discountPercent: 50, termsAcceptedAt: new Date() } });
  const staffUser = await user('it-reset-staff@example.test', 'STAFF');
  await prisma.staffProfile.create({ data: { userId: staffUser.id, displayName: 'IT Staff', staffRoleType: '2' } });
  const adminUser = await user('it-reset-admin@example.test', 'ADMIN');
  await prisma.adminProfile.create({ data: { userId: adminUser.id, displayName: 'IT Admin' } });
  const accountantUser = await user('it-reset-accountant@example.test', 'ACCOUNTANT');
  await prisma.accountantProfile.create({ data: { userId: accountantUser.id, displayName: 'IT Accountant' } });
  const inactiveUser = await user('it-reset-inactive@example.test', 'DEALER', 'INACTIVE');
  await prisma.dealerProfile.create({ data: { userId: inactiveUser.id, businessName: 'IT Inactive Dealer', dealerCode: '9302', discountPercent: 50, termsAcceptedAt: new Date() } });
  for (const n of [1, 2]) await prisma.authSession.create({ data: { userId: dealerUser.id, refreshTokenHash: `it-refresh-${n}`, expiresAt: new Date(Date.now() + 86_400_000) } });

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const post = async (handler, body) => {
    const response = await handler(new Request('http://it.local/api', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'sapoms-it' }, body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  };
  const mail = () => globalThis.__mail;
  const lastCodeFor = (email) => mail().filter((m) => m.to === email).at(-1)?.otp;
  const latestCode = async (userId) => prisma.emailOtp.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: 'desc' } });
  const userRow = (id) => prisma.user.findUniqueOrThrow({ where: { id } });
  const wrong = (code, n = 1) => String((Number(code) + n) % 1_000_000).padStart(6, '0');
  // A new code is refused for 30 s after the last one; backdate instead of waiting.
  const skipCooldown = (userId) => prisma.emailOtp.updateMany({ where: { userId }, data: { createdAt: new Date(Date.now() - 60_000) } });
  const freshCode = async (u) => {
    await skipCooldown(u.id);
    assert.equal((await post(requestReset, { email: u.email })).status, 200);
    return lastCodeFor(u.email);
  };
  const confirm = (otp, newPassword = NEW_PASSWORD, email = dealerUser.email) => post(confirmReset, { email, otp, newPassword });

  // ── Asking for a code ─────────────────────────────────────────────────────────
  console.log('\nPOST /api/auth/password-reset/request');
  let generic;
  let dealerCode;
  await check('a dealer gets one code, even with the email typed in capitals and spaces', async () => {
    const r = await post(requestReset, { email: '  IT-Reset-Dealer@Example.TEST ' });
    assert.equal(r.status, 200);
    assert.equal(r.body.message, 'If an account exists, a reset code has been sent to its email address.');
    generic = r.body;
    assert.deepEqual(mail().map((m) => `${m.kind} ${m.to}`), [`reset ${dealerUser.email}`]);
    dealerCode = lastCodeFor(dealerUser.email);
    assert.match(dealerCode, /^\d{6}$/);
  });
  await check('only a hash is stored: the code itself is nowhere in email_otps', async () => {
    const rows = await prisma.$queryRaw`SELECT * FROM email_otps`;
    assert.equal(rows.length, 1);
    assert.ok(!json(rows).includes(dealerCode));
  });
  await check('a staff member gets a code too', async () => {
    assert.equal((await post(requestReset, { email: staffUser.email })).status, 200);
    assert.match(lastCodeFor(staffUser.email), /^\d{6}$/);
  });
  await check('unknown, admin, accountant and deactivated emails get the same reply, and no code is made or sent', async () => {
    const before = mail().length;
    for (const email of ['nobody@example.test', adminUser.email, accountantUser.email, inactiveUser.email]) {
      const r = await post(requestReset, { email });
      assert.equal(r.status, 200, email);
      assert.deepEqual(r.body, generic, email);
    }
    assert.equal(mail().length, before);
    assert.equal(await prisma.emailOtp.count({ where: { userId: { in: [adminUser.id, accountantUser.id, inactiveUser.id] } } }), 0);
  });
  await check('asking again within 30 seconds sends nothing and keeps the first code', async () => {
    const before = mail().length;
    const r = await post(requestReset, { email: dealerUser.email });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, generic);
    assert.equal(mail().length, before);
    assert.equal(await prisma.emailOtp.count({ where: { userId: dealerUser.id } }), 1);
    assert.equal((await latestCode(dealerUser.id)).usedAt, null);
  });
  await check('when the mail server fails the reply is 500, and the code it made is cancelled', async () => {
    await skipCooldown(staffUser.id);
    globalThis.__mailDown = true;
    try {
      assert.equal((await post(requestReset, { email: staffUser.email })).status, 500);
    } finally {
      globalThis.__mailDown = false;
    }
    assert.notEqual((await latestCode(staffUser.id)).usedAt, null);
  });

  // ── Using it ──────────────────────────────────────────────────────────────────
  console.log('\nPOST /api/auth/password-reset/confirm');
  await check('a password under 10 characters is refused (400) and spends no attempt', async () => {
    assert.equal((await confirm(dealerCode, 'short9chr')).status, 400);
    assert.equal((await latestCode(dealerUser.id)).attempts, 0);
  });
  await check('a wrong code is refused (401), spends one attempt and changes nothing', async () => {
    const before = await userRow(dealerUser.id);
    const r = await confirm(wrong(dealerCode));
    assert.equal(r.status, 401);
    assert.equal(r.body.message, 'Invalid or expired code');
    assert.equal((await latestCode(dealerUser.id)).attempts, 1);
    assert.equal((await userRow(dealerUser.id)).passwordHash, before.passwordHash);
  });
  await check('the first code then sets the new password, signs out every session and is audited', async () => {
    const before = await userRow(dealerUser.id);
    const r = await confirm(dealerCode);
    assert.equal(r.status, 200, json(r.body));
    const after = await userRow(dealerUser.id);
    assert.equal(await verifyPassword(NEW_PASSWORD, after.passwordHash), true);
    assert.equal(after.tokenVersion, before.tokenVersion + 1);
    assert.ok(after.passwordUpdatedAt);
    assert.equal(await prisma.authSession.count({ where: { userId: dealerUser.id, revokedAt: null } }), 0);
    assert.equal(await prisma.authAuditLog.count({ where: { actorId: dealerUser.id, eventType: 'PASSWORD_RESET_COMPLETED' } }), 1);
  });
  await check('the dealer signs in with the new password; the old one no longer works', async () => {
    await postgresAuthenticationProvider.authenticate({ email: dealerUser.email, password: NEW_PASSWORD });
    await assert.rejects(postgresAuthenticationProvider.authenticate({ email: dealerUser.email, password: OLD_PASSWORD }));
  });
  await check('a code works once: using it again is refused (401)', async () => {
    assert.equal((await confirm(dealerCode, 'Another#Pass1')).status, 401);
    assert.equal(await verifyPassword(NEW_PASSWORD, (await userRow(dealerUser.id)).passwordHash), true);
  });
  await check('after 5 wrong codes the right one is refused too', async () => {
    const code = await freshCode(dealerUser);
    for (let n = 1; n <= OTP_MAX_ATTEMPTS; n++) assert.equal((await confirm(wrong(code, n), 'Another#Pass1')).status, 401);
    assert.equal((await confirm(code, 'Another#Pass1')).status, 401);
    assert.equal(await verifyPassword(NEW_PASSWORD, (await userRow(dealerUser.id)).passwordHash), true);
  });
  await check('an expired code is refused (401)', async () => {
    const code = await freshCode(dealerUser);
    await prisma.emailOtp.updateMany({ where: { userId: dealerUser.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await confirm(code, 'Another#Pass1')).status, 401);
  });
  await check('a code can never reset an admin password', async () => {
    const { otp } = await createEmailOtpForUser(adminUser.id);
    const before = (await userRow(adminUser.id)).passwordHash;
    assert.equal((await confirm(otp, NEW_PASSWORD, adminUser.email)).status, 401);
    assert.equal((await userRow(adminUser.id)).passwordHash, before);
  });

  // ── Guesses sent at the same moment (the code check both login and reset use) ──
  console.log('\nGuesses at the same moment');
  await check('25 wrong codes sent at once still get only 5 tries, and then the right code is refused', async () => {
    const code = await freshCode(dealerUser);
    const outcomes = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => verifyEmailOtpForUser(dealerUser.id, wrong(code, i + 1))));
    assert.ok(outcomes.every((o) => o.status === 'rejected'));
    const row = await latestCode(dealerUser.id);
    assert.equal(row.attempts, OTP_MAX_ATTEMPTS, 'attempts counted');
    assert.notEqual(row.usedAt, null, 'the code is locked');
    await assert.rejects(verifyEmailOtpForUser(dealerUser.id, code));
  });
  await check('the right code sent twice at once goes through exactly once', async () => {
    const code = await freshCode(dealerUser);
    const outcomes = await Promise.allSettled([verifyEmailOtpForUser(dealerUser.id, code), verifyEmailOtpForUser(dealerUser.id, code)]);
    assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
  });
  await check('no audit row holds a code that was sent', async () => {
    const logs = json(await prisma.authAuditLog.findMany());
    for (const { otp } of mail()) assert.ok(!logs.includes(otp), `code ${otp} found in auth_audit_logs`);
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
