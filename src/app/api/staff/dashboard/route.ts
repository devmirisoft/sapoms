import { NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { isStaffLike } from "@/server/auth/sales-scope";
import { staffDashboard } from "@/server/modules/staff-dashboard";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const actor = await requireAuth();
    if (!isStaffLike(actor) || !actor.staffId) return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
    const granularity = new URL(request.url).searchParams.get("granularity");
    return NextResponse.json(
      { success: true, data: await staffDashboard(actor, actor.staffId, granularity) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    console.error("[GET /api/staff/dashboard]", error);
    const status = error?.message === "Unauthenticated" ? 401 : 500;
    return NextResponse.json({ success: false, message: "Dashboard unavailable" }, { status });
  }
}
