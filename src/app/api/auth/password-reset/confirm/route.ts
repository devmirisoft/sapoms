import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { compatibilityFailure, compatibilitySuccess } from "@/server/http/compat-response";
import { findActivePostgresUserByLoginIdentifier, normalizeLoginIdentifier } from "@/server/auth/providers/postgres-auth.provider";
import { requiresEmailOtp, verifyEmailOtpForUser } from "@/server/auth/email-otp";
import { hashPassword } from "@/server/auth/password";
import { writeAuthAuditLog } from "@/server/auth/session";

export const runtime = "nodejs";

// Same length rule as /api/dealer/password.
const confirmSchema = z.object({
  email: z.string().trim().min(1),
  otp: z.string().trim().regex(/^\d{6}$/),
  newPassword: z.string().min(10).max(200),
});

function failed(message: string, status: number) {
  return NextResponse.json(compatibilityFailure(message), { status });
}

export async function POST(request: NextRequest) {
  let loginIdentifier: string | undefined;

  try {
    // Input is checked before the code, so a too-short password never spends one of the code's attempts.
    const parsed = confirmSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      const badPassword = parsed.error.issues.some((issue) => issue.path[0] === "newPassword");
      return failed(badPassword ? "Password must be 10 to 200 characters" : "Invalid or expired code", 400);
    }

    loginIdentifier = normalizeLoginIdentifier(parsed.data.email);
    const actor = await findActivePostgresUserByLoginIdentifier(loginIdentifier);
    // Admins and accountants never get emailed codes, so a code can never reset their passwords.
    if (!requiresEmailOtp(actor.role)) throw new Error("Invalid credentials");

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await verifyEmailOtpForUser(actor.userId, parsed.data.otp);

    // The bumped tokenVersion kills every access token; revoking the sessions kills every refresh token.
    const now = new Date();
    await prisma.$transaction([
      prisma.user.update({
        where: { id: actor.userId },
        data: { passwordHash, passwordUpdatedAt: now, tokenVersion: { increment: 1 } },
      }),
      prisma.authSession.updateMany({
        where: { userId: actor.userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    await writeAuthAuditLog({
      userId: actor.userId,
      role: actor.role,
      eventType: "PASSWORD_RESET_COMPLETED",
      request,
      metadata: { loginIdentifier },
    });

    // No session is minted here: the user logs in normally, so the login code still applies.
    return NextResponse.json(compatibilitySuccess({}, "Password updated. Please log in with your new password."));
  } catch {
    await writeAuthAuditLog({
      eventType: "PASSWORD_RESET_FAILED",
      request,
      metadata: { loginIdentifier },
    });
    return failed("Invalid or expired code", 401);
  }
}
