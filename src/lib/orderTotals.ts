import type { OrderDiscountType } from "@prisma/client";
import { normalizeApprovalProductKey } from "@/lib/customDiscountRequests";
import discountUtils from "@/lib/discount";

/** One priced order line, in paise. Discount fields are filled in by orderTotals. */
export type PricedLine = {
  catNo: string;
  listPriceTotalPaise: bigint;
  saleSavedPaise: bigint;
  discountPercent: number;
  discountAmountPaise: bigint;
  finalAmountPaise: bigint;
};

/** The parts of an approved custom-discount request that set the order's discount. */
export type ApprovedCustomDiscount = {
  scope: string;
  requestedDiscountAmountPaise: bigint | null;
  requestedOrderDiscountPercent: unknown;
  requestedDiscountPercent: unknown;
  requestedProductDiscounts: unknown;
};

function num(value: unknown) { const n = Number(String(value ?? "").replace(/,/g, "").trim()); return Number.isFinite(n) ? n : 0; }
function clampPercent(value: unknown) { return Math.min(100, Math.max(0, num(value))); }

/** A percent share of a paise amount, rounded to the paisa. */
export function share(amountPaise: bigint, percent: number) { return BigInt(Math.round(Number(amountPaise) * percent / 100)); }

/**
 * What an order costs, from its priced lines: the one calculation behind a new order
 * (priceDealerOrder) and an edited one (applyOrderEdit). Every percent comes from the
 * server - the base percent the caller decided, then approved custom requests from the
 * DB or the slab table. Sets each line's discount and final amount in place.
 */
export function orderTotals<T extends PricedLine>(items: T[], basePercent: number, customRequests: ApprovedCustomDiscount[]) {
  const baseDiscountPercent = clampPercent(basePercent);
  const grossAmountPaise = items.reduce((sum, item) => sum + item.listPriceTotalPaise, BigInt(0));
  const baseDiscountAmountPaise = share(grossAmountPaise, baseDiscountPercent);
  const postBaseAmountPaise = grossAmountPaise - baseDiscountAmountPaise;

  const customDiscountAmountPaise = customRequests.reduce((sum, request) => sum + (request.requestedDiscountAmountPaise ?? BigInt(0)), BigInt(0));
  const slabDiscountPercent = customRequests.length ? 0 : discountUtils.getSlabPercent(Number(postBaseAmountPaise) / 100);
  const slabDiscountAmountPaise = share(postBaseAmountPaise, slabDiscountPercent);
  const additionalDiscountType: OrderDiscountType = customRequests.length ? "CUSTOM" : slabDiscountPercent > 0 ? "SLAB" : "NONE";
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
    grossAmountPaise, baseDiscountPercent, baseDiscountAmountPaise, postBaseAmountPaise,
    saleDiscountAmountPaise,
    additionalDiscountType, slabDiscountPercent, slabDiscountAmountPaise,
    customDiscountAmountPaise, additionalDiscountAmountPaise,
    totalDiscountAmountPaise, totalDiscountPercent, finalPayableAmountPaise,
  };
}
