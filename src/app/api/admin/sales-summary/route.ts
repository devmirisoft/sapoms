import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { requireAdmin } from "@/server/admin/admin-route";
import { adminErrorResponse } from "@/server/admin/admin-errors";
import { periodKey } from "@/server/modules/admin-dashboard/postgres-admin-dashboard.repository";
import { SALES_REGION_OPTIONS, formatSalesRegionLabel, type SalesRegionOptionValue } from "@/lib/salesRegions";
import { csvRow } from "@/lib/csv";

export const runtime = "nodejs";

const DAY_MS = 86_400_000;

/** A sale only counts once the RSM has approved it and the assigned staff has accepted it. */
const ACCEPTED_ONLY = {
  rsmApprovalStatus: "ACCEPTED",
  acceptanceStatus: "ACCEPTED",
  status: { notIn: ["CANCELLED", "DECLINED"] },
} satisfies Prisma.OrderWhereInput;

const REPORT_COLUMNS = [
  "Order No", "Order Date", "Dealer", "Dealer Code", "City", "State", "Region",
  "RSM", "ASM", "Sales Manager", "Amount (INR)",
];

/** An unset bound means no bound, so a range nobody picked reads as all time. */
function parseDay(value: string | null, endOfDay = false) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(`${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function day(date: Date) {
  return date.toISOString().slice(0, 10);
}

function rupees(paise: bigint) {
  return Number(paise / BigInt(100));
}

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const params = new URL(request.url).searchParams;

    const from = parseDay(params.get("from"));
    const to = parseDay(params.get("to"), true);

    const regionParam = String(params.get("region") ?? "").trim().toUpperCase();
    const region = SALES_REGION_OPTIONS.some((option) => option.value === regionParam)
      ? (regionParam as SalesRegionOptionValue)
      : undefined;
    // The sales of an ASM are the sales of the states assigned to them. The states are
    // read here rather than taken from the caller so an ASM with none scopes to nothing.
    // ponytail: exact state match, mirrors how assigned_states is stored on the ASM.
    const asmId = /^\d+$/.test(String(params.get("asm") ?? "").trim()) ? BigInt(params.get("asm")!.trim()) : null;
    const asm = asmId === null ? null : await prisma.staffProfile.findFirst({
      where: { id: asmId, user: { role: "ASM" } },
      select: { displayName: true, assignedStates: true },
    });

    const city = String(params.get("city") ?? "").trim();

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

    if (params.get("format") === "csv") {
      return csvReport(where, {
        region: region ? formatSalesRegionLabel(region) : "All regions",
        asm: asm?.displayName ?? (asmId === null ? "All ASMs" : "Unknown ASM"),
        city: city || "All cities",
        range: from || to ? `${from ? day(from) : "start"} to ${to ? day(to) : "today"}` : "All time",
      });
    }

    // `earliest` is the oldest record in this scope whatever the picked range, so the
    // date fields can be walked back as far as there is anything to show.
    const [orders, oldest] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        select: { orderDate: true, finalPayableAmountPaise: true },
        orderBy: { orderDate: "asc" },
      }),
      prisma.order.aggregate({
        where: { ...where, orderDate: undefined },
        _min: { orderDate: true },
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

    return NextResponse.json(
      {
        success: true,
        data: {
          from: from ? day(from) : null,
          to: to ? day(to) : null,
          earliest: oldest._min.orderDate ? day(oldest._min.orderDate) : null,
          granularity,
          orderCount: orders.length,
          total: rupees(totalPaise),
          series: Array.from(buckets.entries())
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([period, paise]) => ({ period, total: rupees(paise) })),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[GET /api/admin/sales-summary]", error);
    return adminErrorResponse(error, "Sales summary is temporarily unavailable");
  }
}

/** One row per accepted order in scope, under a header naming the filters it was run with. */
async function csvReport(
  where: Prisma.OrderWhereInput,
  scope: { region: string; asm: string; city: string; range: string },
) {
  const orders = await prisma.order.findMany({
    where,
    select: {
      orderNumber: true,
      orderDate: true,
      finalPayableAmountPaise: true,
      dealer: { select: { businessName: true, dealerCode: true, city: true, state: true, region: true } },
      assignedStaff: {
        select: {
          displayName: true,
          staffRoleType: true,
          parentAsm: { select: { displayName: true } },
          parentRsm: { select: { displayName: true } },
        },
      },
    },
    orderBy: { orderDate: "asc" },
  });

  let totalPaise = BigInt(0);
  const rows = orders.map((order) => {
    totalPaise += order.finalPayableAmountPaise;
    const staff = order.assignedStaff;
    // An ASM can carry an order itself, in which case it is its own ASM.
    const asmName = staff?.parentAsm?.displayName ?? (staff?.staffRoleType === "ASM" ? staff.displayName : "");
    const salesManager = staff && staff.staffRoleType !== "ASM" && staff.staffRoleType !== "RSM" ? staff.displayName : "";
    return csvRow([
      order.orderNumber,
      day(order.orderDate),
      order.dealer?.businessName ?? "",
      order.dealer?.dealerCode ?? "",
      order.dealer?.city ?? "",
      order.dealer?.state ?? "",
      order.dealer?.region ? formatSalesRegionLabel(order.dealer.region) : "",
      staff?.parentRsm?.displayName ?? "",
      asmName,
      salesManager,
      rupees(order.finalPayableAmountPaise),
    ]);
  });

  const csv = [
    csvRow(["Sales report"]),
    csvRow(["Region", scope.region]),
    csvRow(["ASM", scope.asm]),
    csvRow(["City", scope.city]),
    csvRow(["Date range", scope.range]),
    csvRow(["Orders", orders.length]),
    csvRow(["Total (INR)", rupees(totalPaise)]),
    "",
    csvRow(REPORT_COLUMNS),
    ...rows,
    "",
    csvRow(["", "", "", "", "", "", "", "", "", "Total", rupees(totalPaise)]),
  ].join("\r\n");

  const name = ["sales", scope.region, scope.asm, scope.city, scope.range]
    .join("_")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  // The BOM keeps Excel on the rupee amounts and Indian names rather than mojibake.
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
