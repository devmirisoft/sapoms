import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { requireAdmin } from "@/server/admin/admin-route";
import { adminErrorResponse } from "@/server/admin/admin-errors";
import { day, resolveSalesFilters, rupees, summarizeSales } from "@/server/modules/admin-dashboard/sales-summary";
import { formatSalesRegionLabel } from "@/lib/salesRegions";
import { csvRow } from "@/lib/csv";
import { buildSalesReport, type SalesReportScope } from "@/server/modules/admin-dashboard/sales-report";

export const runtime = "nodejs";

const REPORT_COLUMNS = [
  "Order No", "Order Date", "Dealer", "Dealer Code", "City", "State", "Region",
  "RSM", "ASM", "Sales Manager", "Amount (INR)",
];

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const params = new URL(request.url).searchParams;
    const filters = await resolveSalesFilters({
      from: params.get("from"),
      to: params.get("to"),
      region: params.get("region"),
      asm: params.get("asm"),
      city: params.get("city"),
    });

    const format = params.get("format");
    if (format === "csv" || format === "xlsx") {
      const { from, to, region, asm, asmId, city } = filters;
      const scope = {
        region: region ? formatSalesRegionLabel(region) : "All regions",
        asm: asm?.displayName ?? (asmId === null ? "All ASMs" : "Unknown ASM"),
        city: city || "All cities",
        range: from || to ? `${from ? day(from) : "start"} to ${to ? day(to) : "today"}` : "All time",
      };
      if (format === "csv") return csvReport(filters.where, scope);
      return new NextResponse(new Uint8Array(await buildSalesReport(filters, scope)), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${reportName(scope)}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json(
      { success: true, data: await summarizeSales(filters) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[GET /api/admin/sales-summary]", error);
    return adminErrorResponse(error, "Sales summary is temporarily unavailable");
  }
}

function reportName(scope: SalesReportScope) {
  return ["sales", scope.region, scope.asm, scope.city, scope.range]
    .join("_")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
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
          rsmLinks: { orderBy: { rsmId: "asc" }, select: { rsm: { select: { displayName: true } } } },
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
      staff?.parentRsm?.displayName ?? staff?.rsmLinks.map((link) => link.rsm.displayName).join(" / ") ?? "",
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

  // The BOM keeps Excel on the rupee amounts and Indian names rather than mojibake.
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${reportName(scope)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
