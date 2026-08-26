import { NextRequest, NextResponse } from "next/server";
import { invalidatePendingProductsCache } from "@/lib/pendingProducts";
import { requireAuth } from "@/server/auth/session";
import { errorStatus } from "@/server/http/auth-error";
import { serializePrismaValue } from "@/server/db/prisma-serialize";
import { normalizeFulfilmentStatus, PostgresOrderStatusError } from "@/lib/postgresOrderStatus";
import { applyPostgresOrderDispatch, applyPostgresOrderDispatchTracking, findPostgresOrderDispatchPayload, mapPostgresDispatchRecordForResponse } from "@/lib/postgresOrderDispatch";

export const runtime = "nodejs";

function safeText(value: unknown, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof PostgresOrderStatusError) {
    return NextResponse.json({ success: false, code: error.code, message: error.message }, { status: error.status });
  }
  const status = errorStatus(error);
  if (status < 500) {
    return NextResponse.json({ success: false, message: (error as Error).message }, { status });
  }
  return NextResponse.json({ success: false, message: fallback }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth();
    const orderId = safeText(req.nextUrl.searchParams.get("orderId") || req.nextUrl.searchParams.get("order_id"), 80);
    const orderItemId = safeText(req.nextUrl.searchParams.get("orderItemId") || req.nextUrl.searchParams.get("order_item_id"), 80);
    const lookup = orderId || orderItemId;
    if (!lookup) {
      return NextResponse.json({ success: false, message: "orderId or orderItemId is required" }, { status: 400 });
    }

    const payload = await findPostgresOrderDispatchPayload(lookup, actor);
    if (!payload) {
      return NextResponse.json({ success: false, message: "Dispatch records are available only for PostgreSQL orders." }, { status: 404 });
    }

    const records = payload.records.map(mapPostgresDispatchRecordForResponse);
    if (orderItemId) {
      const record = records.find((candidate) => candidate.orderItemId === orderItemId || candidate.id === `pg:${orderItemId}`);
      if (!record) return NextResponse.json({ success: false, message: "Dispatch record not found" }, { status: 404 });
      return NextResponse.json({ success: true, data: record }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ success: true, data: records, tracking: payload.tracking }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/order-dispatch]", error);
    return errorResponse(error, "Failed to load dispatch details");
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const actor = await requireAuth();

    // Dispatch tracking information is saved on its own (no quantity/remark),
    // reusing the same authorization as a dispatch quantity update.
    if (body.action === "update_dispatch_tracking") {
      const saved = await applyPostgresOrderDispatchTracking(body.orderId, actor, body);
      if (!saved) {
        return NextResponse.json({ success: false, message: "Historical PHP orders are read-only for dispatch updates." }, { status: 409 });
      }
      return NextResponse.json(
        serializePrismaValue({ success: true, data: saved.records, tracking: saved.tracking, order: saved.order, failures: [] }),
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const nextStatus = normalizeFulfilmentStatus(body.fulfilmentStatus ?? body.status ?? "IN_PROCESS");
    if (!nextStatus) {
      return NextResponse.json({ success: false, message: "A valid fulfilment status is required" }, { status: 400 });
    }

    const updated = await applyPostgresOrderDispatch(body.orderId, actor, body);
    if (!updated) {
      return NextResponse.json({ success: false, message: "Historical PHP orders are read-only for dispatch updates." }, { status: 409 });
    }

    invalidatePendingProductsCache();
    return NextResponse.json(serializePrismaValue({ success: true, data: updated.records, tracking: updated.tracking, order: updated.order, failures: [] }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[POST /api/order-dispatch]", error);
    return errorResponse(error, "Failed to save dispatch details");
  }
}
