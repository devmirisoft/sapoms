import { NextRequest, NextResponse } from "next/server";
import type { Warehouse } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { requireAuth, type AuthActor } from "@/server/auth/session";
import { isStaffLike } from "@/server/auth/sales-scope";
import dashboardSearch from "@/lib/dashboardSearch.js";
import { mapPostgresOrderToLegacy, type PostgresOrderRecord } from "@/lib/postgresOrders";

export const runtime = "nodejs";

const SEARCH_LIMIT = 12;
const ORDER_LIMIT = 25;

type DashboardRole = "admin" | "staff" | "dealer" | "accountant";

type SearchResponse = {
  success: boolean;
  query: string;
  results: unknown[];
  groups: Record<string, unknown[]>;
};

type ProductWithVariants = Prisma.ProductGetPayload<{
  include: { category: true; variants: true };
}>;

type DealerWithUser = Prisma.DealerProfileGetPayload<{
  include: { user: true; staffAssignments: { where: { active: true; removedAt: null }; include: { staff: true } } };
}>;

type StaffWithUser = Prisma.StaffProfileGetPayload<{
  include: { user: true };
}>;

const orderInclude = {
  dealer: {
    select: {
      id: true,
      businessName: true,
      dealerCode: true,
      phone: true,
      city: true,
      address: true,
      pincode: true,
      gstin: true,
      discountPercent: true,
    },
  },
  assignedStaff: { select: { id: true, displayName: true } },
  items: { orderBy: { id: "asc" as const } },
} satisfies Prisma.OrderInclude;

type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

function safeText(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function toDashboardRole(actor: AuthActor): DashboardRole {
  return isStaffLike(actor) ? "staff" : actor.role.toLowerCase() as DashboardRole;
}

function emptyResponse(query: string): SearchResponse {
  return {
    success: true,
    query,
    results: [],
    groups: {
      products: [],
      orders: [],
      dealers: [],
      staff: [],
    },
  };
}

function buildProductWhere(query: string): Prisma.ProductWhereInput {
  return {
    active: true,
    OR: [
      { name: { contains: query, mode: "insensitive" } },
      { productCode: { contains: query, mode: "insensitive" } },
      { description: { contains: query, mode: "insensitive" } },
      { category: { name: { contains: query, mode: "insensitive" } } },
      {
        variants: {
          some: {
            active: true,
            OR: [
              { sku: { contains: query, mode: "insensitive" } },
              { catalogueNumber: { contains: query, mode: "insensitive" } },
              { unitName: { contains: query, mode: "insensitive" } },
            ],
          },
        },
      },
    ],
  };
}

function buildDealerWhere(query: string): Prisma.DealerProfileWhereInput {
  return {
    deletedAt: null,
    user: { status: "ACTIVE", deletedAt: null },
    OR: [
      { businessName: { contains: query, mode: "insensitive" } },
      { dealerCode: { contains: query, mode: "insensitive" } },
      { city: { contains: query, mode: "insensitive" } },
      { phone: { contains: query, mode: "insensitive" } },
      { gstin: { contains: query, mode: "insensitive" } },
      { user: { email: { contains: query, mode: "insensitive" } } },
      { user: { username: { contains: query, mode: "insensitive" } } },
    ],
  };
}

function buildStaffWhere(query: string): Prisma.StaffProfileWhereInput {
  return {
    user: { status: "ACTIVE", deletedAt: null },
    OR: [
      { displayName: { contains: query, mode: "insensitive" } },
      { designation: { contains: query, mode: "insensitive" } },
      { location: { contains: query, mode: "insensitive" } },
      { staffRoleType: { contains: query, mode: "insensitive" } },
      { user: { email: { contains: query, mode: "insensitive" } } },
      { user: { username: { contains: query, mode: "insensitive" } } },
    ],
  };
}

function buildOrderSearchWhere(query: string): Prisma.OrderWhereInput {
  return {
    OR: [
      { orderNumber: { contains: query, mode: "insensitive" } },
      { legacyPhpId: { contains: query, mode: "insensitive" } },
      { dealer: { businessName: { contains: query, mode: "insensitive" } } },
      { dealer: { dealerCode: { contains: query, mode: "insensitive" } } },
      { assignedStaff: { displayName: { contains: query, mode: "insensitive" } } },
      {
        items: {
          some: {
            OR: [
              { productNameSnapshot: { contains: query, mode: "insensitive" } },
              { catalogueNumberSnapshot: { contains: query, mode: "insensitive" } },
              { skuSnapshot: { contains: query, mode: "insensitive" } },
            ],
          },
        },
      },
    ],
  };
}

async function getAssignedDealerIds(actor: AuthActor) {
  if (!isStaffLike(actor) || !actor.staffId) return [] as bigint[];
  const rows = await prisma.dealerStaffAssignment.findMany({
    where: { staffId: actor.staffId, active: true, removedAt: null, dealer: { deletedAt: null, user: { status: "ACTIVE", deletedAt: null } } },
    select: { dealerId: true },
  });
  return rows.map((row) => row.dealerId);
}

function buildOrderScope(actor: AuthActor, assignedDealerIds: bigint[]): Prisma.OrderWhereInput | null {
  if (actor.role === "ADMIN" || actor.role === "ACCOUNTANT") return {};
  if (actor.role === "DEALER") return actor.dealerId ? { dealerId: actor.dealerId } : null;
  if (isStaffLike(actor)) {
    const scopes: Prisma.OrderWhereInput[] = [];
    if (actor.staffId) scopes.push({ assignedStaffId: actor.staffId });
    if (assignedDealerIds.length > 0) scopes.push({ dealerId: { in: assignedDealerIds } });
    if (scopes.length === 0) return null;
    // Same warehouse isolation the order list applies.
    return actor.warehouse
      ? { assignedStaff: { warehouse: actor.warehouse as Warehouse }, OR: scopes }
      : { OR: scopes };
  }
  return null;
}

function mapProduct(product: ProductWithVariants) {
  return {
    id: product.id.toString(),
    name: product.name,
    productName: product.name,
    product_name: product.name,
    catalogueNumber: product.productCode || product.variants[0]?.catalogueNumber || product.variants[0]?.sku || product.id.toString(),
    sku: product.variants[0]?.sku || product.productCode || "",
    description: product.description || "",
    categoryName: product.category?.name || "",
    category: product.category?.name || "",
    image: product.imageUrl || "",
    variants: product.variants.map((variant) => ({
      id: variant.id.toString(),
      sku: variant.sku || "",
      catalogueNumber: variant.catalogueNumber || variant.sku || "",
      productName: product.name,
      name: product.name,
      unitName: variant.unitName || "",
    })),
  };
}

function mapDealer(dealer: DealerWithUser) {
  return {
    Dealer_Id: dealer.id.toString(),
    Dealer_Name: dealer.businessName,
    Dealer_Dealercode: dealer.dealerCode || "",
    Dealer_City: dealer.city || "",
    Dealer_Number: dealer.phone || "",
    Dealer_Email: dealer.user.email,
    gst: dealer.gstin || "",
    staffname: dealer.staffAssignments.map((assignment) => assignment.staff.displayName).filter(Boolean).join(", "),
  };
}

function mapStaff(staff: StaffWithUser) {
  return {
    staff_id: staff.id.toString(),
    staff_name: staff.displayName,
    staff_email: staff.user.email,
    staff_location: staff.location || "",
    staff_designation: staff.designation || "",
    staff_roletype: staff.staffRoleType || "",
  };
}

function buildItemSummariesByOrderId(orders: OrderWithRelations[]) {
  const summaries: Record<string, { searchText: string }> = {};
  for (const order of orders) {
    const legacy = mapPostgresOrderToLegacy(order as PostgresOrderRecord) as { order_id?: string; items?: Array<Record<string, unknown>> };
    const orderId = String(legacy.order_id || order.id.toString());
    summaries[orderId] = {
      searchText: (legacy.items || [])
        .map((item) => [item.catNo, item.catalogueNumber, item.skuSnapshot, item.productName].filter(Boolean).join(" "))
        .join(" ")
        .toLowerCase(),
    };
  }
  return summaries;
}

export async function GET(req: NextRequest) {
  const query = safeText(req.nextUrl.searchParams.get("q"));
  try {
    const actor = await requireAuth();
    const queryInfo = dashboardSearch.getDashboardQueryInfo(query);
    if (!queryInfo.canSearch) return NextResponse.json(emptyResponse(query));
    const role = toDashboardRole(actor);
    const assignedDealerIds = await getAssignedDealerIds(actor);
    const orderScope = buildOrderScope(actor, assignedDealerIds);
    if (!orderScope) return NextResponse.json(emptyResponse(query));

    const productsPromise = actor.role === "ACCOUNTANT"
      ? Promise.resolve([])
      : prisma.product.findMany({
          where: buildProductWhere(query),
          include: { category: true, variants: { where: { active: true }, orderBy: [{ catalogueNumber: "asc" }, { sku: "asc" }] } },
          orderBy: { name: "asc" },
          take: SEARCH_LIMIT,
        });
    const dealersPromise = actor.role === "ADMIN" || isStaffLike(actor)
      ? prisma.dealerProfile.findMany({
          where: isStaffLike(actor) && actor.staffId
            ? { AND: [buildDealerWhere(query), { staffAssignments: { some: { staffId: actor.staffId, active: true, removedAt: null } } }] }
            : buildDealerWhere(query),
          include: { user: true, staffAssignments: { where: { active: true, removedAt: null }, include: { staff: true } } },
          orderBy: { businessName: "asc" },
          take: SEARCH_LIMIT,
        })
      : Promise.resolve([]);
    const staffPromise = actor.role === "ADMIN"
      ? prisma.staffProfile.findMany({
          where: buildStaffWhere(query),
          include: { user: true },
          orderBy: { displayName: "asc" },
          take: SEARCH_LIMIT,
        })
      : Promise.resolve([]);
    const ordersPromise = prisma.order.findMany({
      where: { AND: [orderScope, buildOrderSearchWhere(query)] },
      include: orderInclude,
      orderBy: { orderDate: "desc" },
      take: ORDER_LIMIT,
    });

    const [products, dealers, staff, orders] = await Promise.all([productsPromise, dealersPromise, staffPromise, ordersPromise]);
    const legacyOrders = orders.map((order) => mapPostgresOrderToLegacy(order as PostgresOrderRecord));
    const response = dashboardSearch.buildDashboardSearchResponse({
      role,
      query,
      products: products.map(mapProduct),
      orders: legacyOrders,
      dealers: dealers.map(mapDealer),
      staff: staff.map(mapStaff),
      itemSummariesByOrderId: buildItemSummariesByOrderId(orders),
    });

    return NextResponse.json({
      success: true,
      query,
      results: response.results,
      groups: response.groups,
    } satisfies SearchResponse);
  } catch (error) {
    console.error("[GET /api/dashboard-search]", error);
    const message = error instanceof Error && error.message === "Unauthenticated"
      ? "Unauthenticated"
      : "Dashboard search is unavailable right now.";
    return NextResponse.json(
      { success: false, message },
      { status: message === "Unauthenticated" ? 401 : 500 }
    );
  }
}


