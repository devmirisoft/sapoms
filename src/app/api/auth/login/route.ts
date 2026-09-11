import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { compatibilityFailure, compatibilitySuccess } from "@/server/http/compat-response";
import { postgresAuthenticationProvider, normalizeLoginIdentifier } from "@/server/auth/providers/postgres-auth.provider";
import { createEmailOtpForUser, invalidateEmailOtp, isEmailOtpEnabled } from "@/server/auth/email-otp";
import { sendLoginOtp } from "@/server/auth/email";
import { createSessionForUser, setAuthCookies, writeAuthAuditLog } from "@/server/auth/session";
import type { AuthenticatedPostgresUser } from "@/server/auth/providers/postgres-auth.provider";

const loginSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
  roletype: z.enum(["1", "2", "3", "4"]).optional(),
});

async function readLoginInput(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    return {
      email: formData.get("email"),
      password: formData.get("password"),
      roletype: formData.get("roletype") || undefined,
    };
  }
  return request.json();
}

function failed(message = "Invalid credentials", status = 401) {
  return NextResponse.json(compatibilityFailure(message), { status });
}

function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

// Dealers get a second factor: a valid password alone never mints a session for them.
// Staff and admins keep signing in with one step.
async function requireDealerOtp(actor: AuthenticatedPostgresUser, request: NextRequest, loginIdentifier: string) {
  let record: Awaited<ReturnType<typeof createEmailOtpForUser>>["record"] | undefined;
  try {
    const created = await createEmailOtpForUser(actor.userId);
    record = created.record;
    await sendLoginOtp(actor.email, created.otp);
  } catch (error) {
    // A live code is still in its resend cooldown, so the dealer already has one to type.
    if (Number((error as { status?: unknown }).status) === 429) {
      return NextResponse.json(compatibilitySuccess(
        { otpRequired: true, email: maskEmail(actor.email) },
        `A code was already sent to ${maskEmail(actor.email)}. Enter it below.`,
      ));
    }
    if (record) await invalidateEmailOtp(record.id);
    await writeAuthAuditLog({
      userId: actor.userId,
      role: actor.role,
      eventType: "EMAIL_OTP_SEND_FAILED",
      request,
      metadata: { loginIdentifier },
    });
    console.error("[POST /api/auth/login] OTP send failed", error);
    return NextResponse.json(compatibilityFailure("Unable to send your verification code. Try again."), { status: 503 });
  }

  await writeAuthAuditLog({
    userId: actor.userId,
    role: actor.role,
    eventType: "LOGIN_OTP_REQUIRED",
    request,
    metadata: { loginIdentifier },
  });
  return NextResponse.json(compatibilitySuccess(
    { otpRequired: true, email: maskEmail(actor.email) },
    `Enter the 6-digit code sent to ${maskEmail(actor.email)}.`,
  ));
}

function isDatabaseUnavailableError(error: unknown) {
  if (!(error instanceof Error)) return false;

  // P2021/P2022 mean the table or column the query needs is missing, i.e. an unapplied
  // migration. Reporting that as "Invalid credentials" sends everyone hunting passwords.
  const code = (error as { code?: unknown }).code;
  return (
    error.name === "PrismaClientInitializationError" ||
    code === "P2021" ||
    code === "P2022" ||
    error.message.includes("Can't reach database server") ||
    error.message.includes("Timed out fetching a new connection")
  );
}

export async function POST(request: NextRequest) {
  let loginIdentifier: string | undefined;
  let requestedRole: string | undefined;

  try {
    const parsed = loginSchema.safeParse(await readLoginInput(request));
    if (!parsed.success) return failed("Invalid login request", 400);

    loginIdentifier = normalizeLoginIdentifier(parsed.data.email);
    requestedRole = parsed.data.roletype;

    const actor = await postgresAuthenticationProvider.authenticate({
      email: parsed.data.email,
      password: parsed.data.password,
      roleType: parsed.data.roletype,
    });

    if (actor.role === "DEALER" && isEmailOtpEnabled()) return requireDealerOtp(actor, request, loginIdentifier);

    const { accessToken, refreshToken } = await createSessionForUser(actor, request);
    const response = NextResponse.json(compatibilitySuccess(actor.profile));
    setAuthCookies(response, accessToken, refreshToken);
    return response;
  } catch (error) {
    console.error("[POST /api/auth/login]", error);
    await writeAuthAuditLog({
      eventType: "LOGIN_FAILED",
      request,
      metadata: {
        loginIdentifier,
        requestedRole,
      },
    });
    if (isDatabaseUnavailableError(error)) {
      return failed("Authentication database is currently unavailable", 503);
    }
    return failed();
  }
}