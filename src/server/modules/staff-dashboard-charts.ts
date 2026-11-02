import type { Prisma } from "@prisma/client";

/* The staff dashboard charts, kept free of the database so they can be tested alone.
   Each role sees its sales one level below itself: an RSM by ASM, an ASM by sales
   manager. Sales Managers and Staff have nobody under them, so theirs go by city. */

export type StaffBreakdown = "asm" | "salesManager" | "city";

type NamedStaff = { id: bigint; displayName: string };

export type StaffChartOrder = {
  orderNumber: string;
  orderDate: Date;
  finalPayableAmountPaise: bigint;
  dealerId: bigint;
  salesManager: (NamedStaff & { parentAsm: NamedStaff | null }) | null;
  dealer: {
    businessName: string | null;
    dealerCode: string | null;
    city: string | null;
    staffAssignments: Array<{ staff: NamedStaff }>;
  };
};

const TOP_CITIES = 5;
const TOP_GROUP_DEALERS = 5;
const TOP_LIMIT = 10;

const rupees = (paise: bigint) => Number(paise / BigInt(100));
const byTotalDesc = (left: { total: bigint }, right: { total: bigint }) =>
  left.total > right.total ? -1 : left.total < right.total ? 1 : 0;

export function breakdownForRole(role: unknown): StaffBreakdown {
  return role === "RSM" ? "asm" : role === "ASM" ? "salesManager" : "city";
}

/** Tidied for display; the same city typed in different cases reads as one. */
export function cityName(value: string | null | undefined) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

/** The line an order belongs to, along the same paths as rsmOrderScope. */
export function orderGroup(order: StaffChartOrder, breakdown: StaffBreakdown) {
  if (breakdown === "city") {
    const city = cityName(order.dealer.city);
    return city ? { id: city, label: city } : { id: "no-city", label: "No city" };
  }
  const staff = breakdown === "salesManager"
    ? order.salesManager
    : order.salesManager ? order.salesManager.parentAsm : order.dealer.staffAssignments[0]?.staff;
  return staff ? { id: staff.id.toString(), label: staff.displayName } : { id: "direct", label: "Direct" };
}

/**
 * The orders of one team member, matching orderGroup. Callers AND this with the viewer's
 * own order scope, so an id from another team finds nothing rather than widening access.
 */
export function memberOrderWhere(breakdown: StaffBreakdown, member: unknown): Prisma.OrderWhereInput | null {
  const raw = String(member ?? "").trim();
  if (breakdown === "city" || !/^\d+$/.test(raw)) return null;
  const id = BigInt(raw);
  if (breakdown === "salesManager") return { salesManagerId: id };
  return {
    OR: [
      { salesManager: { parentAsmId: id } },
      { salesManagerId: null, dealer: { staffAssignments: { some: { staffId: id, active: true, removedAt: null } } } },
    ],
  };
}

function dealerName(order: StaffChartOrder) {
  return order.dealer.businessName || order.dealer.dealerCode || `Dealer ${order.dealerId.toString()}`;
}

function addToDealer(dealers: Map<string, { dealerId: string; dealerName: string; total: bigint }>, order: StaffChartOrder) {
  const dealerId = order.dealerId.toString();
  const dealer = dealers.get(dealerId) ?? { dealerId, dealerName: dealerName(order), total: BigInt(0) };
  dealer.total += order.finalPayableAmountPaise;
  dealers.set(dealerId, dealer);
}

/**
 * Series keys are g0, g1, ... rather than the group's id: recharts reads a dot in a
 * dataKey as a path, and city names can contain dots.
 */
export function buildStaffCharts(orders: StaffChartOrder[], breakdown: StaffBreakdown, periodOf: (date: Date) => string) {
  const groups = new Map<string, {
    label: string;
    total: bigint;
    periods: Map<string, bigint>;
    dealers: Map<string, { dealerId: string; dealerName: string; total: bigint }>;
  }>();
  const dealers = new Map<string, { dealerId: string; dealerName: string; total: bigint }>();
  const periods = new Set<string>();

  for (const order of orders) {
    const { id, label } = orderGroup(order, breakdown);
    const group = groups.get(id) ?? { label, total: BigInt(0), periods: new Map(), dealers: new Map() };
    const period = periodOf(order.orderDate);
    group.total += order.finalPayableAmountPaise;
    group.periods.set(period, (group.periods.get(period) ?? BigInt(0)) + order.finalPayableAmountPaise);
    addToDealer(group.dealers, order);
    groups.set(id, group);
    addToDealer(dealers, order);
    periods.add(period);
  }

  const ranked = Array.from(groups.values()).sort(byTotalDesc);
  const shown = (breakdown === "city" ? ranked.slice(0, TOP_CITIES) : ranked).map((group, index) => ({ ...group, key: `g${index}` }));
  const toDealerRow = (dealer: { dealerId: string; dealerName: string; total: bigint }) => ({
    dealerId: dealer.dealerId,
    dealerName: dealer.dealerName,
    total: rupees(dealer.total),
  });

  return {
    groups: shown.map(({ key, label }) => ({ key, label })),
    netSales: Array.from(periods).sort().map((period) => {
      const point: { period: string; [groupKey: string]: string | number } = { period };
      for (const group of shown) point[group.key] = rupees(group.periods.get(period) ?? BigInt(0));
      return point;
    }),
    topByGroup: Object.fromEntries(shown.map((group) => [
      group.key,
      Array.from(group.dealers.values()).sort(byTotalDesc).slice(0, TOP_GROUP_DEALERS).map(toDealerRow),
    ])),
    topOrders: orders
      .map((order) => ({ order_id: order.orderNumber, total: order.finalPayableAmountPaise }))
      .sort(byTotalDesc)
      .slice(0, TOP_LIMIT)
      .map((order) => ({ order_id: order.order_id, total: rupees(order.total) })),
    topDealers: Array.from(dealers.values()).sort(byTotalDesc).slice(0, TOP_LIMIT).map(toDealerRow),
  };
}
