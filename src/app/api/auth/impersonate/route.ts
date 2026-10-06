import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { compatibilityFailure, compatibilitySuccess } from "@/server/http/compat-response";
import { adminErrorResponse } from "@/server/admin/admin-errors";
import { requireAdminOnly } from "@/server/admin/admin-route";
import { findActivePostgresDealer } from "@/server/auth/providers/postgres-auth.provider";
import { REFRESH_COOKIE, createSessionForUser, setAuthCookies, setImpersonatorCookie, writeAuthAuditLog } from "@/server/auth/session";

const schema = z.object({ dealerId: z.coerce.bigint() });

// Signs an admin in as a dealer, skipping the dealer's password and emailed code.
// Lives under /api/auth so the admin's refresh cookie (path /api/auth) is sent here
// and can be set aside for logout to restore.
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminOnly();
    const adminRefreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
    if (!adminRefreshToken) return NextResponse.json(compatibilityFailure("Unauthenticated"), { status: 401 });

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json(compatibilityFailure("Invalid dealer"), { status: 400 });

    const dealer = await findActivePostgresDealer(parsed.data.dealerId);
    const { session, accessToken, refreshToken } = await createSessionForUser(dealer, request);

    await writeAuthAuditLog({
      sessionId: session.id,
      userId: admin.userId,
      role: admin.role,
      eventType: "IMPERSONATION_STARTED",
      action: "IMPERSONATE",
      entity: "DEALER",
      entityId: parsed.data.dealerId.toString(),
      actorName: admin.displayName,
      actorEmail: admin.email,
      request,
      metadata: { adminSessionId: admin.sessionId, dealerUserId: dealer.userId.toString() },
    });

    const response = NextResponse.json(compatibilitySuccess(dealer.profile));
    setAuthCookies(response, accessToken, refreshToken);
    setImpersonatorCookie(response, session.id, adminRefreshToken);
    return response;
  } catch (error) {
    console.error("[POST /api/auth/impersonate]", error);
    return adminErrorResponse(error, "Unable to sign in as this dealer");
  }
}
