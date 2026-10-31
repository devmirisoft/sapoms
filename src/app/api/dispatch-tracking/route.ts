import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { orderActorFromAuth } from "@/lib/orderScopeServer";
import { actorWhere, mapPostgresShipment } from "@/lib/postgresOrders";
import { requireAuth } from "@/server/auth/session";
import {
  buildPendingProductFilterOptions,
  buildPendingProductLines,
  paginatePendingProducts,
  parsePendingReportPeriod,
  pendingReportPeriodStartMs,
  type PendingProductsItemRow,
} from "@/lib/pendingProducts";
import { mapPostgresOrderDispatchRecords } from "@/lib/postgresOrderDispatch";
import { shipmentLabel, type OrderDispatchRecord } from "@/lib/orderDispatch";
import { alignDispatchRecordsToOverlayItems } from "@/lib/pendingProductOverlays";
import { itemAliases, loadOrderOverlayStates, orderAlias, pendingCatalogueProducts } from "@/lib/postgresPendingProducts";
import { findCatalogueItem } from "@/server/modules/products/catalogue";
import cataloguePricing from "@/lib/cataloguePricing";
import {
  buildDispatchTrackingOrders,
  filterDispatchTrackingOrders,
  parseDispatchTrackingSort,
  parseDispatchTrackingStatus,
  sortDispatchTrackingOrders,
  summarizeDispatchTrackingOrders,
  type DispatchEntry,
  type DispatchOrderMeta,
  type TrackedLineInput,
} from "@/lib/dispatchTracking";

export const runtime = "nodejs";

// ponytail: status, category and search are worked out per order in memory, so the
// scan is capped like Pending Products. Move them into SQL if the cap starts biting.
const ORDER_SCAN_LIMIT = 5000;

function safeText(value: unknown, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function safeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

async function loadOrders(scope: Prisma.OrderWhereInput, periodStartMs: number | null, dealerId: string) {
  return prisma.order.findMany({
    where: {
      AND: [
        scope,
        { status: { notIn: ["CANCELLED", "DECLINED"] } },
        // Tracking starts at the first dispatch; a period keeps orders with a dispatch inside it.
        { items: { some: { dispatches: { some: periodStartMs === null ? {} : { createdAt: { gte: new Date(periodStartMs) } } } } } },
        ...(/^\d{1,18}$/.test(dealerId) ? [{ dealerId: BigInt(dealerId) }] : []),
      ],
    },
    include: {
      dealer: { select: { id: true, businessName: true, dealerCode: true } },
      assignedStaff: { select: { id: true, displayName: true } },
      items: { orderBy: { id: "asc" }, include: { dispatches: { orderBy: { createdAt: "asc" } } } },
      shipments: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { orderDate: "desc" },
    take: ORDER_SCAN_LIMIT,
  });
}

type LoadedOrder = Awaited<ReturnType<typeof loadOrders>>[number];

/** A line the order no longer prices (legacy overlay edits) is valued at its catalogue pack price. */
async function catalogueValuePaise(catalogueNumber: string, packs: number): Promise<bigint | null> {
  const entry = catalogueNumber ? await findCatalogueItem(catalogueNumber).catch(() => null) : null;
  const pricing = entry?.variant ? cataloguePricing.variantPricing(entry.variant) : null;
  return pricing ? BigInt(Math.round(pricing.packPricePaise)) * BigInt(packs) : null;
}

function dispatchEntries(order: LoadedOrder, item: LoadedOrder["items"][number]): DispatchEntry[] {
  return item.dispatches.map((dispatch) => {
    const shipment = dispatch.shipmentId ? order.shipments.find((row) => row.id === dispatch.shipmentId) : undefined;
    return {
      at: dispatch.createdAt.toISOString(),
      quantity: dispatch.quantity,
      shipmentId: shipment ? shipment.id.toString() : null,
      shipment: shipment ? shipmentLabel(mapPostgresShipment(shipment)) : "No shipment linked",
      trackingLink: shipment?.trackingLink ?? null,
      remark: dispatch.remark ?? "",
    };
  });
}

export async function GET(req: NextRequest) {
  try {
    const actor = orderActorFromAuth(await requireAuth());
    if (actor?.role !== "accountant") {
      return NextResponse.json({ success: false, message: "Dispatch tracking is available to accountants only." }, { status: 403 });
    }

    const params = req.nextUrl.searchParams;
    const search = safeText(params.get("search"), 240);
    const category = safeText(params.get("category"), 120);
    const dealerId = safeText(params.get("dealerId"), 40);
    const status = parseDispatchTrackingStatus(params.get("status"));
    const sort = parseDispatchTrackingSort(params.get("sort"));
    const period = parsePendingReportPeriod(params.get("period"));
    const page = safeInteger(params.get("page"), 1);
    const pageSize = Math.min(100, safeInteger(params.get("pageSize"), 12));

    const scannedOrders = await loadOrders(await actorWhere(actor), pendingReportPeriodStartMs(period, Date.now()), dealerId);
    const overlayStates = await loadOrderOverlayStates(scannedOrders);

    const warnings: string[] = [];
    if (scannedOrders.length >= ORDER_SCAN_LIMIT) {
      warnings.push(
        `Only the ${ORDER_SCAN_LIMIT.toLocaleString()} newest orders with dispatches were scanned. Narrow the dealer or period filter for complete totals.`
      );
    }

    const orders = scannedOrders.filter(
      (order) => !overlayStates.get(order.legacyPhpId || order.id.toString())?.cancelled
    );

    // Same item, dispatch and overlay alignment as Pending Products, so the quantities match it.
    const orderItemsByOrderId: Record<string, PendingProductsItemRow[]> = {};
    const dispatchRecordsByOrderId: Record<string, OrderDispatchRecord[]> = {};
    const metaByOrderId = new Map<string, DispatchOrderMeta>();
    const sourceByLineKey = new Map<string, { order: LoadedOrder; item: LoadedOrder["items"][number] }>();

    for (const order of orders) {
      const orderId = order.legacyPhpId || order.id.toString();
      const effectiveItems = overlayStates.get(orderId)?.effectiveItems ?? null;
      const dispatchRecords = mapPostgresOrderDispatchRecords(order as any);

      orderItemsByOrderId[orderId] = effectiveItems ?? itemAliases(order);
      dispatchRecordsByOrderId[orderId] = effectiveItems
        ? alignDispatchRecordsToOverlayItems(dispatchRecords, effectiveItems)
        : dispatchRecords;
      metaByOrderId.set(orderId, {
        finalPayablePaise: order.finalPayableAmountPaise,
        shipments: order.shipments.map((shipment) => ({
          id: shipment.id.toString(),
          dispatchPartner: shipment.dispatchPartner || null,
          trackingNumber: shipment.trackingNumber,
          trackingLink: shipment.trackingLink,
          createdAt: shipment.createdAt.toISOString(),
        })),
      });
      for (const item of order.items) {
        sourceByLineKey.set(`${orderId}:${item.legacyPhpOrderItemId || item.id.toString()}`, { order, item });
      }
    }

    const lines = buildPendingProductLines({
      orders: orders.map(orderAlias),
      orderItemsByOrderId,
      dispatchRecordsByOrderId,
      catalogueProducts: pendingCatalogueProducts,
      includeFulfilled: true,
    });

    const trackedLines: TrackedLineInput[] = await Promise.all(
      lines.map(async (line) => {
        const source = sourceByLineKey.get(`${line.orderId}:${line.orderItemId}`);
        const stored = source && source.item.finalAmountPaise > BigInt(0) && source.item.quantityPacks > 0 ? source.item : null;
        return {
          ...line,
          valuePaise: stored
            ? (stored.finalAmountPaise * BigInt(line.orderedQuantity)) / BigInt(stored.quantityPacks)
            : await catalogueValuePaise(line.catalogueNumber, line.orderedQuantity),
          dispatches: source ? dispatchEntries(source.order, source.item) : [],
        };
      })
    );

    const { categories, dealers } = buildPendingProductFilterOptions(lines);
    const allOrders = buildDispatchTrackingOrders(trackedLines, metaByOrderId);
    // The cards count every status, so "fully dispatched" still shows under "In progress".
    const summary = summarizeDispatchTrackingOrders(filterDispatchTrackingOrders(allOrders, { search, category, status: "all" }));
    const matching = sortDispatchTrackingOrders(filterDispatchTrackingOrders(allOrders, { search, category, status }), sort);

    // Report mode returns every matching order unpaginated for the workbook.
    if (safeText(params.get("report"), 20)) {
      return NextResponse.json(
        { success: true, data: { orders: matching, summary, period, generatedAt: new Date().toISOString(), warnings } },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const paginated = paginatePendingProducts(matching, page, pageSize);
    return NextResponse.json(
      { success: true, data: { ...paginated, summary, filters: { categories, dealers }, warnings } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if ((error as Error)?.message === "Unauthenticated") {
      return NextResponse.json({ success: false, message: "Your session has expired. Sign in again." }, { status: 401 });
    }
    console.error("[GET /api/dispatch-tracking]", error);
    return NextResponse.json({ success: false, message: "Failed to load dispatch tracking." }, { status: 500 });
  }
}
