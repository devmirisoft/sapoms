import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireAuth } from "@/server/auth/session";
import { isStaffLike } from "@/server/auth/sales-scope";
import { getAdminStaff } from "@/server/modules/admin/staff/staff.service";

export const runtime = "nodejs";

// Read-only: staff see the same details admin sees in "view details", but only admin can edit them.
export async function GET() {
  try {
    const actor = await requireAuth();
    if (!isStaffLike(actor) || !actor.staffId) return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
    const [staff, user] = await Promise.all([
      getAdminStaff({ kind: "staff", id: actor.staffId }),
      prisma.user.findUnique({ where: { id: actor.userId }, select: { username: true, email: true } }),
    ]);
    return NextResponse.json({ success: true, status: true, data: { ...staff, staff_username: user?.username || user?.email || "" } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/staff/profile]", error);
    return NextResponse.json({ success: false, message: "Staff profile unavailable" }, { status: 401 });
  }
}
