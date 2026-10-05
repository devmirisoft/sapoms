import "server-only";

import type { OrderAcceptanceStatus, OrderFulfilmentStatus, OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";

export const rupees = (paise: bigint) => Number(paise) / 100;

type StatusFields = {
  status: OrderStatus;
  acceptanceStatus: OrderAcceptanceStatus;
  rsmApprovalStatus: OrderAcceptanceStatus;
  fulfilmentStatus: OrderFulfilmentStatus;
};

const FULFILMENT_LABEL: Record<OrderFulfilmentStatus, string> = {
  PENDING: "Accepted",
  IN_PROCESS: "In process",
  PARTIALLY_READY: "Partially ready",
  READY: "Ready to dispatch",
  DISPATCHED: "Dispatched",
  COMPLETED: "Completed",
};

/** One plain status a dealer understands, from the order's approval and fulfilment columns. */
export function orderStatusLabel(order: StatusFields) {
  if (order.status === "CANCELLED") return "Cancelled";
  if (order.status === "DECLINED" || order.acceptanceStatus === "DECLINED" || order.rsmApprovalStatus === "DECLINED") return "Declined";
  if (order.acceptanceStatus === "AWAITING") return "Awaiting approval";
  return FULFILMENT_LABEL[order.fulfilmentStatus];
}

export const ORDER_STATUS_FILTERS = ["awaiting_approval", "in_progress", "dispatched", "completed", "declined", "cancelled"] as const;
export type OrderStatusFilter = (typeof ORDER_STATUS_FILTERS)[number];

// Live = neither cancelled nor declined at any stage. One `status` key: two spreads would overwrite each other.
const live = { status: { notIn: ["CANCELLED", "DECLINED"] as OrderStatus[] }, acceptanceStatus: { not: "DECLINED" as const }, rsmApprovalStatus: { not: "DECLINED" as const } };

/** The where-clause matching each label group, so filters agree with orderStatusLabel. */
export const ORDER_STATUS_WHERE: Record<OrderStatusFilter, Prisma.OrderWhereInput> = {
  awaiting_approval: { ...live, acceptanceStatus: "AWAITING" },
  in_progress: { ...live, acceptanceStatus: "ACCEPTED", fulfilmentStatus: { in: ["PENDING", "IN_PROCESS", "PARTIALLY_READY", "READY"] } },
  dispatched: { ...live, acceptanceStatus: "ACCEPTED", fulfilmentStatus: "DISPATCHED" },
  completed: { ...live, acceptanceStatus: "ACCEPTED", fulfilmentStatus: "COMPLETED" },
  declined: { status: { not: "CANCELLED" }, OR: [{ status: "DECLINED" }, { acceptanceStatus: "DECLINED" }, { rsmApprovalStatus: "DECLINED" }] },
  cancelled: { status: "CANCELLED" },
};

/** Staff can correct an order's totals; the latest correction is what the dealer owes. */
export function orderTotal(order: { finalPayableAmountPaise: bigint; summaryOverrides: Array<{ finalPayableAmountPaise: bigint }> }) {
  return rupees(order.summaryOverrides[0]?.finalPayableAmountPaise ?? order.finalPayableAmountPaise);
}

export const latestOverride = { orderBy: { createdAt: "desc" as const }, take: 1, select: { finalPayableAmountPaise: true } };

/** YYYY-MM-DD in India, the dates dealers mean. */
export const indiaDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);

/** Start of an India calendar day, for YYYY-MM-DD filters. */
export const indiaDayStart = (date: string) => new Date(`${date}T00:00:00+05:30`);

/** Status + inclusive India date range, as the order tools accept them. */
export function orderFilters(args: { status?: OrderStatusFilter; fromDate?: string; toDate?: string }): Prisma.OrderWhereInput {
  return {
    ...(args.status ? ORDER_STATUS_WHERE[args.status] : {}),
    ...(args.fromDate || args.toDate ? {
      orderDate: {
        ...(args.fromDate ? { gte: indiaDayStart(args.fromDate) } : {}),
        ...(args.toDate ? { lt: new Date(indiaDayStart(args.toDate).getTime() + 86_400_000) } : {}),
      },
    } : {}),
  };
}

/** Newest first (or oldest with "asc"), capped, with `hasMore`. `where` carries the caller's scope (a dealer, or a staff member's orders). */
export async function listOrders(where: Prisma.OrderWhereInput, limit: number, withDealer = false, direction: "asc" | "desc" = "desc") {
  const orders = await prisma.order.findMany({
    where,
    orderBy: { orderDate: direction },
    take: limit + 1,
    select: {
      orderNumber: true, orderDate: true, finalPayableAmountPaise: true,
      status: true, acceptanceStatus: true, rsmApprovalStatus: true, fulfilmentStatus: true,
      summaryOverrides: latestOverride,
      _count: { select: { items: true } },
      dealer: { select: { businessName: true } },
    },
  });
  return {
    orders: orders.slice(0, limit).map((order) => ({
      orderId: order.orderNumber,
      ...(withDealer ? { dealer: order.dealer.businessName } : {}),
      date: indiaDate(order.orderDate),
      status: orderStatusLabel(order),
      total: orderTotal(order),
      itemCount: order._count.items,
    })),
    hasMore: orders.length > limit,
  };
}

/** Dealers quote orders loosely: the full number, its DMS suffix, or just the sequence. */
function orderNumberMatch(raw: string): Prisma.OrderWhereInput[] {
  const value = raw.trim().replace(/^#/, "");
  const sequence = /^(?:DMS-?)?(\d{1,6})$/i.exec(value)?.[1];
  return [
    { orderNumber: { equals: value, mode: "insensitive" } },
    { orderNumber: { endsWith: `/${value}`, mode: "insensitive" } },
    ...(sequence ? [{ orderNumber: { endsWith: `DMS-${sequence.padStart(3, "0")}`, mode: "insensitive" as const } }] : []),
    { legacyPhpId: value },
  ];
}

const MAX_ITEMS = 20;
const APPROVAL: Record<OrderAcceptanceStatus, string> = { AWAITING: "pending", ACCEPTED: "approved", DECLINED: "declined" };

/**
 * One order's status, items and dispatch, found only inside `where` (the caller's scope):
 * an order outside it is simply "not found". `internal` adds who it belongs to and where it
 * is in the approval chain, for staff.
 */
export async function findOrderDetails(where: Prisma.OrderWhereInput, orderId: string, internal = false) {
  const order = await prisma.order.findFirst({
    where: { AND: [where, { OR: orderNumberMatch(orderId) }] },
    orderBy: { orderDate: "desc" },
    include: {
      summaryOverrides: latestOverride,
      items: { orderBy: { id: "asc" }, take: MAX_ITEMS + 1, include: { dispatches: { select: { quantity: true } } } },
      dealer: { select: { businessName: true, dealerCode: true, city: true } },
      assignedStaff: { select: { displayName: true } },
      salesManager: { select: { displayName: true } },
    },
  });
  if (!order) return { error: "ORDER_NOT_FOUND", message: `No order ${orderId}${internal ? " that you can access" : " on this account"}.` };

  const status = orderStatusLabel(order);
  return {
    orderId: order.orderNumber,
    date: indiaDate(order.orderDate),
    status,
    total: orderTotal(order),
    ...(internal ? {
      dealer: order.dealer.businessName,
      dealerCode: order.dealer.dealerCode ?? undefined,
      dealerCity: order.dealer.city ?? undefined,
      rsmApproval: APPROVAL[order.rsmApprovalStatus],
      staffAcceptance: APPROVAL[order.acceptanceStatus],
      salesManager: order.salesManager?.displayName ?? undefined,
      assignedStaff: order.assignedStaff?.displayName ?? undefined,
    } : {}),
    items: order.items.slice(0, MAX_ITEMS).map((item) => {
      const dispatchedPieces = item.dispatches.reduce((sum, dispatch) => sum + dispatch.quantity, 0);
      return {
        productId: item.catalogueNumberSnapshot,
        name: item.productNameSnapshot,
        packs: item.quantityPacks,
        packSize: item.packSize,
        lineTotal: rupees(item.finalAmountPaise),
        ...(dispatchedPieces ? { dispatchedPieces } : {}),
      };
    }),
    hasMoreItems: order.items.length > MAX_ITEMS,
    ...(order.dispatchedAt ? { dispatchedOn: indiaDate(order.dispatchedAt) } : {}),
    ...(order.dispatchPartner ? { courier: order.dispatchPartner } : {}),
    ...(order.trackingNumber ? { trackingNo: order.trackingNumber } : {}),
    ...(order.trackingLink ? { trackingLink: order.trackingLink } : {}),
    ...(status === "Declined" ? { declineReason: order.acceptanceNote || order.rsmNote || undefined } : {}),
    ...(status === "Cancelled" && order.cancellationReason ? { cancellationReason: order.cancellationReason } : {}),
  };
}
