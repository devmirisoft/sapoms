import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireAuth, requireRole } from "@/server/auth/session";
import { DISPATCH_PARTNER_LIMIT, normalizeTrackingLink } from "@/lib/orderDispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Read-only list for the order "Dispatched By" dropdown. Anyone who can see an
// order may read it; admin manages the rows through /api/admin/couriers.
export async function GET() {
  try {
    await requireAuth();
    const rows = await prisma.courier.findMany({
      where: { isActive: true },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, trackingUrlPrefix: true },
    });
    return NextResponse.json(
      {
        success: true,
        data: rows.map((row) => ({
          id: row.id.toString(),
          name: row.name,
          trackingUrlPrefix: row.trackingUrlPrefix,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[GET /api/couriers]", error);
    const message = error instanceof Error ? error.message : "Failed to load couriers";
    return NextResponse.json({ success: false, message }, { status: message === "Unauthenticated" ? 401 : 500 });
  }
}

// Staff and admins add couriers from the order details dispatch dropdown; the
// admin couriers page still owns rename/deactivate/delete.
export async function POST(request: NextRequest) {
  try {
    await requireRole(["ADMIN", "NSM", "RSM", "ASM", "STAFF"]);
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim().slice(0, DISPATCH_PARTNER_LIMIT) : "";
    if (!name) return NextResponse.json({ success: false, message: "Courier name is required" }, { status: 400 });
    // Optional: a blank/invalid prefix just leaves the tracking link manual.
    const trackingUrlPrefix = normalizeTrackingLink(body.trackingUrlPrefix);

    // An existing (possibly deactivated) courier is reused, so adding a name
    // twice selects it instead of failing on the unique index.
    const existing = await prisma.courier.findFirst({ where: { name } });
    const row = existing
      ? await prisma.courier.update({
          where: { id: existing.id },
          // Keep the prefix already on file when the caller sent none.
          data: { isActive: true, ...(trackingUrlPrefix ? { trackingUrlPrefix } : {}) },
        })
      : await prisma.courier.create({ data: { name, trackingUrlPrefix, position: 0 } });

    return NextResponse.json(
      { success: true, data: { id: row.id.toString(), name: row.name, trackingUrlPrefix: row.trackingUrlPrefix } },
      { status: existing ? 200 : 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[POST /api/couriers]", error);
    const message = error instanceof Error ? error.message : "Failed to add courier";
    const status = message === "Unauthenticated" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}
