import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { periodKey } from "@/server/modules/admin-dashboard/postgres-admin-dashboard.repository";
import { SALES_REGION_OPTIONS, type SalesRegionOptionValue } from "@/lib/salesRegions";

// Lifted out of GET /api/admin/sales-summary so the assistant's sales report counts
// sales by exactly the same rules as the Sales page.

const DAY_MS = 86_400_000;

/** A sale only counts once the RSM has approved it and the assigned staff has accepted it. */
export const ACCEPTED_ONLY = {
  rsmApprovalStatus: "ACCEPTED",
  acceptanceStatus: "ACCEPTED",
  status: { notIn: ["CANCELLED", "DECLINED"] },
} satisfies Prisma.OrderWhereInput;

/** An unset bound means no bound, so a range nobody picked reads as all time. */
function parseDay(value: string | null | undefined, endOfDay = false) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(`${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function day(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Whole rupees, as the Sales page shows them. */
export function rupees(paise: bigint) {
  return Number(paise / BigInt(100));
}

export type SalesFilterInput = { from?: string | null; to?: string | null; region?: string | null; asm?: string | null; city?: string | null };

export async function resolveSalesFilters(input: SalesFilterInput) {
  const from = parseDay(input.from);
  const to = parseDay(input.to, true);

  const regionParam = String(input.region ?? "").trim().toUpperCase();
  const region = SALES_REGION_OPTIONS.some((option) => option.value === regionParam)
    ? (regionParam as SalesRegionOptionValue)
    : undefined;
  // The sales of an ASM are the sales of the states assigned to them. The states are
  // read here rather than taken from the caller so an ASM with none scopes to nothing.
  // ponytail: exact state match, mirrors how assigned_states is stored on the ASM.
  const asmId = /^\d+$/.test(String(input.asm ?? "").trim()) ? BigInt(String(input.asm).trim()) : null;
  const asm = asmId === null ? null : await prisma.staffProfile.findFirst({
    where: { id: asmId, user: { role: "ASM" } },
    select: { displayName: true, assignedStates: true },
  });

  const city = String(input.city ?? "").trim();

  const dealer = {
    ...(region ? { region } : {}),
    ...(asmId === null ? {} : { state: { in: asm?.assignedStates ?? [] } }),
    ...(city ? { city: { equals: city, mode: "insensitive" as const } } : {}),
  };

  const range = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  // ponytail: an unbounded range scans every accepted order, as the dashboard
  // repository already does. Push the sum into SQL if the order table outgrows it.
  const where: Prisma.OrderWhereInput = {
    ...ACCEPTED_ONLY,
    ...(Object.keys(dealer).length ? { dealer } : {}),
    ...(Object.keys(range).length ? { orderDate: range } : {}),
  };

  return { from, to, region, asmId, asm, city, dealer, range, where };
}

export type SalesFilters = Awaited<ReturnType<typeof resolveSalesFilters>>;

/**
 * Totals and a day/month series for the filters. `scope` narrows it to what a
 * non-admin may see; billed/paid are only computed when `withBills` is set.
 */
export async function summarizeSales(filters: SalesFilters, options: { scope?: Prisma.OrderWhereInput; withBills?: boolean } = {}) {
  const { from, to, dealer, range } = filters;
  const scoped = (where: Prisma.OrderWhereInput) => (options.scope ? { AND: [where, options.scope] } : where);
  const withBills = options.withBills ?? true;

  // `earliest` is the oldest record in this scope whatever the picked range, so the
  // date fields can be walked back as far as there is anything to show.
  // Billed is what the accountant invoiced in the ledger, paid what was recorded
  // against those bills; both by bill date, since one bill can span several orders.
  const [orders, oldest, bills] = await prisma.$transaction([
    prisma.order.findMany({
      where: scoped(filters.where),
      select: { orderDate: true, finalPayableAmountPaise: true },
      orderBy: { orderDate: "asc" },
    }),
    prisma.order.aggregate({
      where: scoped({ ...filters.where, orderDate: undefined }),
      _min: { orderDate: true },
    }),
    prisma.ledgerBill.aggregate({
      where: withBills
        ? {
          ...(Object.keys(dealer).length ? { dealer } : {}),
          ...(Object.keys(range).length ? { billDate: range } : {}),
        }
        : { id: BigInt(-1) },
      _sum: { billAmountPaise: true, paidAmountPaise: true },
    }),
  ]);

  const spanFrom = from ?? orders[0]?.orderDate ?? new Date();
  const spanTo = to ?? orders[orders.length - 1]?.orderDate ?? new Date();
  const granularity = spanTo.getTime() - spanFrom.getTime() <= 62 * DAY_MS ? "day" : "month";
  const buckets = new Map<string, bigint>();
  let totalPaise = BigInt(0);

  for (const order of orders) {
    totalPaise += order.finalPayableAmountPaise;
    const key = periodKey(order.orderDate, granularity);
    buckets.set(key, (buckets.get(key) ?? BigInt(0)) + order.finalPayableAmountPaise);
  }

  return {
    from: from ? day(from) : null,
    to: to ? day(to) : null,
    earliest: oldest._min.orderDate ? day(oldest._min.orderDate) : null,
    granularity,
    orderCount: orders.length,
    total: rupees(totalPaise),
    ...(withBills ? {
      billed: rupees(bills._sum.billAmountPaise ?? BigInt(0)),
      paid: rupees(bills._sum.paidAmountPaise ?? BigInt(0)),
    } : {}),
    series: Array.from(buckets.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([period, paise]) => ({ period, total: rupees(paise) })),
  };
}
