import { NextRequest, NextResponse } from "next/server";
import catalogueProducts from "../../../../public/data/omsons_products_from_excel_with_images.json";
import { prisma } from "@/server/db/prisma";
import { orderActorFromAuth } from "@/lib/orderScopeServer";
import { requireAuth } from "@/server/auth/session";
import {
  aggregatePendingProducts,
  buildPendingProductDrilldown,
  buildPendingProductFilterOptions,
  buildPendingProductLines,
  buildPendingProductsSummaryFromLines,
  filterPendingLinesByPeriod,
  filterPendingProductLines,
  filterPendingProducts,
  parsePendingReportPeriod,
  paginatePendingProducts,
  sortPendingProducts,
  type PendingDealerDirectoryRow,
  type PendingProductClubBy,
  type PendingProductsItemRow,
  type PendingProductsOrderRow,
  type PendingProductsRole,
} from "@/lib/pendingProducts";
import { mapPostgresOrderDispatchRecords } from "@/lib/postgresOrderDispatch";
import type { OrderDispatchRecord } from "@/lib/orderDispatch";
import {
  alignDispatchRecordsToOverlayItems,
  resolvePendingOverlayStates,
  type PendingOverlayState,
} from "@/lib/pendingProductOverlays";

export const runtime = "nodejs";

const ORDER_SCAN_LIMIT = 5000;

type PendingProductsActor = { role: PendingProductsRole; actorId: string };

function safeText(value: unknown, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function safeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function parseSort(value: string) {
  if (value === "alphabetical" || value === "oldest_pending") return value;
  return "pending_desc";
}

function parseClubBy(value: string): PendingProductClubBy {
  return value === "dealer" || value === "category" ? value : "product";
}

async function loadOrders(actor: PendingProductsActor) {
  const where: any = {
    status: { notIn: ["CANCELLED", "DECLINED", "COMPLETED"] },
    acceptanceStatus: "ACCEPTED",
  };

  if (actor.role === "dealer") where.dealerId = BigInt(actor.actorId);
  if (actor.role === "staff") {
    const staffId = BigInt(actor.actorId);
    where.OR = [
      { assignedStaffId: staffId },
      { dealer: { staffAssignments: { some: { staffId, active: true } } } },
    ];
  }

  return prisma.order.findMany({
    where,
    include: {
      dealer: { select: { id: true, businessName: true } },
      assignedStaff: { select: { id: true, displayName: true } },
      items: { orderBy: { id: "asc" }, include: { dispatches: { orderBy: { createdAt: "asc" } } } },
    },
    orderBy: { orderDate: "asc" },
    take: ORDER_SCAN_LIMIT,
  });
}

type LoadedOrder = Awaited<ReturnType<typeof loadOrders>>[number];

async function loadOrderOverlayStates(orders: LoadedOrder[]) {
  if (orders.length === 0) return new Map<string, PendingOverlayState>();

  const rows = await prisma.orderOverlay.findMany({
    where: { orderId: { in: orders.map((order) => order.id) } },
    orderBy: { createdAt: "asc" },
    select: { orderId: true, type: true, status: true, metadata: true },
  });

  return resolvePendingOverlayStates(
    rows,
    new Map(orders.map((order) => [order.id.toString(), order.legacyPhpId || order.id.toString()]))
  );
}

function orderAlias(order: Awaited<ReturnType<typeof loadOrders>>[number]): PendingProductsOrderRow {
  return {
    order_id: order.legacyPhpId || order.id.toString(),
    orderId: order.legacyPhpId || order.id.toString(),
    order_date: order.orderDate.toISOString(),
    orderDate: order.orderDate.toISOString(),
    order_dealer: order.dealerId.toString(),
    orderdata_dealerid: order.dealerId.toString(),
    Dealer_Id: order.dealerId.toString(),
    Dealer_Name: order.dealer.businessName,
    accept_order: "1",
    del_status: "0",
    order_status: order.status,
    mtstatus: order.fulfilmentStatus,
    reason: order.cancellationReason ?? "",
    assignedstaff: order.assignedStaffId?.toString() ?? "",
    staffid: order.assignedStaffId?.toString() ?? "",
    staffname: order.assignedStaff?.displayName ?? "",
  };
}

function itemAliases(order: Awaited<ReturnType<typeof loadOrders>>[number]): PendingProductsItemRow[] {
  const orderId = order.legacyPhpId || order.id.toString();
  return order.items.map((item) => ({
    orderdata_id: item.legacyPhpOrderItemId || item.id.toString(),
    orderdata_orderid: orderId,
    orderdata_cat_no: item.catalogueNumberSnapshot,
    product_name: item.productNameSnapshot,
    product_discription: item.skuSnapshot ?? "",
    product_unit: "Units",
    orderdata_item_quantity: item.quantityPacks,
    readyquantity: item.dispatches.reduce((sum, dispatch) => sum + dispatch.quantity, 0),
    orderdata_status: item.dispatches.length > 0 ? "1" : "0",
    remark: item.remarks ?? "",
    remarks: item.remarks ?? "",
    packSize: item.packSize,
    totalPieces: item.totalPieces,
    quantityPacks: item.quantityPacks,
    category: item.categorySnapshot ?? "",
  }));
}

export async function GET(req: NextRequest) {
  try {
    const authActor = await requireAuth();
    const scopedActor = orderActorFromAuth(authActor);
    if (!scopedActor) {
      return NextResponse.json({ success: false, message: "Missing pending-products identity" }, { status: 401 });
    }

    const actor: PendingProductsActor = {
      role: scopedActor.role === "accountant" ? "admin" : scopedActor.role,
      actorId: scopedActor.actorId,
    };

    const search = safeText(req.nextUrl.searchParams.get("search"), 240);
    const category = safeText(req.nextUrl.searchParams.get("category"), 120);
    const sort = parseSort(safeText(req.nextUrl.searchParams.get("sort"), 40));
    const clubBy = parseClubBy(safeText(req.nextUrl.searchParams.get("clubBy"), 40));
    const dealerId = safeText(req.nextUrl.searchParams.get("dealerId"), 120);
    const assignedStaffId = safeText(req.nextUrl.searchParams.get("assignedStaffId"), 120);
    const productKey = safeText(req.nextUrl.searchParams.get("productKey"), 260);
    const page = safeInteger(req.nextUrl.searchParams.get("page"), 1);
    const pageSize = safeInteger(req.nextUrl.searchParams.get("pageSize"), 20);

    const scannedOrders = await loadOrders(actor);
    const overlayStates = await loadOrderOverlayStates(scannedOrders);

    const warnings: string[] = [];
    if (scannedOrders.length >= ORDER_SCAN_LIMIT) {
      warnings.push(
        `Only the ${ORDER_SCAN_LIMIT.toLocaleString()} oldest open orders were scanned. Narrow the dealer or staff filter for complete totals.`
      );
    }

    const orders = scannedOrders.filter(
      (order) => !overlayStates.get(order.legacyPhpId || order.id.toString())?.cancelled
    );

    const orderRows = orders.map(orderAlias);
    const orderItemsByOrderId: Record<string, PendingProductsItemRow[]> = {};
    const dispatchRecordsByOrderId: Record<string, OrderDispatchRecord[]> = {};
    const dealerDirectoryById: Record<string, PendingDealerDirectoryRow> = {};

    for (const order of orders) {
      const orderId = order.legacyPhpId || order.id.toString();
      const effectiveItems = overlayStates.get(orderId)?.effectiveItems ?? null;
      const dispatchRecords = mapPostgresOrderDispatchRecords(order as any);

      orderItemsByOrderId[orderId] = effectiveItems ?? itemAliases(order);
      dispatchRecordsByOrderId[orderId] = effectiveItems
        ? alignDispatchRecordsToOverlayItems(dispatchRecords, effectiveItems)
        : dispatchRecords;
      dealerDirectoryById[order.dealerId.toString()] = {
        Dealer_Id: order.dealerId.toString(),
        Dealer_Name: order.dealer.businessName,
        assignedstaff: order.assignedStaffId?.toString() ?? "",
        staffname: order.assignedStaff?.displayName ?? "",
      };
    }

    const lines = buildPendingProductLines({
      orders: orderRows,
      orderItemsByOrderId,
      dispatchRecordsByOrderId,
      dealerDirectoryById,
      catalogueProducts: Array.isArray(catalogueProducts) ? catalogueProducts : [],
    });
    const scopedLines = filterPendingProductLines(lines, { dealerId, assignedStaffId });
    const summary = buildPendingProductsSummaryFromLines(scopedLines);
    const filters = buildPendingProductFilterOptions(scopedLines);

    // Report mode returns every matching row unpaginated so the client can build
    // a workbook. It always groups by product — the dealer/category clubbing is a
    // browse aid, and mixing it in would desync the two sheets.
    if (safeText(req.nextUrl.searchParams.get("report"), 20)) {
      const period = parsePendingReportPeriod(req.nextUrl.searchParams.get("period"));
      const periodLines = filterPendingLinesByPeriod(scopedLines, period);
      const products = sortPendingProducts(
        filterPendingProducts(aggregatePendingProducts(periodLines, "product"), { search, category }),
        sort
      );
      const keptKeys = new Set(products.map((product) => product.productKey));
      const keptLines = periodLines.filter((line) => keptKeys.has(line.productKey));

      return NextResponse.json(
        {
          success: true,
          data: {
            products,
            // Trimmed to the columns the workbook renders; the full line carries
            // ~30 fields and this payload is unpaginated.
            lines: keptLines.map((line) => ({
              productKey: line.productKey,
              catalogueNumber: line.catalogueNumber,
              productName: line.productName,
              specification: line.specification,
              category: line.category,
              orderId: line.orderId,
              orderDate: line.orderDate,
              dealerId: line.dealerId,
              dealerName: line.dealerName,
              assignedStaffNames: line.assignedStaffNames,
              orderedQuantity: line.orderedQuantity,
              dispatchedQuantity: line.dispatchedQuantity,
              pendingQuantity: line.pendingQuantity,
              productUnit: line.productUnit,
              packSize: line.packSize,
              dispatchStatus: line.dispatchStatus,
              mtstatus: line.mtstatus,
            })),
            summary: buildPendingProductsSummaryFromLines(keptLines),
            period,
            generatedAt: new Date().toISOString(),
            warnings,
          },
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (productKey) {
      const detail = buildPendingProductDrilldown(scopedLines, productKey, clubBy);
      if (!detail.aggregate) {
        return NextResponse.json({ success: false, message: "Pending product not found in your permitted scope." }, { status: 404 });
      }
      const paginatedOrders = paginatePendingProducts(detail.orders, page, pageSize);
      return NextResponse.json({ success: true, data: { product: detail.aggregate, orders: paginatedOrders.items, summary, filters, page: paginatedOrders.page, pageSize: paginatedOrders.pageSize, total: paginatedOrders.total, totalPages: paginatedOrders.totalPages, warnings } }, { headers: { "Cache-Control": "no-store" } });
    }

    const aggregates = sortPendingProducts(filterPendingProducts(aggregatePendingProducts(scopedLines, clubBy), { search, category }), sort);
    const paginatedProducts = paginatePendingProducts(aggregates, page, pageSize);
    return NextResponse.json({ success: true, data: { items: paginatedProducts.items, summary, filters, page: paginatedProducts.page, pageSize: paginatedProducts.pageSize, total: paginatedProducts.total, totalPages: paginatedProducts.totalPages, warnings } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if ((error as Error)?.message === "Unauthenticated") {
      return NextResponse.json({ success: false, message: "Your session has expired. Sign in again." }, { status: 401 });
    }
    console.error("[GET /api/pending-products]", error);
    return NextResponse.json({ success: false, message: "Failed to load pending products." }, { status: 500 });
  }
}