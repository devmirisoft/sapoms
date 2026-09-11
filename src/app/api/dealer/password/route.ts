import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireRole } from "@/server/auth/session";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { compatibilityFailure, compatibilitySuccess } from "@/server/http/compat-response";

export const runtime = "nodejs";

const MIN_LENGTH = 10;
const MAX_LENGTH = 200;

export async function POST(request: NextRequest) {
  let actor;
  try {
    actor = await requireRole("DEALER");
  } catch {
    return NextResponse.json(compatibilityFailure("Unauthenticated"), { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const currentPassword = String(input.currentPassword ?? "");
    const newPassword = String(input.newPassword ?? "");

    if (newPassword.length < MIN_LENGTH || newPassword.length > MAX_LENGTH) {
      return NextResponse.json(compatibilityFailure(`Password must be at least ${MIN_LENGTH} characters`), { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { passwordHash: true, passwordUpdatedAt: true },
    });
    if (!user) return NextResponse.json(compatibilityFailure("Account not found"), { status: 404 });

    // The current password is required except for the very first change, which is
    // the forced post-login popup - the dealer has an admin-issued password they
    // were never told, and the popup blocks the app until they replace it.
    if (user.passwordUpdatedAt && !(await verifyPassword(currentPassword, user.passwordHash))) {
      return NextResponse.json(compatibilityFailure("Current password is incorrect"), { status: 400 });
    }

    if (await verifyPassword(newPassword, user.passwordHash)) {
      return NextResponse.json(compatibilityFailure("Choose a password different from your current one"), { status: 400 });
    }

    const passwordHash = await hashPassword(newPassword);
    const passwordUpdatedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: actor.userId },
        data: { passwordHash, passwordUpdatedAt, tokenVersion: { increment: 1 } },
      });
      await tx.authSession.updateMany({
        where: { userId: actor.userId, id: { not: actor.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.authAuditLog.create({
        data: {
          sessionId: actor.sessionId,
          role: actor.role,
          eventType: "DEALER_PASSWORD_CHANGED",
          metadata: {
            userId: actor.userId.toString(),
            dealerId: actor.dealerId?.toString(),
            forced: !user.passwordUpdatedAt,
          },
        },
      });
    });

    return NextResponse.json(compatibilitySuccess({ passwordUpdatedAt: passwordUpdatedAt.toISOString() }, "Password updated"));
  } catch (error) {
    console.error("[POST /api/dealer/password]", error);
    return NextResponse.json(compatibilityFailure("Password could not be updated"), { status: 400 });
  }
}
