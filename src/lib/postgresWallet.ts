import { WalletStatus, WalletTransactionType, type Prisma } from "@prisma/client";

export class WalletError extends Error {
  constructor(message: string, public status = 400, public code = "wallet_error") {
    super(message);
    this.name = "WalletError";
  }
}

export type WalletActor = {
  userId?: bigint;
  role?: string;
  displayName?: string;
};

type WalletClient = Pick<Prisma.TransactionClient, "dealerWallet" | "walletTransaction" | "$executeRaw">;

export function roundMoney(value: unknown) {
  const n = typeof value === "string" ? Number(value.replace(/,/g, "").trim()) : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function toPaise(value: unknown) {
  const n = typeof value === "string" ? Number(value.replace(/,/g, "").trim()) : Number(value);
  return Number.isFinite(n) ? BigInt(Math.round(n * 100)) : BigInt(0);
}

export function fromPaise(value: bigint | number | null | undefined) {
  return roundMoney(Number(value ?? 0) / 100);
}

function text(value: unknown, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeStatus(status: unknown) {
  return status === WalletStatus.ACTIVE ? "active" : "inactive";
}

function isCreditType(type: WalletTransactionType) {
  return type === WalletTransactionType.CREDIT || type === WalletTransactionType.REFUND;
}

export function normalizeWalletTransaction(row: any) {
  return {
    id: row?.id?.toString?.() ?? "",
    dealerId: row?.dealerId?.toString?.() ?? "",
    type: String(row?.type ?? "").toLowerCase(),
    amount: fromPaise(row?.amountPaise),
    balanceBefore: fromPaise(row?.balanceBeforePaise),
    balanceAfter: fromPaise(row?.balanceAfterPaise),
    relatedOrderId: row?.orderId?.toString?.() ?? "",
    relatedOrderNumber: text(row?.metadata?.orderNumber ?? ""),
    reference: text(row?.reference ?? "", 200),
    note: text(row?.note ?? "", 1000),
    transactionDate: row?.createdAt ?? null,
    actorId: text(row?.metadata?.actorUserId ?? "", 120),
    actorRole: text(row?.metadata?.actorRole ?? "", 40).toLowerCase(),
    actorName: text(row?.metadata?.actorName ?? "", 160),
    idempotencyKey: text(row?.idempotencyKey ?? "", 240),
    createdAt: row?.createdAt ?? null,
  };
}

export function normalizeWalletSnapshot(wallet: any, transactions: any[] = []) {
  const balancePaise = BigInt(wallet?.balancePaise ?? 0);
  const reservedPaise = BigInt(wallet?.reservedPaise ?? 0);
  return {
    dealerId: wallet?.dealerId?.toString?.() ?? "",
    status: normalizeStatus(wallet?.status),
    balance: fromPaise(balancePaise),
    availableBalance: fromPaise(balancePaise - reservedPaise > BigInt(0) ? balancePaise - reservedPaise : BigInt(0)),
    totalCredited: fromPaise(wallet?.totalCreditedPaise ?? 0),
    totalConsumed: fromPaise(wallet?.totalConsumedPaise ?? 0),
    createdAt: wallet?.createdAt ?? null,
    updatedAt: wallet?.updatedAt ?? null,
    transactions: transactions.map(normalizeWalletTransaction),
  };
}

export async function getWalletSnapshot(client: WalletClient, dealerId: bigint, options: { limit?: number } = {}) {
  const limit = Math.min(200, Math.max(1, Number(options.limit ?? 50)));
  const wallet = await client.dealerWallet.findUnique({ where: { dealerId } });
  const history = await client.walletTransaction.findMany({
    where: { dealerId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return normalizeWalletSnapshot(wallet ?? { dealerId, status: WalletStatus.INACTIVE, balancePaise: BigInt(0), reservedPaise: BigInt(0), totalCreditedPaise: BigInt(0), totalConsumedPaise: BigInt(0) }, history);
}

export async function applyWalletChange(
  client: WalletClient,
  dealerId: bigint,
  type: WalletTransactionType,
  amountInput: unknown,
  options: {
    idempotencyKey?: string | null;
    reference?: string | null;
    note?: string | null;
    orderId?: bigint | null;
    metadata?: Record<string, unknown>;
    actor?: WalletActor;
    allowCreate?: boolean;
    /** Log the transaction (ledger + idempotency) without moving the balance - credit-terms dealers have no spendable wallet. */
    recordOnly?: boolean;
  } = {},
) {
  const amountPaise = toPaise(amountInput);
  if (amountPaise <= BigInt(0)) throw new WalletError("A valid positive wallet amount is required", 422, "invalid_amount");
  const idempotencyKey = text(options.idempotencyKey, 240) || null;
  if (idempotencyKey) {
    const existing = await client.walletTransaction.findUnique({ where: { idempotencyKey } });
    if (existing) return { duplicate: true, transaction: normalizeWalletTransaction(existing), balanceAfter: fromPaise(existing.balanceAfterPaise) };
  }

  let wallet = await client.dealerWallet.findUnique({ where: { dealerId } });
  if (!wallet) {
    if (!options.allowCreate && !isCreditType(type) && type !== WalletTransactionType.ADJUSTMENT) throw new WalletError("Dealer wallet was not found", 404, "wallet_not_found");
    wallet = await client.dealerWallet.create({ data: { dealerId, status: options.recordOnly ? WalletStatus.INACTIVE : WalletStatus.ACTIVE } });
  }

  const direction = isCreditType(type) ? BigInt(1) : BigInt(-1);
  const nextBalance = options.recordOnly ? wallet.balancePaise : wallet.balancePaise + (amountPaise * direction);
  if (nextBalance < BigInt(0)) throw new WalletError("Insufficient wallet balance", 409, "insufficient_balance");

  if (!options.recordOnly) {
    const creditedIncrement = isCreditType(type) ? amountPaise : BigInt(0);
    const consumedIncrement = type === WalletTransactionType.ORDER_DEBIT || type === WalletTransactionType.DEBIT ? amountPaise : BigInt(0);
    const updatedCount = await client.$executeRaw`
      UPDATE dealer_wallets
      SET balance_paise = ${nextBalance},
          total_credited_paise = total_credited_paise + ${creditedIncrement},
          total_consumed_paise = total_consumed_paise + ${consumedIncrement},
          updated_at = NOW()
      WHERE id = ${wallet.id}
        AND balance_paise = ${wallet.balancePaise}
        AND reserved_paise = ${wallet.reservedPaise}
    `;
    if (Number(updatedCount) !== 1) throw new WalletError("Wallet balance changed, please retry.", 409, "wallet_conflict");
  }

  const transaction = await client.walletTransaction.create({
    data: {
      dealerId,
      walletId: wallet.id,
      orderId: options.orderId ?? null,
      type,
      amountPaise,
      balanceBeforePaise: wallet.balancePaise,
      balanceAfterPaise: nextBalance,
      idempotencyKey,
      reference: text(options.reference, 200) || null,
      note: text(options.note, 1000) || null,
      metadata: {
        ...(options.metadata ?? {}),
        actorUserId: options.actor?.userId?.toString(),
        actorRole: options.actor?.role,
        actorName: options.actor?.displayName,
      },
    },
  });

  return {
    amount: fromPaise(amountPaise),
    balanceBefore: fromPaise(wallet.balancePaise),
    balanceAfter: fromPaise(nextBalance),
    transaction: normalizeWalletTransaction(transaction),
  };
}

export async function setWalletStatus(client: WalletClient, dealerId: bigint, status: WalletStatus, options: { idempotencyKey?: string | null; note?: string | null; actor?: WalletActor } = {}) {
  const idempotencyKey = text(options.idempotencyKey, 240) || null;
  if (idempotencyKey) {
    const existing = await client.walletTransaction.findUnique({ where: { idempotencyKey } });
    if (existing) return getWalletSnapshot(client, dealerId, { limit: 50 });
  }
  const wallet = await client.dealerWallet.upsert({
    where: { dealerId },
    create: { dealerId, status },
    update: { status },
  });
  await client.walletTransaction.create({
    data: {
      dealerId,
      walletId: wallet.id,
      type: WalletTransactionType.ADJUSTMENT,
      amountPaise: BigInt(0),
      balanceBeforePaise: wallet.balancePaise,
      balanceAfterPaise: wallet.balancePaise,
      idempotencyKey,
      note: text(options.note, 1000) || null,
      metadata: { actorUserId: options.actor?.userId?.toString(), actorRole: options.actor?.role, actorName: options.actor?.displayName, status },
    },
  });
  return getWalletSnapshot(client, dealerId, { limit: 50 });
}

export async function applyWalletAdjustment(
  client: WalletClient,
  dealerId: bigint,
  amountInput: unknown,
  options: {
    direction?: "credit" | "debit";
    idempotencyKey?: string | null;
    reference?: string | null;
    note?: string | null;
    metadata?: Record<string, unknown>;
    actor?: WalletActor;
    allowCreate?: boolean;
  } = {},
) {
  const amountPaise = toPaise(amountInput);
  if (amountPaise <= BigInt(0)) throw new WalletError("A valid positive wallet amount is required", 422, "invalid_amount");
  const deltaPaise = options.direction === "debit" ? -amountPaise : amountPaise;
  const idempotencyKey = text(options.idempotencyKey, 240) || null;
  if (idempotencyKey) {
    const existing = await client.walletTransaction.findUnique({ where: { idempotencyKey } });
    if (existing) return { duplicate: true, transaction: normalizeWalletTransaction(existing), balanceAfter: fromPaise(existing.balanceAfterPaise) };
  }

  let wallet = await client.dealerWallet.findUnique({ where: { dealerId } });
  if (!wallet) {
    if (!options.allowCreate) throw new WalletError("Dealer wallet was not found", 404, "wallet_not_found");
    wallet = await client.dealerWallet.create({ data: { dealerId, status: WalletStatus.ACTIVE } });
  }
  const nextBalance = wallet.balancePaise + deltaPaise;
  if (nextBalance < BigInt(0)) throw new WalletError("Insufficient wallet balance", 409, "insufficient_balance");

  const creditedIncrement = deltaPaise > BigInt(0) ? amountPaise : BigInt(0);
  const consumedIncrement = deltaPaise < BigInt(0) ? amountPaise : BigInt(0);
  const updatedCount = await client.$executeRaw`
    UPDATE dealer_wallets
    SET balance_paise = ${nextBalance},
        total_credited_paise = total_credited_paise + ${creditedIncrement},
        total_consumed_paise = total_consumed_paise + ${consumedIncrement},
        updated_at = NOW()
    WHERE id = ${wallet.id}
      AND balance_paise = ${wallet.balancePaise}
      AND reserved_paise = ${wallet.reservedPaise}
  `;
  if (Number(updatedCount) !== 1) throw new WalletError("Wallet balance changed, please retry.", 409, "wallet_conflict");

  const transaction = await client.walletTransaction.create({
    data: {
      dealerId,
      walletId: wallet.id,
      type: WalletTransactionType.ADJUSTMENT,
      amountPaise,
      balanceBeforePaise: wallet.balancePaise,
      balanceAfterPaise: nextBalance,
      idempotencyKey,
      reference: text(options.reference, 200) || null,
      note: text(options.note, 1000) || null,
      metadata: { ...(options.metadata ?? {}), direction: options.direction ?? "credit", actorUserId: options.actor?.userId?.toString(), actorRole: options.actor?.role, actorName: options.actor?.displayName },
    },
  });
  return { amount: fromPaise(amountPaise), balanceBefore: fromPaise(wallet.balancePaise), balanceAfter: fromPaise(nextBalance), transaction: normalizeWalletTransaction(transaction) };
}
