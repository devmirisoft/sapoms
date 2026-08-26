/**
 * Settlement visibility on an order.
 *
 * When the Accountant settles a dealer's advance wallet against a bill,
 * `applySettlement` writes the money three ways: a wallet CREDIT, a bump to
 * LedgerBill.paidAmountPaise, and a WalletSettlementApplication row linking
 * settlement -> bill -> order. Only the bill knew about it, so an order and its
 * invoice still read as fully unpaid. These helpers derive the paid/settled
 * position from the bills already attached to an order.
 *
 * Ledger *totals* deliberately still exclude settlement transactions — see
 * isSettlementTransaction in ledgerSystem.ts. This module reports what was paid
 * against a specific order; it does not feed the dealer's outstanding figure.
 */

export type OrderSettlementBill = {
  id: bigint | string;
  orderNumber?: string | null;
  billAmountPaise: bigint | number | string;
  paidAmountPaise: bigint | number | string;
  lastPaymentDate?: Date | string | null;
};

export type OrderSettlementStatus = "unbilled" | "unpaid" | "part_settled" | "settled";

function toBigInt(value: bigint | number | string | null | undefined) {
  if (typeof value === "bigint") return value;
  if (value === null || value === undefined || value === "") return BigInt(0);
  const numeric = Math.round(Number(value));
  return Number.isFinite(numeric) ? BigInt(numeric) : BigInt(0);
}

function rupees(paise: bigint) {
  return Number(paise) / 100;
}

function isoDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Roll the bills attached to an order into a single paid/outstanding position.
 *
 * An order with no bills is "unbilled", which is different from "unpaid": the
 * Accountant has not raised a bill yet, so there is nothing to settle against.
 */
export function summarizeOrderSettlement(
  bills: OrderSettlementBill[] | null | undefined,
  finalPayableAmountPaise?: bigint | number | string | null,
) {
  const rows = Array.isArray(bills) ? bills : [];
  const billedPaise = rows.reduce((sum, bill) => sum + toBigInt(bill.billAmountPaise), BigInt(0));
  const paidPaise = rows.reduce((sum, bill) => sum + toBigInt(bill.paidAmountPaise), BigInt(0));

  // Prefer the order's own payable as the denominator: a bill can be raised for
  // part of an order, and "settled" should mean the order is covered.
  const orderPayablePaise = toBigInt(finalPayableAmountPaise);
  const totalPaise = orderPayablePaise > BigInt(0) ? orderPayablePaise : billedPaise;
  const duePaise = totalPaise > paidPaise ? totalPaise - paidPaise : BigInt(0);

  const lastPaymentAt = rows
    .map((bill) => isoDate(bill.lastPaymentDate))
    .filter((value): value is string => !!value)
    .sort()
    .at(-1) ?? null;

  const status: OrderSettlementStatus = rows.length === 0
    ? "unbilled"
    : paidPaise <= BigInt(0)
      ? "unpaid"
      : duePaise > BigInt(0)
        ? "part_settled"
        : "settled";

  return {
    status,
    isSettled: status === "settled",
    isPartSettled: status === "part_settled",
    billedAmount: rupees(billedPaise),
    billedAmountPaise: billedPaise.toString(),
    paidAmount: rupees(paidPaise),
    paidAmountPaise: paidPaise.toString(),
    dueAmount: rupees(duePaise),
    dueAmountPaise: duePaise.toString(),
    lastPaymentAt,
    bills: rows.map((bill) => ({
      id: String(bill.id),
      orderNumber: bill.orderNumber ?? "",
      billAmount: rupees(toBigInt(bill.billAmountPaise)),
      paidAmount: rupees(toBigInt(bill.paidAmountPaise)),
      lastPaymentAt: isoDate(bill.lastPaymentDate),
    })),
  };
}

export function orderSettlementLabel(status: OrderSettlementStatus) {
  if (status === "settled") return "Settled";
  if (status === "part_settled") return "Part settled";
  if (status === "unpaid") return "Unpaid";
  return "";
}
