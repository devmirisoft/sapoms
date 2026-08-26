import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireAuth } from "@/server/auth/session";
import { isAdminLike, isStaffLike } from "@/server/auth/sales-scope";
import { peekNextLeadNo } from "@/lib/formSubmissions";
import { formsErrorResponse } from "../route";

export const runtime = "nodejs";

export async function GET() {
  try {
    const actor = await requireAuth();
    if (!isStaffLike(actor) && !isAdminLike(actor)) {
      return NextResponse.json({ success: false, message: "Form access denied" }, { status: 403 });
    }

    const leadNo = await peekNextLeadNo(prisma);
    return NextResponse.json({ success: true, leadNo }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return formsErrorResponse("[GET /api/forms/next-lead]", error, "Failed to load next lead number");
  }
}
