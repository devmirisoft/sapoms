import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { adminDetailResponse } from "@/server/admin/admin-response";
import { adminErrorResponse } from "@/server/admin/admin-errors";
import { requireAdmin } from "@/server/admin/admin-route";

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
