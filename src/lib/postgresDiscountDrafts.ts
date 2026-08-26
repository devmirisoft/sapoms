import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { AuthActor } from "@/server/auth/session";
import {
  buildOrderApprovalSnapshot,
  buildDraftApprovalState,
  normalizeCustomDiscountScope,
  type CustomDiscountStatus,
} from "@/lib/customDiscountRequests";

export function text(value: unknown, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

export function num(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : fallback;
}

export function percent(value: unknown, fallback = 0) {
  return Math.min(100, Math.max(0, Math.round(num(value, fallback) * 100) / 100));
}

export function paise(value: unknown) {
  return BigInt(Math.round(num(value) * 100));
}

export function rupees(value: bigint | null | undefined) {
  return Number(value ?? BigInt(0)) / 100;
}

export function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export function assertDealerScope(actor: AuthActor | null, dealerId: bigint) {
  if (!actor) return;
  if (actor.role === "ADMIN" || actor.role === "ACCOUNTANT") return;
  if (actor.role === "DEALER" && actor.dealerId === dealerId) return;
  throw Object.assign(new Error("Forbidden"), { status: 403 });
}

export async function dealerExists(dealerId: bigint) {
  const dealer = await prisma.dealerProfile.findUnique({ where: { id: dealerId }, include: { staffAssignments: { where: { active: true }, take: 1 }, user: true } });
  if (!dealer || dealer.deletedAt || dealer.user.status !== "ACTIVE") throw Object.assign(new Error("Dealer not found"), { status: 404 });
  return dealer;
}

export async function assertDraftBelongsToDealer(orderDraftId: bigint, dealerId: bigint) {
  const draft = await prisma.orderDraft.findFirst({ where: { id: orderDraftId, dealerId } });
  if (!draft) throw Object.assign(new Error("Draft not found"), { status: 404 });
  return draft;
}

export async function assertOrderBelongsToDealer(orderId: bigint, dealerId: bigint) {
  const order = await prisma.order.findFirst({ where: { id: orderId, dealerId } });
  if (!order) throw Object.assign(new Error("Order not found"), { status: 404 });
  return order;
}

export function mapDraft(row: any) {
  const snap = (row.snapshot && typeof row.snapshot === "object" ? row.snapshot : {}) as Record<string, any>;
  return {
    id: row.id.toString(),
    dealer_id: row.dealerId.toString(),
    dealerId: row.dealerId.toString(),
    orderId: row.orderId?.toString?.() ?? "",
    convertedOrderId: row.orderId?.toString?.() ?? "",
    status: row.status,
    name: row.name,
    rows: Array.isArray(snap.rows) ? snap.rows : [],
    shipto: snap.shipto ?? null,
    refno: snap.refno ?? null,
    order_note: snap.order_note ?? null,
    coupon_code: snap.coupon_code ?? null,
    coupon_pct: snap.coupon_pct ?? null,
    approval_state: row.approvalState ?? null,
    source: snap.source ?? undefined,
    source_request_id: snap.source_request_id ?? undefined,
    rejection_notes: snap.rejection_notes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function draftSnapshot(input: Record<string, unknown>) {
  return {
    rows: Array.isArray(input.rows) ? input.rows : [],
    shipto: input.shipto ?? null,
    refno: input.refno ?? null,
    order_note: input.order_note ?? null,
    coupon_code: input.coupon_code ?? null,
    coupon_pct: input.coupon_pct ?? null,
    source: input.source ?? null,
    source_request_id: input.source_request_id ?? null,
    // Carried through dealer edits so the reviewer's reason survives until the
    // draft is resubmitted, rather than being dropped on the first save.
    rejection_notes: input.rejection_notes ?? null,
  };
}

export function mapCustomDiscount(row: any) {
  const snap = (row.orderSnapshot && typeof row.orderSnapshot === "object" ? row.orderSnapshot : {}) as Record<string, any>;
  const products = Array.isArray(snap.products) ? snap.products : [];
  const requestedDiscountPercent = Number(row.requestedDiscountPercent ?? 0);
  const currentDiscountPercent = Number(row.currentDiscountPercent ?? 0);
  const requestedDiscountAmount = rupees(row.requestedDiscountAmountPaise);
  const grossAmount = rupees(row.grossAmountPaise);
  const requestedNet = rupees(row.requestedNetPayableAmountPaise);
  const status = String(row.status || "PENDING").toLowerCase();
  const orderId = row.orderId?.toString?.() ?? "";
  const draftId = row.orderDraftId?.toString?.() ?? "";
  return {
    id: row.id.toString(),
    dealerId: row.dealerId.toString(),
    dealer_id: row.dealerId.toString(),
    staffId: row.staffId?.toString?.() ?? "",
    assignedStaffId: row.staffId?.toString?.() ?? "",
    staffName: row.staff?.displayName ?? "",
    staff_name: row.staff?.displayName ?? "",
    staffRoleType: row.staff?.staffRoleType ?? "",
    dealerName: row.dealer?.businessName ?? "",
    dealerCode: row.dealer?.dealerCode ?? "",
    orderId,
    order_id: orderId,
    orderNumber: row.order?.orderNumber ?? "",
    order_number: row.order?.orderNumber ?? "",
    orderDraftId: draftId,
    order_draft_id: draftId,
    status,
    rsmApprovalStatus: String(row.rsmApprovalStatus || "PENDING").toLowerCase(),
    rsm_approval_status: String(row.rsmApprovalStatus || "PENDING").toLowerCase(),
    rsmReviewedBy: row.rsmReviewedByName ?? "",
    rsm_reviewed_by: row.rsmReviewedByName ?? "",
    rsmReviewedAt: row.rsmReviewedAt?.toISOString?.() ?? null,
    rsm_reviewed_at: row.rsmReviewedAt?.toISOString?.() ?? null,
    rsmNote: row.rsmNote ?? "",
    rsm_note: row.rsmNote ?? "",
    requestedDiscountPercent,
    currentDiscountPercent,
    requestedOrderDiscountPercent: row.requestedOrderDiscountPercent === null ? null : Number(row.requestedOrderDiscountPercent),
    requestedProductDiscounts: row.requestedProductDiscounts ?? {},
    subtotal: grossAmount,
    currentDiscountAmount: Math.max(0, grossAmount - rupees(row.requestedDiscountAmountPaise) - requestedNet),
    requestedDiscountAmount,
    currentFinalPayable: Math.max(0, grossAmount - requestedDiscountAmount),
    requestedFinalPayable: requestedNet,
    discountScope: String(row.scope || "ORDER").toLowerCase(),
    targetProduct: row.targetProductKey ? { productKey: row.targetProductKey } : null,
    targetProductKey: row.targetProductKey ?? "",
    shipto: (snap as any).shipto ?? "",
    refno: (snap as any).refno ?? "",
    orderNote: snap.orderNote ?? "",
    orderSignature: row.orderSignature ?? "",
    discountBreakdown: (snap as any).discountBreakdown ?? {},
    orderSnapshot: snap,
    products,
    draftProducts: products,
    allowReorder: !!row.allowReorder,
    reorderCount: row.reorderLogs?.length ?? row.reorderCount ?? 0,
    lastReorderedAt: row.reorderLogs?.[0]?.createdAt?.toISOString?.() ?? null,
    lastReorderedOrderId: row.reorderLogs?.[0]?.orderId?.toString?.() ?? "",
    adminNote: row.adminNote ?? "",
    reviewedBy: row.reviewedByUserId?.toString?.() ?? "",
    reviewedAt: row.reviewedAt?.toISOString?.() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rejectionDraftId: "",
  };
}

export const customDiscountInclude = {
  dealer: { select: { id: true, businessName: true, dealerCode: true } },
  // Lets an RSM see which of their team raised the request.
  staff: { select: { id: true, displayName: true, staffRoleType: true } },
  order: { select: { id: true, orderNumber: true } },
  reorderLogs: { orderBy: { createdAt: "desc" as const }, take: 1 },
};

export async function buildCustomDiscountCreate(body: Record<string, any>, dealerId: bigint, staffId?: bigint | null) {
  const requestedDiscountPercent = percent(body.requestedDiscountPercent);
  const currentDiscountPercent = percent(body.currentDiscountPercent);
  const scope = normalizeCustomDiscountScope(body.discountScope);
  const requestedOrderDiscountPercent = scope === "order" ? requestedDiscountPercent : null;
  const requestedProductDiscounts = body.requestedProductDiscounts && typeof body.requestedProductDiscounts === "object" ? body.requestedProductDiscounts : {};
  const orderSnapshot = buildOrderApprovalSnapshot({
    products: Array.isArray(body.orderSnapshot?.products) ? body.orderSnapshot.products : Array.isArray(body.products) ? body.products : [],
    orderNote: body.orderSnapshot?.orderNote ?? body.orderNote,
    baseDiscountPercent: currentDiscountPercent,
    requestedOrderDiscountPercent,
    requestedProductDiscounts,
  });
  if (orderSnapshot.products.length === 0) throw Object.assign(new Error("At least one order product is required"), { status: 400 });
  if (scope === "order" && requestedDiscountPercent <= currentDiscountPercent) throw Object.assign(new Error("Requested discount must be greater than current discount"), { status: 400 });
  if (scope === "product" && !orderSnapshot.products.some((product) => product.usesCustomDiscount)) {
    throw Object.assign(new Error("At least one product discount must be greater than current discount"), { status: 400 });
  }
  const draftId = text(body.orderDraftId || body.order_draft_id, 120);
  if (!draftId) throw Object.assign(new Error("orderDraftId is required"), { status: 400 });
  const orderDraftId = BigInt(draftId);
  return {
    dealerId,
    staffId,
    orderDraftId,
    scope: scope === "product" ? "PRODUCT" as const : "ORDER" as const,
    status: "PENDING" as const,
    requestedDiscountPercent: new Prisma.Decimal(requestedDiscountPercent),
    currentDiscountPercent: new Prisma.Decimal(currentDiscountPercent),
    requestedOrderDiscountPercent: requestedOrderDiscountPercent === null ? null : new Prisma.Decimal(requestedOrderDiscountPercent),
    requestedProductDiscounts: jsonValue(requestedProductDiscounts),
    targetProductKey: text(body.targetProduct?.productKey || body.targetProduct?.variantCode || body.targetProductKey, 160) || null,
    grossAmountPaise: paise(orderSnapshot.grossAmount),
    requestedDiscountAmountPaise: paise(orderSnapshot.requestedAdditionalDiscountAmount),
    requestedNetPayableAmountPaise: paise(orderSnapshot.requestedNetPayableAmount),
    orderSignature: text(body.orderSignature, 400) || null,
    orderSnapshot: jsonValue({ ...orderSnapshot, shipto: body.shipto ?? "", refno: body.refno ?? "", discountBreakdown: body.discountBreakdown ?? {} }),
  };
}

export async function updateDraftApprovalState(draftId: bigint | null | undefined, dealerId: bigint, params: {
  approvalRequestId: string;
  status: CustomDiscountStatus;
  requestedOrderDiscountPercent?: number | null;
  requestedProductDiscounts?: Record<string, number>;
}) {
  if (!draftId) return;
  await prisma.orderDraft.updateMany({
    where: { id: draftId, dealerId },
    data: {
      approvalState: jsonValue(buildDraftApprovalState({ ...params, updatedAt: new Date().toISOString() })),
    },
  });
}
