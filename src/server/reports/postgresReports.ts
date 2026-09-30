import { prisma } from "@/server/db/prisma";
import type { AuthActor } from "@/server/auth/session";
import { isStaffLike } from "@/server/auth/sales-scope";

export type ReportActorScope = "admin" | "accountant" | "staff";

export type DealerReportActor = {
  scope: ReportActorScope;
  staffId?: bigint;
};

const POSTGRES_REPORT_SOURCE = "postgres";
const POSTGRES_REPORT_LABEL = "PostgreSQL-only report; historical PHP orders are excluded.";

function paiseToRupees(value: bigint | number | null | undefined) {
  return Math.round((Number(value ?? 0) / 100 + Number.EPSILON) * 100) / 100;
}

function numberText(value: unknown, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function parsePositiveInt(value: string | null, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(1, Math.floor(parsed))) : fallback;
}

function dateRange(from?: string | null, to?: string | null) {
  const where: { gte?: Date; lte?: Date } = {};
  if (from) {
    const parsed = new Date(from);
    if (Number.isFinite(parsed.getTime())) where.gte = parsed;
  }
  if (to) {
    const parsed = new Date(to);
    if (Number.isFinite(parsed.getTime())) {
      parsed.setHours(23, 59, 59, 999);
      where.lte = parsed;
    }
  }
  return Object.keys(where).length > 0 ? where : undefined;
}

export function reportActorFromAuth(actor: AuthActor): DealerReportActor | null {
  if (actor.role === "ADMIN") return { scope: "admin" };
  if (actor.role === "ACCOUNTANT") return { scope: "accountant" };
  if (isStaffLike(actor) && actor.staffId) return { scope: "staff", staffId: actor.staffId };
  return null;
}

export function assertGlobalReportActor(actor: AuthActor) {
  if (actor.role !== "ADMIN" && actor.role !== "ACCOUNTANT") {
    throw new Error("Forbidden");
  }
}

function scopedDealerWhere(actor: DealerReportActor, extra: Record<string, unknown> = {}) {
  return {
    deletedAt: null,
    ...(actor.scope === "staff"
      ? { staffAssignments: { some: { staffId: actor.staffId, active: true } } }
      : {}),
    ...extra,
  };
}

function scopedOrderWhere(actor: DealerReportActor, input: {
  dealerId?: string;
  from?: string | null;
  to?: string | null;
  statusFilter?: string;
} = {}) {
  const orderDate = dateRange(input.from, input.to);
  const where: Record<string, unknown> = {
    status: { notIn: ["CANCELLED", "DECLINED"] },
    ...(orderDate ? { orderDate } : {}),
    ...(input.dealerId ? { dealerId: BigInt(input.dealerId) } : {}),
    ...(actor.scope === "staff" ? { dealer: scopedDealerWhere(actor) } : {}),
  };

  if (input.statusFilter === "accepted") where.acceptanceStatus = "ACCEPTED";
  if (input.statusFilter === "completed") where.fulfilmentStatus = "COMPLETED";
  return where;
}

function mapDealer(dealer: {
  id: bigint;
  businessName: string;
  city: string | null;
  phone: string | null;
  dealerCode: string | null;
  staffAssignments?: { staff?: { id: bigint; displayName: string } }[];
}) {
  const assigned = dealer.staffAssignments?.find((row) => row.staff);
  return {
    Dealer_Id: dealer.id.toString(),
    Dealer_Name: dealer.businessName,
    Dealer_City: dealer.city ?? "",
    Dealer_Number: dealer.phone ?? "",
    Dealer_Dealercode: dealer.dealerCode ?? "",
    assignedstaff: assigned?.staff?.id.toString() ?? "",
    staffname: assigned?.staff?.displayName ?? "",
  };
}

export async function buildDealerSelection(input: {
  actor: DealerReportActor;
  page: number;
  search: string;
  pageSize?: number;
}) {
  const pageSize = input.pageSize ?? 10;
  const page = Math.max(1, input.page);
  const search = input.search.trim();
  const searchWhere = search
    ? {
        OR: [
          { businessName: { contains: search, mode: "insensitive" as const } },
          { dealerCode: { contains: search, mode: "insensitive" as const } },
          { city: { contains: search, mode: "insensitive" as const } },
          { phone: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};
  const where = scopedDealerWhere(input.actor, searchWhere);
  const [total, dealers] = await Promise.all([
    prisma.dealerProfile.count({ where }),
    prisma.dealerProfile.findMany({
      where,
      orderBy: [{ businessName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { staffAssignments: { where: { active: true }, include: { staff: true }, take: 1 } },
    }),
  ]);

  return {
    success: true,
    page,
    pageSize,
    total,
    last_page: Math.max(1, Math.ceil(total / pageSize)),
    data: dealers.map(mapDealer),
    meta: {
      source: POSTGRES_REPORT_SOURCE,
      sourceLabel: POSTGRES_REPORT_LABEL,
      historicalOrdersIncluded: false,
    },
  };
}

export async function buildDealerCategoryReport(input: {
  actor: DealerReportActor;
  dealerId: string;
  from?: string | null;
  to?: string | null;
  statusFilter?: string;
}) {
  if (!/^\d+$/.test(input.dealerId)) throw new Error("Invalid dealer id");
  const dealer = await prisma.dealerProfile.findFirst({
    where: scopedDealerWhere(input.actor, { id: BigInt(input.dealerId) }),
    include: { staffAssignments: { where: { active: true }, include: { staff: true }, take: 1 } },
  });
  if (!dealer) return null;

  const orders = await prisma.order.findMany({
    where: scopedOrderWhere(input.actor, input),
    orderBy: { orderDate: "desc" },
    include: {
      items: {
        include: {
          product: { include: { category: true } },
          productVariant: true,
        },
      },
    },
  });

  const products = new Map<string, any>();
  const categories = new Map<string, any>();
  let latestPurchaseDateMs: number | null = null;
  let totalPurchasedQuantity = 0;
  let itemSalesPaise = BigInt(0);
  const variantKeys = new Set<string>();

  for (const order of orders) {
    const orderDateIso = order.orderDate.toISOString();
    latestPurchaseDateMs = Math.max(latestPurchaseDateMs ?? 0, order.orderDate.getTime());
    for (const item of order.items) {
      const category = item.categorySnapshot || item.product?.category?.name || "Uncategorized";
      const catalogueNumber = item.catalogueNumberSnapshot || item.productVariant?.catalogueNumber || item.productVariant?.sku || "";
      const productKey = item.productVariantId?.toString() ?? item.productId?.toString() ?? `snapshot:${catalogueNumber || item.productNameSnapshot}`;
      const totalValue = paiseToRupees(item.finalAmountPaise);
      variantKeys.add(productKey);
      totalPurchasedQuantity += item.totalPieces;
      itemSalesPaise += item.finalAmountPaise;

      const product = products.get(productKey) ?? {
        productKey,
        productName: item.productNameSnapshot,
        catalogueNumber,
        normalizedCatalogueNumber: catalogueNumber,
        category,
        specification: "",
        purchasedQuantity: 0,
        orderCount: 0,
        totalValue: 0,
        latestPurchaseDate: "",
        orderIds: new Set<string>(),
        orders: new Map<string, any>(),
      };
      product.purchasedQuantity += item.totalPieces;
      product.totalValue = Math.round((product.totalValue + totalValue + Number.EPSILON) * 100) / 100;
      product.orderIds.add(order.id.toString());
      product.latestPurchaseDate = product.latestPurchaseDate && product.latestPurchaseDate > orderDateIso ? product.latestPurchaseDate : orderDateIso;
      const productOrder = product.orders.get(order.id.toString()) ?? {
        orderId: order.id.toString(),
        orderDate: orderDateIso,
        dealerId: order.dealerId.toString(),
        dealerName: dealer.businessName,
        catalogueNumber,
        purchasedQuantity: 0,
        totalValue: 0,
        statusLabel: order.fulfilmentStatus === "COMPLETED" ? "Completed" : order.acceptanceStatus === "ACCEPTED" ? "Accepted" : "Awaiting",
      };
      productOrder.purchasedQuantity += item.totalPieces;
      productOrder.totalValue = Math.round((productOrder.totalValue + totalValue + Number.EPSILON) * 100) / 100;
      product.orders.set(order.id.toString(), productOrder);
      products.set(productKey, product);

      const categoryRow = categories.get(category) ?? {
        category,
        purchasedQuantity: 0,
        orderIds: new Set<string>(),
        productKeys: new Set<string>(),
        totalValue: 0,
        latestPurchaseDate: "",
        products: new Map<string, any>(),
      };
      categoryRow.purchasedQuantity += item.totalPieces;
      categoryRow.orderIds.add(order.id.toString());
      categoryRow.productKeys.add(productKey);
      categoryRow.totalValue = Math.round((categoryRow.totalValue + totalValue + Number.EPSILON) * 100) / 100;
      categoryRow.latestPurchaseDate = categoryRow.latestPurchaseDate && categoryRow.latestPurchaseDate > orderDateIso ? categoryRow.latestPurchaseDate : orderDateIso;
      categoryRow.products.set(productKey, product);
      categories.set(category, categoryRow);
    }
  }

  const productRows = Array.from(products.values()).map((row) => ({
    ...row,
    orderCount: row.orderIds.size,
    orderIds: undefined,
    orders: Array.from(row.orders.values()),
  })).sort((left, right) => right.purchasedQuantity - left.purchasedQuantity || left.productName.localeCompare(right.productName));

  const categoryRows = Array.from(categories.values()).map((row) => ({
    category: row.category,
    purchasedQuantity: row.purchasedQuantity,
    orderCount: row.orderIds.size,
    variantCount: row.productKeys.size,
    shareOfPurchases: totalPurchasedQuantity > 0 ? Math.round((row.purchasedQuantity / totalPurchasedQuantity) * 10000) / 100 : 0,
    latestPurchaseDate: row.latestPurchaseDate,
    totalValue: row.totalValue,
    products: Array.from(row.products.values()).map((product: any) => ({
      ...product,
      orderCount: product.orderIds.size,
      orderIds: undefined,
      orders: Array.from(product.orders.values()),
    })),
  })).sort((left, right) => right.purchasedQuantity - left.purchasedQuantity || left.category.localeCompare(right.category));

  const orderGrossPaise = orders.reduce((sum, order) => sum + order.grossAmountPaise, BigInt(0));
  const orderDiscountPaise = orders.reduce((sum, order) => sum + order.totalDiscountAmountPaise, BigInt(0));
  const orderPayablePaise = orders.reduce((sum, order) => sum + order.finalPayableAmountPaise, BigInt(0));

  return {
    dealer: mapDealer(dealer),
    summary: {
      totalOrders: orders.length,
      totalPurchasedQuantity,
      totalCategories: categoryRows.length,
      totalVariants: variantKeys.size,
      distinctProducts: productRows.length,
      totalSalesValue: paiseToRupees(orderPayablePaise),
      totalGrossValue: paiseToRupees(orderGrossPaise),
      totalDiscountValue: paiseToRupees(orderDiscountPaise),
      itemSalesValue: paiseToRupees(itemSalesPaise),
      latestPurchaseDate: latestPurchaseDateMs === null ? "" : new Date(latestPurchaseDateMs).toISOString(),
      dateRange: { from: numberText(input.from), to: numberText(input.to) },
      statusFilter: input.statusFilter || "all",
    },
    products: productRows,
    categories: categoryRows,
    warnings: [],
    meta: {
      lineCount: orders.reduce((sum, order) => sum + order.items.length, 0),
      failedOrderCount: 0,
      failedOrderIds: [],
      source: POSTGRES_REPORT_SOURCE,
      sourceLabel: POSTGRES_REPORT_LABEL,
      historicalOrdersIncluded: false,
      orderTotals: "Order.grossAmountPaise, Order.totalDiscountAmountPaise, Order.finalPayableAmountPaise",
      itemTotals: "OrderItem.finalAmountPaise for product/category contribution only",
    },
  };
}

export async function buildAccountantDashboard() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const activeOrderWhere: any = { status: { notIn: ["CANCELLED", "DECLINED"] } };
  const pendingWhere: any = {
    ...activeOrderWhere,
    OR: [
      { acceptanceStatus: "AWAITING" as const },
      { status: "AWAITING_ACCEPTANCE" as const },
    ],
  };

  const [dealerCount, staffCount, orderCount, pendingCount, recentOrders, pendingOrders, topDealerGroups, monthAggregate, allAggregate, walletAggregate, walletTransactionAggregate, billAggregate] = await Promise.all([
    prisma.dealerProfile.count({ where: { deletedAt: null } }),
    prisma.staffProfile.count(),
    prisma.order.count({ where: activeOrderWhere }),
    prisma.order.count({ where: pendingWhere }),
    prisma.order.findMany({ where: activeOrderWhere, orderBy: { orderDate: "desc" }, take: 10, include: { dealer: true, items: true } }),
    prisma.order.findMany({ where: pendingWhere, orderBy: { orderDate: "desc" }, take: 10, include: { dealer: true, items: true } }),
    prisma.order.groupBy({ by: ["dealerId"], where: activeOrderWhere, _sum: { finalPayableAmountPaise: true }, _count: { _all: true }, orderBy: { _sum: { finalPayableAmountPaise: "desc" } }, take: 10 }),
    prisma.order.aggregate({ where: { ...activeOrderWhere, orderDate: { gte: startOfMonth } }, _sum: { grossAmountPaise: true, totalDiscountAmountPaise: true, finalPayableAmountPaise: true }, _count: { _all: true } }),
    prisma.order.aggregate({ where: activeOrderWhere, _sum: { grossAmountPaise: true, totalDiscountAmountPaise: true, finalPayableAmountPaise: true }, _count: { _all: true } }),
    prisma.dealerWallet.aggregate({ _sum: { balancePaise: true, reservedPaise: true, totalCreditedPaise: true, totalConsumedPaise: true } }),
    prisma.walletTransaction.aggregate({ _sum: { amountPaise: true }, _count: { _all: true } }),
    prisma.ledgerBill.aggregate({ _sum: { billAmountPaise: true } }),
  ]);

  const dealerNames = new Map((await prisma.dealerProfile.findMany({
    where: { id: { in: topDealerGroups.map((row: any) => row.dealerId) } },
    select: { id: true, businessName: true },
  })).map((dealer) => [dealer.id.toString(), dealer.businessName]));

  const mapOrder = (order: any) => ({
    order_id: order.id.toString(),
    orderDate: order.orderDate.toISOString(),
    order_date: order.orderDate.toISOString(),
    order_dealer: order.dealerId.toString(),
    order_amount: paiseToRupees(order.grossAmountPaise),
    order_discount: paiseToRupees(order.totalDiscountAmountPaise),
    order_discount_amount: paiseToRupees(order.totalDiscountAmountPaise),
    order_net_amount: paiseToRupees(order.finalPayableAmountPaise),
    grossAmount: paiseToRupees(order.grossAmountPaise),
    discountAmount: paiseToRupees(order.totalDiscountAmountPaise),
    netPayableAmount: paiseToRupees(order.finalPayableAmountPaise),
    Dealer_Name: order.dealer.businessName,
    orderdata_item_quantity: String(order.items.reduce((sum: number, item: any) => sum + item.totalPieces, 0)),
    mtstatus: order.fulfilmentStatus,
    accept_order: order.acceptanceStatus === "ACCEPTED" ? "1" : "0",
    order_status: order.status === "ACCEPTED" || order.status === "PROCESSING" || order.status === "COMPLETED" ? "1" : "0",
    outstandingDate: "",
    __source: POSTGRES_REPORT_SOURCE,
  });

  return {
    success: true,
    status: true,
    data: [{
      dealerCount,
      staffCount,
      orderCount,
      PorderCount: pendingCount,
    }],
    stats: { dealerCount, staffCount, orderCount, PorderCount: pendingCount },
    // Sum of every invoice the accountant has added in the ledger.
    billedTotal: paiseToRupees(billAggregate._sum.billAmountPaise ?? BigInt(0)),
    top: topDealerGroups.map((row: any) => ({
      Dealer_Name: dealerNames.get(row.dealerId.toString()) ?? row.dealerId.toString(),
      total: String(paiseToRupees((row._sum as any)?.finalPayableAmountPaise ?? BigInt(0))),
      orderCount: (row._count as any)?._all ?? 0,
    })),
    chartOrders: recentOrders.map((order: any) => ({
      order_id: order.id.toString(),
      total: String(paiseToRupees(order.finalPayableAmountPaise)),
    })),
    recentOrders: recentOrders.map(mapOrder),
    pendingOrders: pendingOrders.map(mapOrder),
    monthlyTotals: {
      orderCount: (monthAggregate._count as any)?._all ?? 0,
      gross: paiseToRupees((monthAggregate._sum as any)?.grossAmountPaise ?? BigInt(0)),
      discount: paiseToRupees((monthAggregate._sum as any)?.totalDiscountAmountPaise ?? BigInt(0)),
      payable: paiseToRupees((monthAggregate._sum as any)?.finalPayableAmountPaise ?? BigInt(0)),
    },
    orderTotals: {
      orderCount: (allAggregate._count as any)?._all ?? 0,
      gross: paiseToRupees((allAggregate._sum as any)?.grossAmountPaise ?? BigInt(0)),
      discount: paiseToRupees((allAggregate._sum as any)?.totalDiscountAmountPaise ?? BigInt(0)),
      payable: paiseToRupees((allAggregate._sum as any)?.finalPayableAmountPaise ?? BigInt(0)),
    },
    financialSummary: {
      walletBalance: paiseToRupees((walletAggregate._sum as any)?.balancePaise ?? BigInt(0)),
      walletReserved: paiseToRupees((walletAggregate._sum as any)?.reservedPaise ?? BigInt(0)),
      walletCredited: paiseToRupees((walletAggregate._sum as any)?.totalCreditedPaise ?? BigInt(0)),
      walletConsumed: paiseToRupees((walletAggregate._sum as any)?.totalConsumedPaise ?? BigInt(0)),
      walletTransactionCount: (walletTransactionAggregate._count as any)?._all ?? 0,
      walletTransactionAmount: paiseToRupees((walletTransactionAggregate._sum as any)?.amountPaise ?? BigInt(0)),
    },
    meta: {
      source: POSTGRES_REPORT_SOURCE,
      sourceLabel: POSTGRES_REPORT_LABEL,
      historicalOrdersIncluded: false,
      models: ["Order", "OrderItem", "DealerProfile", "StaffProfile", "DealerStaffAssignment", "Product", "ProductVariant", "DealerWallet", "WalletTransaction"],
    },
  };
}

export const postgresReportSource = {
  source: POSTGRES_REPORT_SOURCE,
  sourceLabel: POSTGRES_REPORT_LABEL,
  historicalOrdersIncluded: false,
};

export const reportPagination = { parsePositiveInt };


