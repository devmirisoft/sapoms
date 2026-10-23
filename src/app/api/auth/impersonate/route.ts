import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { compatibilityFailure, compatibilitySuccess } from "@/server/http/compat-response";
import { adminErrorResponse } from "@/server/admin/admin-errors";
import { requireAdminOnly } from "@/server/admin/admin-route";
import { ImpersonationError, startImpersonation } from "@/server/auth/impersonation";
import { findActivePostgresDealer, findActivePostgresStaff } from "@/server/auth/providers/postgres-auth.provider";
import {
  REFRESH_COOKIE,
  createSessionForUser,
  impersonationDeps,
  revokeSession,
  setAuthCookies,
  setImpersonatorCookie,
  writeAuthAuditLog,
} from "@/server/auth/session";

const schema = z.union([z.object({ dealerId: z.coerce.bigint() }), z.object({ staffId: z.coerce.bigint() })]);

// Signs an admin in as a dealer or staff member, skipping their password and emailed code. The admin's own
// session is paused, not ended; logout from the dealer session resumes it (see impersonation.ts).
// Lives under /api/auth so the admin's refresh cookie (path /api/auth) is sent here: presenting it
// proves this browser holds the admin session being paused.
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminOnly();
    const adminRefreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
    if (!adminRefreshToken) return NextResponse.json(compatibilityFailure("Unauthenticated"), { status: 401 });

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json(compatibilityFailure("Invalid account"), { status: 400 });

    const target = "dealerId" in parsed.data
      ? { entity: "DEALER", id: parsed.data.dealerId, user: await findActivePostgresDealer(parsed.data.dealerId) }
      : { entity: "STAFF", id: parsed.data.staffId, user: await findActivePostgresStaff(parsed.data.staffId) };
    const { session, accessToken, refreshToken } = await createSessionForUser(target.user, request);

    let started: Awaited<ReturnType<typeof startImpersonation>>;
    try {
      started = await startImpersonation(impersonationDeps(), { adminSessionId: admin.sessionId, adminRefreshToken, dealerSessionId: session.id });
    } catch (error) {
      // Never leave an unlinked dealer session behind.
      await revokeSession(session.id, request).catch(() => undefined);
      if (error instanceof ImpersonationError) {
        return NextResponse.json(compatibilityFailure("Your admin session changed. Refresh the page and try again."), { status: 409 });
      }
      throw error;
    }

    await writeAuthAuditLog({
      sessionId: session.id,
      userId: admin.userId,
      role: admin.role,
      eventType: "IMPERSONATION_STARTED",
      action: "IMPERSONATE",
      entity: target.entity,
      entityId: target.id.toString(),
      actorName: admin.displayName,
      actorEmail: admin.email,
      request,
      metadata: {
        impersonationId: started.impersonationId,
        adminSessionId: admin.sessionId,
        dealerSessionId: session.id,
        dealerUserId: target.user.userId.toString(),
        expiresAt: started.expiresAt.toISOString(),
      },
    });

    const response = NextResponse.json(compatibilitySuccess(target.user.profile));
    setAuthCookies(response, accessToken, refreshToken, request);
    setImpersonatorCookie(response, started.restorationToken, started.expiresAt, request);
    return response;
  } catch (error) {
    console.error("[POST /api/auth/impersonate]", error);
    return adminErrorResponse(error, "Unable to sign in as this account");
  }
}
