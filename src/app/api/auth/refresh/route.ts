import { NextRequest, NextResponse } from "next/server";
import { compatibilityFailure, compatibilitySuccess } from "@/server/http/compat-response";
import { REFRESH_COOKIE, rotateRefreshToken, setAuthCookies } from "@/server/auth/session";

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
    if (!refreshToken) return NextResponse.json(compatibilityFailure("Unauthenticated"), { status: 401 });

    const rotated = await rotateRefreshToken(refreshToken, request);
    const response = NextResponse.json(compatibilitySuccess({}, "Session refreshed"));
    setAuthCookies(response, rotated.accessToken, rotated.refreshToken, request);
    return response;
  } catch (error) {
    console.error("[POST /api/auth/refresh]", error);
    return NextResponse.json(compatibilityFailure("Unauthenticated"), { status: 401 });
  }
}