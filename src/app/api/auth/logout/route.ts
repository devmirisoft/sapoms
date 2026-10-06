import { NextRequest, NextResponse } from "next/server";
import { compatibilitySuccess } from "@/server/http/compat-response";
import {
  ACCESS_COOKIE,
  clearAuthCookies,
  currentProfileForAccessToken,
  readImpersonatorCookie,
  revokeSession,
  rotateRefreshToken,
  setAuthCookies,
  verifyAccessToken,
} from "@/server/auth/session";

export async function POST(request: NextRequest) {
  let restored: { accessToken: string; refreshToken: string; profile: unknown } | null = null;
  try {
    const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
    if (accessToken) {
      const claims = verifyAccessToken(accessToken);
      await revokeSession(claims.sid, request);

      // An admin leaving a dealer account they signed into goes back to their own session.
      const impersonator = readImpersonatorCookie(request);
      if (impersonator?.dealerSessionId === claims.sid) {
        const rotated = await rotateRefreshToken(impersonator.adminRefreshToken, request);
        restored = { ...rotated, profile: await currentProfileForAccessToken(rotated.accessToken) };
      }
    }
  } catch (error) {
    console.error("[POST /api/auth/logout]", error);
  }

  const response = NextResponse.json(restored
    ? compatibilitySuccess({ restored: restored.profile }, "Signed back in as admin")
    : compatibilitySuccess({}, "Logged out successfully"));
  clearAuthCookies(response);
  if (restored) setAuthCookies(response, restored.accessToken, restored.refreshToken);
  return response;
}
