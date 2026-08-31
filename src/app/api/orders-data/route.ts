import { NextRequest, NextResponse } from "next/server";
import { loadOrderHeaders, ORDER_HEADER_SOURCES } from "@/lib/orderHeaders";
import { buildOrdersPage } from "@/lib/orderPagination";
import { fetchStaffAssignedDealerIds, orderActorFromAuth } from "@/lib/orderScopeServer";
import { STAFF_ORDER_SCOPE_VERSION } from "@/lib/staffOrderScope.js";
import { requireAuth } from "@/server/auth/session";
import { serializePrismaValue } from "@/server/db/prisma-serialize";

export const runtime = "nodejs";

function positiveInt(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(1, Math.floor(parsed))) : fallback;
}

export async function GET(req: NextRequest) {
  const requestStartedAt = performance.now();
  const requestedSource = String(req.nextUrl.searchParams.get("source") || "current");
  const source = ORDER_HEADER_SOURCES.has(requestedSource) ? requestedSource : "current";
  const requestedPage = positiveInt(req.nextUrl.searchParams.get("page"), 1, 100_000);
  const requestedLimit = positiveInt(req.nextUrl.searchParams.get("limit"), 10, 1000);

  try {
    const authActor = await requireAuth();
    const actor = orderActorFromAuth(authActor);
    if (!actor) {
      return NextResponse.json({ success: false, message: "Order scope is not available for this session." }, { status: 403 });
    }
    const assignedDealerIds = actor.role === "staff" ? await fetchStaffAssignedDealerIds(actor.actorId) : [];
    const loaded = await loadOrderHeaders({ source, actor, assignedDealerIds });
    const activeRows = loaded.rows.filter((row) => String(row.del_status ?? "").trim() !== "1");
    const amountMin = req.nextUrl.searchParams.has("amount_min") ? Number(req.nextUrl.searchParams.get("amount_min")) : null;
    const amountMax = req.nextUrl.searchParams.has("amount_max") ? Number(req.nextUrl.searchParams.get("amount_max")) : null;
    const page = buildOrdersPage({
      rows: activeRows,
      page: requestedPage,
      pageSize: requestedLimit,
      filters: {
        search: String(req.nextUrl.searchParams.get("search") || "").slice(0, 200),
        accepted: req.nextUrl.searchParams.get("accepted") ?? "",
        orderStatus: req.nextUrl.searchParams.get("order_status") ?? "",
        mtStatus: req.nextUrl.searchParams.get("mt_status") ?? "",
        orderId: req.nextUrl.searchParams.get("order_id") ?? "",
        dateFrom: req.nextUrl.searchParams.get("date_from") ?? "",
        dateTo: req.nextUrl.searchParams.get("date_to") ?? "",
        amountMin: amountMin !== null && Number.isFinite(amountMin) ? amountMin : null,
        amountMax: amountMax !== null && Number.isFinite(amountMax) ? amountMax : null,
        targetDealerId: req.nextUrl.searchParams.get("dealer") ?? "",
        warehouse: req.nextUrl.searchParams.get("warehouse") ?? "",
      },
    });
    const response = NextResponse.json(serializePrismaValue({
      success: true,
      status: true,
      data: page.items,
      count: page.total,
      total: page.total,
      recordsTotal: page.total,
      recordsFiltered: page.total,
      last_page: page.totalPages,
      lastPage: page.totalPages,
      page: requestedPage,
      truncated: loaded.truncated,
      totalIsExact: loaded.totalIsExact,
      staffOrderScopeVersion: STAFF_ORDER_SCOPE_VERSION,
      diagnostics: process.env.NODE_ENV !== "production" ? loaded.diagnostics : undefined,
    }));
    if (process.env.NODE_ENV !== "production") {
      const durationMs = Math.round(performance.now() - requestStartedAt);
      response.headers.set("Server-Timing", `orders-data;dur=${durationMs}`);
    }
    return response;
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthenticated") {
      return NextResponse.json({ success: false, message: "Authentication required." }, { status: 401 });
    }
    console.error("[GET /api/orders-data]", error);
    return NextResponse.json({ success: false, message: "Unable to load orders" }, { status: 502 });
  }
}