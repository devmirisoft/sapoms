import "server-only";

import type OpenAI from "openai";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { getDealerCreditStatus } from "@/lib/dealerCreditLimit";
import type { ToolContext } from "../types";
import { indiaDate, rupees } from "../orders";

export const schema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_ledger_summary",
    description: "This dealer's account: credit limit and available credit (credit dealers) or wallet balance (advance dealers), unpaid bills, overdue status, last payment.",
    parameters: { type: "object", properties: {} },
  },
};

export const argsSchema = z.object({});

export async function handler(_args: z.infer<typeof argsSchema>, ctx: ToolContext) {
  const dealer = await prisma.dealerProfile.findUnique({
    where: { id: ctx.dealerId },
    select: { id: true, creditDays: true, creditLimitPaise: true, tempCreditLimitPaise: true, wallet: true },
  });
  if (!dealer) return { error: "ACCOUNT_NOT_FOUND" };

  const [bills, lastPayment, credit] = await Promise.all([
    prisma.ledgerBill.findMany({ where: { dealerId: dealer.id }, select: { billAmountPaise: true, paidAmountPaise: true } }),
    prisma.walletTransaction.findFirst({ where: { dealerId: dealer.id, type: "CREDIT" }, orderBy: { createdAt: "desc" }, select: { amountPaise: true, createdAt: true } }),
    getDealerCreditStatus(prisma, dealer),
  ]);
  const unpaid = bills.filter((bill) => bill.billAmountPaise > bill.paidAmountPaise);
  const common = {
    unpaidBills: unpaid.length,
    unpaidBillsAmount: rupees(unpaid.reduce((sum, bill) => sum + bill.billAmountPaise - bill.paidAmountPaise, BigInt(0))),
    lastPaymentDate: lastPayment ? indiaDate(lastPayment.createdAt) : null,
    lastPaymentAmount: lastPayment ? rupees(lastPayment.amountPaise) : null,
  };

  if (credit) {
    return {
      accountType: "credit",
      creditDays: dealer.creditDays,
      creditLimit: credit.creditLimitPaise === null ? null : rupees(credit.creditLimitPaise),
      temporaryCredit: rupees(credit.tempCreditLimitPaise),
      creditUsed: rupees(credit.usedPaise),
      creditAvailable: credit.remainingPaise === null ? null : rupees(credit.remainingPaise),
      overdue: credit.isOverdue,
      ...(credit.overdueSince ? { overdueSinceBillDate: indiaDate(credit.overdueSince), note: "New orders are blocked until overdue bills are paid." } : {}),
      ...common,
    };
  }
  const wallet = dealer.wallet;
  return {
    accountType: wallet?.status === "ACTIVE" ? "advance" : "none",
    ...(wallet?.status === "ACTIVE" ? { walletBalance: rupees(wallet.balancePaise), walletReserved: rupees(wallet.reservedPaise), walletAvailable: rupees(wallet.balancePaise - wallet.reservedPaise) } : {}),
    ...common,
  };
}
