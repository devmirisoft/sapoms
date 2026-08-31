import "server-only";

import { OrderAcceptanceStatus, OrderFulfilmentStatus, OrderStatus, Prisma, WalletTransactionType } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { AuthActor } from "@/server/auth/session";
import { isStaffLike } from "@/server/auth/sales-scope";
import { applyWalletChange, fromPaise, roundMoney, toPaise } from "@/lib/postgresWallet";
import { mapPostgresOrderToLegacy } from "@/lib/postgresOrders";

export type LedgerOrderState = "Cancelled" | "Awaiting" | "SupposedToGo" | "SentAndSettled";

export type AccountBookSummary = {
  booked: number;
  bookedCount: number;
  sentAndSettled: number;
  sentAndSettledCount: number;
  supposedToGo: number;
  supposedToGoCount: number;
  awaiting: number;
  awaitingCount: number;
};

const orderInclude = {
  dealer: {
    select: {
      id: true,
      businessName: true,
      dealerCode: true,
      phone: true,
      city: true,
      address: true,
      pincode: true,
      gstin: true,
      discountPercent: true,
      creditDays: true,
      user: { select: { email: true, status: true } },
    },
  },
  assignedStaff: { select: { id: true, displayName: true, warehouse: true } },
  // dispatches feed the order's Pending/Partial/Completed status in the mappers.
  items: { orderBy: { id: "asc" as const }, include: { dispatches: { select: { quantity: true } } } },
  // Required by mapPostgresOrderToLegacy, which derives the order's settled
  // position from its bills.
  ledgerBills: { orderBy: { billDate: "desc" as const } },
} satisfies Prisma.OrderInclude;

type LedgerClient = Pick<Prisma.TransactionClient, "dealerProfile" | "dealerStaffAssignment" | "order" | "dealerWallet" | "walletTransaction" | "$executeRaw">;
type LedgerOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
type LedgerBillRecord = {
  id: bigint
  dealerId: bigint
  orderId?: bigint | null
  orderNumber: string
  billAmountPaise: bigint | number | null
  gstPercent?: Prisma.Decimal | number | string | null
  billDate: Date | string
  pdfName?: string | null
  pdfUrl?: string | null
  pdfFiles?: Prisma.JsonValue
  paidAmountPaise: bigint | number | null
  lastPaymentDate?: Date | string | null
  createdAt: Date
  updatedAt: Date
}
type DealerRecord = Prisma.DealerProfileGetPayload<{ include: { user: { select: { email: true; status: true } }; wallet: true } }>;

function parseBigIntId(value: unknown, label = "id") {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) throw Object.assign(new Error(`Invalid ${label}.`), { status: 400 });
  return BigInt(text);
}

function parseDateOnly(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw Object.assign(new Error(`Valid ${label} is required.`), { status: 400 });
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error(`Valid ${label} is required.`), { status: 400 });
  return parsed;
}

function normalizeDateOnly(value: Date | string | null | undefined) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

function money(value: bigint | number | null | undefined) {
  return fromPaise(value ?? 0);
}

function normalizeDealer(dealer: DealerRecord | LedgerOrder["dealer"], wallet?: { balancePaise?: bigint | null } | null) {
  return {
    Dealer_Id: dealer.id.toString(),
    Dealer_Name: dealer.businessName ?? "",
    Dealer_Email: "user" in dealer ? dealer.user?.email ?? "" : "",
    Dealer_Number: dealer.phone ?? "",
    Dealer_Address: dealer.address ?? "",
    Dealer_City: dealer.city ?? "",
    Dealer_Pincode: dealer.pincode ?? "",
    Dealer_Dealercode: dealer.dealerCode ?? "",
    creditdays: dealer.creditDays ?? "",
    walletBalance: money(wallet?.balancePaise ?? 0),
  };
}

export type LedgerBillPdf = {
  name: string
  url: string
  downloadUrl?: string
  publicId?: string
  bytes?: number
}

// Cloudinary serves raw files inline; fl_attachment flips it to a download.
function attachmentUrl(url: string) {
  return url.includes("/upload/") ? url.replace("/upload/", "/upload/fl_attachment/") : url;
}

export function parseLedgerBillPdfs(value: unknown): LedgerBillPdf[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const url = String(record.url ?? "").trim();
    if (!url) return [];
    const name = String(record.name ?? "").trim() || "Bill PDF";
    const downloadUrl = String(record.downloadUrl ?? "").trim() || attachmentUrl(url);
    const publicId = String(record.publicId ?? "").trim();
    const bytes = Number(record.bytes ?? 0);
    return [{ name, url, downloadUrl, ...(publicId ? { publicId } : {}), ...(Number.isFinite(bytes) && bytes > 0 ? { bytes } : {}) }];
  });
}

// Bills saved before multi-file uploads only carry pdfName / pdfUrl.
function ledgerBillPdfs(bill: LedgerBillRecord): LedgerBillPdf[] {
  const stored = parseLedgerBillPdfs(bill.pdfFiles);
  if (stored.length > 0) return stored;
  if (!bill.pdfUrl) return [];
  const url = bill.pdfUrl;
  return [{ name: bill.pdfName || "Bill PDF", url, downloadUrl: attachmentUrl(url) }];
}

function normalizeLedgerBill(bill: LedgerBillRecord) {
  return {
    id: bill.id.toString(),
    dealerId: bill.dealerId.toString(),
    orderId: bill.orderId?.toString() || "",
    orderNumber: bill.orderNumber,
    billAmount: money(bill.billAmountPaise),
    gstPercent: Number(bill.gstPercent ?? 0),
    billDate: normalizeDateOnly(bill.billDate) || "",
    pdfName: bill.pdfName || "Bill PDF pending",
    pdfUrl: bill.pdfUrl || undefined,
    pdfFiles: ledgerBillPdfs(bill),
    paidAmount: money(bill.paidAmountPaise),
    lastPaymentDate: normalizeDateOnly(bill.lastPaymentDate),
    createdAt: bill.createdAt.toISOString(),
    updatedAt: bill.updatedAt.toISOString(),
  };
}

function classifyPostgresOrder(order: Pick<LedgerOrder, "status" | "acceptanceStatus" | "fulfilmentStatus">): LedgerOrderState {
  if (order.status === OrderStatus.CANCELLED || order.acceptanceStatus === OrderAcceptanceStatus.DECLINED) return "Cancelled";
  if (order.acceptanceStatus !== OrderAcceptanceStatus.ACCEPTED) return "Awaiting";
  return order.fulfilmentStatus === OrderFulfilmentStatus.COMPLETED || order.status === OrderStatus.COMPLETED
    ? "SentAndSettled"
    : "SupposedToGo";
}

function orderMode(order: LedgerOrder) {
  const state = classifyPostgresOrder(order);
  if (state === "SentAndSettled") return "Sent & Settled";
  if (state === "SupposedToGo") return "Supposed to Go";
  if (state === "Awaiting") return "Awaiting Confirm";
  return "Cancelled";
}

/* The advance->credit closing debit and the settlement credits that draw it
   down are internal movements of money the dealer had already paid. Counting
   either one would swing the dealer's outstanding by the residual, so they are
   excluded from the ledger totals entirely. */
export function isSettlementTransaction(metadata: Prisma.JsonValue | null | undefined) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const meta = metadata as Record<string, unknown>;
  return Boolean(meta.walletSettlementClosing) || Boolean(meta.walletSettlementApplication);
}

export function ledgerTransactionDirection(type: WalletTransactionType, metadata: Prisma.JsonValue | null | undefined, orderId?: bigint | null) {
  if (type === WalletTransactionType.CREDIT || type === WalletTransactionType.REFUND) return "credit";
  if (type === WalletTransactionType.ORDER_DEBIT && orderId) return "credit";
  if (type === WalletTransactionType.ADJUSTMENT) {
    const direction = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? String((metadata as Record<string, unknown>).direction ?? "credit") : "credit";
    return direction === "debit" ? "debit" : "credit";
  }
  return "debit";
}

function orderTransaction(order: LedgerOrder) {
  const legacy = mapPostgresOrderToLegacy(order);
  return {
    id: order.id.toString(),
    debit: money(order.finalPayableAmountPaise),
    credit: 0,
    narration: `Order ${order.orderNumber}`,
    date: order.orderDate.toISOString(),
    invoice: order.legacyPhpId || order.orderNumber || order.id.toString(),
    mode: orderMode(order),
    type: "debit",
    order: legacy,
  };
}

function walletLedgerTransaction(tx: Prisma.WalletTransactionGetPayload<{ include: { order: true } }>) {
  const direction = ledgerTransactionDirection(tx.type, tx.metadata, tx.orderId);
  const amount = money(tx.amountPaise);
  return {
    id: tx.id.toString(),
    debit: direction === "debit" ? amount : 0,
    credit: direction === "credit" ? amount : 0,
    narration: tx.note || tx.reference || String(tx.type).toLowerCase().replace(/_/g, " "),
    date: tx.createdAt.toISOString(),
    invoice: tx.reference || tx.order?.orderNumber || tx.orderId?.toString() || "",
    mode: String(tx.type).toLowerCase().replace(/_/g, " "),
    type: String(tx.type).toLowerCase(),
  };
}

function summarizeOrders(orders: LedgerOrder[]): AccountBookSummary {
  let bookedPaise = BigInt(0);
  let sentAndSettledPaise = BigInt(0);
  let supposedToGoPaise = BigInt(0);
  let awaitingPaise = BigInt(0);
  const counts = { bookedCount: 0, sentAndSettledCount: 0, supposedToGoCount: 0, awaitingCount: 0 };

  for (const order of orders) {
    const state = classifyPostgresOrder(order);
    if (state === "Cancelled") continue;
    bookedPaise += order.finalPayableAmountPaise;
    counts.bookedCount += 1;
    if (state === "Awaiting") { awaitingPaise += order.finalPayableAmountPaise; counts.awaitingCount += 1; }
    else if (state === "SupposedToGo") { supposedToGoPaise += order.finalPayableAmountPaise; counts.supposedToGoCount += 1; }
    else { sentAndSettledPaise += order.finalPayableAmountPaise; counts.sentAndSettledCount += 1; }
  }

  return {
    booked: money(bookedPaise),
    sentAndSettled: money(sentAndSettledPaise),
    supposedToGo: money(supposedToGoPaise),
    awaiting: money(awaitingPaise),
    ...counts,
  };
}

export function summarizeWalletForLedger(transactions: Array<{ type: WalletTransactionType; amountPaise: bigint; metadata: Prisma.JsonValue | null; orderId?: bigint | null }>) {
  return transactions.reduce((totals, tx) => {
    if (isSettlementTransaction(tx.metadata)) return totals;
    const amount = toPaise(money(tx.amountPaise));
    if (ledgerTransactionDirection(tx.type, tx.metadata, tx.orderId) === "credit") totals.creditPaise += amount;
    else totals.debitPaise += amount;
    return totals;
  }, { creditPaise: BigInt(0), debitPaise: BigInt(0) });
}

export function calculateLedgerSummary(
  orders: Array<{ status: OrderStatus; acceptanceStatus: OrderAcceptanceStatus; fulfilmentStatus: OrderFulfilmentStatus; finalPayableAmountPaise: bigint }>,
  transactions: Array<{ type: WalletTransactionType; amountPaise: bigint; metadata: Prisma.JsonValue | null; orderId?: bigint | null }>
) {
  const accountBook = summarizeOrders(orders as LedgerOrder[]);
  const wallet = summarizeWalletForLedger(transactions);
  const totalDebit = roundMoney(accountBook.booked + money(wallet.debitPaise));
  const totalCredit = money(wallet.creditPaise);
  return { accountBook, totalDebit, totalCredit, netBalance: roundMoney(totalDebit - totalCredit) };
}

function summaryFrom(orders: LedgerOrder[], transactions: Array<{ type: WalletTransactionType; amountPaise: bigint; metadata: Prisma.JsonValue | null; orderId?: bigint | null }>) {
  return calculateLedgerSummary(orders, transactions);
}

async function canAccessDealer(client: LedgerClient, actor: AuthActor, dealerId: bigint) {
  if (actor.role === "ADMIN") return true;
  if (actor.role === "ACCOUNTANT") return true;
  if (actor.role === "DEALER") return actor.dealerId === dealerId;
  if (isStaffLike(actor) && actor.staffId) {
    const assignment = await client.dealerStaffAssignment.findFirst({
      where: { dealerId, staffId: actor.staffId, active: true, dealer: { deletedAt: null, user: { status: "ACTIVE" } } },
      select: { id: true },
    });
    return Boolean(assignment);
  }
  return false;
}

function dealerWhereForActor(actor: AuthActor): Prisma.DealerProfileWhereInput {
  const active = { deletedAt: null, user: { status: "ACTIVE" as const } };
  if (actor.role === "ADMIN") return active;
  if (actor.role === "ACCOUNTANT") return active;
  if (actor.role === "DEALER" && actor.dealerId) return { ...active, id: actor.dealerId };
  if (isStaffLike(actor) && actor.staffId) return { ...active, staffAssignments: { some: { staffId: actor.staffId, active: true } } };
  return { id: BigInt(-1) };
}

async function findDealerOrder(client: Pick<LedgerClient, "order">, dealerId: bigint, lookup: string) {
  const normalized = String(lookup ?? "").trim();
  if (!normalized) return null;
  const numericId = /^\d+$/.test(normalized) ? BigInt(normalized) : null;
  return client.order.findFirst({
    where: {
      dealerId,
      OR: [
        ...(numericId ? [{ id: numericId }] : []),
        { legacyPhpId: normalized },
        { orderNumber: normalized },
      ],
    },
    select: { id: true, orderNumber: true, legacyPhpId: true },
  });
}

export async function getCollectiveLedger(actor: AuthActor) {
  const dealers = await prisma.dealerProfile.findMany({
    where: dealerWhereForActor(actor),
    include: { user: { select: { email: true, status: true } }, wallet: true },
    orderBy: { businessName: "asc" },
  });
  const dealerIds = dealers.map((dealer) => dealer.id);
  const [orders, transactions] = dealerIds.length === 0 ? [[], []] : await Promise.all([
    prisma.order.findMany({ where: { dealerId: { in: dealerIds } }, include: orderInclude }),
    prisma.walletTransaction.findMany({ where: { dealerId: { in: dealerIds } } }),
  ]);

  return dealers.map((dealer) => {
    const dealerOrders = orders.filter((order) => order.dealerId === dealer.id);
    const dealerTransactions = transactions.filter((tx) => tx.dealerId === dealer.id);
    const summary = summaryFrom(dealerOrders, dealerTransactions);
    return { ...normalizeDealer(dealer, dealer.wallet), totalDebit: summary.totalDebit, totalCredit: summary.totalCredit, netBalance: summary.netBalance, accountBook: summary.accountBook };
  });
}

export async function getDealerLedger(actor: AuthActor, rawDealerId: string) {
  const dealerId = parseBigIntId(rawDealerId, "dealer id");
  if (!(await canAccessDealer(prisma, actor, dealerId))) throw Object.assign(new Error("Ledger access denied."), { status: 403 });

  const dealer = await prisma.dealerProfile.findFirst({
    where: { id: dealerId, deletedAt: null, user: { status: "ACTIVE" } },
    include: { user: { select: { email: true, status: true } }, wallet: true },
  });
  if (!dealer) throw Object.assign(new Error("Dealer not found"), { status: 404 });

  const [orders, transactions, bills] = await Promise.all([
    prisma.order.findMany({ where: { dealerId }, include: orderInclude, orderBy: { orderDate: "desc" } }),
    prisma.walletTransaction.findMany({ where: { dealerId }, include: { order: true }, orderBy: { createdAt: "desc" } }),
    prisma.ledgerBill.findMany({ where: { dealerId }, orderBy: [{ billDate: "desc" }, { id: "desc" }] }),
  ]);
  const summary = summaryFrom(orders, transactions);
  return {
    dealer: normalizeDealer(dealer, dealer.wallet),
    summary: { totalDebit: summary.totalDebit, totalCredit: summary.totalCredit, netBalance: summary.netBalance },
    summaryStats: summary.accountBook,
    orders: orders.filter((order) => classifyPostgresOrder(order) !== "Cancelled").map(mapPostgresOrderToLegacy),
    bills: bills.map(normalizeLedgerBill),
    transactionCount: orders.length + transactions.length,
  };
}

export async function getDealerLedgerTransactions(actor: AuthActor, rawDealerId: string, options: { page?: number; limit?: number }) {
  const dealerId = parseBigIntId(rawDealerId, "dealer id");
  if (!(await canAccessDealer(prisma, actor, dealerId))) throw Object.assign(new Error("Ledger access denied."), { status: 403 });
  const pageSize = Math.min(100, Math.max(5, Number(options.limit || 20)));
  const requestedPage = Math.max(1, Number(options.page || 1));
  const [orders, walletTransactions] = await Promise.all([
    prisma.order.findMany({ where: { dealerId }, include: orderInclude }),
    prisma.walletTransaction.findMany({ where: { dealerId }, include: { order: true } }),
  ]);
  const allTransactions = [
    ...orders.filter((order) => classifyPostgresOrder(order) !== "Cancelled").map(orderTransaction),
    ...walletTransactions.map(walletLedgerTransaction),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const count = allTransactions.length;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  return { data: allTransactions.slice(start, start + pageSize), count, page, pageSize, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
}

export async function getLedgerBillPdf(actor: AuthActor, rawDealerId: string, rawBillId: string, index: number) {
  const dealerId = parseBigIntId(rawDealerId, "dealer id");
  if (!(await canAccessDealer(prisma, actor, dealerId))) throw Object.assign(new Error("Ledger access denied."), { status: 403 });

  const billId = parseBigIntId(rawBillId, "bill id");
  const bill = await prisma.ledgerBill.findFirst({ where: { id: billId, dealerId } });
  if (!bill) throw Object.assign(new Error("Ledger bill not found."), { status: 404 });

  const file = ledgerBillPdfs(bill)[index];
  if (!file) throw Object.assign(new Error("Bill PDF not found."), { status: 404 });
  return file;
}

export async function recordLedgerBill(actor: AuthActor, rawDealerId: string, body: Record<string, unknown>) {
  const dealerId = parseBigIntId(rawDealerId, "dealer id");
  if (actor.role !== "ACCOUNTANT") throw Object.assign(new Error("Only Accountant can save ledger bills."), { status: 403 });

  const requestedOrderNumbers = Array.isArray(body.orderNumbers)
    ? body.orderNumbers.map((value) => String(value || "").trim()).filter(Boolean)
    : [String(body.orderNumber || body.orderId || "").trim()].filter(Boolean);
  const uniqueRequestedOrderNumbers = Array.from(new Set(requestedOrderNumbers));
  if (uniqueRequestedOrderNumbers.length === 0) throw Object.assign(new Error("At least one order number is required."), { status: 400 });

  const billAmount = Number(body.billAmount);
  if (!Number.isFinite(billAmount) || billAmount <= 0) throw Object.assign(new Error("Valid bill amount is required."), { status: 400 });

  const gstPercent = Number(body.gstPercent ?? 0);
  if (!Number.isFinite(gstPercent) || gstPercent < 0) throw Object.assign(new Error("Valid GST percent is required."), { status: 400 });

  const billDate = parseDateOnly(body.billDate, "bill date");
  const billAmountPaise = toPaise(billAmount);
  const uploadedPdfs = parseLedgerBillPdfs(body.pdfFiles);
  const pdfNames = uploadedPdfs.length > 0
    ? uploadedPdfs.map((file) => file.name)
    : Array.isArray(body.pdfNames)
      ? body.pdfNames.map((value) => String(value || "").trim()).filter(Boolean)
      : [String(body.pdfName || "").trim()].filter(Boolean);
  const pdfName = pdfNames.join(", ").slice(0, 255) || null;
  const pdfUrl = (uploadedPdfs[0]?.url || String(body.pdfUrl || "").trim()).slice(0, 4000) || null;
  // Leave the stored PDFs untouched when an edit does not re-send them.
  const hasPdfInput = uploadedPdfs.length > 0 || pdfNames.length > 0;

  return prisma.$transaction(async (tx) => {
    const dealer = await tx.dealerProfile.findFirst({ where: { id: dealerId, deletedAt: null, user: { status: "ACTIVE" } }, select: { id: true } });
    if (!dealer) throw Object.assign(new Error("Dealer not found"), { status: 404 });

    const orderLookups = await Promise.all(uniqueRequestedOrderNumbers.map((orderNumber) => findDealerOrder(tx, dealerId, orderNumber)));
    const storedOrderNumbers = uniqueRequestedOrderNumbers.map((orderNumber, index) => orderLookups[index]?.legacyPhpId || orderNumber);
    const storedOrderNumber = storedOrderNumbers.join(", ");
    const linkedOrder = orderLookups.length === 1 ? orderLookups[0] : null;
    const existing = await tx.ledgerBill.findUnique({ where: { dealerId_orderNumber: { dealerId, orderNumber: storedOrderNumber } } });
    const paidAmountPaise = existing && existing.paidAmountPaise > billAmountPaise ? billAmountPaise : existing?.paidAmountPaise ?? BigInt(0);

    const saved = existing
      ? await tx.ledgerBill.update({
          where: { id: existing.id },
          data: {
            orderId: linkedOrder?.id ?? existing.orderId,
            orderNumber: storedOrderNumber,
            billAmountPaise,
            gstPercent,
            billDate,
            ...(hasPdfInput
              ? { pdfName, pdfUrl, pdfFiles: uploadedPdfs.length > 0 ? (uploadedPdfs as Prisma.InputJsonValue) : Prisma.DbNull }
              : {}),
            paidAmountPaise,
          },
        })
      : await tx.ledgerBill.create({
          data: {
            dealerId,
            orderId: linkedOrder?.id ?? null,
            orderNumber: storedOrderNumber,
            billAmountPaise,
            gstPercent,
            billDate,
            pdfName,
            pdfUrl,
            ...(uploadedPdfs.length > 0 ? { pdfFiles: uploadedPdfs as Prisma.InputJsonValue } : {}),
          },
        });

    return { created: !existing, bill: normalizeLedgerBill(saved) };
  });
}

export async function recordLedgerPayment(actor: AuthActor, rawDealerId: string, body: Record<string, unknown>, idempotencyHeader?: string | null) {
  const dealerId = parseBigIntId(rawDealerId, "dealer id");
  if (actor.role !== "ACCOUNTANT") throw Object.assign(new Error("Only Accountant can record ledger payments."), { status: 403 });
  const idempotencyKey = String(idempotencyHeader || body.idempotencyKey || "").trim().slice(0, 240);
  if (!idempotencyKey) throw Object.assign(new Error("Idempotency key is required."), { status: 400 });
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error("Valid amount is required"), { status: 400 });

  const rawBillId = String(body.billId || "").trim();
  const billId = rawBillId ? parseBigIntId(rawBillId, "bill id") : null;
  const paymentDate = body.paymentDate ? parseDateOnly(body.paymentDate, "payment date") : null;

  return prisma.$transaction(async (tx) => {
    const dealer = await tx.dealerProfile.findFirst({ where: { id: dealerId, deletedAt: null, user: { status: "ACTIVE" } }, select: { id: true } });
    if (!dealer) throw Object.assign(new Error("Dealer not found"), { status: 404 });

    const bill = billId
      ? await tx.ledgerBill.findFirst({ where: { id: billId, dealerId } })
      : null;
    if (billId && !bill) throw Object.assign(new Error("Ledger bill not found."), { status: 404 });

    const result = await applyWalletChange(tx, dealerId, WalletTransactionType.CREDIT, amount, {
      idempotencyKey,
      reference: String(body.referenceId || body.reference || bill?.orderNumber || "").trim().slice(0, 200),
      note: String(body.narration || `Payment received - ${body.paymentMode || "Cash"}`).trim().slice(0, 1000),
      metadata: {
        ledgerPayment: true,
        billId: bill?.id.toString() || null,
        orderNumber: bill?.orderNumber || String(body.referenceId || body.reference || "").trim() || null,
        paymentMode: String(body.paymentMode || "Cash"),
        paymentDate: body.paymentDate || null,
      },
      actor: { userId: actor.userId, role: actor.role, displayName: actor.displayName },
      allowCreate: true,
    });

    if (result.duplicate) {
      return { ...result, bill: bill ? normalizeLedgerBill(bill) : null };
    }

    const updatedBill = bill
      ? await tx.ledgerBill.update({
          where: { id: bill.id },
          data: {
            paidAmountPaise: bill.paidAmountPaise + toPaise(amount) > bill.billAmountPaise ? bill.billAmountPaise : bill.paidAmountPaise + toPaise(amount),
            lastPaymentDate: paymentDate ?? bill.lastPaymentDate ?? new Date(),
          },
        })
      : null;

    return { ...result, bill: updatedBill ? normalizeLedgerBill(updatedBill) : null };
  });
}
