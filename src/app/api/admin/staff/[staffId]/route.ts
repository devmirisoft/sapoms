import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse } from "@/server/admin/admin-errors";
import { auditAdminAction, parseBigIntRouteParam, requireAdmin, requestIdFrom } from "@/server/admin/admin-route";
import { parseUpdateAdminStaffInput } from "@/server/modules/admin/staff/staff.schemas";
import { deleteAdminStaff, getAdminStaff, updateAdminStaff } from "@/server/modules/admin/staff/staff.service";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ staffId: string }> }) {
  try {
    const actor = await requireAdmin();
    const requestId = requestIdFrom(request);
    const { staffId } = await context.params;
    const id = parseBigIntRouteParam(staffId, "staff id");
    const item = await getAdminStaff(id);
    await auditAdminAction({ actor, request, eventType: "ADMIN_STAFF_DETAIL_VIEWED", route: "/api/admin/staff/[staffId]", requestId, targetId: staffId });
    return NextResponse.json({ success: true, data: item }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/admin/staff/[staffId]]", error);
    return adminErrorResponse(error, "Staff member is unavailable");
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ staffId: string }> }) {
  try {
    const actor = await requireAdmin();
    const requestId = requestIdFrom(request);
    const { staffId } = await context.params;
    const id = parseBigIntRouteParam(staffId, "staff id");
    const input = parseUpdateAdminStaffInput(await request.json());
    const item = await updateAdminStaff(id, input, actor);
    await auditAdminAction({ actor, request, eventType: "ADMIN_STAFF_UPDATED", route: "/api/admin/staff/[staffId]", requestId, targetId: staffId });
    return NextResponse.json({ success: true, data: item });
  } catch (error) {
    console.error("[PATCH /api/admin/staff/[staffId]]", error);
    return adminErrorResponse(error, "Staff member could not be updated");
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ staffId: string }> }) {
  try {
    const actor = await requireAdmin();
    const requestId = requestIdFrom(request);
    const { staffId } = await context.params;
    const id = parseBigIntRouteParam(staffId, "staff id");
    await deleteAdminStaff(id, actor);
    await auditAdminAction({ actor, request, eventType: "ADMIN_STAFF_DELETED", route: "/api/admin/staff/[staffId]", requestId, targetId: staffId });
    return NextResponse.json({ success: true, message: "Staff member deleted successfully" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[DELETE /api/admin/staff/[staffId]]", error);
    return adminErrorResponse(error, "Staff member could not be deleted");
  }
}
