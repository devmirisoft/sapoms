import "server-only";

import { Prisma, WalletSettlementStatus, WalletTransactionType } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { AuthActor } from "@/server/auth/session";
import { applyWalletChange, fromPaise, toPaise } from "@/lib/postgresWallet";

/* When a dealer moves advance -> credit the wallet must read zero, but the
   money itself still belongs to the dealer. Rather than deleting it, the
   residual is moved into an OPEN WalletSettlement that the accountant draws
   down against that dealer's bills. Every draw-down goes back through the
   wallet as a settlement-tagged CREDIT so the ledger and the settlement can
   never disagree about how much has been consumed. */

/** Marks the transactions this flow writes so the ledger can leave them out of
    the dealer's outstanding. Both legs are internal bookkeeping, not new debt. */
export const SETTLEMENT_CLOSING_FLAG = "walletSettlementClosing";
export const SETTLEMENT_APPLICATION_FLAG = "walletSettlementApplication";

type SettlementClient = Prisma.TransactionClient;

function text(value: unknown, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function parseBigIntId(value: unknown, label = "id") {
  const raw = text(value, 40);
  if (!/^\d+$/.test(raw)) throw Object.assign(new Error(`A valid ${label} is required.`), { status: 400 });
  return BigInt(raw);
}

const settlementInclude = {
  dealer: { select: { businessName: true, dealerCode: true } },
  applications: {
    orderBy: { createdAt: "desc" },
    include: {
      bill: { select: { orderNumber: true } },
      appliedBy: { select: { email: true, staffProfile: { select: { displayName: true } } } },
    },
  },
} satisfies Prisma.WalletSettlementInclude;

export function normalizeSettlement(row: any) {
  const originalPaise = BigInt(row?.originalPaise ?? 0);
  const remainingPaise = BigInt(row?.remainingPaise ?? 0);
  return {
    id: row?.id?.toString?.() ?? "",
    dealerId: row?.dealerId?.toString?.() ?? "",
    dealerName: row?.dealer?.businessName ?? "",
    dealerCode: row?.dealer?.dealerCode ?? "",
    status: String(row?.status ?? "").toLowerCase(),
    originalAmount: fromPaise(originalPaise),
    remainingAmount: fromPaise(remainingPaise),
    appliedAmount: fromPaise(originalPaise - remainingPaise),
    note: row?.note ?? "",
    openedAt: row?.createdAt ?? null,
    closedAt: row?.closedAt ?? null,
    applications: (row?.applications ?? []).map((application: any) => ({
      id: application?.id?.toString?.() ?? "",
      billId: application?.billId?.toString?.() ?? "",
      orderId: application?.orderId?.toString?.() ?? "",
      orderNumber: application?.bill?.orderNumber ?? "",
      amount: fromPaise(BigInt(application?.amountPaise ?? 0)),
      note: application?.note ?? "",
      appliedAt: application?.createdAt ?? null,
      appliedByName: application?.appliedBy?.staffProfile?.displayName ?? application?.appliedBy?.email ?? "",
    })),
  };
}

/** Returns the dealer's OPEN settlement, if any. */
export async function findOpenSettlement(client: SettlementClient, dealerId: bigint) {
  return client.walletSettlement.findFirst({
    where: { dealerId, status: WalletSettlementStatus.OPEN },
    include: settlementInclude,
  });
}

/* Called from inside the dealer-update transaction when walletActive flips to
   false. Zeroes the wallet and parks the residual in an OPEN settlement.
   A dealer with no balance needs no settlement, so this is a no-op then. */
export async function openSettlementForWalletClosure(
  client: SettlementClient,
  dealerId: bigint,
  actor: { userId?: bigint; role?: string; displayName?: string },
  options: { note?: string | null } = {},
) {
  const wallet = await client.dealerWallet.findUnique({ where: { dealerId } });
  const balancePaise = BigInt(wallet?.balancePaise ?? 0);
  if (!wallet || balancePaise <= BigInt(0)) return null;

  const existing = await client.walletSettlement.findFirst({
    where: { dealerId, status: WalletSettlementStatus.OPEN },
    select: { id: true },
  });
  if (existing) {
    throw Object.assign(new Error("This dealer already has an open wallet settlement."), { status: 409, code: "settlement_already_open" });
  }

  const note = text(options.note) || "Wallet closed on switch from advance to credit";
  const closing = await applyWalletChange(client, dealerId, WalletTransactionType.DEBIT, fromPaise(balancePaise), {
    note,
    reference: "ADVANCE_TO_CREDIT",
    metadata: { [SETTLEMENT_CLOSING_FLAG]: true },
    actor,
  });

  return client.walletSettlement.create({
    data: {
      dealerId,
      originalPaise: balancePaise,
      remainingPaise: balancePaise,
      status: WalletSettlementStatus.OPEN,
      closingTransactionId: closing.transaction?.id ? BigInt(closing.transaction.id) : null,
      openedByUserId: actor.userId ?? null,
      note,
    },
    include: settlementInclude,
  });
}

/** Blocks credit -> advance while money is still unsettled, so a dealer can
    never hold a fresh wallet and an unresolved residual at the same time. */
export async function assertNoOpenSettlement(client: SettlementClient, dealerId: bigint) {
  const open = await client.walletSettlement.findFirst({
    where: { dealerId, status: WalletSettlementStatus.OPEN },
    select: { id: true, remainingPaise: true },
  });
  if (open) {
    throw Object.assign(
      new Error(
        `This dealer has an unsettled wallet balance of Rs ${fromPaise(open.remainingPaise)}. ` +
        "The accountant must settle or void it before switching back to advance.",
      ),
      { status: 409, code: "settlement_open" },
    );
  }
}

function assertAccountant(actor: AuthActor, action = "view wallet settlements") {
  if (actor.role !== "ACCOUNTANT" && actor.role !== "ADMIN") {
    throw Object.assign(new Error(`Only Accountant can ${action}.`), { status: 403 });
  }
}

export async function listSettlements(actor: AuthActor, params: { status?: string; dealerId?: string; search?: string } = {}) {
  assertAccountant(actor);
  const requested = text(params.status, 20).toUpperCase();
  const status = ["OPEN", "SETTLED", "VOID"].includes(requested) ? (requested as WalletSettlementStatus) : undefined;
  const search = text(params.search, 120);

  const where: Prisma.WalletSettlementWhereInput = {
    ...(status ? { status } : {}),
    ...(params.dealerId ? { dealerId: parseBigIntId(params.dealerId, "dealer id") } : {}),
    ...(search
      ? {
          dealer: {
            OR: [
              { businessName: { contains: search, mode: "insensitive" } },
              { dealerCode: { contains: search, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };

  const rows = await prisma.walletSettlement.findMany({
    where,
    include: settlementInclude,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  const openRows = rows.filter((row) => row.status === WalletSettlementStatus.OPEN);
  const openTotal = openRows.reduce((sum, row) => sum + row.remainingPaise, BigInt(0));

  return {
    settlements: rows.map(normalizeSettlement),
    summary: { openCount: openRows.length, openAmount: fromPaise(openTotal) },
  };
}

export async function getSettlement(actor: AuthActor, settlementId: string) {
  assertAccountant(actor);
  const id = parseBigIntId(settlementId, "settlement id");
  const settlement = await prisma.walletSettlement.findUnique({ where: { id }, include: settlementInclude });
  if (!settlement) throw Object.assign(new Error("Settlement not found."), { status: 404 });

  /* The accountant picks the invoice to settle against, so hand back this
     dealer's bills that still have something outstanding. */
  const bills = await prisma.ledgerBill.findMany({
    where: { dealerId: settlement.dealerId },
    orderBy: { billDate: "desc" },
    take: 200,
  });

  return {
    settlement: normalizeSettlement(settlement),
    bills: bills
      .map((bill) => ({
        id: bill.id.toString(),
        orderId: bill.orderId?.toString() ?? "",
        orderNumber: bill.orderNumber,
        billDate: bill.billDate,
        billAmount: fromPaise(bill.billAmountPaise),
        paidAmount: fromPaise(bill.paidAmountPaise),
        dueAmount: fromPaise(bill.billAmountPaise - bill.paidAmountPaise),
      }))
      .filter((bill) => bill.dueAmount > 0),
  };
}

/* Applies part (or all) of an open settlement against one of the dealer's
   bills. The money re-enters the wallet as a settlement-tagged CREDIT and the
   bill's paid amount moves in the same transaction, so the dealer's
   outstanding drops by exactly what was applied. */
export async function applySettlement(
  actor: AuthActor,
  settlementId: string,
  body: Record<string, unknown>,
  idempotencyHeader?: string | null,
) {
  assertAccountant(actor, "settle wallet balances");
  const id = parseBigIntId(settlementId, "settlement id");
  const idempotencyKey = text(idempotencyHeader || body.idempotencyKey, 240);
  if (!idempotencyKey) throw Object.assign(new Error("Idempotency key is required."), { status: 400 });

  const amountPaise = toPaise(body.amount);
  if (amountPaise <= BigInt(0)) throw Object.assign(new Error("A valid positive amount is required."), { status: 400 });

  const billId = body.billId ? parseBigIntId(body.billId, "bill id") : null;
  if (!billId) throw Object.assign(new Error("Select the order or invoice to settle against."), { status: 400 });

  return prisma.$transaction(async (tx) => {
    const existing = await tx.walletSettlementApplication.findUnique({
      where: { idempotencyKey },
      include: { settlement: { include: settlementInclude } },
    });
    if (existing) {
      return { duplicate: true, settlement: normalizeSettlement(existing.settlement), applied: fromPaise(existing.amountPaise) };
    }

    const settlement = await tx.walletSettlement.findUnique({ where: { id } });
    if (!settlement) throw Object.assign(new Error("Settlement not found."), { status: 404 });
    if (settlement.status !== WalletSettlementStatus.OPEN) {
      throw Object.assign(new Error("This settlement is already closed."), { status: 409, code: "settlement_closed" });
    }
    if (amountPaise > settlement.remainingPaise) {
      throw Object.assign(
        new Error(`Only Rs ${fromPaise(settlement.remainingPaise)} is left to settle.`),
        { status: 422, code: "amount_exceeds_remaining" },
      );
    }

    const bill = await tx.ledgerBill.findFirst({ where: { id: billId, dealerId: settlement.dealerId } });
    if (!bill) throw Object.assign(new Error("Ledger bill not found for this dealer."), { status: 404 });

    const billDuePaise = bill.billAmountPaise - bill.paidAmountPaise;
    if (billDuePaise <= BigInt(0)) throw Object.assign(new Error("This bill is already fully paid."), { status: 422, code: "bill_settled" });
    if (amountPaise > billDuePaise) {
      throw Object.assign(
        new Error(`This bill only has Rs ${fromPaise(billDuePaise)} outstanding.`),
        { status: 422, code: "amount_exceeds_bill" },
      );
    }

    const note = text(body.note) || `Settled from advance wallet against ${bill.orderNumber}`;
    const credit = await applyWalletChange(tx, settlement.dealerId, WalletTransactionType.CREDIT, fromPaise(amountPaise), {
      idempotencyKey: `settlement:${idempotencyKey}`,
      reference: bill.orderNumber,
      note,
      orderId: bill.orderId ?? null,
      metadata: {
        [SETTLEMENT_APPLICATION_FLAG]: true,
        settlementId: settlement.id.toString(),
        billId: bill.id.toString(),
        orderNumber: bill.orderNumber,
      },
      actor: { userId: actor.userId, role: actor.role, displayName: actor.displayName },
      allowCreate: true,
    });

    await tx.ledgerBill.update({
      where: { id: bill.id },
      data: { paidAmountPaise: bill.paidAmountPaise + amountPaise, lastPaymentDate: new Date() },
    });

    await tx.walletSettlementApplication.create({
      data: {
        settlementId: settlement.id,
        billId: bill.id,
        orderId: bill.orderId ?? null,
        amountPaise,
        walletTransactionId: credit.transaction?.id ? BigInt(credit.transaction.id) : null,
        idempotencyKey,
        appliedByUserId: actor.userId ?? null,
        note,
      },
    });

    const remainingPaise = settlement.remainingPaise - amountPaise;
    const fullySettled = remainingPaise <= BigInt(0);
    const updated = await tx.walletSettlement.update({
      where: { id: settlement.id },
      data: {
        remainingPaise,
        status: fullySettled ? WalletSettlementStatus.SETTLED : WalletSettlementStatus.OPEN,
        closedAt: fullySettled ? new Date() : null,
      },
      include: settlementInclude,
    });

    return { duplicate: false, settlement: normalizeSettlement(updated), applied: fromPaise(amountPaise) };
  });
}

/* Escape hatch for a residual that was reconciled outside the system, so the
   dealer is not stuck unable to move back to advance. */
export async function voidSettlement(actor: AuthActor, settlementId: string, body: Record<string, unknown>) {
  assertAccountant(actor, "void wallet settlements");
  const id = parseBigIntId(settlementId, "settlement id");
  const note = text(body.note);
  if (!note) throw Object.assign(new Error("A reason is required to void a settlement."), { status: 400 });

  return prisma.$transaction(async (tx) => {
    const settlement = await tx.walletSettlement.findUnique({ where: { id } });
    if (!settlement) throw Object.assign(new Error("Settlement not found."), { status: 404 });
    if (settlement.status !== WalletSettlementStatus.OPEN) {
      throw Object.assign(new Error("This settlement is already closed."), { status: 409, code: "settlement_closed" });
    }

    const updated = await tx.walletSettlement.update({
      where: { id: settlement.id },
      data: {
        status: WalletSettlementStatus.VOID,
        closedAt: new Date(),
        note: `${settlement.note ?? ""}${settlement.note ? " | " : ""}Voided: ${note}`.slice(0, 1000),
      },
      include: settlementInclude,
    });

    return { settlement: normalizeSettlement(updated) };
  });
}
