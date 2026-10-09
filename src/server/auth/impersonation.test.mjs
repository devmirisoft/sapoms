import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

async function loadTsModule(file) {
  const source = await fs.readFile(path.resolve(file), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const read = (file) => fs.readFile(file, "utf8");
const { startImpersonation, restoreImpersonation, ImpersonationError, IMPERSONATION_TTL_MS } = await loadTsModule("src/server/auth/impersonation.ts");

// ---------------------------------------------------------------------------
// In-memory stand-in for the Prisma calls impersonation.ts makes. updateMany is a
// single synchronous step, like one conditional UPDATE on a row in PostgreSQL.
// ---------------------------------------------------------------------------
function matches(row, where) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected === null) return actual === null || actual === undefined;
    if (expected && typeof expected === "object" && !(expected instanceof Date) && "gt" in expected) return actual > expected.gt;
    if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
    return actual === expected;
  });
}

function createDb(state) {
  const table = (rows) => ({
    async findUnique({ where }) {
      const row = rows.find((candidate) => matches(candidate, where));
      return row ? { ...row } : null;
    },
    async updateMany({ where, data }) {
      const hits = rows.filter((candidate) => matches(candidate, where));
      hits.forEach((row) => Object.assign(row, data));
      return { count: hits.length };
    },
    async update({ where, data }) {
      const row = rows.find((candidate) => matches(candidate, where));
      if (!row) throw new Error("Record not found");
      Object.assign(row, data);
      return { ...row };
    },
    async create({ data }) {
      if (data.restorationTokenHash && rows.some((row) => row.restorationTokenHash === data.restorationTokenHash)) throw new Error("Unique constraint");
      if (data.dealerSessionId && rows.some((row) => row.dealerSessionId === data.dealerSessionId)) throw new Error("Unique constraint");
      const row = { id: `imp-${rows.length + 1}`, endedAt: null, ...data };
      rows.push(row);
      return { ...row };
    },
  });
  const db = {
    authSession: table(state.sessions),
    authImpersonation: table(state.impersonations),
    user: table(state.users),
    // Interactive transaction with rollback. Transactions run one at a time, as two that touch the
    // same row do in PostgreSQL (the second waits on the row lock), so a rollback undoes only its own work.
    $transaction(fn) {
      const run = queue.then(async () => {
        const snapshot = structuredClone(state);
        try {
          return await fn(db);
        } catch (error) {
          for (const key of Object.keys(state)) state[key].splice(0, state[key].length, ...snapshot[key]);
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
  let queue = Promise.resolve();
  return db;
}

const NOW = new Date("2026-10-09T10:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function setup() {
  const state = {
    users: [
      { id: 1n, role: "ADMIN", status: "ACTIVE", deletedAt: null, tokenVersion: 3 },
      { id: 2n, role: "DEALER", status: "ACTIVE", deletedAt: null, tokenVersion: 1 },
      { id: 9n, role: "DEALER", status: "ACTIVE", deletedAt: null, tokenVersion: 1 },
    ],
    sessions: [
      { id: "A", userId: 1n, refreshTokenHash: "h:admin-refresh", expiresAt: new Date(NOW.getTime() + 30 * 24 * HOUR), revokedAt: null, lastUsedAt: null },
      { id: "B", userId: 2n, refreshTokenHash: "h:dealer-refresh", expiresAt: new Date(NOW.getTime() + 30 * 24 * HOUR), revokedAt: null, lastUsedAt: null },
      { id: "C", userId: 9n, refreshTokenHash: "h:other-dealer", expiresAt: new Date(NOW.getTime() + 30 * 24 * HOUR), revokedAt: null, lastUsedAt: null },
    ],
    impersonations: [],
  };
  let counter = 0;
  const clock = { now: NOW };
  const deps = {
    db: createDb(state),
    hashToken: (token) => `h:${token}`,
    generateToken: () => `tok-${++counter}`,
    issueAccessToken: (input) => `jwt:${input.userId}:${input.sessionId}:${input.role}:${input.tokenVersion}`,
    now: () => clock.now,
  };
  const session = (id) => state.sessions.find((row) => row.id === id);
  const user = (id) => state.users.find((row) => row.id === id);
  return { state, deps, clock, session, user };
}

async function started() {
  const ctx = setup();
  const result = await startImpersonation(ctx.deps, { adminSessionId: "A", adminRefreshToken: "admin-refresh", dealerSessionId: "B" });
  return { ...ctx, start: result };
}

// --- start --------------------------------------------------------------------

test("start pauses admin session A without revoking it and links a separate dealer session B", async () => {
  const { state, session, start } = await started();

  assert.equal(session("A").revokedAt, null, "A is preserved, not revoked");
  assert.notEqual(session("A").refreshTokenHash, "h:admin-refresh", "A's refresh hash is parked");
  assert.notEqual(session("A").refreshTokenHash, `h:${start.restorationToken}`, "parked hash is not the restoration token");
  assert.equal(state.impersonations.length, 1);
  const record = state.impersonations[0];
  assert.equal(record.adminSessionId, "A");
  assert.equal(record.dealerSessionId, "B");
  assert.equal(record.adminTokenVersion, 3);
  assert.equal(record.restorationTokenHash, `h:${start.restorationToken}`, "only the hash is stored");
  assert.equal(record.endedAt, null);
  assert.equal(start.expiresAt.getTime(), NOW.getTime() + IMPERSONATION_TTL_MS);
  assert.equal(session("B").expiresAt.getTime(), start.expiresAt.getTime(), "dealer session never outlives the impersonation");
});

test("impersonation expiry never extends past the admin session's own expiry", async () => {
  const ctx = setup();
  ctx.session("A").expiresAt = new Date(NOW.getTime() + 2 * HOUR);
  const start = await startImpersonation(ctx.deps, { adminSessionId: "A", adminRefreshToken: "admin-refresh", dealerSessionId: "B" });
  assert.equal(start.expiresAt.getTime(), NOW.getTime() + 2 * HOUR);
  assert.equal(ctx.session("A").expiresAt.getTime(), NOW.getTime() + 2 * HOUR, "A's expiry is untouched");
});

test("start fails and rolls back when the presented refresh token is not A's current one", async () => {
  const ctx = setup();
  await assert.rejects(
    startImpersonation(ctx.deps, { adminSessionId: "A", adminRefreshToken: "stale-token", dealerSessionId: "B" }),
    (error) => error instanceof ImpersonationError && error.code === "admin_session_changed",
  );
  assert.equal(ctx.session("A").refreshTokenHash, "h:admin-refresh", "A untouched");
  assert.equal(ctx.state.impersonations.length, 0);
});

test("a double start cannot fork the admin session", async () => {
  const ctx = setup();
  const [first, second] = await Promise.allSettled([
    startImpersonation(ctx.deps, { adminSessionId: "A", adminRefreshToken: "admin-refresh", dealerSessionId: "B" }),
    startImpersonation(ctx.deps, { adminSessionId: "A", adminRefreshToken: "admin-refresh", dealerSessionId: "C" }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), ["fulfilled", "rejected"]);
  assert.equal(ctx.state.impersonations.length, 1);
});

test("start rejects a revoked or expired admin session", async () => {
  for (const mutate of [(row) => { row.revokedAt = NOW; }, (row) => { row.expiresAt = new Date(NOW.getTime() - 1); }]) {
    const ctx = setup();
    mutate(ctx.session("A"));
    await assert.rejects(
      startImpersonation(ctx.deps, { adminSessionId: "A", adminRefreshToken: "admin-refresh", dealerSessionId: "B" }),
      (error) => error instanceof ImpersonationError && error.code === "admin_session_inactive",
    );
  }
});

// --- restore ------------------------------------------------------------------

test("dealer logout restores A with fresh credentials and consumes the restoration token", async () => {
  const { deps, state, session, start } = await started();
  const result = await restoreImpersonation(deps, { restorationToken: start.restorationToken, dealerSessionId: "B" });

  assert.equal(result.ok, true);
  assert.equal(result.adminSessionId, "A");
  assert.equal(result.adminUserId, 1n);
  assert.equal(result.accessToken, "jwt:1:A:ADMIN:3", "fresh access token for session A");
  assert.equal(session("A").refreshTokenHash, `h:${result.refreshToken}`, "new refresh token is A's only valid one");
  assert.notEqual(session("A").refreshTokenHash, "h:admin-refresh", "pre-impersonation refresh token stays dead");
  assert.equal(session("A").revokedAt, null);
  assert.ok(state.impersonations[0].endedAt instanceof Date, "impersonation marked ended");

  const replay = await restoreImpersonation(deps, { restorationToken: start.restorationToken, dealerSessionId: "B" });
  assert.deepEqual(replay, { ok: false, reason: "invalid_or_used" });
});

test("dealer refresh rotation does not disturb the paused admin session or its restore", async () => {
  const { deps, session, start } = await started();
  const parkedHash = session("A").refreshTokenHash;
  // What rotateRefreshToken does for B: find by B's hash, update that row only.
  await deps.db.authSession.update({ where: { id: "B" }, data: { refreshTokenHash: "h:dealer-refresh-2" } });
  assert.equal(session("A").refreshTokenHash, parkedHash);
  assert.equal((await restoreImpersonation(deps, { restorationToken: start.restorationToken, dealerSessionId: "B" })).ok, true);
});

test("a restoration token only works for its own dealer session", async () => {
  const { deps, state, start } = await started();
  const wrong = await restoreImpersonation(deps, { restorationToken: start.restorationToken, dealerSessionId: "C" });
  assert.deepEqual(wrong, { ok: false, reason: "invalid_or_used" });
  assert.equal(state.impersonations[0].endedAt, null, "another session cannot consume the record");
});

test("missing, forged and expired restoration tokens fail safely", async () => {
  const { deps, clock, start } = await started();
  assert.deepEqual(await restoreImpersonation(deps, { restorationToken: "", dealerSessionId: "B" }), { ok: false, reason: "invalid_or_used" });
  assert.deepEqual(await restoreImpersonation(deps, { restorationToken: "forged", dealerSessionId: "B" }), { ok: false, reason: "invalid_or_used" });
  clock.now = new Date(start.expiresAt.getTime() + 1);
  assert.deepEqual(await restoreImpersonation(deps, { restorationToken: start.restorationToken, dealerSessionId: "B" }), { ok: false, reason: "invalid_or_used" });
});

const failureCases = [
  ["revoked admin session", (ctx) => { ctx.session("A").revokedAt = NOW; }, "session_revoked"],
  ["expired admin session", (ctx) => { ctx.session("A").expiresAt = new Date(NOW.getTime() - 1); }, "session_expired"],
  ["deactivated admin", (ctx) => { ctx.user(1n).status = "INACTIVE"; }, "admin_inactive"],
  ["deleted admin", (ctx) => { ctx.user(1n).deletedAt = NOW; }, "admin_inactive"],
  ["admin demoted to NSM", (ctx) => { ctx.user(1n).role = "NSM"; }, "role_changed"],
  ["token version bumped (password change)", (ctx) => { ctx.user(1n).tokenVersion = 4; }, "token_version_changed"],
];

for (const [label, mutate, reason] of failureCases) {
  test(`restore fails for a ${label}, and A ends up revoked`, async () => {
    const ctx = await started();
    mutate(ctx);
    const result = await restoreImpersonation(ctx.deps, { restorationToken: ctx.start.restorationToken, dealerSessionId: "B" });
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.accessToken, undefined);
    assert.ok(ctx.session("A").revokedAt, "the parked admin session cannot be revived later");
    assert.ok(ctx.state.impersonations[0].endedAt, "the token is spent either way");
  });
}

test("the audit role is the account's actual role, not a hard-coded ADMIN", async () => {
  const ctx = await started();
  ctx.user(1n).role = "NSM";
  const result = await restoreImpersonation(ctx.deps, { restorationToken: ctx.start.restorationToken, dealerSessionId: "B" });
  assert.equal(result.reason, "role_changed");
  assert.equal(result.adminRole, "NSM");
});

test("a transient database error during restore rolls back, so a retried logout still restores", async () => {
  const ctx = await started();
  const realFindUnique = ctx.deps.db.user.findUnique;
  ctx.deps.db.user.findUnique = async () => {
    throw new Error("connection reset");
  };
  await assert.rejects(
    restoreImpersonation(ctx.deps, { restorationToken: ctx.start.restorationToken, dealerSessionId: "B" }),
    /connection reset/,
  );
  assert.equal(ctx.state.impersonations[0].endedAt, null, "the claim was rolled back");
  assert.equal(ctx.session("A").revokedAt, null, "the admin session was not revoked");

  ctx.deps.db.user.findUnique = realFindUnique;
  const retry = await restoreImpersonation(ctx.deps, { restorationToken: ctx.start.restorationToken, dealerSessionId: "B" });
  assert.equal(retry.ok, true);
});

test("concurrent logouts restore at most once", async () => {
  const { deps, start } = await started();
  const results = await Promise.all([
    restoreImpersonation(deps, { restorationToken: start.restorationToken, dealerSessionId: "B" }),
    restoreImpersonation(deps, { restorationToken: start.restorationToken, dealerSessionId: "B" }),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.deepEqual(results.find((result) => !result.ok), { ok: false, reason: "invalid_or_used" });
});

// --- wiring (source checks, the project's usual style for routes) -------------------

test("only an ADMIN can start impersonation, of an active dealer, and a failed start leaves no dealer session", async () => {
  const route = await read("src/app/api/auth/impersonate/route.ts");
  const provider = await read("src/server/auth/providers/postgres-auth.provider.ts");
  const adminRoute = await read("src/server/admin/admin-route.ts");

  assert.match(route, /const admin = await requireAdminOnly\(\)/);
  assert.match(adminRoute, /if \(actor\.role !== "ADMIN"\) throw new Error\("Forbidden"\)/);
  // requireAdmin (every admin route) refuses dealers, so an impersonated dealer cannot reach them.
  assert.match(adminRoute, /if \(!isAdminLike\(actor\)\) throw new Error\("Forbidden"\)/);
  assert.match(route, /findActivePostgresDealer\(parsed\.data\.dealerId\)/);
  assert.match(provider, /role: "DEALER", dealerProfile: \{ id: dealerId \}/);
  assert.match(provider, /if \(!user \|\| user\.deletedAt \|\| user\.status !== "ACTIVE"\) throw new Error\("Dealer account is not active"\)/);
  assert.match(route, /catch \(error\) \{\s*\/\/ Never leave an unlinked dealer session behind\.\s*await revokeSession\(session\.id, request\)/);
  assert.match(route, /setImpersonatorCookie\(response, started\.restorationToken, started\.expiresAt\)/);
});

test("audit rows never carry tokens", async () => {
  for (const file of ["src/app/api/auth/impersonate/route.ts", "src/app/api/auth/logout/route.ts"]) {
    const source = await read(file);
    const auditCalls = source.match(/writeAuthAuditLog\(\{[\s\S]*?\n {4,8}\}\);/g) ?? [];
    assert.ok(auditCalls.length > 0, `${file} writes an audit row`);
    for (const call of auditCalls) assert.doesNotMatch(call, /restorationToken|refreshToken|accessToken|cookie/i, file);
  }
});

test("logout revokes the current session before restoring and only then sets admin cookies", async () => {
  const route = await read("src/app/api/auth/logout/route.ts");
  assert.ok(route.indexOf("await revokeSession(sessionId, request)") < route.indexOf("restoreImpersonation(impersonationDeps()"));
  assert.match(route, /dealerSessionId: sessionId/);
  assert.match(route, /IMPERSONATION_ENDED/);
  assert.match(route, /IMPERSONATION_RESTORE_FAILED/);
  assert.ok(route.indexOf("clearAuthCookies(response)") < route.indexOf("if (restored) setAuthCookies(response"));
  assert.match(route, /compatibilitySuccess\(\{ restored: true \}/);
  assert.match(route, /role: result\.adminRole/);
  assert.doesNotMatch(route, /rotateRefreshToken/);
});

test("a transient logout error keeps what a retry needs, and ?final=1 gives up cleanly", async () => {
  const route = await read("src/app/api/auth/logout/route.ts");
  const catchBlock = route.slice(route.indexOf("} catch (error) {"), route.indexOf("const response = NextResponse.json(restored"));
  assert.match(catchBlock, /if \(restorationToken && !request\.nextUrl\.searchParams\.has\("final"\)\)/);
  assert.match(catchBlock, /status: 503/);
  assert.match(catchBlock, /clearAccessCookie\(response\)/);
  assert.doesNotMatch(catchBlock, /clearAuthCookies/, "refresh and restoration cookies survive for the retry");
});

test("revoking a session is safe to repeat", async () => {
  const session = await read("src/server/auth/session.ts");
  const revoke = session.slice(session.indexOf("export async function revokeSession"));
  assert.match(revoke, /updateMany\(\{\s*where: \{ id: sessionId, revokedAt: null \}/);
  assert.match(revoke, /if \(revoked\.count === 0\) return;/);
});

test("cookies keep their names, paths and flags; the impersonator cookie holds only the opaque token", async () => {
  const session = await read("src/server/auth/session.ts");
  assert.match(session, /export const ACCESS_COOKIE = "omsons_access"/);
  assert.match(session, /export const REFRESH_COOKIE = "omsons_refresh"/);
  assert.match(session, /export const IMPERSONATOR_COOKIE = "omsons_impersonator"/);
  assert.match(session, /httpOnly: true,\s*secure: process\.env\.NODE_ENV === "production"/);
  // Unchanged normal login/refresh cookies.
  assert.match(session, /response\.cookies\.set\(ACCESS_COOKIE, accessToken, cookieOptions\(ACCESS_TTL_SECONDS, "lax", "\/"\)\)/);
  assert.match(session, /response\.cookies\.set\(REFRESH_COOKIE, refreshToken, cookieOptions\(REFRESH_TTL_SECONDS, "strict", "\/api\/auth"\)\)/);
  assert.match(session, /response\.cookies\.set\(IMPERSONATOR_COOKIE, restorationToken, cookieOptions\(maxAge, "strict", "\/api\/auth"\)\)/);
  // Deletion uses the same name and path each cookie was set with.
  assert.match(session, /set\(ACCESS_COOKIE, "", \{ \.\.\.cookieOptions\(0, "lax", "\/"\), expires: new Date\(0\) \}\)/);
  assert.match(session, /set\(REFRESH_COOKIE, "", \{ \.\.\.cookieOptions\(0, "strict", "\/api\/auth"\), expires: new Date\(0\) \}\)/);
  assert.match(session, /set\(IMPERSONATOR_COOKIE, "", \{ \.\.\.cookieOptions\(0, "strict", "\/api\/auth"\), expires: new Date\(0\) \}\)/);
  assert.doesNotMatch(session, /adminRefreshToken\}|readImpersonatorCookie/);
});

test("a paused admin session is refused, and refresh still rotates only the presented session", async () => {
  const session = await read("src/server/auth/session.ts");
  assert.match(session, /impersonationsAsAdmin: \{ where: \{ endedAt: null, expiresAt: \{ gt: now \} \}/);
  assert.match(session, /if \(session\.impersonationsAsAdmin\.length\) throw new Error\("Session is paused"\)/);
  assert.match(session, /findUnique\(\{ where: \{ refreshTokenHash \} \}\)[\s\S]*?prisma\.authSession\.update\(\{\s*where: \{ id: session\.id \}/);
  // Logout finds the session from the access token, else from the refresh cookie.
  assert.match(session, /return verifyAccessToken\(accessToken\)\.sid/);
  assert.match(session, /findUnique\(\{ where: \{ refreshTokenHash: hashRefreshToken\(refreshToken\) \}, select: \{ id: true \} \}\)/);
});

test("client logout trusts only the server and /api/auth/me before showing the admin UI", async () => {
  const roleAccess = await read("src/lib/roleAccess.ts");
  const body = roleAccess.slice(roleAccess.indexOf("export async function logout"), roleAccess.indexOf("export async function loginAsDealer"));
  assert.match(body, /data\?\.restored === true/);
  assert.match(body, /"\/api\/auth\/logout", "\/api\/auth\/logout", "\/api\/auth\/logout\?final=1"/);
  assert.match(body, /res\.status !== 503/);
  assert.match(body, /fetch\("\/api\/auth\/me"/);
  assert.match(body, /session\.role === "admin"[\s\S]*"\/dashboard\/admin\/dealer\/DealerList"/);
  assert.match(body, /window\.location\.href = LOGIN_ROUTE/);
});

test("migration only adds auth_impersonations and leaves auth_sessions alone", async () => {
  const sql = await read("prisma/migrations/20261009120000_auth_impersonations/migration.sql");
  assert.match(sql, /CREATE TABLE "auth_impersonations"/);
  assert.match(sql, /"restoration_token_hash" TEXT NOT NULL/);
  assert.doesNotMatch(sql, /DROP|TRUNCATE|DELETE FROM|ALTER TABLE "auth_sessions"|UPDATE "auth_sessions"/i);
});
