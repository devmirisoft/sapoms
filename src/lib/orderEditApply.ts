import "server-only";

import { Prisma, WalletTransactionType } from "@prisma/client";
import { reserveDealerCredit } from "@/lib/dealerCreditLimit";
import { OrderError, parseItems, type ParsedItem } from "@/lib/dealerOrderCreate";
import { OrderOverlayError, type OrderEditRevision } from "@/lib/orderOverlays";
import { walletDebitRemaining } from "@/lib/orderRejectionDrafts";
import { orderTotals } from "@/lib/orderTotals";
import { applyWalletChange, WalletError } from "@/lib/postgresWallet";
import { loadCatalogue } from "@/server/modules/products/catalogue";
import { liveSalePercents } from "@/server/todays-sale";

const text = (value: unknown) => String(value ?? "").trim();
const sameSku = (a: unknown, b: unknown) => text(a).toLowerCase() === text(b).toLowerCase();
const rupees = (paise: bigint) => Number(paise) / 100;
const ZERO = BigInt(0);

type EditLine = {
  lineId: string;
  dbId: bigint;
  swapped: boolean;
  catNo: string;
  productName: string;
  quantityPacks: number;
  packSize: number;
  priceBasis: string | null;
  unitPricePaise: bigint;
  packPricePaise: bigint;
  listPriceTotalPaise: bigint;
  saleDiscountPercent: number;
  saleSavedPaise: bigint;
  discountPercent: number;
  discountAmountPaise: bigint;
  finalAmountPaise: bigint;
};

/** Rounded paise ÷ count, for lines stored before the pack price was kept (orders before 10-17, legacy lines). */
function perPack(totalPaise: bigint, packs: number) {
  return packs > 0 ? (totalPaise * BigInt(2) / BigInt(packs) + BigInt(1)) / BigInt(2) : ZERO;
}

/** A swapped catalogue number is priced exactly like a line of a new order (catalogue + Today's Sale). */
function priceSwappedLine(catNo: string, quantityPacks: number, index: Parameters<typeof parseItems>[1], sales: Map<string, number>): ParsedItem {
  try {
    return parseItems([{ catNo, quantityPacks }], index, sales)[0];
  } catch (error) {
    if (error instanceof OrderError) throw new OrderOverlayError(error.status, error.code, error.message);
    throw error;
  }
}

/**
 * Apply a dealer's edit to the order itself: reprice it on the server, move the
 * credit or wallet money the change needs, and rewrite the order and its lines, so
 * credit, wallet and the discount breakdown all follow the edit. Kept lines keep the
 * price they were ordered at; a swapped catalogue number is priced like a new order.
 * Runs inside the caller's transaction and returns the revision stamped with the
 * server's figures for the overlay.
 */
export async function applyOrderEdit(tx: Prisma.TransactionClient, orderId: bigint, revision: OrderEditRevision) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { orderBy: { id: "asc" } }, dealer: { select: { creditDays: true } } },
  });
  if (await tx.customDiscountRequest.count({ where: { orderId, status: "APPROVED" } })) {
    throw new OrderOverlayError(409, "custom_discount_order", "This order has an approved custom discount; cancel and re-order, or request a new discount.");
  }

  const dbLines = new Map(order.items.map((item) => [item.legacyPhpOrderItemId || item.id.toString(), item]));
  let swapContext: { index: Parameters<typeof parseItems>[1]; sales: Map<string, number> } | null = null;
  const lines: EditLine[] = [];
  for (const effective of revision.effectiveItems) {
    const lineId = text(effective.orderdata_id);
    const db = dbLines.get(lineId);
    if (!db) throw new OrderOverlayError(409, "stale_revision", "This order was changed elsewhere. Reload and try again.");
    const quantityPacks = Math.trunc(Number(effective.quantityPacks ?? effective.orderdata_item_quantity));
    if (!(quantityPacks > 0)) throw new OrderOverlayError(422, "invalid_quantity", "Item quantity must be greater than zero.");
    const catNo = text(effective.orderdata_cat_no) || db.catalogueNumberSnapshot;

    if (sameSku(catNo, db.catalogueNumberSnapshot)) {
      const packPricePaise = db.packPricePaise > ZERO ? db.packPricePaise : perPack(db.listPriceTotalPaise, db.quantityPacks);
      const salePercent = Number(db.saleDiscountPercent);
      // Record only: what Today's Sale took off, rebuilt from the stored sale price.
      const savedPerPack = salePercent > 0 && salePercent < 100 ? BigInt(Math.round(Number(packPricePaise) * salePercent / (100 - salePercent))) : ZERO;
      lines.push({
        lineId, dbId: db.id, swapped: false, catNo: db.catalogueNumberSnapshot, productName: db.productNameSnapshot,
        quantityPacks, packSize: db.packSize, priceBasis: db.priceBasis, unitPricePaise: db.unitPricePaise, packPricePaise,
        listPriceTotalPaise: packPricePaise * BigInt(quantityPacks), saleDiscountPercent: salePercent, saleSavedPaise: savedPerPack * BigInt(quantityPacks),
        discountPercent: 0, discountAmountPaise: ZERO, finalAmountPaise: ZERO,
      });
      continue;
    }

    swapContext ??= { index: (await loadCatalogue()).index, sales: await liveSalePercents(tx) };
    const priced = priceSwappedLine(catNo, quantityPacks, swapContext.index, swapContext.sales);
    lines.push({
      lineId, dbId: db.id, swapped: true, catNo: priced.catNo, productName: priced.productName,
      quantityPacks, packSize: priced.packSize, priceBasis: priced.priceBasis, unitPricePaise: priced.unitPricePaise, packPricePaise: priced.packPricePaise,
      listPriceTotalPaise: priced.listPriceTotalPaise, saleDiscountPercent: priced.saleDiscountPercent, saleSavedPaise: priced.saleSavedPaise,
      discountPercent: 0, discountAmountPaise: ZERO, finalAmountPaise: ZERO,
    });
  }

  // The base percent agreed when the order was placed (coupon included); the slab is re-read for the new total.
  const totals = orderTotals(lines, Number(order.baseDiscountPercent), []);
  const delta = totals.finalPayableAmountPaise - order.finalPayableAmountPaise;

  // Money first, while the order row still holds the old total that used credit is counted from.
  if (delta !== ZERO && order.dealer.creditDays !== null) {
    if (delta > ZERO) {
      const block = await reserveDealerCredit(tx, order.dealerId, delta);
      if (block) throw new OrderOverlayError(409, block.code, block.message);
    }
  } else if (delta !== ZERO && await walletDebitRemaining(tx, order.id) > ZERO) {
    try {
      await applyWalletChange(tx, order.dealerId, delta > ZERO ? WalletTransactionType.ORDER_DEBIT : WalletTransactionType.REFUND, rupees(delta > ZERO ? delta : -delta), {
        orderId: order.id,
        idempotencyKey: `order:${order.id.toString()}:edit-r${revision.revision}`,
        reference: order.orderNumber,
        note: delta > ZERO ? "Order edit: additional amount" : "Order edit: refund of the difference",
        metadata: { orderNumber: order.orderNumber, revision: revision.revision, reason: "order_edited" },
      });
    } catch (error) {
      if (error instanceof WalletError) throw new OrderOverlayError(error.status, error.code, error.message);
      throw error;
    }
  }

  await tx.order.update({
    where: { id: order.id },
    data: {
      grossAmountPaise: totals.grossAmountPaise,
      baseDiscountAmountPaise: totals.baseDiscountAmountPaise,
      postBaseAmountPaise: totals.postBaseAmountPaise,
      additionalDiscountType: totals.additionalDiscountType,
      additionalDiscountAmountPaise: totals.additionalDiscountAmountPaise,
      slabDiscountPercent: new Prisma.Decimal(totals.slabDiscountPercent),
      slabDiscountAmountPaise: totals.slabDiscountAmountPaise,
      saleDiscountAmountPaise: totals.saleDiscountAmountPaise,
      totalDiscountPercent: new Prisma.Decimal(totals.totalDiscountPercent),
      totalDiscountAmountPaise: totals.totalDiscountAmountPaise,
      finalPayableAmountPaise: totals.finalPayableAmountPaise,
    },
  });
  for (const line of lines) {
    await tx.orderItem.update({
      where: { id: line.dbId },
      data: {
        quantityPacks: line.quantityPacks,
        packSize: line.packSize,
        totalPieces: line.quantityPacks * line.packSize,
        priceBasis: line.priceBasis,
        unitPricePaise: line.unitPricePaise,
        packPricePaise: line.packPricePaise,
        listPriceTotalPaise: line.listPriceTotalPaise,
        discountPercent: new Prisma.Decimal(line.discountPercent),
        discountAmountPaise: line.discountAmountPaise,
        finalAmountPaise: line.finalAmountPaise,
        saleDiscountPercent: new Prisma.Decimal(line.saleDiscountPercent),
        ...(line.swapped ? { catalogueNumberSnapshot: line.catNo, skuSnapshot: line.catNo, productNameSnapshot: line.productName, productId: null, productVariantId: null } : {}),
      },
    });
  }
  const kept = new Set(lines.map((line) => line.dbId));
  const removed = order.items.filter((item) => !kept.has(item.id)).map((item) => item.id);
  if (removed.length) await tx.orderItem.deleteMany({ where: { id: { in: removed }, orderId: order.id } });

  const byLine = new Map(lines.map((line) => [line.lineId, line]));
  const stamped: OrderEditRevision = {
    ...revision,
    effectiveItems: revision.effectiveItems.map((item) => {
      const line = byLine.get(text(item.orderdata_id))!;
      const pieces = line.quantityPacks * line.packSize;
      return {
        ...item,
        orderdata_cat_no: line.catNo, product_name: line.productName, productName: line.productName,
        packSize: line.packSize, pack_size: line.packSize, totalPieces: pieces, total_pieces: pieces, pieces,
        orderdata_price: rupees(line.unitPricePaise), unitPrice: rupees(line.unitPricePaise), packPrice: rupees(line.packPricePaise),
        listPriceTotal: rupees(line.listPriceTotalPaise), list_price_total: rupees(line.listPriceTotalPaise),
        order_amount: rupees(line.listPriceTotalPaise), grossAmount: rupees(line.listPriceTotalPaise),
        discountPercent: line.discountPercent,
        orderdata_discount: rupees(line.discountAmountPaise), discountAmount: rupees(line.discountAmountPaise),
        orderdata_afterDisPrice: rupees(line.finalAmountPaise), finalAmount: rupees(line.finalAmountPaise),
      };
    }),
    totals: {
      grossAmount: rupees(totals.grossAmountPaise),
      discountAmount: rupees(totals.totalDiscountAmountPaise),
      netPayableAmount: rupees(totals.finalPayableAmountPaise),
    },
  };
  return { revision: stamped, totals, delta };
}
