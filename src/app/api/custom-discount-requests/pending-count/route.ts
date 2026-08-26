import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireAuth } from "@/server/auth/session";
import { buildRsmDiscountRequestWhere, isStaffLike } from "@/server/auth/sales-scope";

export const runtime = "nodejs";

/* The sidebar badge must equal the number the discount page itself shows, so
   the scoping here mirrors GET /api/custom-discount-requests exactly:

     - ADMIN lands on the pending tab of a list the API pre-filters to
       rsmApprovalStatus APPROVED, i.e. RSM-cleared and awaiting admin.
     - RSM lands on the "awaiting" tab, which is the subset still unreviewed
       by the RSM, over their region plus the staff reporting into them.
     - Other staff only ever see their own requests.

   The page derives its status through resolveApprovalAggregateStatus, which
   overrides the column from a `lineStatuses` array. Nothing populates that
   array today (it is not a column on CustomDiscountRequest), so it always
   falls through to the raw status and this count matches. Should lineStatuses
   ever start being written, this endpoint has to learn the same aggregation. */
export async function GET() {
  try {
    const actor = await requireAuth();

    if (!actor || actor.role === "DEALER") {
      return NextResponse.json({ success: false, message: "Discount approval counts are not available for this role" }, { status: 403 });
    }

    const where: Record<string, unknown> = { status: "PENDING" };

    if (actor.role === "ADMIN") {
      where.rsmApprovalStatus = "APPROVED";
    } else if (actor.role === "RSM") {
      Object.assign(where, await buildRsmDiscountRequestWhere(actor, prisma));
      where.rsmApprovalStatus = "PENDING";
    } else if (isStaffLike(actor)) {
      where.staffId = actor.staffId;
    } else {
      return NextResponse.json({ success: true, count: 0 });
    }

    const count = await prisma.customDiscountRequest.count({ where });
    return NextResponse.json({ success: true, count });
  } catch (error: any) {
    console.error("custom-discount-requests pending-count GET failed", error);
    const status = Number(error?.status)
      || (error?.message === "Unauthenticated" ? 401 : error?.message === "Forbidden" ? 403 : 500);
    return NextResponse.json(
      { success: false, message: status >= 500 ? "Failed to load pending discount count" : error.message },
      { status },
    );
  }
}
