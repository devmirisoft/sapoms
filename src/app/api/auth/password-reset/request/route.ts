import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { compatibilitySuccess } from "@/server/http/compat-response";
import { findActivePostgresUserByLoginIdentifier, normalizeLoginIdentifier } from "@/server/auth/providers/postgres-auth.provider";
import { createEmailOtpForUser, invalidateEmailOtp, requiresEmailOtp } from "@/server/auth/email-otp";
import { sendPasswordResetOtp } from "@/server/auth/email";
import { writeAuthAuditLog } from "@/server/auth/session";

const requestSchema = z.object({
  email: z.string().trim().min(1),
});

// The same reply whether or not the account exists, so this route cannot be used to find accounts.
const genericMessage = "If an account exists, a reset code has been sent to its email address.";

export async function POST(request: NextRequest) {
  let loginIdentifier: string | undefined;

  try {
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json(compatibilitySuccess({}, genericMessage));

    loginIdentifier = normalizeLoginIdentifier(parsed.data.email);

    let actor;
    try {
      actor = await findActivePostgresUserByLoginIdentifier(loginIdentifier);
      // Self-service reset is for the emailed-code roles (dealers, staff, NSMs); admins and accountants go through an admin.
      if (!requiresEmailOtp(actor.role)) throw new Error("Invalid credentials");
    } catch {
      await writeAuthAuditLog({
        eventType: "PASSWORD_RESET_REQUEST_IGNORED",
        request,
        metadata: { loginIdentifier },
      });
      return NextResponse.json(compatibilitySuccess({}, genericMessage));
    }

    const { otp, record } = await createEmailOtpForUser(actor.userId);
    try {
      await sendPasswordResetOtp(actor.email, otp);
    } catch (error) {
      await invalidateEmailOtp(record.id);
      await writeAuthAuditLog({
        userId: actor.userId,
        role: actor.role,
        eventType: "PASSWORD_RESET_SEND_FAILED",
        request,
        metadata: { loginIdentifier },
      });
      throw error;
    }

    await writeAuthAuditLog({
      userId: actor.userId,
      role: actor.role,
      eventType: "PASSWORD_RESET_REQUESTED",
      request,
      metadata: { loginIdentifier },
    });

    return NextResponse.json(compatibilitySuccess({}, genericMessage));
  } catch (error) {
    const status = Number((error as { status?: unknown }).status) || 500;
    if (status !== 429) console.error("[POST /api/auth/password-reset/request]", error);
    await writeAuthAuditLog({
      eventType: "PASSWORD_RESET_REQUEST_FAILED",
      request,
      metadata: { loginIdentifier, status },
    });
    // A resend inside the 30-second cooldown is not an error to the user: the earlier code is still live.
    return NextResponse.json(compatibilitySuccess({}, genericMessage), { status: status === 429 ? 200 : 500 });
  }
}
