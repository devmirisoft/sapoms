import "server-only";

import { Prisma, type Warehouse } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { OrdersActor } from "@/lib/orderPagination";
import { summarizeOrderSettlement } from "@/lib/orderSettlement";
import { normalizeSku } from "@/lib/orderProductNotes.mjs";
import { normalizeDispatchStatus, type DispatchStatus, type OrderDispatchRecord } from "@/lib/orderDispatch";

export const orderInclude = {
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
      // The admin warehouse tab matches any staff linked to the order, not just
      // the one stamped on it at creation time.
      staffAssignments: { where: { active: true }, select: { staff: { select: { warehouse: true } } } },
    },
  },
  assignedStaff: { select: { id: true, displayName: true, warehouse: true } },
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
type DispatchTotalsSource = { items?: Array<{ quantityPacks: number; packSize?: number; dispatches?: Array<{ quantity: number }> }> };

// Ordered vs dispatched across the whole order, in pieces (dispatch rows hold packs).
function orderDispatchPieces(order: DispatchTotalsSource) {
  return (order.items ?? []).reduce((totals, item) => {
    const packSize = Math.max(1, item.packSize ?? 1);
    const dispatchedPacks = (item.dispatches ?? []).reduce((packs, dispatch) => packs + dispatch.quantity, 0);
    return { ordered: totals.ordered + item.quantityPacks * packSize, dispatched: totals.dispatched + dispatchedPacks * packSize };
  }, { ordered: 0, dispatched: 0 });
}

function legacyFulfilment(order: DispatchTotalsSource) {
  const { ordered, dispatched } = orderDispatchPieces(order);
  if (dispatched <= 0) return "Pending";
  return dispatched >= ordered ? "Completed" : "Partial";
}

function orderIdentity(order: PostgresOrderRecord) {
  return order.legacyPhpId || order.id.toString();
}

export function postgresOrderDedupeIds(order: PostgresOrderRecord) {
  return [order.id.toString(), order.orderNumber, order.legacyPhpId].map(text).filter(Boolean);
}

// One record per order line, aggregating its dispatch rows. Clients merge these
// onto the line items to show dispatched/left quantities and the line status, so
// every payload that carries dispatchRecords must use this shape.
type DispatchRowLike = { id?: bigint; quantity: number; remark?: string | null; status?: string; actorUserId?: bigint | null; actorRole?: string | null; createdAt?: Date };

export function mapPostgresOrderDispatchRecords(order: PostgresOrderLike): OrderDispatchRecord[] {
  const orderId = orderIdentity(order);
  return (order.items ?? []).map((item) => {
    const dispatches = (item.dispatches ?? []) as DispatchRowLike[];
    const dispatchedQuantity = dispatches.reduce((sum, dispatch) => sum + dispatch.quantity, 0);
    // List queries select quantities only; the history is available on detail reads.
    const updates = dispatches.filter((dispatch) => dispatch.id !== undefined).map((dispatch) => ({
      id: dispatch.id!.toString(),
      quantity: dispatch.quantity,
      remark: dispatch.remark || "",
      status: normalizeDispatchStatus(dispatch.status),
      actorId: dispatch.actorUserId?.toString() || "",
      actorRole: dispatch.actorRole === "ADMIN" || dispatch.actorRole === "NSM" ? "admin" as const : "staff" as const,
      createdAt: dispatch.createdAt as Date,
    }));
    const currentStatus: DispatchStatus = dispatchedQuantity >= item.quantityPacks ? "successful" : dispatchedQuantity > 0 ? "dispatched" : "pending";
    return {
      id: `pg:${item.id.toString()}`,
      orderId,
      orderItemId: item.legacyPhpOrderItemId || item.id.toString(),
      sku: item.catalogueNumberSnapshot,
      normalizedSku: normalizeSku(item.catalogueNumberSnapshot),
      occurrence: 1,
      dealerId: order.dealerId.toString(),
      assignedStaffId: order.assignedStaffId?.toString() || null,
      orderedQuantity: item.quantityPacks,
      dispatchedQuantity,
      currentStatus,
      updates,
      createdAt: item.createdAt,
      updatedAt: updates.at(-1)?.createdAt ?? item.updatedAt,
    };
  });
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
    staffwarehouse: order.assignedStaff?.warehouse || "",
    staffwarehouses: Array.from(new Set([
      order.assignedStaff?.warehouse,
      ...order.dealer.staffAssignments.map((assignment) => assignment.staff.warehouse),
    ].filter(Boolean))),
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
    orderdata_item_quantity: String(orderDispatchPieces(order).ordered),
    readyquantity: String(orderDispatchPieces(order).dispatched),
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
    dispatchRecords: mapPostgresOrderDispatchRecords(order),
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

/**
 * Which orders an actor sees. Orders flow as a reverse waterfall: the dealer's
 * Sales Manager (stamped on the order) sees it first, and its ASM and RSM see
 * it through that Sales Manager. Plain Staff only get it after RSM approval,
 * and only for their own warehouse.
 */
export async function actorWhere(actor: OrdersActor, assignedDealerIds: Array<string | number> = []): Promise<Prisma.OrderWhereInput> {
  if (actor.role === "dealer") return { dealerId: BigInt(actor.actorId) };
  if (actor.isRsm && actor.userId) return buildRsmOrderWhere(actor);
  if (actor.role === "staff") {
    const me = BigInt(actor.actorId);
    const assignedDealerBigInts = assignedDealerIds
      .map((id) => String(id ?? "").trim())
      .filter((id) => /^\d+$/.test(id))
      .map((id) => BigInt(id));
    const staffScope = {
      // A warehouse-pinned staff member only sees orders whose assigned staff
      // sits in the same warehouse; staff with no warehouse keep full scope.
      ...(actor.warehouse ? { assignedStaff: { warehouse: actor.warehouse as Warehouse } } : {}),
      OR: [
        { assignedStaffId: me },
        { salesManagerId: me },
        ...(actor.isAsm ? [{ salesManager: { parentAsmId: me } }] : []),
        ...(assignedDealerBigInts.length > 0 ? [{ dealerId: { in: assignedDealerBigInts } }] : []),
      ],
    } satisfies Prisma.OrderWhereInput;
    // Sales Manager and ASM sit above the RSM step; only plain Staff wait for it.
    return actor.isAsm || actor.isSalesManager ? staffScope : { rsmApprovalStatus: "ACCEPTED", ...staffScope };
  }
  return {};
}

// An RSM sees exactly the orders pushed up by its own Sales Managers.
async function buildRsmOrderWhere(actor: OrdersActor): Promise<Prisma.OrderWhereInput> {
  return { salesManager: { parentRsmId: BigInt(actor.actorId) } };
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
// order id keeps /api/order-access identical to the list scope.
export async function isOrderInRsmScope(actor: OrdersActor, orderId: unknown) {
  if (!actor.isRsm || !actor.userId) return false;
  return isOrderInActorScope(actor, orderId);
}

export async function isOrderInActorScope(actor: OrdersActor, orderId: unknown, assignedDealerIds: Array<string | number> = []) {
  const id = text(orderId);
  if (!id) return false;
  const scopeWhere = await actorWhere(actor, assignedDealerIds);
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
