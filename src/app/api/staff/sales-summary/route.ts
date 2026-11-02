import { NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { isStaffLike } from "@/server/auth/sales-scope";
import { staffSalesSummary } from "@/server/modules/staff-dashboard";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const actor = await requireAuth();
    if (!isStaffLike(actor) || !actor.staffId) return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
    const params = new URL(request.url).searchParams;
    return NextResponse.json(
      {
        success: true,
        data: await staffSalesSummary(actor, {
          from: params.get("from"),
          to: params.get("to"),
          city: params.get("city"),
          member: params.get("member"),
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    console.error("[GET /api/staff/sales-summary]", error);
    const status = error?.message === "Unauthenticated" ? 401 : 500;
    return NextResponse.json({ success: false, message: "Sales summary unavailable" }, { status });
  }
}
