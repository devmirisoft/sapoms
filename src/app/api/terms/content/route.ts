import { NextRequest, NextResponse } from "next/server";
import { adminDetailResponse } from "@/server/admin/admin-response";
import { adminErrorResponse } from "@/server/admin/admin-errors";
import { auditAdminAction, requestIdFrom, requireAdminOnly } from "@/server/admin/admin-route";
import { getTermsBlocks, parseTermsBlocks, saveTermsBlocks } from "@/server/terms-content";

export const runtime = "nodejs";

// Public: the /terms page and the dealer modal both read it.
export async function GET() {
  try {
    return NextResponse.json(adminDetailResponse(await getTermsBlocks()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/terms/content]", error);
    return NextResponse.json({ status: false, success: false, message: "Terms are unavailable" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await requireAdminOnly();
    const body = await request.json().catch(() => null);
    const blocks = parseTermsBlocks(body?.blocks);
    if (!blocks) {
      return NextResponse.json({ status: false, success: false, message: "Invalid terms content" }, { status: 400 });
    }

    await saveTermsBlocks(blocks);
    await auditAdminAction({ actor, request, eventType: "TERMS_CONTENT_UPDATED", route: "/api/terms/content", requestId: requestIdFrom(request) });

    return NextResponse.json(adminDetailResponse(blocks));
  } catch (error) {
    console.error("[PUT /api/terms/content]", error);
    return adminErrorResponse(error, "Could not save terms");
  }
}
