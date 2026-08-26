import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { isStaffLike } from "@/server/auth/sales-scope";
import { formsErrorResponse, listForms } from "../route";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth();
    if (!isStaffLike(actor)) {
      return NextResponse.json(
        { success: false, message: "Only staff can view their form submissions" },
        { status: 403 }
      );
    }
    return await listForms(req, actor);
  } catch (error) {
    return formsErrorResponse("[GET /api/forms/mine]", error, "Failed to load form submissions");
  }
}
