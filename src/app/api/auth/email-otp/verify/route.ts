import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { compatibilityFailure, compatibilitySuccess } from "@/server/http/compat-response";
import { findActivePostgresUserByLoginIdentifier, normalizeLoginIdentifier } from "@/server/auth/providers/postgres-auth.provider";
import { isEmailOtpEnabled, verifyEmailOtpForUser } from "@/server/auth/email-otp";
import { createSessionForUser, setAuthCookies, writeAuthAuditLog } from "@/server/auth/session";

const verifySchema = z.object({
  email: z.string().trim().min(1),
  otp: z.string().trim().regex(/^\d{6}$/),
});

function failed(message = "Invalid verification code", status = 401) {
  return NextResponse.json(compatibilityFailure(message), { status });
}

export async function POST(request: NextRequest) {
  if (!isEmailOtpEnabled()) return NextResponse.json({ message: "Not found" }, { status: 404 });

  let loginIdentifier: string | undefined;

  try {
    const parsed = verifySchema.safeParse(await request.json());
    if (!parsed.success) return failed("Invalid verification request", 400);

    loginIdentifier = normalizeLoginIdentifier(parsed.data.email);
    const actor = await findActivePostgresUserByLoginIdentifier(loginIdentifier);
    // A code alone never mints a session for staff or admins; only dealers use this route.
    if (actor.role !== "DEALER") throw new Error("Invalid credentials");

    await verifyEmailOtpForUser(actor.userId, parsed.data.otp);

    const { accessToken, refreshToken } = await createSessionForUser(actor, request);
    await writeAuthAuditLog({
      userId: actor.userId,
      role: actor.role,
      eventType: "EMAIL_OTP_LOGIN_SUCCEEDED",
      request,
      metadata: { loginIdentifier },
    });

    const response = NextResponse.json(compatibilitySuccess(actor.profile));
    setAuthCookies(response, accessToken, refreshToken);
    return response;
  } catch {
    await writeAuthAuditLog({
      eventType: "EMAIL_OTP_LOGIN_FAILED",
      request,
      metadata: { loginIdentifier },
    });
    return failed();
  }
}