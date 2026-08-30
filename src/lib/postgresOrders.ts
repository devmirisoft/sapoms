import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { buildOrderRegionWhere } from "@/server/auth/sales-scope";
import type { OrdersActor } from "@/lib/orderPagination";
import { summarizeOrderSettlement } from "@/lib/orderSettlement";

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
      creditDays: true,
    },
  },
  assignedStaff: { select: { id: true, displayName: true } },
  items: { orderBy: { id: "asc" as const }, include: { dispatches: { select: { quantity: true } } } },
  // Bills carry paidAmountPaise, which is what wallet settlement moves. Without
  // them an order settled from advance still reads as fully unpaid.
  ledgerBills: { orderBy: { billDate: "desc" as const } },
} satisfies Prisma.OrderInclude;

const orderDetailInclude = {
  ...orderInclude,
  items: { orderBy: { id: "asc" as const }, include: { dispatches: { orderBy: { createdAt: "asc" as const } }, productNotes: { orderBy: { updatedAt: "desc" as const } } } },
  notes: { orderBy: { updatedAt: "desc" as const } },
  productNotes: { orderBy: { updatedAt: "desc" as const } },
  summaryOverrides: { orderBy: { createdAt: "desc" as const } },
  overlays: { orderBy: { updatedAt: "desc" as const } },
  dispatches: { orderBy: { createdAt: "asc" as const } },
  walletTransactions: { orderBy: { createdAt: "desc" as const } },
} satisfies Prisma.OrderInclude;

export type PostgresOrderRecord = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
type PostgresOrderDetailRecord = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;
type PostgresOrderLike = PostgresOrderRecord | PostgresOrderDetailRecord;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function rupees(value: bigint) {
  return Number(value) / 100;
}

function percent(value: unknown) {
  return Number(value ?? 0);
}

function legacyAcceptance(status: string) {
  if (status === "ACCEPTED") return "1";
  if (status === "DECLINED") return "2";
  return "0";
}

function legacyDeletion(status: string) {
  return status === "CANCELLED" ? "1" : "0";
}

function legacyOrderStatus(status: string) {
  if (status === "CANCELLED") return "cancelled";
  if (status === "COMPLETED") return "approved";
  if (status === "ACCEPTED" || status === "PROCESSING" || status === "READY" || status === "DISPATCHED") return "approved";
  return "pending";
}

// Dispatch progress, in the only three states the UI shows: nothing dispatched,
// some of it dispatched, all of it dispatched. Read off the dispatch rows rather
// than fulfilmentStatus, which a manual status change can move without anything
// actually leaving the warehouse.
function legacyFulfilment(order: { items?: Array<{ quantityPacks: number; dispatches?: Array<{ quantity: number }> }> }) {
  const items = order.items ?? [];
  const ordered = items.reduce((sum, item) => sum + item.quantityPacks, 0);
  const dispatched = items.reduce(
    (sum, item) => sum + (item.dispatches ?? []).reduce((packs, dispatch) => packs + dispatch.quantity, 0),
    0,
  );
  if (dispatched <= 0) return "Pending";
  return dispatched >= ordered ? "Completed" : "Partial";
}

function legacyDispatchStatus(status: string) {
  if (status === "DISPATCHED" || status === "COMPLETED") return "dispatched";
  if (status === "READY" || status === "PARTIALLY_READY" || status === "IN_PROCESS") return "packing";
  return "pending";
}

function orderIdentity(order: PostgresOrderRecord) {
  return order.legacyPhpId || order.id.toString();
}

export function postgresOrderDedupeIds(order: PostgresOrderRecord) {
  return [order.id.toString(), order.orderNumber, order.legacyPhpId].map(text).filter(Boolean);
}

export function mapPostgresOrderItemToLegacy(item: PostgresOrderLike["items"][number], order: PostgresOrderLike) {
  const orderId = orderIdentity(order);
  const itemId = item.legacyPhpOrderItemId || item.id.toString();
  return {
    __source: "postgres",
    id: itemId,
    orderdata_id: itemId,
    orderdata_orderid: orderId,
    order_id: orderId,
    order_number: order.orderNumber,
    orderdata_dealerid: order.dealerId.toString(),
    order_dealer: order.dealerId.toString(),
    Dealer_Id: order.dealerId.toString(),
    Dealer_Name: order.dealer.businessName,
    productname: item.productNameSnapshot,
    productName: item.productNameSnapshot,
    catNo: item.catalogueNumberSnapshot,
    catalogueNumber: item.catalogueNumberSnapshot,
    category: item.categorySnapshot || "",
    producQuanity: item.totalPieces,
    orderdata_item_quantity: String(item.quantityPacks),
    quantityPacks: item.quantityPacks,
    packs: item.quantityPacks,
    packSize: item.packSize,
    pack_size: item.packSize,
    pieces: item.totalPieces,
    totalPieces: item.totalPieces,
    unitPrice: rupees(item.unitPricePaise),
    packPrice: rupees(item.packPricePaise),
    order_amount: rupees(item.listPriceTotalPaise),
    grossAmount: rupees(item.listPriceTotalPaise),
    discountPercent: percent(item.discountPercent),
    discountAmount: rupees(item.discountAmountPaise),
    discountAmountPaise: item.discountAmountPaise.toString(),
    finalAmount: rupees(item.finalAmountPaise),
    finalPayableAmount: rupees(item.finalAmountPaise),
    finalAmountPaise: item.finalAmountPaise.toString(),
    remarks: item.remarks || "",
    productNote: item.productNote || "",
    product_note: item.productNote || "",
    priority: item.isPriority ? "1" : "0",
    isPriority: item.isPriority,
    status: order.status,
    order_status: legacyOrderStatus(order.status),
    accept_order: legacyAcceptance(order.acceptanceStatus),
    rsmApprovalStatus: order.rsmApprovalStatus,
    rsm_approval_status: order.rsmApprovalStatus,
    rsmReviewedBy: order.rsmReviewedByName || "",
    rsm_reviewed_by: order.rsmReviewedByName || "",
    rsmReviewedAt: order.rsmReviewedAt?.toISOString?.() ?? null,
    rsm_reviewed_at: order.rsmReviewedAt?.toISOString?.() ?? null,
    rsmNote: order.rsmNote || "",
    rsm_note: order.rsmNote || "",
    settlement: summarizeOrderSettlement((order as { ledgerBills?: any[] }).ledgerBills, order.finalPayableAmountPaise),
    acceptanceStatus: order.acceptanceStatus,
    acceptance_status: order.acceptanceStatus,
    acceptanceNote: order.acceptanceNote || "",
    acceptance_note: order.acceptanceNote || "",
    acceptanceReviewedBy: order.acceptanceReviewedByName || "",
    acceptance_reviewed_by: order.acceptanceReviewedByName || "",
    acceptanceReviewedAt: order.acceptanceReviewedAt?.toISOString?.() ?? null,
    acceptance_reviewed_at: order.acceptanceReviewedAt?.toISOString?.() ?? null,
    fulfilmentStatus: order.fulfilmentStatus,
    fulfilment_status: order.fulfilmentStatus,
    mtstatus: legacyFulfilment(order),
    del_status: legacyDeletion(order.status),
    orderdata_datetime: order.orderDate.toISOString(),
  };
}

export function mapPostgresOrderToLegacy(order: PostgresOrderLike) {
  const orderId = orderIdentity(order);
  const discountAmount = rupees(order.totalDiscountAmountPaise);
  const finalPayableAmount = rupees(order.finalPayableAmountPaise);
  const row = {
    __source: "postgres",
    id: orderId,
    orderId,
    order_id: orderId,
    order_number: order.orderNumber,
    order_dealer: order.dealerId.toString(),
    orderdata_dealerid: order.dealerId.toString(),
    Dealer_Id: order.dealerId.toString(),
    Dealer_Name: order.dealer.businessName,
    Dealer_Dealercode: order.dealer.dealerCode || "",
    Dealer_Number: order.dealer.phone || "",
    Dealer_City: order.dealer.city || "",
    Dealer_Address: order.dealer.address || "",
    Dealer_Pincode: order.dealer.pincode || "",
    gst: order.dealer.gstin || "",
    creditdays: order.dealer.creditDays?.toString() || "",
    assignedstaff: order.assignedStaffId?.toString() || "",
    staffid: order.assignedStaffId?.toString() || "",
    staffname: order.assignedStaff?.displayName || "",
    order_date: order.orderDate.toISOString(),
    orderdata_datetime: order.orderDate.toISOString(),
    order_amount: rupees(order.grossAmountPaise),
    grossAmount: rupees(order.grossAmountPaise),
    grossAmountPaise: order.grossAmountPaise.toString(),
    order_discount: discountAmount,
    discountAmount,
    discountAmountPaise: order.totalDiscountAmountPaise.toString(),
    finalPayableAmount,
    finalPayableAmountPaise: order.finalPayableAmountPaise.toString(),
    baseDiscountPercent: percent(order.baseDiscountPercent),
    baseDiscountAmount: rupees(order.baseDiscountAmountPaise),
    additionalDiscountType: order.additionalDiscountType,
    additionalDiscountAmount: rupees(order.additionalDiscountAmountPaise),
    slabDiscountPercent: percent(order.slabDiscountPercent),
    slabDiscountAmount: rupees(order.slabDiscountAmountPaise),
    customDiscountAmount: rupees(order.customDiscountAmountPaise),
    totalDiscountPercent: percent(order.totalDiscountPercent),
    note: order.note || "",
    order_note: order.note || "",
    shipTo: order.shipTo || "",
    Dealer_shipto: order.shipTo || "",
    refNo: order.refNo || "",
    ref_no: order.refNo || "",
    priority: (order.items ?? []).some((item) => item.isPriority) ? "1" : "0",
    status: order.status,
    order_status: legacyOrderStatus(order.status),
    accept_order: legacyAcceptance(order.acceptanceStatus),
    rsmApprovalStatus: order.rsmApprovalStatus,
    rsm_approval_status: order.rsmApprovalStatus,
    rsmReviewedBy: order.rsmReviewedByName || "",
    rsm_reviewed_by: order.rsmReviewedByName || "",
    rsmReviewedAt: order.rsmReviewedAt?.toISOString?.() ?? null,
    rsm_reviewed_at: order.rsmReviewedAt?.toISOString?.() ?? null,
    rsmNote: order.rsmNote || "",
    rsm_note: order.rsmNote || "",
    settlement: summarizeOrderSettlement((order as { ledgerBills?: any[] }).ledgerBills, order.finalPayableAmountPaise),
    acceptanceStatus: order.acceptanceStatus,
    acceptance_status: order.acceptanceStatus,
    acceptanceNote: order.acceptanceNote || "",
    acceptance_note: order.acceptanceNote || "",
    acceptanceReviewedBy: order.acceptanceReviewedByName || "",
    acceptance_reviewed_by: order.acceptanceReviewedByName || "",
    acceptanceReviewedAt: order.acceptanceReviewedAt?.toISOString?.() ?? null,
    acceptance_reviewed_at: order.acceptanceReviewedAt?.toISOString?.() ?? null,
    fulfilmentStatus: order.fulfilmentStatus,
    fulfilment_status: order.fulfilmentStatus,
    dispatchPartner: order.dispatchPartner || "",
    dispatch_partner: order.dispatchPartner || "",
    trackingNumber: order.trackingNumber || "",
    tracking_number: order.trackingNumber || "",
    trackingLink: order.trackingLink || "",
    tracking_link: order.trackingLink || "",
    dock: order.dock || "",
    mtstatus: legacyFulfilment(order),
    del_status: legacyDeletion(order.status),
    productorder: (order.items ?? []).map((item) => mapPostgresOrderItemToLegacy(item, order)),
    items: (order.items ?? []).map((item) => mapPostgresOrderItemToLegacy(item, order)),
    dealer: order.dealer,
    assignedStaff: order.assignedStaff,
    orderNotes: "notes" in order ? order.notes : [],
    orderProductNotes: ("productNotes" in order ? order.productNotes : []).map((note) => ({
      ...note,
      id: note.id.toString(),
      orderId: note.orderId.toString(),
      orderItemId: note.orderItemId.toString(),
    })),
    summaryOverrides: ("summaryOverrides" in order ? order.summaryOverrides : []).map((override) => ({
      ...override,
      id: override.id.toString(),
      orderId: override.orderId.toString(),
      grossAmount: rupees(override.grossAmountPaise),
      discountAmount: rupees(override.discountAmountPaise),
      netPayableAmount: rupees(override.finalPayableAmountPaise),
    })),
    overlays: ("overlays" in order ? order.overlays : []).map((overlay) => ({ ...overlay, id: overlay.id.toString(), orderId: overlay.orderId.toString() })),
    dispatchRecords: ("dispatches" in order ? order.dispatches : []).map((dispatch) => ({
      id: dispatch.id.toString(),
      orderId: dispatch.orderId.toString(),
      orderItemId: dispatch.orderItemId.toString(),
      quantity: dispatch.quantity,
      status: legacyDispatchStatus(dispatch.status),
      remark: dispatch.remark || "",
      actorId: dispatch.actorUserId?.toString() || "",
      actorRole: (dispatch.actorRole || "").toString().toLowerCase(),
      createdAt: dispatch.createdAt.toISOString(),
    })),
    walletTransactions: ("walletTransactions" in order ? order.walletTransactions : []).map((transaction) => ({
      ...transaction,
      id: transaction.id.toString(),
      dealerId: transaction.dealerId.toString(),
      walletId: transaction.walletId.toString(),
      orderId: transaction.orderId?.toString() || null,
      amount: rupees(transaction.amountPaise),
      balanceBefore: rupees(transaction.balanceBeforePaise),
      balanceAfter: rupees(transaction.balanceAfterPaise),
    })),
  };
  return row;
}

async function actorWhere(actor: OrdersActor, assignedDealerIds: Array<string | number> = []): Promise<Prisma.OrderWhereInput> {
  if (actor.role === "dealer") return { dealerId: BigInt(actor.actorId) };
  if (actor.isRsm && actor.userId) return buildRsmOrderWhere(actor);
  if (actor.role === "staff") {
    const assignedDealerBigInts = assignedDealerIds
      .map((id) => String(id ?? "").trim())
      .filter((id) => /^\d+$/.test(id))
      .map((id) => BigInt(id));
    const staffScope = {
      OR: [
        { assignedStaffId: BigInt(actor.actorId) },
        ...(assignedDealerBigInts.length > 0 ? [{ dealerId: { in: assignedDealerBigInts } }] : []),
      ],
    } satisfies Prisma.OrderWhereInput;
    return actor.isAsm ? staffScope : { rsmApprovalStatus: "ACCEPTED", ...staffScope };
  }
  return {};
}

async function buildRsmOrderWhere(actor: OrdersActor): Promise<Prisma.OrderWhereInput> {
  const regionWhere = await buildOrderRegionWhere({ userId: BigInt(actor.userId!), role: "RSM" }, undefined, prisma);
  const hierarchyWhere = await buildRsmChildStaffOrderWhere(actor);
  return hierarchyWhere ? { OR: [regionWhere, hierarchyWhere] } : regionWhere;
}

async function buildRsmChildStaffOrderWhere(actor: OrdersActor): Promise<Prisma.OrderWhereInput | null> {
  const rsm = await prisma.staffProfile.findFirst({
    where: {
      userId: BigInt(actor.userId!),
      user: { role: "RSM", status: "ACTIVE", deletedAt: null },
    },
    select: { id: true },
  });
  if (!rsm) return null;

  const childStaff = await prisma.staffProfile.findMany({
    where: {
      parentRsmId: rsm.id,
      user: { status: "ACTIVE", deletedAt: null },
    },
    select: { id: true },
  });
  const childStaffIds = childStaff.map((staff) => staff.id);
  if (childStaffIds.length === 0) return null;

  const childDealerAssignments = await prisma.dealerStaffAssignment.findMany({
    where: {
      active: true,
      staffId: { in: childStaffIds },
      dealer: { deletedAt: null, user: { status: "ACTIVE", deletedAt: null } },
    },
    select: { dealerId: true },
  });
  const childDealerIds = childDealerAssignments.map((assignment) => assignment.dealerId);

  return {
    OR: [
      { assignedStaffId: { in: childStaffIds } },
      ...(childDealerIds.length > 0 ? [{ dealerId: { in: childDealerIds } }] : []),
    ],
  };
}

export async function listPostgresOrderHeaders(actor: OrdersActor, assignedDealerIds: Array<string | number> = []) {
  const where = await actorWhere(actor, assignedDealerIds);
  const orders = await prisma.order.findMany({
    where,
    include: orderInclude,
    orderBy: { orderDate: "desc" },
  });
  return orders.map(mapPostgresOrderToLegacy);
}

export async function findPostgresOrderByLookupId(orderId: unknown) {
  const id = text(orderId);
  if (!id) return null;
  const numericId = /^\d+$/.test(id) ? BigInt(id) : null;
  return prisma.order.findFirst({
    where: {
      OR: [
        ...(numericId ? [{ id: numericId }] : []),
        { orderNumber: id },
        { legacyPhpId: id },
      ],
    },
    include: orderDetailInclude,
  });
}

// Detail views resolve one order at a time, so they cannot reuse the list
// query's where clause directly. Re-running that same clause against a single
// order id keeps RSM scope for /api/order-access identical to the list scope.
export async function isOrderInRsmScope(actor: OrdersActor, orderId: unknown) {
  if (!actor.isRsm || !actor.userId) return false;
  const id = text(orderId);
  if (!id) return false;
  const scopeWhere = await buildRsmOrderWhere(actor);
  const numericId = /^\d+$/.test(id) ? BigInt(id) : null;
  const match = await prisma.order.findFirst({
    where: {
      AND: [
        scopeWhere,
        { OR: [...(numericId ? [{ id: numericId }] : []), { orderNumber: id }, { legacyPhpId: id }] },
      ],
    },
    select: { id: true },
  });
  return !!match;
}
