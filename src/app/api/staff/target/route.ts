import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { requireAuth } from "@/server/auth/session";
import { isStaffLike } from "@/server/auth/sales-scope";

export const runtime = "nodejs";

/* Sales target for the staff dashboard, role-wise: the summed annual target of
   every dealer under the caller (RSM: whole team, ASM: self + executives,
   Staff: own dealers) against accepted sales from those dealers this financial
   year (1 April onwards). */
export async function GET() {
  try {
    const actor = await requireAuth();
    if (!isStaffLike(actor) || !actor.staffId) return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
    const me = actor.staffId;
    const team: Prisma.StaffProfileWhereInput = actor.role === "RSM"
      ? { OR: [{ id: me }, { parentRsmId: me }, { parentAsm: { parentRsmId: me } }] }
      : actor.role === "ASM" ? { OR: [{ id: me }, { parentAsmId: me }] }
      : { id: me };

    const assignments = await prisma.dealerStaffAssignment.findMany({
      where: { staff: team, active: true, removedAt: null, dealer: { deletedAt: null } },
      select: { dealerId: true, dealer: { select: { annualTargetPaise: true } } },
    });
    // A dealer shared by two team members counts once.
    const targets = new Map(assignments.map((row) => [row.dealerId, Number(row.dealer.annualTargetPaise ?? 0)]));

    const now = new Date();
    // ponytail: server-local 1 April; pin to IST if the server runs in UTC and the boundary hour matters.
    const fyStart = new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1);
    const sales = targets.size === 0 ? null : await prisma.order.aggregate({
      where: { dealerId: { in: [...targets.keys()] }, orderDate: { gte: fyStart }, acceptanceStatus: "ACCEPTED", status: { not: "CANCELLED" } },
      _sum: { finalPayableAmountPaise: true },
    });

    const target = [...targets.values()].reduce((sum, paise) => sum + paise, 0) / 100;
    const achieved = Number(sales?._sum.finalPayableAmountPaise ?? 0) / 100;
    return NextResponse.json(
      { success: true, data: { target, achieved, pending: Math.max(0, target - achieved), dealers: targets.size, fyStart: fyStart.toISOString().slice(0, 10) } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    console.error("[GET /api/staff/target]", error);
    const status = error?.message === "Unauthenticated" ? 401 : 500;
    return NextResponse.json({ success: false, message: "Target unavailable" }, { status });
  }
}
