import { NextRequest, NextResponse } from "next/server";
import { adminDetailResponse, adminMutationResponse } from "@/server/admin/admin-response";
import { AdminRouteError, adminErrorResponse } from "@/server/admin/admin-errors";
import { requireAdmin, requireAdminOnly } from "@/server/admin/admin-route";
import { normalizeSalesRegion } from "@/server/auth/sales-scope";
import { prisma } from "@/server/db/prisma";
import { getRegionStates, saveRegionStates } from "@/server/sales-region-states";
import { STATE_OPTIONS } from "@/lib/places";

export const runtime = "nodejs";

// Every region's states: its RSM's, or the list kept for a region with no RSM.
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(adminDetailResponse(await getRegionStates(prisma)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/admin/sales-regions]", error);
    return adminErrorResponse(error, "Region states are unavailable");
  }
}

// Sets the states of a region that has no RSM. A region with an RSM is edited on the RSM row.
export async function PUT(request: NextRequest) {
  try {
    await requireAdminOnly();
    const body = await request.json().catch(() => ({}));
    const region = normalizeSalesRegion(body?.region);
    if (!region) throw new AdminRouteError("INVALID_REQUEST", "A valid region is required");
    const states = Array.isArray(body?.states) ? [...new Set(body.states.map(String))].sort() as string[] : null;
    if (!states || states.some((state) => !(STATE_OPTIONS as readonly string[]).includes(state))) {
      throw new AdminRouteError("INVALID_REQUEST", "States must be a list of known states");
    }
    const rsm = await prisma.staffProfile.findFirst({ where: { salesRegion: region, user: { role: "RSM", deletedAt: null } }, select: { id: true } });
    if (rsm) throw new AdminRouteError("CONFLICT", "This region has an RSM; its states are the RSM's states");
    await saveRegionStates(prisma, region, states);
    return NextResponse.json(adminMutationResponse("Region states saved", { region, states }));
  } catch (error) {
    console.error("[PUT /api/admin/sales-regions]", error);
    return adminErrorResponse(error, "Region states could not be saved");
  }
}
