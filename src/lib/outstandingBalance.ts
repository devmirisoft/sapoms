import moment from "moment";

import { resolveOrderAmounts, type OrderAmountSource } from "@/lib/orderAmounts";

// Shared outstanding/aging maths for the ledger. The dealer ledger page and the
// dealer dashboard both surface the same figure, so the rules for "is this
// order still owed" and "which aging bucket does it land in" live here rather
// than being duplicated per screen.

export type PayStatus = "Paid" | "Partial" | "Unpaid" | "Overdue";

export type OutstandingOrder = OrderAmountSource & {
  order_date?: string;
  mtstatus?: string | number | null;
  outstandingDate?: string;
};

export type OutstandingAging = {
  current: number;
  d31: number;
  d61: number;
  d90: number;
  total: number;
  count: number;
};

export const EMPTY_AGING: OutstandingAging = {
  current: 0, d31: 0, d61: 0, d90: 0, total: 0, count: 0,
};

function mtStatusValue(s: unknown) {
  if (!s) return "NoActionTaken";
  const key = String(s).trim().toLowerCase().replace(/[\s_-]/g, "");
  if (key === "pending") return "Pending";
  if (key === "inprocess") return "InProcess";
  if (key === "completed") return "Completed";
  return "NoActionTaken";
}

export function getPayStatus(order: OutstandingOrder, today = moment().startOf("day")): PayStatus {
  if (mtStatusValue(order.mtstatus) === "Completed") return "Paid";
  const ms = Number(order.mtstatus ?? 0);
  if (ms >= 2) return "Paid";
  if (
    order.outstandingDate &&
    moment(order.outstandingDate, "YYYY-MM-DD", true).isValid() &&
    moment(order.outstandingDate).isBefore(today)
  )
    return "Overdue";
  if (ms === 1) return "Partial";
  return "Unpaid";
}

export function isOutstanding(order: OutstandingOrder, today?: moment.Moment) {
  const status = getPayStatus(order, today);
  return status === "Unpaid" || status === "Partial" || status === "Overdue";
}

/** Total still owed, split into the 0–30 / 31–60 / 61–90 / 90+ day buckets. */
export function calculateOutstandingAging(
  orders: OutstandingOrder[],
  today = moment().startOf("day"),
): OutstandingAging {
  let current = 0, d31 = 0, d61 = 0, d90 = 0, count = 0;

  for (const order of orders) {
    if (!isOutstanding(order, today)) continue;
    count += 1;

    const net  = resolveOrderAmounts(order).netPayable;
    const ref  = order.outstandingDate || order.order_date;
    const days = ref ? today.diff(moment(ref).startOf("day"), "days") : 0;

    if      (days <= 30) current += net;
    else if (days <= 60) d31     += net;
    else if (days <= 90) d61     += net;
    else                 d90     += net;
  }

  return { current, d31, d61, d90, total: current + d31 + d61 + d90, count };
}
