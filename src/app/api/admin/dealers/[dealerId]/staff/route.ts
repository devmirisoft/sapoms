import { NextRequest, NextResponse } from "next/server";
import { adminDetailResponse, adminMutationResponse } from "@/server/admin/admin-response";
import { adminErrorResponse } from "@/server/admin/admin-errors";
import { parseBigIntRouteParam, requireAdmin } from "@/server/admin/admin-route";
import { parseReplaceDealerStaffInput } from "@/server/modules/admin/dealers/dealers.schemas";
import { getAdminDealerStaffAssignments, replaceAdminDealerStaffAssignments } from "@/server/modules/admin/dealers/dealers.service";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ dealerId: string }> }) {
  try {
    await requireAdmin();
    const { dealerId } = await params;
    const id = parseBigIntRouteParam(dealerId, "dealerId");
    const assignedStaff = await getAdminDealerStaffAssignments(id);
    return NextResponse.json(adminDetailResponse({ dealerId: id.toString(), assignedStaff }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/admin/dealers/[dealerId]/staff]", error);
    return adminErrorResponse(error, "Dealer staff assignments are unavailable");
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ dealerId: string }> }) {
  try {
    const actor = await requireAdmin();
    const { dealerId } = await params;
    const id = parseBigIntRouteParam(dealerId, "dealerId");
    const input = parseReplaceDealerStaffInput(await request.json());
    const staffIds = input.staffIds.map((staffId) => BigInt(staffId));
    const assignedStaff = await replaceAdminDealerStaffAssignments(id, staffIds, actor, {
      rsmUserId: input.rsmUserId ? BigInt(input.rsmUserId) : undefined,
      region: input.region,
    });
    return NextResponse.json(adminMutationResponse("Dealer staff assignments updated successfully", { dealerId: id.toString(), assignedStaff }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[PUT /api/admin/dealers/[dealerId]/staff]", error);
    return adminErrorResponse(error, "Dealer staff assignment update failed");
  }
}
