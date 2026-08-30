import { NextRequest, NextResponse } from "next/server";
import { adminDetailResponse, adminMutationResponse } from "@/server/admin/admin-response";
import { adminErrorResponse } from "@/server/admin/admin-errors";
import { parseBigIntRouteParam, requireAdmin } from "@/server/admin/admin-route";
import { createDiagnosticPassword, getActiveDiagnosticPassword, revokeDiagnosticPassword } from "@/server/modules/admin/diagnostic-passwords.service";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ dealerId: string }> }) {
  try {
    await requireAdmin();
    const { dealerId } = await params;
    const id = parseBigIntRouteParam(dealerId, "dealerId");
    return NextResponse.json(adminDetailResponse(await getActiveDiagnosticPassword({ dealerId: id })), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/admin/dealers/[dealerId]/diagnostic-password]", error);
    return adminErrorResponse(error, "Diagnostic password is unavailable");
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ dealerId: string }> }) {
  try {
    const actor = await requireAdmin();
    const { dealerId } = await params;
    const id = parseBigIntRouteParam(dealerId, "dealerId");
    const data = await createDiagnosticPassword({ dealerId: id }, await request.json(), actor);
    return NextResponse.json(adminMutationResponse("Diagnostic password saved", data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[POST /api/admin/dealers/[dealerId]/diagnostic-password]", error);
    return adminErrorResponse(error, "Diagnostic password could not be saved");
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ dealerId: string }> }) {
  try {
    const actor = await requireAdmin();
    const { dealerId } = await params;
    const id = parseBigIntRouteParam(dealerId, "dealerId");
    return NextResponse.json(adminMutationResponse("Diagnostic password revoked", await revokeDiagnosticPassword({ dealerId: id }, actor)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[DELETE /api/admin/dealers/[dealerId]/diagnostic-password]", error);
    return adminErrorResponse(error, "Diagnostic password could not be revoked");
  }
}