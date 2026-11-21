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
  assert.match(verifyRoute, /setAuthCookies\(response, accessToken, refreshToken, request\)/);
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

test("dealer, staff and NSM password login is gated behind an emailed code, other roles sign in directly", async () => {
  const route = await read("src/app/api/auth/login/route.ts");
  const page = await read("src/app/auth/login/page.tsx");
  const helper = await read("src/server/auth/email-otp.ts");

  // Exactly the dealer, staff-profile and NSM roles get the code; admins and accountants never do.
  const roles = helper.match(/EMAIL_OTP_ROLES = new Set<AuthRole>\(\[([^\]]*)\]\)/)?.[1] ?? "";
  assert.deepEqual(roles.match(/[A-Z]+/g)?.sort(), ["ASM", "DEALER", "NSM", "RSM", "STAFF"]);

  // The OTP branch returns before a session is ever minted, so the gate cannot be skipped.
  assert.match(route, /requiresEmailOtp\(actor\.role\) && isEmailOtpEnabled\(\) && !actor\.diagnosticPasswordId\)/);
  assert.ok(route.indexOf("requiresEmailOtp(actor.role)") < route.indexOf("createSessionForUser(actor, request)"));
  assert.match(route, /otpRequired: true/);
  // Bad credentials never reach the OTP branch; they fall through to the generic rejection.
  assert.match(route, /return failed\(\);/);

  const codeField = await read("src/app/auth/login/ForgotPasswordForm.tsx");
  assert.match(codeField, /import \{ InputOTP, InputOTPGroup, InputOTPSlot \} from "@\/components\/ui\/input-otp"/);
  assert.match(page, /<OtpCodeField/);
  assert.match(page, /data\?\.data\?\.otpRequired/);
  assert.match(page, /showOtp \? "mt-4 grid-rows-\[1fr\]/);
});

test("The OTP routes are dealer-, staff- and NSM-only, so a code never signs in admins", async () => {
  const requestRoute = await read("src/app/api/auth/email-otp/request/route.ts");
  const verifyRoute = await read("src/app/api/auth/email-otp/verify/route.ts");
  const page = await read("src/app/auth/login/page.tsx");

  // Both routes look a user up by identifier alone, with no password, so each needs the guard.
  assert.match(requestRoute, /!requiresEmailOtp\(actor\.role\)/);
  assert.match(verifyRoute, /!requiresEmailOtp\(actor\.role\)/);
  // The guard has to run before any session is minted, or it is decoration.
  assert.ok(verifyRoute.indexOf("!requiresEmailOtp(actor.role)") < verifyRoute.indexOf("createSessionForUser(actor, request)"));

  // The password-free entry point is gone: the panel opens only on the server's otpRequired.
  assert.doesNotMatch(page, /Login with Email OTP/);
  assert.match(page, /const showOtp = otpRequired/);
});

test("Password reset request emails a code only to emailed-code roles and never reveals whether an account exists", async () => {
  const route = await read("src/app/api/auth/password-reset/request/route.ts");
  const mailer = await read("src/server/auth/email.ts");

  assert.match(route, /!requiresEmailOtp\(actor\.role\)/);
  assert.match(route, /createEmailOtpForUser\(actor\.userId\)/);
  assert.match(route, /sendPasswordResetOtp\(actor\.email, otp\)/);
  assert.match(mailer, /export async function sendPasswordResetOtp/);
  // Every exit returns the one generic message, and the code never goes back to the browser.
  const replies = route.match(/NextResponse\.json\([^;]*/g) ?? [];
  assert.ok(replies.length >= 3);
  for (const reply of replies) assert.match(reply, /compatibilitySuccess\(\{\}, genericMessage\)/);
});

test("Password reset confirm checks the code before writing, signs out every session, and never logs in", async () => {
  const route = await read("src/app/api/auth/password-reset/confirm/route.ts");

  assert.match(route, /newPassword: z\.string\(\)\.min\(10\)\.max\(200\)/);
  assert.match(route, /!requiresEmailOtp\(actor\.role\)/);
  assert.ok(route.indexOf("verifyEmailOtpForUser(") < route.indexOf("prisma.user.update("));
  assert.ok(route.indexOf("!requiresEmailOtp(actor.role)") < route.indexOf("verifyEmailOtpForUser("));
  assert.match(route, /tokenVersion: \{ increment: 1 \}/);
  assert.match(route, /authSession\.updateMany\(\{\s*where: \{ userId: actor\.userId, revokedAt: null \}/);
  assert.doesNotMatch(route, /createSessionForUser|setAuthCookies/);
});

test("A code's attempt is spent in one conditional update before the code is compared, and a code works once", async () => {
  const helper = await read("src/server/auth/email-otp.ts");
  const verify = helper.slice(helper.indexOf("export async function verifyEmailOtpForUser"));

  // Reading attempts and writing back attempts + 1 lets guesses sent together share one attempt.
  assert.doesNotMatch(verify, /attempts: nextAttempts/);
  const spend = verify.search(/where: \{ id: record\.id, usedAt: null, attempts: \{ lt: OTP_MAX_ATTEMPTS \} \},\s*data: \{ attempts: \{ increment: 1 \} \}/);
  assert.ok(spend > 0, "the attempt is spent with a conditional increment");
  assert.ok(spend < verify.indexOf("hashesMatch("), "the attempt is spent before the code is compared");
  // Of two correct submissions at once, only the one that marks the code used gets through.
  assert.match(verify, /const used = await prisma\.emailOtp\.updateMany\(\{\s*where: \{ id: record\.id, usedAt: null \},\s*data: \{ usedAt: now \},\s*\}\);\s*if \(used\.count === 0\)/);
});

test("Every code entry box shows the spam-folder hint", async () => {
  const form = await read("src/app/auth/login/ForgotPasswordForm.tsx");
  const page = await read("src/app/auth/login/page.tsx");

  assert.match(form, /SPAM_FOLDER_HINT = "Didn't receive the code\? Please check your spam folder\."/);
  const field = form.match(/export function OtpCodeField[\s\S]*?\n\}\n/)?.[0] ?? "";
  assert.match(field, /\{SPAM_FOLDER_HINT\}/);
  // OtpCodeField is the only place InputOTP is rendered, in both the login and reset panels.
  assert.equal(form.match(/<InputOTP\b/g)?.length, 1);
  assert.doesNotMatch(page, /<InputOTP\b/);
  assert.match(page, /<OtpCodeField/);
  assert.match(form, /<OtpCodeField/);
});
