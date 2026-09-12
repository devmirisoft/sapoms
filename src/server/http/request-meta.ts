import type { NextRequest } from "next/server";

// Deliberately dependency-free. Both the session layer and the audit writer need
// these, and routing the audit writer through session.ts to get them would drag
// jwt, cookies and the Prisma client into anything that writes an audit row.

export function requestIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

export function userAgent(request: NextRequest) {
  return request.headers.get("user-agent");
}
