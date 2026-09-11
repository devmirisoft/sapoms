import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireAdmin } from "@/server/admin/admin-route";
import { DISPATCH_PARTNER_LIMIT, normalizeTrackingLink } from "@/lib/orderDispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CourierRow = {
  id: bigint;
  name: string;
  trackingUrlPrefix: string | null;
  isActive: boolean;
  position: number;
};

function toDto(row: CourierRow) {
  return {
    id: row.id.toString(),
    name: row.name,
    trackingUrlPrefix: row.trackingUrlPrefix,
    isActive: row.isActive,
    position: row.position,
  };
}

// Empty string clears the prefix; anything that is not an http(s) URL is a
// typo worth reporting rather than silently dropping.
function courierPrefix(value: unknown) {
  if (typeof value === "string" && !value.trim()) return null;
  const prefix = normalizeTrackingLink(value);
  if (!prefix) throw Object.assign(new Error("Tracking link prefix must be a valid http(s) URL."), { status: 400 });
  return prefix;
}

function courierName(value: unknown) {
  const name = typeof value === "string" ? value.trim().slice(0, DISPATCH_PARTNER_LIMIT) : "";
  if (!name) throw Object.assign(new Error("Courier name is required"), { status: 400 });
  return name;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Courier request failed";
  // A duplicate name is a user mistake, not a server fault.
  if ((error as { code?: string })?.code === "P2002") {
    return NextResponse.json({ success: false, message: "A courier with that name already exists." }, { status: 409 });
  }
  const status = Number((error as { status?: unknown })?.status)
    || (message === "Unauthenticated" ? 401 : message === "Forbidden" ? 403 : 500);
  return NextResponse.json({ success: false, message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  try {
    await requireAdmin();
    const rows = await prisma.courier.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
    });
    return NextResponse.json({ success: true, data: rows.map(toDto) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/admin/couriers]", error);
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const row = await prisma.courier.create({
      data: {
        name: courierName(body.name),
        trackingUrlPrefix: body.trackingUrlPrefix === undefined ? null : courierPrefix(body.trackingUrlPrefix),
        position: Number.isFinite(Number(body.position)) ? Number(body.position) : 0,
      },
    });
    return NextResponse.json({ success: true, data: toDto(row) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[POST /api/admin/couriers]", error);
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const id = String(body.id ?? "").trim();
    if (!id) throw Object.assign(new Error("Courier id is required"), { status: 400 });

    const row = await prisma.courier.update({
      where: { id: BigInt(id) },
      data: {
        ...(body.name === undefined ? {} : { name: courierName(body.name) }),
        ...(body.trackingUrlPrefix === undefined ? {} : { trackingUrlPrefix: courierPrefix(body.trackingUrlPrefix) }),
        ...(body.isActive === undefined ? {} : { isActive: Boolean(body.isActive) }),
        ...(body.position === undefined ? {} : { position: Number(body.position) || 0 }),
      },
    });
    return NextResponse.json({ success: true, data: toDto(row) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[PATCH /api/admin/couriers]", error);
    return errorResponse(error);
  }
}

// Orders store the courier name as text, so removing a row never orphans an
// order — past dispatches keep reading their saved name.
export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin();
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) throw Object.assign(new Error("Courier id is required"), { status: 400 });

    await prisma.courier.delete({ where: { id: BigInt(id) } });
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[DELETE /api/admin/couriers]", error);
    return errorResponse(error);
  }
}
