import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";

async function read(file) {
  return fs.readFile(file, "utf8");
}

test("login route uses PostgreSQL provider instead of legacy provider router", async () => {
  const source = await read("src/app/api/auth/login/route.ts");
  assert.match(source, /postgresAuthenticationProvider\.authenticate/);
  assert.doesNotMatch(source, /getAuthenticationProvider|phpAuthenticationProvider|mongoAccountantAuthenticationProvider/);
});


test("login route keeps roletype optional for automatic PostgreSQL role detection", async () => {
  const source = await read("src/app/api/auth/login/route.ts");
  assert.match(source, /roletype: z\.enum\(\["1", "2", "3", "4"\]\)\.optional\(\)/);
});
test("login route reports PostgreSQL connectivity failures as service unavailable", async () => {
  const source = await read("src/app/api/auth/login/route.ts");
  assert.match(source, /isDatabaseUnavailableError/);
  assert.match(source, /PrismaClientInitializationError/);
  assert.match(source, /Authentication database is currently unavailable", 503/);
});

test("PostgreSQL provider infers role when legacy roletype is not supplied", async () => {
  const source = await read("src/server/auth/providers/postgres-auth.provider.ts");
  assert.match(source, /roleType\?: string/);
  assert.match(source, /input\.roleType \? LEGACY_ROLE_MAP/);
  assert.match(source, /if \(expectedRole && user\.role !== expectedRole\)/);
});
test("JWT access claims use PostgreSQL user identity and no legacy source claims", async () => {
  const source = await read("src/server/auth/session.ts");
  assert.match(source, /sub: input\.userId\.toString\(\)/);
  assert.match(source, /tokenVersion: input\.tokenVersion/);
  assert.doesNotMatch(source, /legacyActorId|legacySource|source:/);
});

test("client session resolver refreshes expired access cookies before login fallback", async () => {
  const source = await read("src/hooks/useAuthSession.ts");
  assert.match(source, /fetchWithSessionRefresh\("\/api\/auth\/me"\)/);
  assert.match(source, /fetch\("\/api\/auth\/refresh"/);
  assert.match(source, /response\.status !== 401/);
  assert.match(source, /installAxiosSessionRefresh\(\)/);
  assert.match(source, /config\._sessionRefreshRetried = true/);
});
test("legacy accountant route is retired", async () => {
  const source = await read("src/app/api/auth/accountant/route.ts");
  assert.match(source, /status: 410/);
  assert.doesNotMatch(source, /getDb\(|createJWT|accountants/);
});

test("create auth user script never prints password or hash fields", async () => {
  const source = await read("scripts/create-auth-user.mjs");
  assert.match(source, /hashPassword\(password\)/);
  assert.match(source, /userId: result\.id\.toString\(\), role: result\.role, email: result\.email/);
  assert.doesNotMatch(source, /passwordHash.*console\.log|password.*console\.log/);
});
test("PostgreSQL provider accepts legacy username and dealer-code login identifiers", async () => {
  const source = await read("src/server/auth/providers/postgres-auth.provider.ts");
  assert.match(source, /findFirst/);
  assert.match(source, /\{ normalizedUsername: normalized \}/);
  assert.match(source, /dealerProfile: \{ dealerCode: identifier\.trim\(\) \}/);
  assert.match(source, /dealerProfile: \{ legacyPhpId: identifier\.trim\(\) \}/);
  assert.match(source, /verifyPassword\(input\.password, user\.passwordHash\)/);
});
