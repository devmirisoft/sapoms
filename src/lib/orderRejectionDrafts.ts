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

/** What the wallet still holds for this order: its debits (placement and edits) less what was already refunded. */
export async function walletDebitRemaining(tx: Tx, orderId: bigint) {
  const rows = await tx.walletTransaction.findMany({
    where: { orderId, type: { in: [WalletTransactionType.ORDER_DEBIT, WalletTransactionType.REFUND] } },
    select: { type: true, amountPaise: true },
  });
  return rows.reduce((sum, row) => sum + (row.type === WalletTransactionType.ORDER_DEBIT ? row.amountPaise : -row.amountPaise), BigInt(0));
}

const REFUND_NOTE = { decline: "Refund for disapproved order", cancel: "Refund for cancelled order" } as const;

/**
 * Give back what the order took.
 *
 * A declined order is resubmitted as a new order, which debits the wallet again;
 * a cancelled one simply never ships. Either way its own debit must come back.
 * Only the unrefunded remainder is returned, so a declined order that is later
 * cancelled is not paid back twice. Idempotency-keyed, so a re-run cannot double-credit.
 */
export async function refundOrderWallet(tx: Tx, order: { id: bigint; dealerId: bigint; orderNumber: string }, reason: "decline" | "cancel") {
  const remaining = await walletDebitRemaining(tx, order.id);
  if (remaining <= BigInt(0)) return null;
  return applyWalletChange(tx, order.dealerId, WalletTransactionType.REFUND, Number(remaining) / 100, {
    orderId: order.id,
    idempotencyKey: `order:${order.id.toString()}:${reason}-refund`,
    reference: order.orderNumber,
    note: REFUND_NOTE[reason],
    metadata: { orderNumber: order.orderNumber, reason: reason === "decline" ? "order_declined" : "order_cancelled" },
  });
}

export { ORDER_REJECTION_SOURCE };
