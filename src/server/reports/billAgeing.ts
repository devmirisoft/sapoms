import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { billAgeing } from "@/lib/dealerCreditLimit";
import { fromPaise } from "@/lib/postgresWallet";
import { formatDisplayOrderNumber } from "@/lib/orderDisplay";

/**
 * Every bill with a balance still unpaid, aged as of `now`. Shared by the bill-ageing
 * report and the assistant; `dealer` narrows it (to one dealer, or a user's scope).
 * dueAmount is only the overdue part: the unpaid balance once past due, else 0.
 */
export async function listUnpaidBills(dealer: Prisma.DealerProfileWhereInput = {}, now = Date.now()) {
  const bills = await prisma.ledgerBill.findMany({
    where: {
      billAmountPaise: { gt: prisma.ledgerBill.fields.paidAmountPaise },
      dealer: { deletedAt: null, ...dealer },
    },
    select: {
      orderNumber: true, billDate: true, billAmountPaise: true, paidAmountPaise: true, extraCreditDays: true,
      dealer: { select: { id: true, businessName: true, creditDays: true } },
    },
    orderBy: [{ dealer: { businessName: "asc" } }, { billDate: "asc" }, { id: "asc" }],
  });

  return bills.map((bill) => {
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
      unpaidAmount: fromPaise(bill.billAmountPaise - bill.paidAmountPaise),
      age: ageDays,
      dueAmount: fromPaise(duePaise),
    };
  });
}
