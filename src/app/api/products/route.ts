import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/server/auth/session";
import { listPostgresCatalogue } from "@/server/modules/products/postgres-catalogue";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireRole(["ADMIN", "STAFF", "DEALER"]);
    const includeInactive = actor.role === "ADMIN" && request.nextUrl.searchParams.get("includeInactive") === "true";
    const data = await listPostgresCatalogue({ includeInactive });
    return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/products]", error);
    return NextResponse.json({ success: false, message: "Product catalogue is unavailable" }, { status: error instanceof Error && error.message === "Forbidden" ? 403 : 401 });
  }
}
