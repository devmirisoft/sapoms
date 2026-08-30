import "server-only";

import { Prisma, WalletTransactionType } from "@prisma/client";
import { applyWalletChange } from "@/lib/postgresWallet";
import { buildOrderRejectionSnapshot, ORDER_REJECTION_SOURCE } from "@/lib/orderRejectionDraft.mjs";

type Tx = Prisma.TransactionClient;

type DeclinedOrder = {
  id: bigint;
  dealerId: bigint;
  orderNumber: string;
  shipTo: string | null;
  refNo: string | null;
  note: string | null;
  items: Array<Record<string, unknown>>;
};

function snapshotRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/**
 * Put a declined order back in the dealer's drafts.
 *
 * A resubmission that was declined again already has its own draft (it is the
 * draft that placed the order), so that one is refreshed with the new reason
 * instead of leaving the dealer with one draft per rejection round.
 */
export async function createOrderRejectionDraft(
  tx: Tx,
  order: DeclinedOrder,
  rejectedBy: { role: string; name: string },
  note: string,
) {
  const existing = await tx.orderDraft.findFirst({ where: { orderId: order.id, dealerId: order.dealerId } });
  const snapshot = buildOrderRejectionSnapshot({
    order,
    items: order.items,
    rejectedBy,
    note,
    previousSnapshot: snapshotRecord(existing?.snapshot),
  });
  const approvalState = jsonValue({ status: "rejected", orderId: order.id.toString(), orderNumber: order.orderNumber, updatedAt: new Date().toISOString() });
  const name = `Rejected Order: ${order.orderNumber}`;

  if (existing) {
    return tx.orderDraft.update({
      where: { id: existing.id },
      data: { name, status: "ACTIVE", snapshot: jsonValue(snapshot), approvalState },
    });
  }
  return tx.orderDraft.create({
    data: { dealerId: order.dealerId, name, snapshot: jsonValue(snapshot), approvalState },
  });
}

/**
 * Give back what the order took.
 *
 * The dealer resubmits a rejected order as a new order, which debits the wallet
 * again, so the declined order must release its own debit or the same cart is
 * paid for twice. Idempotency-keyed, so a re-run cannot double-credit.
 */
export async function refundDeclinedOrderWallet(tx: Tx, order: { id: bigint; dealerId: bigint; orderNumber: string }) {
  const debit = await tx.walletTransaction.findFirst({ where: { orderId: order.id, type: WalletTransactionType.ORDER_DEBIT } });
  if (!debit || debit.amountPaise <= BigInt(0)) return null;
  return applyWalletChange(tx, order.dealerId, WalletTransactionType.REFUND, Number(debit.amountPaise) / 100, {
    orderId: order.id,
    idempotencyKey: `order:${order.id.toString()}:decline-refund`,
    reference: order.orderNumber,
    note: "Refund for disapproved order",
    metadata: { orderNumber: order.orderNumber, reason: "order_declined" },
  });
}

export { ORDER_REJECTION_SOURCE };
