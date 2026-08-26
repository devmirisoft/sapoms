import { Prisma } from "@prisma/client";

/**
 * Auto-placement of an order when Admin approves a custom discount.
 *
 * The dealer already committed to these lines when they raised the request, so
 * approval places the order directly instead of sending them back to the cart.
 * The order is created under the draft's dealer — not the approving Admin — so
 * ownership, ledger, and dealer-scoped reads all behave as a normal order.
 *
 * Amounts come from the approved snapshot rather than being recomputed: the
 * snapshot is what both reviewers actually saw and signed off on, so
 * recalculating here could place an order for a figure nobody approved.
 */

export class DiscountOrderError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "DiscountOrderError";
    this.status = status;
    this.code = code;
  }
}

function toPaise(value: unknown) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return BigInt(0);
  return BigInt(Math.round(numeric * 100));
}

function text(value: unknown, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function count(value: unknown, fallback = 1) {
  const numeric = Math.floor(Number(value ?? fallback));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

async function nextOrderNumber(tx: Prisma.TransactionClient) {
  const year = new Date().getFullYear();
  const sequence = await tx.orderSequence.upsert({
    where: { year },
    create: { year, lastValue: BigInt(1) },
    update: { lastValue: { increment: BigInt(1) } },
  });
  const yearRange = `${String(year).slice(-2)}-${String(year + 1).slice(-2)}`;
  return `OM/${yearRange}/DMS-${sequence.lastValue.toString().padStart(3, "0")}`;
}

type ApprovedRequest = {
  id: bigint;
  dealerId: bigint;
  orderId: bigint | null;
  orderDraftId: bigint | null;
  orderSnapshot: unknown;
  grossAmountPaise?: bigint | null;
  requestedDiscountAmountPaise?: bigint | null;
  requestedNetPayableAmountPaise?: bigint | null;
  currentDiscountPercent?: Prisma.Decimal | null;
};

/**
 * Create the order for an approved request and retire its draft.
 *
 * Returns null when there is nothing to place — already linked to an order, or
 * a snapshot with no products — so the approval itself still succeeds.
 */
export async function placeOrderForApprovedDiscount(
  tx: Prisma.TransactionClient,
  request: ApprovedRequest,
  actor: { userId: bigint },
) {
  // Approval can be re-sent; never place a second order for one request.
  if (request.orderId) return null;

  const snapshot = (request.orderSnapshot && typeof request.orderSnapshot === "object"
    ? request.orderSnapshot
    : {}) as Record<string, any>;
  const products: any[] = Array.isArray(snapshot.products) ? snapshot.products : [];
  if (products.length === 0) return null;

  const dealer = await tx.dealerProfile.findUnique({
    where: { id: request.dealerId },
    include: { user: true, staffAssignments: { where: { active: true }, take: 1 } },
  });
  if (!dealer || dealer.deletedAt || dealer.user.status !== "ACTIVE") {
    throw new DiscountOrderError(409, "inactive_dealer", "This dealer account is inactive, so the approved order could not be placed.");
  }

  const items = products.slice(0, 500).map((product) => {
    const quantityPacks = count(product.quantity, 1);
    const packSize = count(product.packSize, 1);
    const grossAmount = toPaise(product.grossAmount);
    const baseDiscount = toPaise(product.baseDiscountAmount);
    const customDiscount = toPaise(product.requestedCustomDiscountAmount);
    const finalAmount = toPaise(product.finalAmount);
    const discountAmountPaise = baseDiscount + customDiscount;
    const sku = text(product.sku ?? product.catalogueNumber ?? product.productName, 160);
    return {
      productNameSnapshot: text(product.productName ?? sku, 300),
      catalogueNumberSnapshot: text(product.catalogueNumber ?? sku, 160),
      skuSnapshot: sku,
      quantityPacks,
      packSize,
      totalPieces: count(product.totalPieces, quantityPacks * packSize),
      unitPricePaise: toPaise(product.unitPrice),
      listPriceTotalPaise: grossAmount,
      discountPercent: new Prisma.Decimal(Number(product.baseDiscountPercent ?? 0) + Number(product.requestedCustomDiscountPercent ?? 0)),
      discountAmountPaise,
      finalAmountPaise: finalAmount,
      isPriority: !!product.isPriority,
      productNote: text(product.productNote, 500) || null,
    };
  });

  const grossAmountPaise = request.grossAmountPaise ?? items.reduce((sum, item) => sum + item.listPriceTotalPaise, BigInt(0));
  const customDiscountAmountPaise = request.requestedDiscountAmountPaise ?? BigInt(0);
  const baseDiscountPercent = Number(request.currentDiscountPercent ?? 0);
  const baseDiscountAmountPaise = toPaise(snapshot.baseDiscountAmount);
  const totalDiscountAmountPaise = baseDiscountAmountPaise + customDiscountAmountPaise;
  const finalPayableAmountPaise = request.requestedNetPayableAmountPaise
    ?? (grossAmountPaise > totalDiscountAmountPaise ? grossAmountPaise - totalDiscountAmountPaise : BigInt(0));
  const totalDiscountPercent = grossAmountPaise > BigInt(0)
    ? Number(totalDiscountAmountPaise) * 100 / Number(grossAmountPaise)
    : 0;

  const orderNumber = await nextOrderNumber(tx);
  const order = await tx.order.create({
    data: {
      orderNumber,
      dealerId: dealer.id,
      assignedStaffId: dealer.staffAssignments[0]?.staffId ?? null,
      // The dealer owns the order; the approving Admin is recorded on the
      // discount request and the audit log instead.
      createdByUserId: dealer.userId,
      shipTo: text(snapshot.shipto ?? snapshot.shipTo, 1000),
      refNo: text(snapshot.refno ?? snapshot.refNo, 160),
      note: text(snapshot.orderNote ?? snapshot.order_note, 1500),
      grossAmountPaise,
      allocatedDiscountPercent: new Prisma.Decimal(baseDiscountPercent),
      baseDiscountPercent: new Prisma.Decimal(baseDiscountPercent),
      baseDiscountAmountPaise,
      postBaseAmountPaise: grossAmountPaise - baseDiscountAmountPaise,
      additionalDiscountType: "CUSTOM",
      additionalDiscountAmountPaise: customDiscountAmountPaise,
      customDiscountAmountPaise,
      totalDiscountPercent: new Prisma.Decimal(totalDiscountPercent),
      totalDiscountAmountPaise,
      finalPayableAmountPaise,
      status: "AWAITING_ACCEPTANCE",
      acceptanceStatus: "AWAITING",
      rsmApprovalStatus: "AWAITING",
      fulfilmentStatus: "PENDING",
      items: { create: items },
    },
  });

  // Retire the draft: the dealer should not be able to submit these lines twice.
  if (request.orderDraftId) {
    await tx.orderDraft.updateMany({
      where: { id: request.orderDraftId, dealerId: request.dealerId },
      data: { status: "CONVERTED", orderId: order.id },
    });
  }

  await tx.authAuditLog.create({
    data: {
      role: "ADMIN",
      eventType: "ORDER_AUTO_PLACED_ON_DISCOUNT_APPROVAL",
      metadata: {
        orderId: order.id.toString(),
        orderNumber,
        discountRequestId: request.id.toString(),
        approvedByUserId: actor.userId.toString(),
        dealerId: dealer.id.toString(),
        ...(request.orderDraftId ? { orderDraftId: request.orderDraftId.toString() } : {}),
      },
    },
  });

  return order;
}
