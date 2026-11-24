import type { Prisma } from "@prisma/client";

/**
 * Credit-limit and credit-day enforcement for dealers who buy on credit terms
 * (dealerTerms() === "credit") rather than through a prepaid wallet.
 *
 * Used credit (shown as "Outstanding") is what's owed since the opening balance:
 * every order placed after it (not cancelled or declined) plus debit notes, plus
 * the unpaid opening bills and later bills for earlier orders, minus what the
 * accountant has recorded as paid against bills - so paying a 2k bill frees 2k
 * of limit. On top of dealer.creditLimitPaise sits a temporary pot
 * (tempCreditLimitPaise) that orders draw down once the base headroom is gone;
 * at zero the dealer is back on the base limit. The overdue check blocks
 * ordering while any bill is past billDate + creditDays + bill.extraCreditDays
 * without being paid in full.
 */

type CreditClient = Pick<Prisma.TransactionClient, "order" | "ledgerBill">;

export type DealerTerms = "advance" | "credit" | "unset";

/**
 * The one rule for how a dealer pays, used by every order and money path.
 * An active wallet makes them advance whatever credit days are saved - those
 * stay on the record so switching back to credit restores them. Otherwise
 * credit days make them credit; with neither, nobody set their terms up and
 * they can't order (admins see these dealers in their notification bell).
 */
export function dealerTerms(dealer: { creditDays: number | null }, wallet: { status: string } | null | undefined): DealerTerms {
  if (wallet?.status === "ACTIVE") return "advance";
  return dealer.creditDays === null ? "unset" : "credit";
}

export const UNSET_TERMS_MESSAGE = "Your credit terms haven't been set up yet. Your admin has been notified.";

/** dealerTerms() === "unset" as a query: active dealers who can't order until an admin sets their terms. */
export function findUnsetTermsDealers(client: Pick<Prisma.TransactionClient, "dealerProfile">, take = 50) {
  return client.dealerProfile.findMany({
    where: {
      deletedAt: null,
      user: { status: "ACTIVE", deletedAt: null },
      creditDays: null,
      OR: [{ wallet: { is: null } }, { wallet: { is: { status: "INACTIVE" } } }],
    },
    orderBy: { businessName: "asc" },
    take,
    select: { id: true, businessName: true, updatedAt: true },
  });
}

export type CreditDealer = {
  id: bigint;
  creditDays: number | null;
  creditLimitPaise: bigint | null;
  tempCreditLimitPaise: bigint;
  // Required so no caller can forget it: an active wallet overrides credit days.
  wallet: { status: string } | null;
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
const ZERO = BigInt(0);

// The accountant's balance sheet as of 31 Oct 2026 is the opening position: its
// unpaid bills were imported as ledger bills with no order (orderNumber ""), see
// scripts/import-opening-bills.mjs. Orders and app bills before this instant are
// already inside those balances.
export const OPENING_BALANCE_CUTOFF = new Date("2026-11-01T00:00:00+05:30");

type UsedOrder = { id: bigint; legacyPhpId: string | null; orderNumber: string; orderDate: Date; status: string; finalPayableAmountPaise: bigint };
type UsedBill = { orderId: bigint | null; orderNumber: string; billDate: Date; billAmountPaise: bigint; paidAmountPaise: bigint; debitNotePaise: bigint };

/** What a credit dealer owes since the opening balance, before clamping at zero. */
export function creditOwedPaise(orders: UsedOrder[], bills: UsedBill[]) {
  const counted = (order: UsedOrder) =>
    order.status !== "CANCELLED" && order.status !== "DECLINED" && order.orderDate >= OPENING_BALANCE_CUTOFF;
  // A bill names its orders by id, legacy id or order number, as recordLedgerBill stores them.
  const ordersOf = (bill: UsedBill) => bill.orderId !== null
    ? orders.filter((order) => order.id === bill.orderId)
    : bill.orderNumber.split(",").map((key) => key.trim()).filter(Boolean).flatMap((key) =>
        orders.filter((order) => order.id.toString() === key || order.legacyPhpId === key || order.orderNumber === key).slice(0, 1));

  let owed = orders.filter(counted).reduce((sum, order) => sum + order.finalPayableAmountPaise, ZERO);
  for (const bill of bills) {
    const opening = bill.orderNumber === "";
    if (!opening && bill.billDate < OPENING_BALANCE_CUTOFF) continue; // inside the opening balance
    // A counted order already carries the goods, so its bill adds only the debit
    // note; an opening bill, or a later bill for an earlier order, counts in full.
    // ponytail: a bill mixing earlier and later orders counts as covered, so the
    // earlier orders' share is missed; split by shipment if such bills show up.
    owed += !opening && ordersOf(bill).some(counted)
      ? bill.debitNotePaise - bill.paidAmountPaise
      : bill.billAmountPaise - bill.paidAmountPaise;
  }
  return owed;
}

export function billDueDate(billDate: Date, creditDays: number, extraCreditDays: number) {
  return new Date(billDate.getTime() + (creditDays + extraCreditDays) * DAY_MS);
}

/** A bill's age in days and what of it is overdue at `now` - the unpaid balance once past due, else 0. */
export function billAgeing(
  bill: { billDate: Date; billAmountPaise: bigint; paidAmountPaise: bigint; extraCreditDays: number },
  creditDays: number,
  now: number,
) {
  const outstanding = bill.billAmountPaise - bill.paidAmountPaise;
  const overdue = outstanding > ZERO && billDueDate(bill.billDate, creditDays, bill.extraCreditDays).getTime() < now;
  return { ageDays: Math.floor((now - bill.billDate.getTime()) / DAY_MS), duePaise: overdue ? outstanding : ZERO };
}

/** Returns null for dealers not on credit terms (see dealerTerms). */
export async function getDealerCreditStatus(client: CreditClient, dealer: CreditDealer): Promise<DealerCreditStatus | null> {
  const creditDays = dealer.creditDays;
  if (creditDays === null || dealerTerms(dealer, dealer.wallet) !== "credit") return null;

  const [orders, bills] = await Promise.all([
    client.order.findMany({
      where: { dealerId: dealer.id },
      select: { id: true, legacyPhpId: true, orderNumber: true, orderDate: true, status: true, finalPayableAmountPaise: true },
    }),
    client.ledgerBill.findMany({
      where: { dealerId: dealer.id },
      select: { orderId: true, orderNumber: true, billAmountPaise: true, paidAmountPaise: true, debitNotePaise: true, billDate: true, extraCreditDays: true },
    }),
  ]);

  const owedPaise = creditOwedPaise(orders, bills);
  const usedPaise = owedPaise > ZERO ? owedPaise : ZERO;
  const creditLimitPaise = dealer.creditLimitPaise;
  let baseHeadroomPaise: bigint | null = null;
  let remainingPaise: bigint | null = null;
  if (creditLimitPaise !== null) {
    baseHeadroomPaise = creditLimitPaise > usedPaise ? creditLimitPaise - usedPaise : ZERO;
    remainingPaise = baseHeadroomPaise + dealer.tempCreditLimitPaise;
  }

  const now = Date.now();
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
  if (status.baseHeadroomPaise === null || orderPaise <= status.baseHeadroomPaise) return ZERO;
  return orderPaise - status.baseHeadroomPaise;
}

export type CreditBlock = { code: "credit_overdue" | "credit_limit_exceeded"; message: string };

const rupees = (paise: bigint) => `₹${(Number(paise) / 100).toLocaleString("en-IN")}`;

/**
 * Gate every order a credit-terms dealer places, whichever path creates it.
 * Returns why the order is blocked, or null once it may go ahead (having drawn
 * any temporary headroom it needs). The row lock serialises one dealer's
 * concurrent orders so two of them can't both pass the headroom check.
 */
export async function reserveDealerCredit(tx: Prisma.TransactionClient, dealerId: bigint, orderPaise: bigint): Promise<CreditBlock | null> {
  await tx.$executeRaw`SELECT id FROM dealer_profiles WHERE id = ${dealerId} FOR UPDATE`;
  const dealer = await tx.dealerProfile.findUnique({
    where: { id: dealerId },
    select: { id: true, creditDays: true, creditLimitPaise: true, tempCreditLimitPaise: true, wallet: { select: { status: true } } },
  });
  const credit = dealer ? await getDealerCreditStatus(tx, dealer) : null;
  if (!credit) return null;
  if (credit.isOverdue) {
    return { code: "credit_overdue", message: "Payment is overdue on a previous bill. Clear the outstanding dues before placing a new order." };
  }
  if (credit.remainingPaise !== null && credit.remainingPaise < orderPaise) {
    return { code: "credit_limit_exceeded", message: `Credit limit exceeded. Available: ${rupees(credit.remainingPaise)}. Required: ${rupees(orderPaise)}.` };
  }
  const draw = tempCreditDraw(credit, orderPaise);
  if (draw > ZERO) {
    await tx.dealerProfile.update({ where: { id: dealerId }, data: { tempCreditLimitPaise: { decrement: draw } } });
  }
  return null;
}
