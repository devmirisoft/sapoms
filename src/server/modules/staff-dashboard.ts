import type { Prisma } from "@prisma/client";
import type { AuthActor } from "@/server/auth/session";
import { rsmTeamWhere } from "@/server/auth/sales-scope";
import { prisma } from "@/server/db/prisma";
import { buildScope } from "@/lib/agent/internalScope";
import { staffRoleBadge } from "@/lib/staffRoleLabel";
import { normalizeGranularity, periodKey } from "@/server/modules/admin-dashboard/postgres-admin-dashboard.repository";
import { ACCEPTED_ONLY, resolveSalesFilters, summarizeSales, type SalesFilterInput } from "@/server/modules/admin-dashboard/sales-summary";
import { breakdownForRole, buildStaffCharts, cityName, memberOrderWhere } from "@/server/modules/staff-dashboard-charts";

/* The admin dashboard's charts for staff, limited by role: orders by the Orders list
   rule (buildScope.orderWhere), dealers by the sales-target rule (buildScope.dealerWhere). */

/** Only an RSM or ASM has a team. members are who the charts break down by. */
async function staffTeam(actor: Pick<AuthActor, "role">, staffId: bigint) {
  const where: Prisma.StaffProfileWhereInput | null = actor.role === "RSM" ? rsmTeamWhere(staffId)
    : actor.role === "ASM" ? { parentAsmId: staffId }
    : null;
  if (!where) return null;

  const rows = await prisma.staffProfile.findMany({
    where: { AND: [where, { user: { status: "ACTIVE", deletedAt: null } }] },
    select: { id: true, displayName: true, staffRoleType: true, salesRegion: true, user: { select: { role: true } } },
    orderBy: { displayName: "asc" },
  });
  const staff = rows.map((row) => ({
    id: row.id.toString(),
    name: row.displayName,
    badge: staffRoleBadge({ role: row.user.role, staffRoleType: row.staffRoleType, salesRegion: row.salesRegion }),
  }));
  const counts = new Map<string, number>();
  for (const member of staff) counts.set(member.badge.label, (counts.get(member.badge.label) ?? 0) + 1);

  return {
    count: staff.length,
    byRole: actor.role === "RSM"
      ? Array.from(counts, ([label, count]) => ({ label, count })).sort((left, right) => left.label.localeCompare(right.label))
      : [],
    members: staff
      .filter((member) => member.badge.key === (actor.role === "RSM" ? "ASM" : "SALES_MANAGER"))
      .map(({ id, name }) => ({ id, name })),
  };
}

export async function staffDashboard(actor: AuthActor, staffId: bigint, granularityParam?: string | null) {
  const granularity = normalizeGranularity(granularityParam);
  const breakdown = breakdownForRole(actor.role);
  const scope = await buildScope(actor);

  // ponytail: scans every accepted order in scope, as the admin repository does.
  // Push the sums into SQL if a team's order history outgrows it.
  const [orders, dealerTotal, dealerActive, team] = await Promise.all([
    prisma.order.findMany({
      where: { AND: [ACCEPTED_ONLY, scope.orderWhere] },
      select: {
        orderNumber: true,
        orderDate: true,
        finalPayableAmountPaise: true,
        dealerId: true,
        salesManager: { select: { id: true, displayName: true, parentAsm: { select: { id: true, displayName: true } } } },
        dealer: {
          select: {
            businessName: true,
            dealerCode: true,
            city: true,
            staffAssignments: {
              where: breakdown === "asm"
                ? { active: true, removedAt: null, staff: { staffRoleType: "ASM", parentRsmId: staffId } }
                : { id: BigInt(-1) },
              orderBy: { assignedAt: "asc" },
              select: { staff: { select: { id: true, displayName: true } } },
            },
          },
        },
      },
    }),
    prisma.dealerProfile.count({ where: scope.dealerWhere }),
    prisma.dealerProfile.count({ where: { AND: [scope.dealerWhere, { user: { status: "ACTIVE" } }] } }),
    staffTeam(actor, staffId),
  ]);

  return {
    breakdown,
    granularity,
    ...buildStaffCharts(orders, breakdown, (date) => periodKey(date, granularity)),
    dealers: { total: dealerTotal, active: dealerActive, inactive: dealerTotal - dealerActive },
    team,
  };
}

export async function staffSalesSummary(actor: AuthActor, input: Pick<SalesFilterInput, "from" | "to" | "city"> & { member?: string | null }) {
  const scope = await buildScope(actor);
  const member = memberOrderWhere(breakdownForRole(actor.role), input.member);
  const orderScope: Prisma.OrderWhereInput = member ? { AND: [scope.orderWhere, member] } : scope.orderWhere;
  // `asm` stays unset: resolveSalesFilters reads it as the ASM's assigned states, which
  // would not add up to that ASM's line on the Net Sales chart.
  const filters = await resolveSalesFilters({ from: input.from, to: input.to, city: input.city });

  const [summary, cityRows] = await Promise.all([
    // withBills stays false: summarizeSales does not apply `scope` to bills, so turning it
    // on would hand staff the company-wide billed and paid totals.
    summarizeSales(filters, { scope: orderScope, withBills: false }),
    prisma.order.findMany({
      where: { AND: [ACCEPTED_ONLY, orderScope] },
      distinct: ["dealerId"],
      select: { dealer: { select: { city: true } } },
    }),
  ]);

  return {
    ...summary,
    cities: Array.from(new Set(cityRows.map((row) => cityName(row.dealer.city)).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
  };
}

export type StaffDashboardData = Awaited<ReturnType<typeof staffDashboard>>;
export type StaffSalesSummaryData = Awaited<ReturnType<typeof staffSalesSummary>>;
