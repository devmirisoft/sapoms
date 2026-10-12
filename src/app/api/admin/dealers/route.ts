import { NextRequest, NextResponse } from "next/server";
import { adminListResponse, adminMutationResponse } from "@/server/admin/admin-response";
import { AdminRouteError, adminErrorResponse } from "@/server/admin/admin-errors";
import { parseTermsBlocks, saveTermsBlocks } from "@/server/terms-content";
import { auditAdminAction, requireAdmin, requestIdFrom } from "@/server/admin/admin-route";
import { parseAdminDealerListInput, parseCreateAdminDealerInput } from "@/server/modules/admin/dealers/dealers.schemas";
import { createAdminDealer, listAdminDealers } from "@/server/modules/admin/dealers/dealers.service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAdmin();
    const requestId = requestIdFrom(request);
    const input = parseAdminDealerListInput(request.nextUrl.searchParams);
    const result = await listAdminDealers(input);
    await auditAdminAction({ actor, request, eventType: "ADMIN_DEALERS_VIEWED", route: "/api/admin/dealers", requestId });
    return NextResponse.json(adminListResponse({ items: result.items, page: input.page, pageSize: input.pageSize, total: result.total }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/admin/dealers]", error);
    return adminErrorResponse(error, "Dealers are unavailable");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAdmin();
    const body = await request.json();
    const input = parseCreateAdminDealerInput(body);
    // Optional per-dealer T&C; validated before the dealer exists so a bad payload creates nothing.
    const termsBlocks = body?.termsBlocks === undefined ? null : parseTermsBlocks(body.termsBlocks);
    if (body?.termsBlocks !== undefined && !termsBlocks) throw new AdminRouteError("INVALID_REQUEST", "Invalid terms content");
    const data = await createAdminDealer(input, actor);
    if (termsBlocks) await saveTermsBlocks(termsBlocks, BigInt(data.Dealer_Id));
    return NextResponse.json(adminMutationResponse("Dealer created successfully", data), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[POST /api/admin/dealers]", error);
    return adminErrorResponse(error, "Dealer creation failed");
  }
}