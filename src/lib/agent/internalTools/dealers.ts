import "server-only";

import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { SALES_REGIONS } from "@/server/auth/sales-scope";
import { formatSalesRegionLabel } from "@/lib/salesRegions";
import { ACCEPTED_ONLY } from "@/server/modules/admin-dashboard/sales-summary";
import type { Tool } from "../types";
import { financialYearStart, type InternalScope } from "../internalScope";
import { indiaDayStart, listOrders, rupees } from "../orders";
import { handler as dealerLedgerSummary } from "../tools/getLedgerSummary";

type Fail = { error: string; message: string; matches?: unknown[] };

/**
 * A dealer the user named, looked up only inside their scope: by id, dealer code or name.
 * Several name matches come back as AMBIGUOUS so the model asks which one.
 */
export async function resolveDealer(scope: InternalScope, ref: string): Promise<{ dealerId: bigint; name: string } | Fail> {
  const value = ref.trim();
  const matches = await prisma.dealerProfile.findMany({
    where: {
      AND: [scope.dealerWhere, {
        OR: [
          ...(/^\d+$/.test(value) ? [{ id: BigInt(value) }] : []),
          { dealerCode: { equals: value, mode: "insensitive" as const } },
          { businessName: { contains: value, mode: "insensitive" as const } },
        ],
      }],
    },
    select: { id: true, businessName: true, dealerCode: true, city: true },
    orderBy: { businessName: "asc" },
    take: 6,
  });
  const lower = value.toLowerCase();
  const exact = matches.find((m) => m.id.toString() === value || m.dealerCode?.toLowerCase() === lower || m.businessName.toLowerCase() === lower);
  const pick = exact ?? (matches.length === 1 ? matches[0] : null);
  if (pick) return { dealerId: pick.id, name: pick.businessName };
  if (matches.length === 0) return { error: "DEALER_NOT_FOUND", message: `No dealer matching "${value}" among the dealers you can access.` };
  return {
    error: "AMBIGUOUS_DEALER",
    message: "Several dealers match. Ask which one (dealer code or id).",
    matches: matches.slice(0, 5).map((m) => ({ dealerId: m.id.toString(), name: m.businessName, code: m.dealerCode, city: m.city })),
  };
}

export const findDealers: Tool<InternalScope> = {
  schema: {
    type: "function",
    function: {
      name: "find_dealers",
      description: "Search the dealers you can access by name, dealer code or city; optional region filter.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name, dealer code or city" },
          city: { type: "string" },
          region: { type: "string", enum: [...SALES_REGIONS] },
          limit: { type: "integer", minimum: 1, maximum: 10 },
        },
      },
    },
  },
  argsSchema: z.object({
    query: z.string().trim().max(120).optional(),
    city: z.string().trim().max(80).optional(),
    region: z.enum(SALES_REGIONS).optional(),
    limit: z.number().int().min(1).max(10).optional(),
  }),
  async handler(args: { query?: string; city?: string; region?: (typeof SALES_REGIONS)[number]; limit?: number }, scope) {
    const limit = args.limit ?? 10;
    const where = {
      AND: [
        scope.dealerWhere,
        ...(args.query ? [{ OR: [
          { businessName: { contains: args.query, mode: "insensitive" as const } },
          { dealerCode: { equals: args.query, mode: "insensitive" as const } },
          { city: { contains: args.query, mode: "insensitive" as const } },
        ] }] : []),
        ...(args.city ? [{ city: { equals: args.city, mode: "insensitive" as const } }] : []),
        ...(args.region ? [{ region: args.region }] : []),
      ],
    };
    const [total, dealers] = await Promise.all([
      prisma.dealerProfile.count({ where }),
      prisma.dealerProfile.findMany({
        where,
        orderBy: { businessName: "asc" },
        take: limit,
        select: {
          id: true, businessName: true, dealerCode: true, city: true, state: true, region: true, creditDays: true, discountPercent: true,
          wallet: { select: { status: true } },
          user: { select: { status: true } },
          staffAssignments: { where: { active: true, removedAt: null }, take: 2, select: { staff: { select: { displayName: true } } } },
        },
      }),
    ]);
    return {
      dealers: dealers.map((d) => ({
        dealerId: d.id.toString(),
        name: d.businessName,
        code: d.dealerCode ?? undefined,
        city: d.city ?? undefined,
        state: d.state ?? undefined,
        region: d.region ? formatSalesRegionLabel(d.region) : undefined,
        account: d.creditDays !== null ? `credit, ${d.creditDays} days` : d.wallet?.status === "ACTIVE" ? "advance (wallet)" : "none",
        discountPercent: Number(d.discountPercent ?? 0),
        assignedTo: d.staffAssignments.map((a) => a.staff.displayName).join(", ") || undefined,
        ...(d.user.status !== "ACTIVE" ? { loginStatus: d.user.status } : {}),
      })),
      total,
      hasMore: total > dealers.length,
    };
  },
};

export const getDealerSummary: Tool<InternalScope> = {
  schema: {
    type: "function",
    function: {
      name: "get_dealer_summary",
      description: "One dealer at a glance: profile, assigned staff, sales this financial year vs target, credit/wallet and unpaid bills, last 5 orders.",
      parameters: {
        type: "object",
        properties: { dealer: { type: "string", description: "Dealer name, dealer code or id" } },
        required: ["dealer"],
      },
    },
  },
  argsSchema: z.object({ dealer: z.string().trim().min(1).max(120) }),
  async handler(args: { dealer: string }, scope) {
    const found = await resolveDealer(scope, args.dealer);
    if ("error" in found) return found;
    const { dealerId } = found;
    const fyStart = financialYearStart();

    const [profile, account, recent, fy] = await Promise.all([
      prisma.dealerProfile.findUniqueOrThrow({
        where: { id: dealerId },
        select: {
          businessName: true, dealerCode: true, city: true, state: true, region: true, phone: true, discountPercent: true, annualTargetPaise: true,
          user: { select: { email: true, status: true } },
          staffAssignments: { where: { active: true, removedAt: null }, select: { staff: { select: { displayName: true } } } },
        },
      }),
      dealerLedgerSummary({}, { dealerId }),
      listOrders({ AND: [scope.orderWhere, { dealerId }] }, 5),
      prisma.order.aggregate({
        where: { AND: [scope.orderWhere, ACCEPTED_ONLY, { dealerId, orderDate: { gte: indiaDayStart(fyStart) } }] },
        _sum: { finalPayableAmountPaise: true },
        _count: { _all: true },
      }),
    ]);

    return {
      dealerId: dealerId.toString(),
      name: profile.businessName,
      code: profile.dealerCode ?? undefined,
      city: profile.city ?? undefined,
      state: profile.state ?? undefined,
      region: profile.region ? formatSalesRegionLabel(profile.region) : undefined,
      phone: profile.phone ?? undefined,
      email: profile.user.email,
      loginStatus: profile.user.status,
      discountPercent: Number(profile.discountPercent ?? 0),
      assignedTo: profile.staffAssignments.map((a) => a.staff.displayName).join(", ") || undefined,
      salesThisFinancialYear: {
        since: fyStart,
        acceptedOrders: fy._count._all,
        total: rupees(fy._sum.finalPayableAmountPaise ?? BigInt(0)),
        annualTarget: profile.annualTargetPaise ? rupees(profile.annualTargetPaise) : null,
      },
      account,
      recentOrders: recent.orders,
    };
  },
};
