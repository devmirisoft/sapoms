import { NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { isStaffLike } from "@/server/auth/sales-scope";
import { staffSalesTarget } from "@/server/modules/staff-target";

export const runtime = "nodejs";

export async function GET() {
  try {
    const actor = await requireAuth();
    if (!isStaffLike(actor) || !actor.staffId) return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
    return NextResponse.json(
      { success: true, data: await staffSalesTarget(actor, actor.staffId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    console.error("[GET /api/staff/target]", error);
    const status = error?.message === "Unauthenticated" ? 401 : 500;
    return NextResponse.json({ success: false, message: "Target unavailable" }, { status });
  }
}
