import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { adminDetailResponse } from "@/server/admin/admin-response";
import { AdminRouteError, adminErrorResponse } from "@/server/admin/admin-errors";
import { auditAdminAction, requestIdFrom, requireAdmin, requireAdminOnly } from "@/server/admin/admin-route";

export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  try {
    await requireAdmin();

    const dealers = await prisma.dealerProfile.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        dealerCode: true,
        businessName: true,
        phone: true,
        city: true,
        state: true,
        termsAcceptedAt: true,
        termsActive: true,
        createdAt: true,
        user: { select: { email: true } },
      },
      orderBy: [{ termsAcceptedAt: "asc" }, { businessName: "asc" }],
    });

    return NextResponse.json(
      adminDetailResponse(
        dealers.map((dealer) => ({
          id: dealer.id.toString(),
          dealerCode: dealer.dealerCode,
          businessName: dealer.businessName,
          phone: dealer.phone,
          email: dealer.user?.email ?? null,
          city: dealer.city,
          state: dealer.state,
          acceptedAt: dealer.termsAcceptedAt?.toISOString() ?? null,
          active: dealer.termsActive,
          createdAt: dealer.createdAt.toISOString(),
        })),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[GET /api/admin/terms-acceptance]", error);
    return adminErrorResponse(error, "Terms acceptance report is unavailable");
  }
}

// Switches the T&C document on or off for every dealer at once.
export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireAdminOnly();
    const body = await request.json().catch(() => null);
    if (typeof body?.active !== "boolean") throw new AdminRouteError("INVALID_REQUEST", "active must be true or false");

    const { count } = await prisma.dealerProfile.updateMany({ where: { deletedAt: null, termsActive: !body.active }, data: { termsActive: body.active } });
    await auditAdminAction({ actor, request, eventType: body.active ? "ALL_DEALER_TERMS_ACTIVATED" : "ALL_DEALER_TERMS_DEACTIVATED", route: "/api/admin/terms-acceptance", requestId: requestIdFrom(request) });

    return NextResponse.json(adminDetailResponse({ active: body.active, updated: count }));
  } catch (error) {
    console.error("[PATCH /api/admin/terms-acceptance]", error);
    return adminErrorResponse(error, "Could not update dealer terms status");
  }
}
