import { Prisma, OrderDiscountType, WalletTransactionType } from "@prisma/client";
import { applyWalletChange } from "@/lib/postgresWallet";
import { reserveDealerCredit } from "@/lib/dealerCreditLimit";
import { resolveOrderStaffStamp } from "@/lib/orderStaffStamp";
import { buildEditLogEntry, diffOrderRows, orderItemsToDraftRows, ORDER_REJECTION_SOURCE } from "@/lib/orderRejectionDraft.mjs";
import { findCatalogueEntry, type CatalogueIndex } from "@/lib/catalogue";
import { couponPercent } from "@/lib/coupons";
import { normalizeApprovalProductKey } from "@/lib/customDiscountRequests";
import discountUtils from "@/lib/discount";
import { linePricing, loadCatalogue } from "@/server/modules/products/catalogue";
import { liveSalePercents } from "@/server/todays-sale";

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
  saleDiscountPercent: number;
  saleSavedPaise: bigint;
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

/** A percent share of a paise amount, rounded to the paisa. */
function share(amountPaise: bigint, percent: number) { return BigInt(Math.round(Number(amountPaise) * percent / 100)); }

/**
 * Only the catalogue number and the pack count are the dealer's to choose. Unit
 * price and pack size are looked up from the catalogue here, so an edited request
 * cannot change what an order costs. Discounts are applied later, in priceDealerOrder.
 * A live Today's Sale lowers the product's own price here, so every discount after
 * it (base, custom, slab) works on the sale price exactly as on a normal price.
 */
function parseItems(rows: Array<Record<string, unknown>>, catalogue: CatalogueIndex, salePercents: Map<string, number>): ParsedItem[] {
  const items: ParsedItem[] = [];
  for (const row of rows) {
    const submittedCatNo = text(row.catNo ?? row.variantCode ?? row.productname, 160);
    const entry = submittedCatNo ? findCatalogueEntry(catalogue, submittedCatNo) : null;
    if (!entry?.variant) throw new OrderError(`${submittedCatNo || "A product"} is not in the catalogue.`, 422, "unknown_product");
    const { product, variant } = entry;
    const pricing = linePricing(product, variant);
    if (!pricing) throw new OrderError(`${submittedCatNo} has no catalogue price.`, 422, "unpriced_product");
    const { packSize } = pricing;

    const quantityPacks = Math.trunc(num(row.quantityPacks) || (num(row.producQuanity) / packSize));
    if (quantityPacks <= 0) throw new OrderError("Order product quantity is invalid.", 422, "invalid_quantity");
    const productName = text(row.productName ?? row.productname, 300) || product.name;
    const catNo = variant.sku || submittedCatNo;
    const salePercent = salePercents.get(catNo.toLowerCase()) ?? salePercents.get(product.sku.toLowerCase()) ?? 0;
    const packPricePaise = paise(pricing.packPrice);
    const unitPricePaise = paise(pricing.unitPrice);
    const listPriceTotalPaise = (packPricePaise - share(packPricePaise, salePercent)) * BigInt(quantityPacks);
    const saleNote = salePercent > 0 ? `Today's Sale: ${salePercent}% off` : "";
    const productNote = text(row.productNote ?? row.product_note ?? row.note, 1500);

    items.push({
      productname: text(row.productname ?? productName, 300),
      productName,
      catNo,
      quantityPacks,
      packSize,
      totalPieces: quantityPacks * packSize,
      unitPricePaise: unitPricePaise - share(unitPricePaise, salePercent),
      listPriceTotalPaise,
      discountPercent: 0,
      discountAmountPaise: BigInt(0),
      finalAmountPaise: listPriceTotalPaise,
      saleDiscountPercent: salePercent,
      saleSavedPaise: share(packPricePaise, salePercent) * BigInt(quantityPacks),
      remarks: text(row.remarks, 1500),
      // The sale note leads, so trimming a long dealer note never drops it.
      productNote: saleNote && !productNote.includes(saleNote)
        ? [saleNote, productNote].filter(Boolean).join(" · ").slice(0, 1500)
        : productNote,
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
  const { index } = await loadCatalogue();
  const items = parseItems(parseProductOrder(fields), index, await liveSalePercents(tx));
  const grossAmountPaise = items.reduce((sum, item) => sum + item.listPriceTotalPaise, BigInt(0));

  // Every percent is decided here, never read from the submission: the dealer's own
  // discount plus a re-validated coupon (one base percent, as the order form shows it),
  // then either approved custom requests from the DB or the slab table.
  const couponDiscountPercent = couponPercent(fields.coupon_code);
  const baseDiscountPercent = clampPercent(num(dealer.discountPercent ?? 0) + couponDiscountPercent);
  const baseDiscountAmountPaise = share(grossAmountPaise, baseDiscountPercent);
  const postBaseAmountPaise = grossAmountPaise - baseDiscountAmountPaise;

  const customRequests = await validateCustomDiscounts(tx, fields, dealer.id);
  const customDiscountAmountPaise = customRequests.reduce((sum, request) => sum + (request.requestedDiscountAmountPaise ?? BigInt(0)), BigInt(0));

  const slabDiscountPercent = customRequests.length ? 0 : discountUtils.getSlabPercent(fromPaise(postBaseAmountPaise));
  const slabDiscountAmountPaise = share(postBaseAmountPaise, slabDiscountPercent);
  const additionalDiscountType = customRequests.length ? OrderDiscountType.CUSTOM : slabDiscountPercent > 0 ? OrderDiscountType.SLAB : OrderDiscountType.NONE;
  const additionalDiscountAmountPaise = customRequests.length ? customDiscountAmountPaise : slabDiscountAmountPaise;

  const discountSum = baseDiscountAmountPaise + additionalDiscountAmountPaise;
  const totalDiscountAmountPaise = discountSum < grossAmountPaise ? discountSum : grossAmountPaise;
  const finalPayableAmountPaise = grossAmountPaise - totalDiscountAmountPaise;
  const totalDiscountPercent = grossAmountPaise > BigInt(0) ? Number(totalDiscountAmountPaise) * 100 / Number(grossAmountPaise) : 0;
  // Already taken off the product prices, so it is a record here, not a discount.
  const saleDiscountAmountPaise = items.reduce((sum, item) => sum + item.saleSavedPaise, BigInt(0));

  // Row discounts mirror the order form: the base percent, raised to an approved
  // order-wide or per-product custom percent (both are totals that include the base).
  const orderCustomPercent = Math.max(0, ...customRequests
    .filter((request) => request.scope === "ORDER")
    .map((request) => num(request.requestedOrderDiscountPercent ?? request.requestedDiscountPercent)));
  for (const item of items) {
    const key = normalizeApprovalProductKey(item.catNo);
    const productPercent = Math.max(0, ...customRequests
      .filter((request) => request.scope === "PRODUCT")
      .map((request) => num((request.requestedProductDiscounts as Record<string, unknown> | null)?.[key])));
    item.discountPercent = clampPercent(Math.max(baseDiscountPercent, orderCustomPercent, productPercent));
    item.discountAmountPaise = share(item.listPriceTotalPaise, item.discountPercent);
    item.finalAmountPaise = item.listPriceTotalPaise - item.discountAmountPaise;
  }

  return {
    items, customRequests,
    grossAmountPaise, baseDiscountPercent, baseDiscountAmountPaise, postBaseAmountPaise,
    saleDiscountAmountPaise,
    additionalDiscountType, slabDiscountPercent, slabDiscountAmountPaise,
    customDiscountAmountPaise, additionalDiscountAmountPaise,
    couponDiscountPercent,
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

  const dealer = await tx.dealerProfile.findUnique({ where: { id: dealerId }, include: { user: true } });
  if (!dealer || dealer.deletedAt || dealer.user.status !== "ACTIVE") throw new OrderError("This dealer account is inactive.", 403, "inactive_dealer");

  const priced = await priceDealerOrder(tx, fields, dealer);

  // Credit dealers order against their credit limit, never a wallet.
  const wallet = dealer.creditDays === null ? await tx.dealerWallet.findUnique({ where: { dealerId: dealer.id } }) : null;
  if (wallet?.status === "ACTIVE" && !options.skipBalanceCheck) {
    const available = wallet.balancePaise - wallet.reservedPaise;
    if (available < priced.finalPayableAmountPaise) {
      throw new OrderError(`Insufficient wallet balance. Available: ₹${fromPaise(available).toLocaleString("en-IN")}. Required: ₹${fromPaise(priced.finalPayableAmountPaise).toLocaleString("en-IN")}.`, 409, "insufficient_balance");
    }
  }

  if (dealer.creditDays !== null) {
    const creditBlock = await reserveDealerCredit(tx, dealer.id, priced.finalPayableAmountPaise);
    if (creditBlock) throw new OrderError(creditBlock.message, 409, creditBlock.code);
  }

  const orderNumber = await nextOrderNumber(tx);
  const stamp = await resolveOrderStaffStamp(tx, dealer.id);
  // A custom discount already cleared by both the RSM and Admin has had its RSM
  // review, so the order skips the RSM stage and goes straight to Staff.
  const rsmReview = priced.customRequests.length > 0 && priced.customRequests.every((request) => request.rsmApprovalStatus === "APPROVED")
    ? priced.customRequests[0]
    : null;
  const order = await tx.order.create({
    data: {
      orderNumber,
      dealerId: dealer.id,
      ...stamp,
      createdByUserId: actor.userId,
      idempotencyKey,
      shipTo: text(fields.Dealer_shipto ?? fields.shipTo, 1000),
      refNo: text(fields.refno ?? fields.refNo, 160),
      note: text(fields.note ?? fields.order_note ?? fields.Dealer_note, 1500),
      grossAmountPaise: priced.grossAmountPaise,
      allocatedDiscountPercent: new Prisma.Decimal(priced.baseDiscountPercent),
      couponDiscountPercent: new Prisma.Decimal(priced.couponDiscountPercent),
      couponCode: priced.couponDiscountPercent ? text(fields.coupon_code, 80) : null,
      baseDiscountPercent: new Prisma.Decimal(priced.baseDiscountPercent),
      baseDiscountAmountPaise: priced.baseDiscountAmountPaise,
      postBaseAmountPaise: priced.postBaseAmountPaise,
      additionalDiscountType: priced.additionalDiscountType,
      additionalDiscountAmountPaise: priced.additionalDiscountAmountPaise,
      customDiscountAmountPaise: priced.customDiscountAmountPaise,
      slabDiscountPercent: new Prisma.Decimal(priced.slabDiscountPercent),
      slabDiscountAmountPaise: priced.slabDiscountAmountPaise,
      saleDiscountAmountPaise: priced.saleDiscountAmountPaise,
      totalDiscountPercent: new Prisma.Decimal(priced.totalDiscountPercent),
      totalDiscountAmountPaise: priced.totalDiscountAmountPaise,
      finalPayableAmountPaise: priced.finalPayableAmountPaise,
      status: "AWAITING_ACCEPTANCE",
      acceptanceStatus: "AWAITING",
      ...(rsmReview ? {
        rsmApprovalStatus: "ACCEPTED" as const,
        rsmReviewedByUserId: rsmReview.rsmReviewedByUserId,
        rsmReviewedByName: rsmReview.rsmReviewedByName,
        rsmReviewedAt: rsmReview.rsmReviewedAt ?? new Date(),
        rsmNote: rsmReview.rsmNote,
      } : {}),
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
        saleDiscountPercent: new Prisma.Decimal(item.saleDiscountPercent),
        isPriority: item.priority,
        remarks: item.remarks || null,
        productNote: item.productNote || null,
      })) },
    },
  });

  if (priced.customRequests.length) {
    await tx.customDiscountRequest.updateMany({ where: { id: { in: priced.customRequests.map((r) => r.id) } }, data: { orderId: order.id } });
  }

  // The order page reads product notes from order_product_notes, so the dealer's
  // note (and the automatic Today's Sale note) is filed there too. Nested creates
  // insert in order, so ascending ids line up with priced.items.
  if (priced.items.some((item) => item.productNote)) {
    const createdItems = await tx.orderItem.findMany({ where: { orderId: order.id }, orderBy: { id: "asc" }, select: { id: true } });
    await tx.orderProductNote.createMany({
      data: priced.items.flatMap((item, index) => item.productNote && createdItems[index]
        ? [{ orderId: order.id, orderItemId: createdItems[index].id, note: item.productNote.slice(0, 500), actorUserId: actor.userId, actorRole: actor.role as never }]
        : []),
    });
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
