import { NextRequest, NextResponse } from "next/server";
import { adminDetailResponse } from "@/server/admin/admin-response";
import { AdminRouteError, adminErrorResponse } from "@/server/admin/admin-errors";
import { auditAdminAction, parseBigIntRouteParam, requestIdFrom, requireAdmin, requireAdminOnly } from "@/server/admin/admin-route";
import { getTermsBlocks, parseTermsBlocks, saveTermsBlocks } from "@/server/terms-content";

export const runtime = "nodejs";

type Params = { params: Promise<{ dealerId: string }> };

// The dealer's own T&C document, or the global template when they have none.
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
    const id = parseBigIntRouteParam((await params).dealerId, "dealerId");
    return NextResponse.json(adminDetailResponse(await getTermsBlocks(id)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/admin/dealers/[dealerId]/terms]", error);
    return adminErrorResponse(error, "Dealer terms are unavailable");
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const actor = await requireAdminOnly();
    const id = parseBigIntRouteParam((await params).dealerId, "dealerId");
    const body = await request.json().catch(() => null);
    const blocks = parseTermsBlocks(body?.blocks);
    if (!blocks) throw new AdminRouteError("INVALID_REQUEST", "Invalid terms content");

    await saveTermsBlocks(blocks, id);
    await auditAdminAction({ actor, request, eventType: "DEALER_TERMS_UPDATED", route: "/api/admin/dealers/[dealerId]/terms", requestId: requestIdFrom(request) });

    return NextResponse.json(adminDetailResponse(blocks));
  } catch (error) {
    console.error("[PUT /api/admin/dealers/[dealerId]/terms]", error);
    return adminErrorResponse(error, "Could not save dealer terms");
  }
}
