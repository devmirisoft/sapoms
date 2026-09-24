import type { Prisma } from "@prisma/client";

/**
 * Credit-limit and credit-day enforcement for dealers who buy on credit terms
 * (dealer.creditDays is set) rather than through a prepaid wallet.
 *
 * The limit never frees up when an order is billed or paid - it only tracks
 * how much the dealer has ever ordered against dealer.creditLimitPaise. On top
 * of it sits a temporary pot (tempCreditLimitPaise) that orders draw down once
 * the base headroom is gone; when it hits zero the dealer is back on the base
 * limit. The overdue check blocks ordering while any ledger bill is past
 * billDate + creditDays + bill.extraCreditDays without being paid in full.
 */

type CreditClient = Pick<Prisma.TransactionClient, "order" | "ledgerBill">;

export type CreditDealer = {
  id: bigint;
  creditDays: number | null;
  creditLimitPaise: bigint | null;
  tempCreditLimitPaise: bigint;
  tempCreditConsumedPaise: bigint;
};

export type DealerCreditStatus = {
  usedPaise: bigint;
  creditLimitPaise: bigint | null;
  tempCreditLimitPaise: bigint;
  baseHeadroomPaise: bigint | null;
  remainingPaise: bigint | null;
  isOverdue: boolean;
  overdueSince: Date | null;
};

const DAY_MS = 86_400_000;

export function billDueDate(billDate: Date, creditDays: number, extraCreditDays: number) {
  return new Date(billDate.getTime() + (creditDays + extraCreditDays) * DAY_MS);
}

/** Returns null for dealers not on credit terms (dealer.creditDays is unset). */
export async function getDealerCreditStatus(client: CreditClient, dealer: CreditDealer): Promise<DealerCreditStatus | null> {
  if (dealer.creditDays === null) return null;

  const [orders, bills] = await Promise.all([
    client.order.findMany({
      where: { dealerId: dealer.id, status: { not: "CANCELLED" } },
      select: { finalPayableAmountPaise: true },
    }),
    client.ledgerBill.findMany({
      where: { dealerId: dealer.id },
      select: { billAmountPaise: true, paidAmountPaise: true, billDate: true, extraCreditDays: true },
    }),
  ]);

  const usedPaise = orders.reduce((sum, order) => sum + order.finalPayableAmountPaise, BigInt(0));
  const creditLimitPaise = dealer.creditLimitPaise;
  let baseHeadroomPaise: bigint | null = null;
  let remainingPaise: bigint | null = null;
  if (creditLimitPaise !== null) {
    const baseUsed = usedPaise - dealer.tempCreditConsumedPaise;
    baseHeadroomPaise = creditLimitPaise > baseUsed ? creditLimitPaise - baseUsed : BigInt(0);
    remainingPaise = baseHeadroomPaise + dealer.tempCreditLimitPaise;
  }

  const now = Date.now();
  const creditDays = dealer.creditDays;
  const overdueBill = bills.find((bill) =>
    bill.billAmountPaise > bill.paidAmountPaise && billDueDate(bill.billDate, creditDays, bill.extraCreditDays).getTime() < now);

  return {
    usedPaise,
    creditLimitPaise,
    tempCreditLimitPaise: dealer.tempCreditLimitPaise,
    baseHeadroomPaise,
    remainingPaise,
    isOverdue: Boolean(overdueBill),
    overdueSince: overdueBill?.billDate ?? null,
  };
}

/** How much of an order the temporary pot has to cover once base headroom is used up. */
export function tempCreditDraw(status: DealerCreditStatus, orderPaise: bigint) {
  if (status.baseHeadroomPaise === null || orderPaise <= status.baseHeadroomPaise) return BigInt(0);
  return orderPaise - status.baseHeadroomPaise;
}
