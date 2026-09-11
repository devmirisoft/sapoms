import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";

async function read(file) {
  return fs.readFile(file, "utf8");
}

test("A single server flag gates the OTP routes and the pepper is configured", async () => {
  const requestRoute = await read("src/app/api/auth/email-otp/request/route.ts");
  const verifyRoute = await read("src/app/api/auth/email-otp/verify/route.ts");
  const env = await read(".env");

  const serverFlag = env.match(/^ENABLE_EMAIL_OTP=(\S*)$/m)?.[1];
  // Hashing throws without a pepper, so an enabled feature needs one.
  if (serverFlag === "true") assert.match(env, /^AUTH_OTP_PEPPER=\S+$/m);
  assert.match(requestRoute, /if \(!isEmailOtpEnabled\(\)\) return NextResponse\.json\(\{ message: "Not found" \}, \{ status: 404 \}\)/);
  assert.match(verifyRoute, /if \(!isEmailOtpEnabled\(\)\) return NextResponse\.json\(\{ message: "Not found" \}, \{ status: 404 \}\)/);
});

test("Email OTP storage is hashed, single-use, attempt-limited, and user-scoped", async () => {
  const helper = await read("src/server/auth/email-otp.ts");
  const schema = await read("prisma/schema.prisma");
  const emailOtpModel = schema.match(/model EmailOtp \{[\s\S]*?\n\}/)?.[0] ?? "";
  // The original email_otp migration was folded into the squashed init, so find the FK wherever it lives.
  const migrationDirs = await fs.readdir("prisma/migrations");
  const migrations = await Promise.all(
    migrationDirs.map((dir) => read(`prisma/migrations/${dir}/migration.sql`).catch(() => "")),
  );

  assert.match(emailOtpModel, /model EmailOtp/);
  assert.match(emailOtpModel, /userId\s+BigInt\s+@map\("user_id"\)/);
  assert.match(emailOtpModel, /codeHash\s+String\s+@map\("code_hash"\)/);
  assert.doesNotMatch(emailOtpModel, /plaintext|\n\s+code\s+String/);
  assert.ok(migrations.some((sql) => /ALTER TABLE "email_otps" ADD CONSTRAINT "email_otps_user_id_fkey" FOREIGN KEY \("user_id"\) REFERENCES "users"\("id"\)/.test(sql)));
  assert.match(helper, /randomInt\(0, 1_000_000\)/);
  assert.match(helper, /AUTH_OTP_PEPPER/);
  assert.match(helper, /OTP_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(helper, /OTP_MAX_ATTEMPTS = 5/);
  assert.match(helper, /OTP_RESEND_COOLDOWN_MS = 30 \* 1000/);
  assert.match(helper, /tx\.emailOtp\.updateMany/);
  assert.match(helper, /usedAt: now/);
  assert.match(helper, /timingSafeEqual/);
});

test("Email OTP routes reuse PostgreSQL user loading and the existing session cookies", async () => {
  const provider = await read("src/server/auth/providers/postgres-auth.provider.ts");
  const requestRoute = await read("src/app/api/auth/email-otp/request/route.ts");
  const verifyRoute = await read("src/app/api/auth/email-otp/verify/route.ts");
  const loginRoute = await read("src/app/api/auth/login/route.ts");

  assert.match(provider, /export async function findActivePostgresUserByLoginIdentifier/);
  assert.match(provider, /mapPostgresUserToLegacyProfile/);
  assert.match(provider, /getProfileId/);
  assert.match(requestRoute, /findActivePostgresUserByLoginIdentifier/);
  assert.match(requestRoute, /sendLoginOtp/);
  assert.doesNotMatch(requestRoute, /return NextResponse\.json\([^;]*otp/i);
  assert.match(verifyRoute, /createSessionForUser\(actor, request\)/);
  assert.match(verifyRoute, /setAuthCookies\(response, accessToken, refreshToken\)/);
  assert.match(verifyRoute, /compatibilitySuccess\(actor\.profile\)/);
  assert.match(loginRoute, /postgresAuthenticationProvider\.authenticate/);
});
test("Login OTP email is sent over SMTP with the configured env vars", async () => {
  const mailer = await read("src/server/auth/email.ts");

  assert.match(mailer, /from "nodemailer"/);
  assert.doesNotMatch(mailer, /resend/i);
  for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"]) {
    assert.match(mailer, new RegExp(`process\.env\.${key}`), `${key} is read`);
    assert.match(await read(".env.example"), new RegExp(`^${key}=`, "m"), `${key} is documented`);
  }
  assert.match(mailer, /secure: port === 465|secure = .*port === 465/);
});

test("dealer password login is gated behind an emailed code, other roles sign in directly", async () => {
  const route = await read("src/app/api/auth/login/route.ts");
  const page = await read("src/app/auth/login/page.tsx");

  // The dealer branch returns before a session is ever minted, so the gate cannot be skipped.
  assert.match(route, /actor\.role === "DEALER" && isEmailOtpEnabled\(\)/);
  assert.ok(route.indexOf('actor.role === "DEALER"') < route.indexOf("createSessionForUser(actor, request)"));
  assert.match(route, /otpRequired: true/);
  // Bad credentials never reach the OTP branch; they fall through to the generic rejection.
  assert.match(route, /return failed\(\);/);

  assert.match(page, /import \{ InputOTP, InputOTPGroup, InputOTPSlot \} from "@\/components\/ui\/input-otp"/);
  assert.match(page, /data\?\.data\?\.otpRequired/);
  assert.match(page, /showOtp \? "mt-3 grid-rows-\[1fr\]/);
});

test("The OTP routes are dealer-only, so a code never signs in staff or admins", async () => {
  const requestRoute = await read("src/app/api/auth/email-otp/request/route.ts");
  const verifyRoute = await read("src/app/api/auth/email-otp/verify/route.ts");
  const page = await read("src/app/auth/login/page.tsx");

  // Both routes look a user up by identifier alone, with no password, so each needs the guard.
  assert.match(requestRoute, /actor\.role !== "DEALER"/);
  assert.match(verifyRoute, /actor\.role !== "DEALER"/);
  // The guard has to run before any session is minted, or it is decoration.
  assert.ok(verifyRoute.indexOf('actor.role !== "DEALER"') < verifyRoute.indexOf("createSessionForUser(actor, request)"));

  // The password-free entry point is gone: the panel opens only on the server's otpRequired.
  assert.doesNotMatch(page, /Login with Email OTP/);
  assert.match(page, /const showOtp = otpRequired/);
});
