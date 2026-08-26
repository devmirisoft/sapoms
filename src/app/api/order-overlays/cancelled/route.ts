import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { listPostgresCancelledOverlays, PostgresOrderAnnotationError } from "@/lib/postgresOrderAnnotations";
import { errorStatus } from "@/server/http/auth-error";

export const runtime = "nodejs";

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(1, Math.floor(parsed))) : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const page = positiveInt(req.nextUrl.searchParams.get("page"), 1, 100_000);
    const limit = positiveInt(req.nextUrl.searchParams.get("limit"), 10, 100);
    const search = req.nextUrl.searchParams.get("search") || "";
    const actor = await requireAuth();
    if (actor.role === "ACCOUNTANT") {
      return NextResponse.json({ success: false, message: "Cancelled orders are not available for this role." }, { status: 403 });
    }

    const result = await listPostgresCancelledOverlays(actor, { search, page, limit });
    return NextResponse.json({
      success: true,
      data: result.rows,
      count: result.total,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      last_page: result.totalPages,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/order-overlays/cancelled]", error);
    const status = error instanceof PostgresOrderAnnotationError ? error.status : errorStatus(error);
    return NextResponse.json(
      { success: false, message: status >= 500 ? "Unable to load cancelled orders." : String((error as Error)?.message ?? "Unable to load cancelled orders.") },
      { status },
    );
  }
}