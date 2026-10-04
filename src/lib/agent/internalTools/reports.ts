import "server-only";

import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { SALES_REGIONS } from "@/server/auth/sales-scope";
import { findCatalogueEntry, getCatalogueSection } from "@/lib/catalogue";
import { formatSalesRegionLabel } from "@/lib/salesRegions";
import { ACCEPTED_ONLY, resolveSalesFilters, rupees as wholeRupees, summarizeSales } from "@/server/modules/admin-dashboard/sales-summary";
import { listUnpaidBills } from "@/server/reports/billAgeing";
import { loadCatalogue } from "@/server/modules/products/catalogue";
import { staffSalesTarget } from "@/server/modules/staff-target";
import type { Tool } from "../types";
import type { InternalScope } from "../internalScope";
import { orderFilters, rupees } from "../orders";
import { resolveDealer } from "./dealers";

const dateArg = z.iso.date().optional();
const round2 = (value: number) => Math.round(value * 100) / 100;

async function dealerFilter(scope: InternalScope, ref?: string) {
  if (!ref) return { dealerId: undefined, dealerName: undefined };
  const found = await resolveDealer(scope, ref);
  return "error" in found ? { fail: found } : { dealerId: found.dealerId, dealerName: found.name };
}

type SalesArgs = { fromDate?: string; toDate?: string; region?: (typeof SALES_REGIONS)[number]; city?: string; asm?: string; dealer?: string };

export const salesReport: Tool<InternalScope> = {
  schema: {
    type: "function",
    function: {
      name: "sales_report",
      description: "Sales (accepted orders, same rule as the Sales page) for a date range: total, order count, day/month series, top dealers, by region; billed/paid for finance roles. Filters: region, city, ASM name, dealer.",
      parameters: {
        type: "object",
        properties: {
          fromDate: { type: "string", description: "YYYY-MM-DD; omit for all time" },
          toDate: { type: "string", description: "YYYY-MM-DD, inclusive" },
          region: { type: "string", enum: [...SALES_REGIONS] },
          city: { type: "string" },
          asm: { type: "string", description: "ASM name: sales of the states that ASM covers" },
          dealer: { type: "string", description: "Dealer name, code or id" },
        },
      },
    },
  },
  argsSchema: z.object({
    fromDate: dateArg, toDate: dateArg,
    region: z.enum(SALES_REGIONS).optional(),
    city: z.string().trim().max(80).optional(),
    asm: z.string().trim().max(120).optional(),
    dealer: z.string().trim().max(120).optional(),
  }),
  async handler(args: SalesArgs, scope) {
    const dealer = await dealerFilter(scope, args.dealer);
    if ("fail" in dealer) return dealer.fail;
    let asmId: bigint | undefined;
    if (args.asm) {
      const asm = await prisma.staffProfile.findFirst({ where: { user: { role: "ASM" }, displayName: { contains: args.asm, mode: "insensitive" } }, select: { id: true } });
      if (!asm) return { error: "ASM_NOT_FOUND", message: `No ASM named "${args.asm}".` };
      asmId = asm.id;
    }

    const filters = await resolveSalesFilters({ from: args.fromDate, to: args.toDate, region: args.region, city: args.city, asm: asmId?.toString() });
    const scopeWhere = { AND: [scope.orderWhere, ...(dealer.dealerId ? [{ dealerId: dealer.dealerId }] : [])] };
    const where = { AND: [filters.where, scopeWhere] };
    const [summary, top, regional] = await Promise.all([
      summarizeSales(filters, { scope: scopeWhere, withBills: scope.finance && !dealer.dealerId }),
      dealer.dealerId ? null : prisma.order.groupBy({
        by: ["dealerId"], where,
        _sum: { finalPayableAmountPaise: true }, _count: { _all: true },
        orderBy: { _sum: { finalPayableAmountPaise: "desc" } }, take: 5,
      }),
      args.region || dealer.dealerId ? null : prisma.order.findMany({ where, select: { finalPayableAmountPaise: true, dealer: { select: { region: true } } } }),
    ]);

    const names = top?.length
      ? new Map((await prisma.dealerProfile.findMany({ where: { id: { in: top.map((t) => t.dealerId) } }, select: { id: true, businessName: true } })).map((d) => [d.id, d.businessName]))
      : new Map<bigint, string>();
    const byRegion = new Map<string, bigint>();
    for (const order of regional ?? []) {
      const key = order.dealer.region ? formatSalesRegionLabel(order.dealer.region) : "No region";
      byRegion.set(key, (byRegion.get(key) ?? BigInt(0)) + order.finalPayableAmountPaise);
    }

    const csv = new URLSearchParams({ format: "csv" });
    if (args.fromDate) csv.set("from", args.fromDate);
    if (args.toDate) csv.set("to", args.toDate);
    if (args.region) csv.set("region", args.region);
    if (args.city) csv.set("city", args.city);
    if (asmId) csv.set("asm", asmId.toString());

    return {
      ...summary,
      series: summary.series.slice(-24),
      ...(dealer.dealerName ? { dealer: dealer.dealerName } : {}),
      ...(top ? { topDealers: top.map((t) => ({ dealer: names.get(t.dealerId) ?? t.dealerId.toString(), orders: t._count._all, total: wholeRupees(t._sum.finalPayableAmountPaise ?? BigInt(0)) })) } : {}),
      ...(regional ? { byRegion: [...byRegion].sort((a, b) => Number(b[1] - a[1])).map(([region, paise]) => ({ region, total: wholeRupees(paise) })) } : {}),
      note: "Accepted orders only (approved by RSM and accepted by staff); amounts in whole rupees.",
      ...(scope.salesCsv && !dealer.dealerId ? { download: { label: "Sales report (CSV)", url: `/api/admin/sales-summary?${csv}` } } : {}),
    };
  },
};

export const outstandingReport: Tool<InternalScope> = {
  schema: {
    type: "function",
    function: {
      name: "outstanding_report",
      description: "Unpaid and overdue bills (bill ageing) for the dealers you can access: totals, dealers with the most overdue, or one dealer's bills.",
      parameters: {
        type: "object",
        properties: {
          dealer: { type: "string", description: "Dealer name, code or id" },
          overdueOnly: { type: "boolean" },
          limit: { type: "integer", minimum: 1, maximum: 10 },
        },
      },
    },
  },
  argsSchema: z.object({
    dealer: z.string().trim().max(120).optional(),
    overdueOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(10).optional(),
  }),
  async handler(args: { dealer?: string; overdueOnly?: boolean; limit?: number }, scope) {
    const dealer = await dealerFilter(scope, args.dealer);
    if ("fail" in dealer) return dealer.fail;
    const limit = args.limit ?? 10;
    const bills = await listUnpaidBills(dealer.dealerId ? { AND: [scope.dealerWhere, { id: dealer.dealerId }] } : scope.dealerWhere);

    const byDealer = new Map<string, { dealer: string; unpaid: number; overdue: number; bills: number; oldestBillAgeDays: number }>();
    for (const bill of bills) {
      const row = byDealer.get(bill.dealerId) ?? { dealer: bill.name, unpaid: 0, overdue: 0, bills: 0, oldestBillAgeDays: 0 };
      row.unpaid = round2(row.unpaid + bill.unpaidAmount);
      row.overdue = round2(row.overdue + bill.dueAmount);
      row.bills += 1;
      row.oldestBillAgeDays = Math.max(row.oldestBillAgeDays, bill.age);
      byDealer.set(bill.dealerId, row);
    }
    const dealers = [...byDealer.values()]
      .filter((row) => !args.overdueOnly || row.overdue > 0)
      .sort((a, b) => b.overdue - a.overdue || b.unpaid - a.unpaid);

    return {
      totalUnpaid: round2(bills.reduce((sum, bill) => sum + bill.unpaidAmount, 0)),
      totalOverdue: round2(bills.reduce((sum, bill) => sum + bill.dueAmount, 0)),
      unpaidBills: bills.length,
      overdueBills: bills.filter((bill) => bill.dueAmount > 0).length,
      dealersWithOverdue: [...byDealer.values()].filter((row) => row.overdue > 0).length,
      ...(dealer.dealerId
        ? { bills: bills.sort((a, b) => b.age - a.age).slice(0, limit).map((b) => ({ billNo: b.billNo, billDate: b.billDate, amount: b.billAmount, unpaid: b.unpaidAmount, overdue: b.dueAmount, ageDays: b.age, creditDays: b.creditDays })) }
        : { dealers: dealers.slice(0, limit), hasMore: dealers.length > limit }),
      note: "Overdue = unpaid balance past the bill's credit days.",
      ...(scope.billAgeingCsv ? { download: { label: "Bill ageing (CSV)", url: `/api/reports/bill-ageing?format=csv${dealer.dealerId ? `&dealerId=${dealer.dealerId}` : ""}` } } : {}),
    };
  },
};

export const productSalesReport: Tool<InternalScope> = {
  schema: {
    type: "function",
    function: {
      name: "product_sales_report",
      description: "Top products or catalogue categories by revenue in accepted orders for a date range; optional dealer and category filter.",
      parameters: {
        type: "object",
        properties: {
          fromDate: { type: "string", description: "YYYY-MM-DD" },
          toDate: { type: "string", description: "YYYY-MM-DD, inclusive" },
          by: { type: "string", enum: ["product", "category"] },
          category: { type: "string", description: "Only products whose category contains this" },
          dealer: { type: "string", description: "Dealer name, code or id" },
          limit: { type: "integer", minimum: 1, maximum: 10 },
        },
      },
    },
  },
  argsSchema: z.object({
    fromDate: dateArg, toDate: dateArg,
    by: z.enum(["product", "category"]).optional(),
    category: z.string().trim().max(80).optional(),
    dealer: z.string().trim().max(120).optional(),
    limit: z.number().int().min(1).max(10).optional(),
  }),
  async handler(args: { fromDate?: string; toDate?: string; by?: "product" | "category"; category?: string; dealer?: string; limit?: number }, scope) {
    const dealer = await dealerFilter(scope, args.dealer);
    if ("fail" in dealer) return dealer.fail;
    const limit = args.limit ?? 10;
    const orderWhere = { AND: [ACCEPTED_ONLY, scope.orderWhere, orderFilters(args), ...(dealer.dealerId ? [{ dealerId: dealer.dealerId }] : [])] };

    // ponytail: groups every catalogue number in range (capped at 2000); push the category roll-up into SQL if it outgrows that.
    const [groups, { index }] = await Promise.all([
      prisma.orderItem.groupBy({
        by: ["catalogueNumberSnapshot"],
        where: { order: orderWhere },
        _sum: { finalAmountPaise: true, quantityPacks: true, totalPieces: true },
        orderBy: { _sum: { finalAmountPaise: "desc" } },
        take: 2000,
      }),
      loadCatalogue(),
    ]);

    const wanted = args.category?.toLowerCase();
    const rows = groups.map((g) => {
      const entry = findCatalogueEntry(index, g.catalogueNumberSnapshot);
      return {
        productId: g.catalogueNumberSnapshot,
        name: entry?.product.name ?? g.catalogueNumberSnapshot,
        category: entry ? getCatalogueSection(entry.product) : "Not in catalogue",
        packs: g._sum.quantityPacks ?? 0,
        pieces: g._sum.totalPieces ?? 0,
        revenuePaise: g._sum.finalAmountPaise ?? BigInt(0),
      };
    }).filter((row) => !wanted || row.category.toLowerCase().includes(wanted) || row.name.toLowerCase().includes(wanted));

    const totalPaise = rows.reduce((sum, row) => sum + row.revenuePaise, BigInt(0));
    const base = { from: args.fromDate ?? null, to: args.toDate ?? null, ...(dealer.dealerName ? { dealer: dealer.dealerName } : {}), totalRevenue: rupees(totalPaise), note: "Accepted orders only; revenue after discounts." };

    if (args.by === "category") {
      const byCategory = new Map<string, { category: string; revenuePaise: bigint; packs: number; products: number }>();
      for (const row of rows) {
        const agg = byCategory.get(row.category) ?? { category: row.category, revenuePaise: BigInt(0), packs: 0, products: 0 };
        agg.revenuePaise += row.revenuePaise;
        agg.packs += row.packs;
        agg.products += 1;
        byCategory.set(row.category, agg);
      }
      const categories = [...byCategory.values()].sort((a, b) => Number(b.revenuePaise - a.revenuePaise));
      return { ...base, categories: categories.slice(0, limit).map(({ revenuePaise, ...c }) => ({ ...c, revenue: rupees(revenuePaise) })), hasMore: categories.length > limit };
    }
    return { ...base, products: rows.slice(0, limit).map(({ revenuePaise, ...p }) => ({ ...p, revenue: rupees(revenuePaise) })), hasMore: rows.length > limit };
  },
};

export const salesTarget: Tool<InternalScope> = {
  schema: {
    type: "function",
    function: {
      name: "sales_target",
      description: "Your (team's) annual sales target for this financial year against accepted sales so far.",
      parameters: { type: "object", properties: {} },
    },
  },
  argsSchema: z.object({}),
  async handler(_args: Record<string, never>, scope) {
    if (!scope.actor.staffId) return { error: "NOT_AVAILABLE", message: "Sales targets are kept for sales staff only." };
    const target = await staffSalesTarget(scope.actor, scope.actor.staffId);
    return { ...target, achievedPercent: target.target > 0 ? round2(target.achieved / target.target * 100) : null };
  },
};
