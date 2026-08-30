import { Prisma, OrderDiscountType, WalletTransactionType } from "@prisma/client";
import { applyWalletChange } from "@/lib/postgresWallet";
import { buildEditLogEntry, diffOrderRows, orderItemsToDraftRows, ORDER_REJECTION_SOURCE } from "@/lib/orderRejectionDraft.mjs";

/**
 * Order creation for a dealer submission.
 *
 * Lifted verbatim out of POST /api/dealer-order so the fund-request workflow can
 * place the dealer's approved order without a second copy of the discount and
 * wallet arithmetic. The route stays the only place that authenticates and
 * reads the multipart body; everything below works off the resulting flat
 * field map, which is exactly what a fund request stores and replays.
 */

export class OrderError extends Error {
  constructor(message: string, public status = 400, public code = "order_error") { super(message); }
}

/** The dealer's submission as a flat string map - a FormData that survives JSON. */
export type OrderFormFields = Record<string, string>;

export function formToFields(form: FormData): OrderFormFields {
  const fields: OrderFormFields = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") fields[key] = value;
  }
  return fields;
}

type ParsedItem = {
  productname: string;
  productName: string;
  catNo: string;
  quantityPacks: number;
  packSize: number;
  totalPieces: number;
  unitPricePaise: bigint;
  listPriceTotalPaise: bigint;
  discountPercent: number;
  discountAmountPaise: bigint;
  finalAmountPaise: bigint;
  remarks: string;
  productNote: string;
  priority: boolean;
  variantId?: bigint;
  productId?: bigint;
};

export function text(value: unknown, max = 1000) { return String(value ?? "").trim().slice(0, max); }
function optionalBigInt(value: unknown) { const raw = text(value, 40); return /^\d+$/.test(raw) ? BigInt(raw) : undefined; }
function num(value: unknown) { const n = Number(String(value ?? "").replace(/,/g, "").trim()); return Number.isFinite(n) ? n : 0; }
function paise(value: unknown) { return BigInt(Math.round(num(value) * 100)); }
export function fromPaise(value: bigint) { return Number(value) / 100; }
function clampPercent(value: unknown) { return Math.min(100, Math.max(0, num(value))); }

function parseProductOrder(fields: OrderFormFields): Array<Record<string, unknown>> {
  const raw = text(fields.productorder, 2_000_000);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new OrderError("Order products are malformed.", 422, "invalid_products"); }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new OrderError("At least one order product is required.", 422, "invalid_products");
  return parsed.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
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

function parseItems(rows: Array<Record<string, unknown>>): ParsedItem[] {
  const items: ParsedItem[] = [];
  for (const row of rows) {
    const catNo = text(row.catNo ?? row.variantCode ?? row.productname, 160);
    const productName = text(row.productName ?? row.productname, 300);
    const quantityPacks = Math.trunc(num(row.quantityPacks) || (num(row.producQuanity) / Math.max(1, num(row.packSize) || 1)));
    const submittedPackSize = Math.trunc(num(row.packSize) || 1);
    if (!catNo || !productName || quantityPacks <= 0 || submittedPackSize <= 0) throw new OrderError("Order product quantity is invalid.", 422, "invalid_quantity");

    const packSize = submittedPackSize || 1;
    const totalPieces = quantityPacks * packSize;
    const unitPricePaise = paise(row.unitPrice ?? row.price);
    const submittedListPricePaise = paise(row.listPriceTotal ?? row.grossAmount ?? row.subtotal);
    const listPriceTotalPaise = submittedListPricePaise > BigInt(0) ? submittedListPricePaise : unitPricePaise * BigInt(totalPieces);
    const discountPercent = clampPercent(row.discountPercent ?? row.totalDiscountPercent);
    const submittedDiscountPaise = paise(row.discount ?? row.discountAmount);
    const discountAmountPaise = submittedDiscountPaise > BigInt(0) ? submittedDiscountPaise : BigInt(Math.round(Number(listPriceTotalPaise) * (discountPercent / 100)));
    const submittedFinalPaise = paise(row.afterDiscountPrice ?? row.finalAmount);
    const calculatedFinalPaise = listPriceTotalPaise > discountAmountPaise ? listPriceTotalPaise - discountAmountPaise : BigInt(0);
    const finalAmountPaise = submittedFinalPaise > BigInt(0) ? submittedFinalPaise : calculatedFinalPaise;

    items.push({
      productname: text(row.productname ?? productName, 300),
      productName,
      catNo,
      quantityPacks,
      packSize,
      totalPieces,
      unitPricePaise,
      listPriceTotalPaise,
      discountPercent,
      discountAmountPaise,
      finalAmountPaise,
      remarks: text(row.remarks, 1500),
      productNote: text(row.productNote ?? row.product_note ?? row.note, 1500),
      priority: row.isPriority === true || text(row.priority, 20) === "1" || text(row.isPriority, 20).toLowerCase() === "true",
      productId: optionalBigInt(row.productId),
      variantId: optionalBigInt(row.variantId),
    });
  }
  return items;
}

async function validateCustomDiscounts(tx: Prisma.TransactionClient, fields: OrderFormFields, dealerId: bigint) {
  const ids = text(fields.customDiscountRequestId, 2000).split(",").map((id) => id.trim()).filter(Boolean);
  if (text(fields.additionalDiscountType, 40).toLowerCase() !== "custom" && ids.length === 0) return [];
  if (ids.length === 0) throw new OrderError("Approved custom-discount reference is required.", 409, "custom_discount_not_approved");
  const bigIds = ids.map((id) => BigInt(id));
  const approved = await tx.customDiscountRequest.findMany({ where: { id: { in: bigIds }, dealerId, status: "APPROVED", orderId: null } });
  if (approved.length !== bigIds.length) throw new OrderError("Custom discount is not approved for this order.", 409, "custom_discount_not_approved");
  return approved;
}

/**
 * Price a submission without writing anything.
 *
 * The dealer's Request Funds path needs the very same figure the order would
 * have been placed for, so the shortfall it asks approval for is the shortfall
 * that will actually be charged.
 */
export async function priceDealerOrder(
  tx: Prisma.TransactionClient,
  fields: OrderFormFields,
  dealer: { id: bigint; discountPercent: Prisma.Decimal | null },
) {
  const rows = parseProductOrder(fields);
  const items = parseItems(rows);
  const grossAmountPaise = items.reduce((sum, item) => sum + item.listPriceTotalPaise, BigInt(0));
  const baseDiscountPercent = clampPercent(fields.baseDiscountPercent ?? fields.allocatedDiscountPercent ?? dealer.discountPercent ?? 0);
  const baseDiscountAmountPaise = BigInt(Math.round(Number(grossAmountPaise) * (baseDiscountPercent / 100)));
  const postBaseAmountPaise = grossAmountPaise - baseDiscountAmountPaise;
  const additionalTypeText = text(fields.additionalDiscountType, 40).toLowerCase();
  const additionalDiscountType = additionalTypeText === "custom" ? OrderDiscountType.CUSTOM : additionalTypeText === "slab" ? OrderDiscountType.SLAB : OrderDiscountType.NONE;
  const slabDiscountPercent = additionalDiscountType === OrderDiscountType.SLAB ? clampPercent(fields.slabDiscountPercent) : 0;
  const slabDiscountAmountPaise = additionalDiscountType === OrderDiscountType.SLAB ? BigInt(Math.round(Number(postBaseAmountPaise) * (slabDiscountPercent / 100))) : BigInt(0);
  let customDiscountAmountPaise = additionalDiscountType === OrderDiscountType.CUSTOM ? paise(fields.customDiscountAmount ?? fields.additionalDiscountAmount) : BigInt(0);
  let additionalDiscountAmountPaise = additionalDiscountType === OrderDiscountType.CUSTOM ? customDiscountAmountPaise : slabDiscountAmountPaise;
  const couponDiscountPercent = clampPercent(fields.couponDiscountPercent);
  let couponDiscountAmountPaise = BigInt(Math.round(Number(postBaseAmountPaise - additionalDiscountAmountPaise) * (couponDiscountPercent / 100)));
  let totalDiscountAmountPaise = baseDiscountAmountPaise + additionalDiscountAmountPaise + couponDiscountAmountPaise;
  let finalPayableAmountPaise = grossAmountPaise > totalDiscountAmountPaise ? grossAmountPaise - totalDiscountAmountPaise : BigInt(0);
  let totalDiscountPercent = grossAmountPaise > BigInt(0) ? Number(totalDiscountAmountPaise) * 100 / Number(grossAmountPaise) : 0;

  const customRequests = await validateCustomDiscounts(tx, fields, dealer.id);
  if (additionalDiscountType === OrderDiscountType.CUSTOM) {
    customDiscountAmountPaise = customRequests.reduce((sum, request) => sum + (request.requestedDiscountAmountPaise ?? BigInt(0)), BigInt(0));
    additionalDiscountAmountPaise = customDiscountAmountPaise;
    couponDiscountAmountPaise = BigInt(Math.round(Number(postBaseAmountPaise - additionalDiscountAmountPaise) * (couponDiscountPercent / 100)));
    totalDiscountAmountPaise = baseDiscountAmountPaise + additionalDiscountAmountPaise + couponDiscountAmountPaise;
    finalPayableAmountPaise = grossAmountPaise > totalDiscountAmountPaise ? grossAmountPaise - totalDiscountAmountPaise : BigInt(0);
    totalDiscountPercent = grossAmountPaise > BigInt(0) ? Number(totalDiscountAmountPaise) * 100 / Number(grossAmountPaise) : 0;
  }

  return {
    items, customRequests,
    grossAmountPaise, baseDiscountPercent, baseDiscountAmountPaise, postBaseAmountPaise,
    additionalDiscountType, slabDiscountPercent, slabDiscountAmountPaise,
    customDiscountAmountPaise, additionalDiscountAmountPaise,
    couponDiscountPercent, couponDiscountAmountPaise,
    totalDiscountAmountPaise, totalDiscountPercent, finalPayableAmountPaise,
  };
}

export type CreateOrderActor = { userId: bigint; role: string; displayName?: string | null; sessionId?: string | null };

export type CreateOrderOptions = {
  idempotencyKey?: string | null;
  /**
   * Skip the pre-flight balance check. Set only on the fund-request path, where
   * the accountant has just credited the wallet inside this same transaction:
   * the debit below still fails on a genuine shortfall, so the money is never
   * over-spent - this only suppresses the duplicate up-front guard.
   */
  skipBalanceCheck?: boolean;
  auditEventType?: string;
  auditMetadata?: Record<string, string>;
};

export type WalletDebitPayload = { used: boolean; transactionId: string; amountConsumed: number; balanceAfter: number };

/**
 * Create the order, debit an active wallet, and audit it - inside the caller's
 * transaction. Returns `duplicate` when the idempotency key already placed one.
 */
export async function createDealerOrder(
  tx: Prisma.TransactionClient,
  fields: OrderFormFields,
  dealerId: bigint,
  actor: CreateOrderActor,
  options: CreateOrderOptions = {},
) {
  const idempotencyKey = options.idempotencyKey ?? null;
  if (idempotencyKey) {
    const existing = await tx.order.findUnique({ where: { idempotencyKey } });
    if (existing) return { order: existing, duplicate: true, wallet: null as null | WalletDebitPayload };
  }

  const dealer = await tx.dealerProfile.findUnique({ where: { id: dealerId }, include: { user: true, staffAssignments: { where: { active: true }, take: 1 } } });
  if (!dealer || dealer.deletedAt || dealer.user.status !== "ACTIVE") throw new OrderError("This dealer account is inactive.", 403, "inactive_dealer");

  const priced = await priceDealerOrder(tx, fields, dealer);

  const wallet = await tx.dealerWallet.findUnique({ where: { dealerId: dealer.id } });
  if (wallet?.status === "ACTIVE" && !options.skipBalanceCheck) {
    const available = wallet.balancePaise - wallet.reservedPaise;
    if (available < priced.finalPayableAmountPaise) {
      throw new OrderError(`Insufficient wallet balance. Available: ₹${fromPaise(available).toLocaleString("en-IN")}. Required: ₹${fromPaise(priced.finalPayableAmountPaise).toLocaleString("en-IN")}.`, 409, "insufficient_balance");
    }
  }

  const orderNumber = await nextOrderNumber(tx);
  const order = await tx.order.create({
    data: {
      orderNumber,
      dealerId: dealer.id,
      assignedStaffId: dealer.staffAssignments[0]?.staffId ?? null,
      createdByUserId: actor.userId,
      idempotencyKey,
      shipTo: text(fields.Dealer_shipto ?? fields.shipTo, 1000),
      refNo: text(fields.refno ?? fields.refNo, 160),
      note: text(fields.note ?? fields.order_note ?? fields.Dealer_note, 1500),
      grossAmountPaise: priced.grossAmountPaise,
      allocatedDiscountPercent: new Prisma.Decimal(priced.baseDiscountPercent),
      couponDiscountPercent: new Prisma.Decimal(priced.couponDiscountPercent),
      couponCode: text(fields.coupon_code, 80) || null,
      baseDiscountPercent: new Prisma.Decimal(priced.baseDiscountPercent),
      baseDiscountAmountPaise: priced.baseDiscountAmountPaise,
      postBaseAmountPaise: priced.postBaseAmountPaise,
      additionalDiscountType: priced.additionalDiscountType,
      additionalDiscountAmountPaise: priced.additionalDiscountAmountPaise,
      customDiscountAmountPaise: priced.customDiscountAmountPaise,
      slabDiscountPercent: new Prisma.Decimal(priced.slabDiscountPercent),
      slabDiscountAmountPaise: priced.slabDiscountAmountPaise,
      totalDiscountPercent: new Prisma.Decimal(priced.totalDiscountPercent),
      totalDiscountAmountPaise: priced.totalDiscountAmountPaise,
      finalPayableAmountPaise: priced.finalPayableAmountPaise,
      status: "AWAITING_ACCEPTANCE",
      acceptanceStatus: "AWAITING",
      fulfilmentStatus: "PENDING",
      items: { create: priced.items.map((item) => ({
        productId: item.productId,
        productVariantId: item.variantId,
        productNameSnapshot: item.productName,
        catalogueNumberSnapshot: item.catNo,
        skuSnapshot: item.catNo,
        quantityPacks: item.quantityPacks,
        packSize: item.packSize,
        totalPieces: item.totalPieces,
        unitPricePaise: item.unitPricePaise,
        listPriceTotalPaise: item.listPriceTotalPaise,
        discountPercent: new Prisma.Decimal(item.discountPercent),
        discountAmountPaise: item.discountAmountPaise,
        finalAmountPaise: item.finalAmountPaise,
        isPriority: item.priority,
        remarks: item.remarks || null,
        productNote: item.productNote || null,
      })) },
    },
  });

  if (priced.customRequests.length) {
    await tx.customDiscountRequest.updateMany({ where: { id: { in: priced.customRequests.map((r) => r.id) } }, data: { orderId: order.id } });
  }

  // A resubmitted rejected order is diffed against the order it replaces, so
  // the reviewer sees exactly what the dealer changed after the disapproval.
  const rejectedFromId = optionalBigInt(fields.rejectedFromOrderId ?? fields.rejected_from_order_id);
  const newRows = orderItemsToDraftRows(priced.items as unknown as Array<Record<string, unknown>>);
  let revisionChanges: Array<{ type: string; catNo: string; summary: string }> = [];
  if (rejectedFromId) {
    const previous = await tx.order.findFirst({
      where: { id: rejectedFromId, dealerId: dealer.id, OR: [{ acceptanceStatus: "DECLINED" }, { rsmApprovalStatus: "DECLINED" }] },
      include: { items: { orderBy: { id: "asc" } } },
    });
    if (!previous) throw new OrderError("The order being resubmitted was not found or was not disapproved.", 409, "invalid_resubmission");
    revisionChanges = diffOrderRows(orderItemsToDraftRows(previous.items as unknown as Array<Record<string, unknown>>), newRows);
    await tx.orderOverlay.create({
      data: {
        orderId: order.id,
        type: "revision",
        status: "active",
        value: previous.orderNumber,
        reason: previous.acceptanceNote || previous.rsmNote || null,
        actorUserId: actor.userId,
        actorRole: actor.role as never,
        metadata: {
          source: "order_rejection_resubmit",
          previousOrderId: previous.id.toString(),
          previousOrderNumber: previous.orderNumber,
          rejectedByName: previous.acceptanceReviewedByName || previous.rsmReviewedByName || "",
          rejectionNote: previous.acceptanceNote || previous.rsmNote || "",
          rejectedAt: (previous.acceptanceReviewedAt ?? previous.rsmReviewedAt)?.toISOString() ?? null,
          changes: revisionChanges,
          submittedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
  }

  const submittedDraftId = text(fields.orderDraftId ?? fields.order_draft_id ?? fields.draftId, 80);
  if (submittedDraftId && /^\d+$/.test(submittedDraftId)) {
    const draft = await tx.orderDraft.findFirst({ where: { id: BigInt(submittedDraftId), dealerId: dealer.id } });
    const snapshot = draft?.snapshot && typeof draft.snapshot === "object" && !Array.isArray(draft.snapshot) ? draft.snapshot as Record<string, unknown> : {};
    if (draft && snapshot.source === ORDER_REJECTION_SOURCE) {
      // The rejection draft survives its own resubmission - it only disappears
      // once a reviewer accepts the order it produced.
      const editLog = Array.isArray(snapshot.edit_log) ? snapshot.edit_log : [];
      await tx.orderDraft.update({
        where: { id: draft.id },
        data: {
          orderId: order.id,
          snapshot: JSON.parse(JSON.stringify({ ...snapshot, rows: newRows, edit_log: [...editLog, buildEditLogEntry({ orderNumber, changes: revisionChanges })] })) as Prisma.InputJsonValue,
          approvalState: { status: "pending", orderId: order.id.toString(), orderNumber, updatedAt: new Date().toISOString() } as Prisma.InputJsonValue,
        },
      });
    } else if (draft) {
      await tx.orderDraft.update({ where: { id: draft.id }, data: { status: "CONVERTED", orderId: order.id } });
    }
  }
  if (text(fields.fromCart ?? fields.from_cart, 20).toLowerCase() === "true") {
    await tx.draftCart.deleteMany({ where: { dealerId: dealer.id } });
  }

  let walletPayload: null | WalletDebitPayload = null;
  if (wallet?.status === "ACTIVE") {
    const walletDebit = await applyWalletChange(tx, dealer.id, WalletTransactionType.ORDER_DEBIT, fromPaise(priced.finalPayableAmountPaise), {
      orderId: order.id,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:wallet` : null,
      reference: order.orderNumber,
      note: "Order wallet debit",
      metadata: { orderNumber: order.orderNumber },
      actor: { userId: actor.userId, role: actor.role as never, displayName: actor.displayName ?? undefined },
    });
    walletPayload = { used: true, transactionId: walletDebit.transaction.id, amountConsumed: walletDebit.transaction.amount, balanceAfter: walletDebit.transaction.balanceAfter };
  }

  await tx.authAuditLog.create({
    data: {
      sessionId: actor.sessionId ?? null,
      role: actor.role as never,
      eventType: options.auditEventType ?? "ORDER_CREATED",
      metadata: { orderId: order.id.toString(), orderNumber, ...(options.auditMetadata ?? {}) },
    },
  });

  return { order, duplicate: false, wallet: walletPayload };
}
