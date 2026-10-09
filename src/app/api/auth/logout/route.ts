import { NextRequest, NextResponse } from "next/server";
import { compatibilityFailure, compatibilitySuccess } from "@/server/http/compat-response";
import { restoreImpersonation } from "@/server/auth/impersonation";
import {
  IMPERSONATOR_COOKIE,
  clearAccessCookie,
  clearAuthCookies,
  currentSessionId,
  impersonationDeps,
  revokeSession,
  setAuthCookies,
  writeAuthAuditLog,
} from "@/server/auth/session";

export async function POST(request: NextRequest) {
  const restorationToken = request.cookies.get(IMPERSONATOR_COOKIE)?.value;
  let restored: { accessToken: string; refreshToken: string } | null = null;
  try {
    const sessionId = await currentSessionId(request);
    if (sessionId) {
      // The current session always ends first, so a failed restore can never leave the dealer signed in.
      await revokeSession(sessionId, request);

      // An admin leaving a dealer account they signed into resumes their own paused session.
      if (restorationToken) {
        const result = await restoreImpersonation(impersonationDeps(), { restorationToken, dealerSessionId: sessionId });
        await writeAuthAuditLog({
          sessionId,
          userId: result.adminUserId,
          role: result.adminRole,
          eventType: result.ok ? "IMPERSONATION_ENDED" : "IMPERSONATION_RESTORE_FAILED",
          action: "IMPERSONATE",
          entity: "SESSION",
          entityId: sessionId,
          request,
          metadata: {
            impersonationId: result.impersonationId,
            adminSessionId: result.adminSessionId,
            dealerSessionId: sessionId,
            outcome: result.ok ? "restored" : result.reason,
          },
        });
        if (result.ok) restored = result;
      }
    }
  } catch (error) {
    console.error("[POST /api/auth/logout]", error);
    // A database/network error mid-way must not cost an impersonating admin their own session:
    // restoreImpersonation rolled back, so keep the refresh and restoration cookies (path /api/auth)
    // and let the client retry. The client's last attempt sends ?final=1 to give up and clear all.
    if (restorationToken && !request.nextUrl.searchParams.has("final")) {
      const response = NextResponse.json(compatibilityFailure("Could not finish signing out. Try again."), { status: 503 });
      clearAccessCookie(response);
      return response;
    }
  }

  const response = NextResponse.json(restored
    ? compatibilitySuccess({ restored: true }, "Signed back in as admin")
    : compatibilitySuccess({}, "Logged out successfully"));
  clearAuthCookies(response);
  if (restored) setAuthCookies(response, restored.accessToken, restored.refreshToken);
  return response;
}
