import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse } from "@/server/admin/admin-errors";
import { auditAdminAction, parseStaffTarget, requireAdminOnly, requestIdFrom } from "@/server/admin/admin-route";
import { parseUpdateStaffStatusInput } from "@/server/modules/admin/staff/staff.schemas";
import { updateAdminStaffStatus } from "@/server/modules/admin/staff/staff.service";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ staffId: string }> }) {
  try {
    const actor = await requireAdminOnly();
    const requestId = requestIdFrom(request);
    const { staffId } = await context.params;
    const input = parseUpdateStaffStatusInput(await request.json());
    const item = await updateAdminStaffStatus(parseStaffTarget(staffId), input, actor);
    await auditAdminAction({ actor, request, eventType: "ADMIN_STAFF_STATUS_CHANGED", route: "/api/admin/staff/[staffId]/status", requestId, targetId: staffId });
    return NextResponse.json({ success: true, data: item }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[PATCH /api/admin/staff/[staffId]/status]", error);
    return adminErrorResponse(error, "Staff status update failed");
  }
}
