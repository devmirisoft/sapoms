import { NextRequest, NextResponse } from "next/server";
import { adminDetailResponse, adminMutationResponse } from "@/server/admin/admin-response";
import { adminErrorResponse } from "@/server/admin/admin-errors";
import { parseBigIntRouteParam, requireAdmin } from "@/server/admin/admin-route";
import { createDiagnosticPassword, getActiveDiagnosticPassword, revokeDiagnosticPassword } from "@/server/modules/admin/diagnostic-passwords.service";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  try {
    await requireAdmin();
    const { staffId } = await params;
    const id = parseBigIntRouteParam(staffId, "staff id");
    return NextResponse.json(adminDetailResponse(await getActiveDiagnosticPassword({ staffId: id })), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/admin/staff/[staffId]/diagnostic-password]", error);
    return adminErrorResponse(error, "Diagnostic password is unavailable");
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  try {
    const actor = await requireAdmin();
    const { staffId } = await params;
    const id = parseBigIntRouteParam(staffId, "staff id");
    const data = await createDiagnosticPassword({ staffId: id }, await request.json(), actor);
    return NextResponse.json(adminMutationResponse("Diagnostic password saved", data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[POST /api/admin/staff/[staffId]/diagnostic-password]", error);
    return adminErrorResponse(error, "Diagnostic password could not be saved");
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ staffId: string }> }) {
  try {
    const actor = await requireAdmin();
    const { staffId } = await params;
    const id = parseBigIntRouteParam(staffId, "staff id");
    return NextResponse.json(adminMutationResponse("Diagnostic password revoked", await revokeDiagnosticPassword({ staffId: id }, actor)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[DELETE /api/admin/staff/[staffId]/diagnostic-password]", error);
    return adminErrorResponse(error, "Diagnostic password could not be revoked");
  }
}
