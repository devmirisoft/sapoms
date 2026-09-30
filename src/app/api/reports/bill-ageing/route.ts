import { NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireRole } from "@/server/auth/session";
import { billAgeing } from "@/lib/dealerCreditLimit";
import { fromPaise } from "@/lib/postgresWallet";
import { formatDisplayOrderNumber } from "@/lib/orderDisplay";
import { csvRow } from "@/lib/csv";

export const runtime = "nodejs";

const COLUMNS = ["Name", "Credit Days", "Bill No.", "Bill Date", "Bill Amount", "Age", "Due Amount"];

/** Every bill with a balance still unpaid, aged as of today. `format=csv` downloads it. */
export async function GET(request: Request) {
  try {
    await requireRole(["ACCOUNTANT", "ADMIN", "NSM"]);
    const params = new URL(request.url).searchParams;
    const dealerId = /^\d+$/.test(params.get("dealerId") ?? "") ? BigInt(params.get("dealerId")!) : null;

    const bills = await prisma.ledgerBill.findMany({
      where: {
        billAmountPaise: { gt: prisma.ledgerBill.fields.paidAmountPaise },
        dealer: { deletedAt: null, ...(dealerId === null ? {} : { id: dealerId }) },
      },
      select: {
        orderNumber: true, billDate: true, billAmountPaise: true, paidAmountPaise: true, extraCreditDays: true,
        dealer: { select: { id: true, businessName: true, creditDays: true } },
      },
      orderBy: [{ dealer: { businessName: "asc" } }, { billDate: "asc" }, { id: "asc" }],
    });

    const now = Date.now();
    const rows = bills.map((bill) => {
      // Dealers not on credit terms (creditDays unset) owe from the bill date.
      const creditDays = bill.dealer.creditDays ?? 0;
      const { ageDays, duePaise } = billAgeing(bill, creditDays, now);
      return {
        dealerId: bill.dealer.id.toString(),
        name: bill.dealer.businessName,
        creditDays: creditDays + bill.extraCreditDays,
        billNo: bill.orderNumber.split(",").map((id) => formatDisplayOrderNumber(id)).join(", "),
        billDate: bill.billDate.toISOString().slice(0, 10),
        billAmount: fromPaise(bill.billAmountPaise),
        age: ageDays,
        dueAmount: fromPaise(duePaise),
      };
    });

    if (params.get("format") !== "csv") {
      return NextResponse.json({ success: true, data: rows }, { headers: { "Cache-Control": "no-store" } });
    }

    const csv = [
      csvRow(COLUMNS),
      ...rows.map((row) => csvRow([row.name, row.creditDays, row.billNo, row.billDate, row.billAmount, row.age, row.dueAmount])),
    ].join("\r\n");
    const today = new Date(now).toISOString().slice(0, 10);
    // The BOM keeps Excel on UTF-8 for dealer names.
    return new NextResponse(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bill-ageing-${today}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    console.error("[GET /api/reports/bill-ageing]", error);
    const status = error?.message === "Unauthenticated" ? 401 : error?.message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ success: false, message: status === 500 ? "Unable to build the report." : error.message }, { status });
  }
}
