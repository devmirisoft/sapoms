import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireAuth } from "@/server/auth/session";

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
      select: { id: true, name: true },
    });
    return NextResponse.json(
      { success: true, data: rows.map((row) => ({ id: row.id.toString(), name: row.name })) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[GET /api/couriers]", error);
    const message = error instanceof Error ? error.message : "Failed to load couriers";
    return NextResponse.json({ success: false, message }, { status: message === "Unauthenticated" ? 401 : 500 });
  }
}
