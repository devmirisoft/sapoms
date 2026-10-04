import "server-only";

import { prisma } from "@/server/db/prisma";
import { createDealerOrder, OrderError, priceDealerOrder, type CreateOrderActor, type OrderFormFields } from "@/lib/dealerOrderCreate";
import { getDealerCreditStatus } from "@/lib/dealerCreditLimit";
import { buildDraftApprovalState, buildOrderApprovalSnapshot, requiresNsmReview, stackDiscountOnNet } from "@/lib/customDiscountRequests";
import { buildCustomDiscountCreate, dealerExists, draftSnapshot, jsonValue } from "@/lib/postgresDiscountDrafts";
import { findCatalogueItem, linePricing } from "@/server/modules/products/catalogue";
import type { DraftSummary } from "./types";

export const DRAFT_TTL_MS = 15 * 60_000;
// A confirm whose function died mid-way may be retried after this; the order's
// idempotency key and the single transaction make the retry safe.
const STUCK_CONFIRM_MS = 120_000;

export type DraftItem = { productId: string; packs: number };
export type CustomDiscountAsk = { percent?: number; amount?: number };
type Fail = { ok: false; error: string; message: string };

const rupees = (paise: bigint) => Number(paise) / 100;
const toPaise = (value: number) => BigInt(Math.round(value * 100));
const round2 = (value: number) => Math.round(value * 100) / 100;
const fail = (error: string, message: string): Fail => ({ ok: false, error, message });
const formatRupees = (value: number) => `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function mergeItems(items: DraftItem[]) {
  const packs = new Map<string, number>();
  for (const item of items) packs.set(item.productId, (packs.get(item.productId) ?? 0) + item.packs);
  return [...packs].map(([productId, total]) => ({ productId, packs: total }));
}

/**
 * Prices a draft exactly as placing it would: catalogue prices and every discount via
 * priceDealerOrder, plus the credit / wallet gates the order form applies. Nothing
 * here comes from the model except catalogue numbers, pack counts and the discount ask.
 */
async function priceDraft(dealerId: bigint, rawItems: DraftItem[], ask: CustomDiscountAsk | null, notes: string | null) {
  const items = mergeItems(rawItems);
  const problems: string[] = [];
  for (const item of items) {
    const entry = await findCatalogueItem(item.productId);
    if (!entry?.variant) problems.push(`${item.productId} is not in the catalogue`);
    else if (entry.variant.inStock === false) problems.push(`${item.productId} is out of stock`);
    else if (!linePricing(entry.product, entry.variant)) problems.push(`${item.productId} has no catalogue price`);
  }
  if (problems.length) return fail("INVALID_ITEMS", `${problems.join("; ")}. Use search_products to find valid productIds.`);

  const dealer = await prisma.dealerProfile.findUnique({ where: { id: dealerId }, include: { wallet: true, user: { select: { status: true } } } });
  if (!dealer || dealer.deletedAt || dealer.user.status !== "ACTIVE") return fail("ACCOUNT_INACTIVE", "This dealer account is inactive.");

  const fields: OrderFormFields = {
    productorder: JSON.stringify(items.map((item) => ({ catNo: item.productId, quantityPacks: item.packs }))),
    ...(notes ? { note: notes } : {}),
  };
  let priced: Awaited<ReturnType<typeof priceDealerOrder>>;
  try {
    priced = await priceDealerOrder(prisma, fields, dealer);
  } catch (error) {
    if (error instanceof OrderError) return fail(error.code.toUpperCase(), error.message);
    throw error;
  }

  const lines = priced.items.map((item) => ({
    productId: item.catNo,
    name: item.productName,
    packs: item.quantityPacks,
    packSize: item.packSize,
    packPrice: round2(rupees(item.listPriceTotalPaise) / item.quantityPacks),
    lineTotal: rupees(item.listPriceTotalPaise),
  }));
  const warnings: string[] = [];
  let payablePaise = priced.finalPayableAmountPaise;
  let customDiscount: DraftSummary["customDiscount"];
  let requestedTotalPercent: number | null = null;

  if (ask) {
    // Asked the way the order form asks it: a % off the net after the dealer's own
    // discount (or rupees, converted to that %), stored as a total % of gross.
    const postBase = rupees(priced.postBaseAmountPaise);
    const onNet = ask.percent ?? (postBase > 0 ? (ask.amount ?? 0) / postBase * 100 : 0);
    if (!(onNet > 0 && onNet < 100)) return fail("INVALID_DISCOUNT", "The requested discount must be more than 0 and less than the order value.");
    requestedTotalPercent = round2(stackDiscountOnNet(priced.baseDiscountPercent, onNet));
    if (requestedTotalPercent <= priced.baseDiscountPercent) return fail("DISCOUNT_TOO_SMALL", "That discount is too small to request on this order.");
    const snapshot = buildOrderApprovalSnapshot({
      products: lines.map((line) => ({ sku: line.productId, catalogueNumber: line.productId, productName: line.name, quantity: line.packs, packSize: line.packSize, grossAmount: line.lineTotal })),
      orderNote: notes ?? "",
      baseDiscountPercent: priced.baseDiscountPercent,
      requestedOrderDiscountPercent: requestedTotalPercent,
      requestedProductDiscounts: {},
    });
    payablePaise = toPaise(snapshot.requestedNetPayableAmount);
    customDiscount = {
      asked: ask.percent !== undefined ? `${ask.percent}% off after your discount` : `${formatRupees(ask.amount ?? 0)} off`,
      totalPercent: requestedTotalPercent,
      extraDiscount: snapshot.requestedAdditionalDiscountAmount,
      totalIfApproved: snapshot.requestedNetPayableAmount,
      approvers: requiresNsmReview(priced.baseDiscountPercent, [requestedTotalPercent]) ? "RSM, NSM and Admin" : "RSM and Admin",
    };
    if (priced.slabDiscountPercent > 0) {
      warnings.push(`A custom discount replaces the ${priced.slabDiscountPercent}% volume discount (${formatRupees(rupees(priced.slabDiscountAmountPaise))}) this order would otherwise get.`);
    }
  }

  if (dealer.creditDays !== null) {
    const credit = await getDealerCreditStatus(prisma, dealer);
    if (credit?.isOverdue) return fail("CREDIT_OVERDUE", "A previous bill is overdue. New orders are blocked until it is paid.");
    if (credit?.remainingPaise != null && credit.remainingPaise < payablePaise) {
      return fail("CREDIT_LIMIT_EXCEEDED", `Available credit is ${formatRupees(rupees(credit.remainingPaise))}; this order needs ${formatRupees(rupees(payablePaise))}.`);
    }
  } else if (dealer.wallet?.status === "ACTIVE") {
    const available = dealer.wallet.balancePaise - dealer.wallet.reservedPaise;
    if (available < payablePaise) {
      return fail("INSUFFICIENT_BALANCE", `Wallet balance available is ${formatRupees(rupees(available))}; this order needs ${formatRupees(rupees(payablePaise))}. Use Request Funds on the order form.`);
    }
  }

  const summary: Omit<DraftSummary, "draftId" | "expiresAt"> = {
    items: lines,
    subtotal: rupees(priced.grossAmountPaise),
    discountPercent: priced.baseDiscountPercent,
    discount: rupees(priced.baseDiscountAmountPaise),
    slabDiscountPercent: priced.slabDiscountPercent,
    slabDiscount: rupees(priced.slabDiscountAmountPaise),
    total: rupees(priced.finalPayableAmountPaise),
    ...(customDiscount ? { customDiscount } : {}),
    warnings,
  };
  return { ok: true as const, summary, payablePaise, fields, requestedTotalPercent };
}

export async function createDraft(dealerId: bigint, items: DraftItem[], ask: CustomDiscountAsk | null, notes: string | null): Promise<DraftSummary | Fail> {
  const priced = await priceDraft(dealerId, items, ask, notes);
  if (!priced.ok) return priced;
  const expiresAt = new Date(Date.now() + DRAFT_TTL_MS);
  const draft = await prisma.agentDraft.create({
    data: {
      dealerId,
      items: jsonValue(mergeItems(items)),
      notes,
      customDiscount: ask ? jsonValue(ask) : undefined,
      summary: jsonValue(priced.summary),
      payablePaise: priced.payablePaise,
      expiresAt,
    },
  });
  return { draftId: draft.id, expiresAt: expiresAt.toISOString(), ...priced.summary };
}

type ConfirmResult = { status: number; body: Record<string, unknown> };

/** Why a draft could not be claimed; a draft that was already confirmed answers with its result again. */
async function explain(draftId: string, dealerId: bigint): Promise<ConfirmResult> {
  const draft = await prisma.agentDraft.findFirst({ where: { id: draftId, dealerId } });
  if (!draft) return { status: 404, body: { error: "DRAFT_NOT_FOUND", message: "This draft no longer exists." } };
  if (draft.status === "CONFIRMED") return { status: 200, body: await confirmedBody(draft.orderId, draft.customDiscountRequestId) };
  if (draft.status === "CANCELLED") return { status: 410, body: { error: "DRAFT_CANCELLED", message: "This draft was cancelled." } };
  if (draft.status === "CONFIRMING") return { status: 409, body: { error: "IN_PROGRESS", message: "This order is already being placed." } };
  return { status: 410, body: { error: "DRAFT_EXPIRED", message: "This draft has expired. Ask the assistant to prepare it again." } };
}

async function confirmedBody(orderId: bigint | null, requestId: bigint | null) {
  if (orderId) {
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { orderNumber: true } });
    return { status: "ORDER_PLACED", orderNumber: order?.orderNumber ?? orderId.toString() };
  }
  return { status: "DISCOUNT_REQUESTED", requestId: requestId?.toString() ?? "" };
}

/**
 * The only way an assistant draft becomes an order. Claims the draft atomically
 * (PENDING -> CONFIRMING), re-prices it, refuses if the payable changed, then places
 * the order (or raises the discount request) and marks the draft CONFIRMED in the
 * same transaction. Never called by the model.
 */
export async function confirmDraft(draftId: string, dealerId: bigint, actor: CreateOrderActor): Promise<ConfirmResult> {
  const now = Date.now();
  const claimed = await prisma.agentDraft.updateMany({
    where: {
      id: draftId,
      dealerId,
      OR: [
        { status: "PENDING", expiresAt: { gt: new Date(now) } },
        // A stuck confirm stays retryable after expiry: it may already have placed the order.
        { status: "CONFIRMING", updatedAt: { lt: new Date(now - STUCK_CONFIRM_MS) } },
      ],
    },
    data: { status: "CONFIRMING" },
  });
  if (claimed.count === 0) return explain(draftId, dealerId);

  const draft = await prisma.agentDraft.findUniqueOrThrow({ where: { id: draftId } });
  const release = (data: Record<string, unknown> = {}) => prisma.agentDraft.update({ where: { id: draftId }, data: { status: "PENDING", ...data } });

  try {
    const ask = draft.customDiscount as unknown as CustomDiscountAsk | null;
    const repriced = await priceDraft(dealerId, draft.items as unknown as DraftItem[], ask, draft.notes);
    if (!repriced.ok) {
      await release();
      return { status: 409, body: { error: repriced.error, message: repriced.message } };
    }
    if (repriced.payablePaise !== draft.payablePaise) {
      const summary = { draftId, expiresAt: draft.expiresAt.toISOString(), ...repriced.summary };
      await release({ summary: jsonValue(repriced.summary), payablePaise: repriced.payablePaise });
      return { status: 409, body: { error: "PRICE_CHANGED", message: "Prices changed since this draft was made. Check the new total and confirm again.", draft: summary } };
    }

    if (!ask) {
      const placed = await prisma.$transaction(async (tx) => {
        const created = await createDealerOrder(tx, repriced.fields, dealerId, actor, { idempotencyKey: `agent-draft:${draftId}` });
        await tx.agentDraft.update({ where: { id: draftId }, data: { status: "CONFIRMED", orderId: created.order.id } });
        return created.order;
      }, { timeout: 20_000 });
      return { status: 200, body: { status: "ORDER_PLACED", orderNumber: placed.orderNumber } };
    }

    // A discount ask goes through the existing approval chain: an order draft the dealer
    // can see on the Drafts page plus a custom-discount request, priced server-side by
    // buildCustomDiscountCreate. Admin approval then places the order automatically.
    const dealer = await dealerExists(dealerId);
    const totalPercent = repriced.requestedTotalPercent as number;
    const requestId = await prisma.$transaction(async (tx) => {
      const orderDraft = await tx.orderDraft.create({
        data: {
          dealerId,
          name: `Assistant order ${new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}`,
          snapshot: jsonValue(draftSnapshot({
            rows: repriced.summary.items.map((item, index) => ({
              key: index + 1,
              productname: item.productId,
              displayName: item.name,
              variantCode: item.productId,
              producQuanity: item.packs,
              packSize: item.packSize,
              price: round2(item.packPrice / item.packSize),
              baseListPrice: item.packPrice,
            })),
            order_note: draft.notes,
            source: "ordering_assistant",
          })),
        },
      });
      const data = await buildCustomDiscountCreate({
        orderDraftId: orderDraft.id.toString(),
        discountScope: "order",
        requestedDiscountPercent: totalPercent,
        products: repriced.summary.items.map((item, index) => ({ rowKey: index + 1, productKey: item.productId.toLowerCase(), sku: item.productId, productName: item.name, quantity: item.packs })),
        orderNote: draft.notes ?? "",
      }, dealerId, dealer.staffAssignments[0]?.staffId ?? null);
      const request = await tx.customDiscountRequest.create({ data });
      await tx.orderDraft.update({
        where: { id: orderDraft.id },
        data: { approvalState: jsonValue(buildDraftApprovalState({ approvalRequestId: request.id.toString(), status: "pending", requestedOrderDiscountPercent: totalPercent, requestedProductDiscounts: {}, updatedAt: new Date().toISOString() })) },
      });
      await tx.agentDraft.update({ where: { id: draftId }, data: { status: "CONFIRMED", customDiscountRequestId: request.id } });
      return request.id;
    }, { timeout: 20_000 });
    return { status: 200, body: { status: "DISCOUNT_REQUESTED", requestId: requestId.toString() } };
  } catch (error) {
    await release().catch(() => undefined);
    if (error instanceof OrderError) return { status: error.status, body: { error: error.code.toUpperCase(), message: error.message } };
    const status = Number((error as { status?: unknown })?.status);
    if (status >= 400 && status < 500) return { status, body: { error: "REQUEST_FAILED", message: (error as Error).message } };
    throw error;
  }
}

export async function cancelDraft(draftId: string, dealerId: bigint): Promise<ConfirmResult> {
  const cancelled = await prisma.agentDraft.updateMany({ where: { id: draftId, dealerId, status: "PENDING" }, data: { status: "CANCELLED" } });
  return cancelled.count ? { status: 200, body: { status: "CANCELLED" } } : explain(draftId, dealerId);
}
