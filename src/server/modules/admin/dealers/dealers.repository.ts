import "server-only";

import { Prisma, WalletStatus } from "@prisma/client";
import { setWalletStatus } from "@/lib/postgresWallet";
import { assertNoOpenSettlement, openSettlementForWalletClosure } from "@/lib/walletSettlement";
import { prisma } from "@/server/db/prisma";
import { paginationToPrisma } from "@/server/admin/admin-pagination";
import { AdminRouteError } from "@/server/admin/admin-errors";
import { normalizeEmail } from "@/server/auth/providers/postgres-auth.provider";
import { hashPassword } from "@/server/auth/password";
import { invalidateStaffAssignmentCache } from "@/lib/orderScopeServer";
import type {
  AdminDealerListInput,
  AdminDealerRecord,
  AdminDealerRepository,
  AdminDealerStaffAssignment,
  AuthActor,
  CreateAdminDealerInput,
  UpdateAdminDealerInput,
  UpdateDealerStatusInput,
} from "./dealers.types";

function buildWhere(input: AdminDealerListInput): Prisma.DealerProfileWhereInput {
  const search = input.search.trim();
  const base: Prisma.DealerProfileWhereInput = { deletedAt: null, user: { deletedAt: null } };
  const filters: Prisma.DealerProfileWhereInput[] = [base];

  if (input.staffId) {
    filters.push({
      staffAssignments: {
        some: {
          staffId: BigInt(input.staffId),
          active: true,
        },
      },
    });
  }

  if (input.status) {
    filters.push({ user: { status: input.status } });
  }

  if (input.wallet === "active") {
    filters.push({ wallet: { is: { status: "ACTIVE" } } });
  } else if (input.wallet === "inactive") {
    filters.push({ OR: [{ wallet: { is: null } }, { wallet: { is: { status: "INACTIVE" } } }] });
  }

  if (input.city) {
    filters.push({ city: { equals: input.city, mode: "insensitive" } });
  }

  if (input.name) {
    filters.push({ businessName: { contains: input.name, mode: "insensitive" } });
  }

  if (input.email) {
    filters.push({ user: { email: { contains: input.email, mode: "insensitive" } } });
  }

  if (input.phone) {
    filters.push({ phone: { contains: input.phone, mode: "insensitive" } });
  }

  if (search) {
    filters.push({ OR: [
      { businessName: { contains: search, mode: "insensitive" } },
      { dealerCode: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
      { city: { contains: search, mode: "insensitive" } },
      { gstin: { contains: search, mode: "insensitive" } },
      { user: { email: { contains: search, mode: "insensitive" } } },
    ] });
  }

  return filters.length === 1 ? base : { AND: filters };
}

const staffAssignmentInclude = {
  staff: { select: { id: true, displayName: true, designation: true, staffRoleType: true, salesRegion: true, mobileNo: true, user: { select: { email: true, status: true, deletedAt: true, role: true } } } },
} satisfies Prisma.DealerStaffAssignmentInclude;

const include = {
  user: { select: { id: true, email: true, username: true, status: true, deletedAt: true } },
  wallet: { select: { status: true } },
  regionalManager: { select: { id: true, email: true, staffProfile: { select: { displayName: true, salesRegion: true } } } },
  staffAssignments: { where: { active: true }, include: staffAssignmentInclude, orderBy: { assignedAt: "desc" } },
} satisfies Prisma.DealerProfileInclude;

function normalizeBigIntList(values: Array<string | bigint>) {
  return Array.from(new Set(values.map((value) => BigInt(value))));
}

function cleanOptional(value: string | undefined) {
  return value === undefined ? undefined : value.trim();
}

function decimalValue(value: string | undefined) {
  return value === undefined ? undefined : new Prisma.Decimal(value);
}

function bigintValue(value: string | undefined) {
  return value === undefined ? undefined : BigInt(value);
}

function conflict(message: string, code: string) {
  return new AdminRouteError("CONFLICT", message, { code });
}

function notFound(message: string, code = "NOT_FOUND", extra?: Record<string, unknown>) {
  return new AdminRouteError("NOT_FOUND", message, { code, ...extra });
}

function invalid(message: string, code = "INVALID_REQUEST", extra?: Record<string, unknown>) {
  return new AdminRouteError("INVALID_REQUEST", message, { code, ...extra });
}

async function ensureStaff(tx: Prisma.TransactionClient, staffIds: bigint[]) {
  if (staffIds.length === 0) return [];
  const staff = await tx.staffProfile.findMany({ where: { id: { in: staffIds }, user: { role: { in: ["STAFF", "RSM", "ASM"] }, status: "ACTIVE", deletedAt: null } }, include: { user: { select: { email: true, status: true, deletedAt: true } } } });
  const found = new Set(staff.map((row) => row.id.toString()));
  const missing = staffIds.map(String).filter((id) => !found.has(id));
  if (missing.length) throw notFound("One or more staff members were not found", "STAFF_NOT_FOUND", { staffIds: missing });
  return staff;
}

async function resolveRsm(tx: Prisma.TransactionClient, rsmUserId: bigint | undefined) {
  if (!rsmUserId) return undefined;
  const rsm = await tx.user.findFirst({
    where: { id: rsmUserId, role: "RSM", status: "ACTIVE", deletedAt: null },
    select: { id: true, staffProfile: { select: { salesRegion: true } } },
  });
  if (!rsm?.staffProfile?.salesRegion) throw invalid("Selected RSM was not found or has no region", "RSM_REGION_REQUIRED", { rsmUserId: rsmUserId.toString() });
  return { rsmUserId: rsm.id, region: rsm.staffProfile.salesRegion };
}

async function audit(tx: Prisma.TransactionClient, actor: AuthActor, eventType: string, metadata: Record<string, unknown>) {
  await tx.authAuditLog.create({ data: { sessionId: actor.sessionId, role: actor.role as never, eventType, metadata: { ...metadata, userId: actor.userId.toString() } } });
}

function mapUniqueError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = Array.isArray(error.meta?.target) ? error.meta.target.join(",") : String(error.meta?.target ?? "");
    if (target.includes("normalized_email")) throw conflict("Email already exists", "EMAIL_CONFLICT");
    if (target.includes("dealer_code")) throw conflict("Dealer code already exists", "DEALER_CODE_CONFLICT");
    if (target.includes("gstin")) throw conflict("GSTIN already exists", "GSTIN_CONFLICT");
  }
  // Wallet settlement guards throw plain Error with a .code tag, not AdminRouteError —
  // map them so their real message reaches the client instead of a generic 500.
  if (error instanceof Error && "code" in error && (error.code === "settlement_open" || error.code === "settlement_already_open")) {
    throw conflict(error.message, String(error.code).toUpperCase());
  }
  throw error;
}

export class PostgresAdminDealerRepository implements AdminDealerRepository {
  async list(input: AdminDealerListInput): Promise<{ items: AdminDealerRecord[]; total: number }> {
    const where = buildWhere(input);
    const { skip, take } = paginationToPrisma(input);
    const [items, total] = await prisma.$transaction([
      prisma.dealerProfile.findMany({ where, include, orderBy: { id: "desc" }, skip, take }),
      prisma.dealerProfile.count({ where }),
    ]);
    return { items, total };
  }

  async findById(dealerId: bigint): Promise<AdminDealerRecord | null> {
    return prisma.dealerProfile.findFirst({ where: { id: dealerId, deletedAt: null, user: { deletedAt: null } }, include });
  }

  private async createWithClient(tx: Prisma.TransactionClient, input: CreateAdminDealerInput, actor: AuthActor, passwordHash: string, staffIds: bigint[]) {
    const normalizedEmail = normalizeEmail(input.email);
    if (await tx.user.findUnique({ where: { normalizedEmail }, select: { id: true } })) throw conflict("Email already exists", "EMAIL_CONFLICT");
    if (await tx.dealerProfile.findUnique({ where: { dealerCode: input.dealerCode }, select: { id: true } })) throw conflict("Dealer code already exists", "DEALER_CODE_CONFLICT");
    await ensureStaff(tx, staffIds);
    const rsm = await resolveRsm(tx, input.rsmUserId ? BigInt(input.rsmUserId) : undefined);

    const user = await tx.user.create({ data: { email: normalizedEmail, normalizedEmail, username: normalizedEmail, normalizedUsername: normalizedEmail, passwordHash, role: "DEALER", status: input.status ?? "ACTIVE" } });
    const dealer = await tx.dealerProfile.create({ data: {
      userId: user.id,
      dealerCode: input.dealerCode,
      businessName: input.businessName,
      phone: cleanOptional(input.phone),
      city: cleanOptional(input.city),
      state: cleanOptional(input.state),
      address: cleanOptional(input.address),
      pincode: cleanOptional(input.pincode),
      gstin: cleanOptional(input.gstin),
      discountPercent: decimalValue(input.discountPercent),
      creditDays: input.creditDays,
      creditLimitPaise: bigintValue(input.creditLimitPaise),
      annualTargetPaise: bigintValue(input.annualTargetPaise),
      notes: cleanOptional(input.notes),
      priorityContact: input.priorityContact ?? "primary",
      secondaryContactName: cleanOptional(input.secondaryContactName),
      secondaryContactPhone: cleanOptional(input.secondaryContactPhone),
      secondaryContactEmail: cleanOptional(input.secondaryContactEmail),
      additionalContacts: input.additionalContacts ?? undefined,
      imageUrl: cleanOptional(input.imageUrl),
      region: rsm?.region,
      rsmUserId: rsm?.rsmUserId,
      createdByUserId: actor.userId,
    } });

    if (staffIds.length) await tx.dealerStaffAssignment.createMany({ data: staffIds.map((staffId) => ({ dealerId: dealer.id, staffId, assignedByUserId: actor.userId })) });
    if (input.walletActive) {
      await setWalletStatus(tx, dealer.id, WalletStatus.ACTIVE, {
        actor: { userId: actor.userId, role: actor.role },
        note: "Activated during dealer creation",
      });
    }
    await audit(tx, actor, "ADMIN_DEALER_CREATED", { dealerId: dealer.id.toString(), assignedStaffIds: staffIds.map(String), rsmUserId: rsm?.rsmUserId?.toString(), region: rsm?.region, walletActive: Boolean(input.walletActive) });
    return tx.dealerProfile.findUniqueOrThrow({ where: { id: dealer.id }, include });
  }

  async create(input: CreateAdminDealerInput, actor: AuthActor, tx?: Prisma.TransactionClient): Promise<AdminDealerRecord> {
    const normalizedInput = { ...input, email: normalizeEmail(input.email) };
    const staffIds = normalizeBigIntList(input.assignedStaffIds);
    const passwordHash = await hashPassword(input.password);
    try {
      if (tx) return await this.createWithClient(tx, normalizedInput, actor, passwordHash, staffIds);
      return await prisma.$transaction((client) => this.createWithClient(client, normalizedInput, actor, passwordHash, staffIds));
    } catch (error) {
      mapUniqueError(error);
    }
  }

  async update(dealerId: bigint, input: UpdateAdminDealerInput, actor: AuthActor): Promise<AdminDealerRecord> {
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await tx.dealerProfile.findFirst({ where: { id: dealerId, deletedAt: null, user: { deletedAt: null } }, include: { user: true } });
        if (!current) throw notFound("Dealer not found", "DEALER_NOT_FOUND");
        const userData: Prisma.UserUpdateInput = {};
        const dealerData: Prisma.DealerProfileUpdateInput = {};
        const changedFields: string[] = [];
        let settlementOpened: Awaited<ReturnType<typeof openSettlementForWalletClosure>> = null;

        if (input.email !== undefined) {
          const normalizedEmail = normalizeEmail(input.email);
          if (normalizedEmail !== current.user.normalizedEmail) {
            const duplicate = await tx.user.findUnique({ where: { normalizedEmail }, select: { id: true } });
            if (duplicate && duplicate.id !== current.userId) throw conflict("Email already exists", "EMAIL_CONFLICT");
            Object.assign(userData, { email: normalizedEmail, normalizedEmail, username: normalizedEmail, normalizedUsername: normalizedEmail });
            changedFields.push("email");
          }
        }
        if (input.dealerCode !== undefined && input.dealerCode !== current.dealerCode) {
          const duplicate = await tx.dealerProfile.findUnique({ where: { dealerCode: input.dealerCode }, select: { id: true } });
          if (duplicate && duplicate.id !== current.id) throw conflict("Dealer code already exists", "DEALER_CODE_CONFLICT");
          dealerData.dealerCode = input.dealerCode;
          changedFields.push("dealerCode");
        }
        for (const [inputKey, dbKey, value] of [
          ["businessName", "businessName", input.businessName], ["phone", "phone", input.phone], ["city", "city", input.city], ["state", "state", input.state],
          ["address", "address", input.address], ["pincode", "pincode", input.pincode], ["gstin", "gstin", input.gstin], ["imageUrl", "imageUrl", input.imageUrl], ["creditDays", "creditDays", input.creditDays],
          ["notes", "notes", input.notes], ["priorityContact", "priorityContact", input.priorityContact],
          ["secondaryContactName", "secondaryContactName", input.secondaryContactName],
          ["secondaryContactPhone", "secondaryContactPhone", input.secondaryContactPhone],
          ["secondaryContactEmail", "secondaryContactEmail", input.secondaryContactEmail],
          ["additionalContacts", "additionalContacts", input.additionalContacts],
        ] as Array<[keyof UpdateAdminDealerInput, keyof Prisma.DealerProfileUpdateInput, unknown]>) {
          if (value !== undefined) {
            (dealerData as Record<string, unknown>)[dbKey as string] = value;
            changedFields.push(String(inputKey));
          }
        }
        if (input.discountPercent !== undefined) {
          dealerData.discountPercent = decimalValue(input.discountPercent);
          changedFields.push("discountPercent");
        }
        if (input.creditLimitPaise !== undefined) {
          dealerData.creditLimitPaise = bigintValue(input.creditLimitPaise);
          changedFields.push("creditLimitPaise");
        }
        if (input.annualTargetPaise !== undefined) {
          dealerData.annualTargetPaise = bigintValue(input.annualTargetPaise);
          changedFields.push("annualTargetPaise");
        }
        if (input.walletActive !== undefined) {
          const nextStatus = input.walletActive ? WalletStatus.ACTIVE : WalletStatus.INACTIVE;
          const currentWallet = await tx.dealerWallet.findUnique({ where: { dealerId }, select: { status: true } });
          if ((currentWallet?.status ?? WalletStatus.INACTIVE) !== nextStatus) {
            /* Advance -> credit must leave the wallet at zero, but the residual
               still belongs to the dealer: it moves into an open settlement for
               the accountant to apply against this dealer's bills. Going the
               other way is blocked while such a settlement is unresolved. */
            if (!input.walletActive) {
              settlementOpened = await openSettlementForWalletClosure(tx, dealerId, { userId: actor.userId, role: actor.role }, {
                note: "Wallet closed on switch from advance to credit",
              });
            } else {
              await assertNoOpenSettlement(tx, dealerId);
            }
            await setWalletStatus(tx, dealerId, nextStatus, {
              actor: { userId: actor.userId, role: actor.role },
              note: input.walletActive ? "Wallet activated from dealer edit" : "Wallet deactivated from dealer edit",
            });
            changedFields.push("walletActive");
          }
        }
        if (input.rsmUserId !== undefined) {
          const rsm = await resolveRsm(tx, input.rsmUserId ? BigInt(input.rsmUserId) : undefined);
          dealerData.regionalManager = rsm?.rsmUserId ? { connect: { id: rsm.rsmUserId } } : { disconnect: true };
          dealerData.region = rsm?.region ?? null;
          changedFields.push("rsmUserId", "region");
        }
        if (input.assignedStaffIds !== undefined) {
          const requested = normalizeBigIntList(input.assignedStaffIds);
          await ensureStaff(tx, requested);
          const now = new Date();
          const currentAssignments = await tx.dealerStaffAssignment.findMany({ where: { dealerId } });
          const requestedSet = new Set(requested.map(String));
          const currentByStaff = new Map(currentAssignments.map((assignment) => [assignment.staffId.toString(), assignment]));
          for (const staffId of requested) {
            const existing = currentByStaff.get(staffId.toString());
            if (existing) {
              await tx.dealerStaffAssignment.update({ where: { id: existing.id }, data: { active: true, removedAt: null, assignedByUserId: actor.userId } });
            } else {
              await tx.dealerStaffAssignment.create({ data: { dealerId, staffId, assignedByUserId: actor.userId } });
            }
          }
          for (const assignment of currentAssignments) {
            if (assignment.active && !requestedSet.has(assignment.staffId.toString())) {
              await tx.dealerStaffAssignment.update({ where: { id: assignment.id }, data: { active: false, removedAt: now } });
            }
          }
          changedFields.push("assignedStaffIds");
        }
        if (Object.keys(userData).length) await tx.user.update({ where: { id: current.userId }, data: userData });
        if (Object.keys(dealerData).length) await tx.dealerProfile.update({ where: { id: dealerId }, data: dealerData });
        await audit(tx, actor, "ADMIN_DEALER_UPDATED", {
          dealerId: dealerId.toString(),
          changedFields: Array.from(new Set(changedFields)),
          ...(settlementOpened
            ? { walletSettlementId: settlementOpened.id.toString(), walletSettlementAmountPaise: settlementOpened.originalPaise.toString() }
            : {}),
        });
        if (input.assignedStaffIds !== undefined) invalidateStaffAssignmentCache();
        return tx.dealerProfile.findUniqueOrThrow({ where: { id: dealerId }, include });
      });
    } catch (error) {
      mapUniqueError(error);
    }
  }

  async updateStatus(dealerId: bigint, input: UpdateDealerStatusInput, actor: AuthActor): Promise<AdminDealerRecord> {
    return prisma.$transaction(async (tx) => {
      const dealer = await tx.dealerProfile.findFirst({ where: { id: dealerId, deletedAt: null, user: { deletedAt: null } }, include: { user: true } });
      if (!dealer) throw notFound("Dealer not found", "DEALER_NOT_FOUND");
      const now = new Date();
      const disable = input.status !== "ACTIVE";
      await tx.user.update({ where: { id: dealer.userId }, data: { status: input.status, ...(disable ? { tokenVersion: { increment: 1 } } : {}) } });
      if (disable) await tx.authSession.updateMany({ where: { userId: dealer.userId, revokedAt: null }, data: { revokedAt: now } });
      await audit(tx, actor, "ADMIN_DEALER_STATUS_CHANGED", { dealerId: dealerId.toString(), oldStatus: dealer.user.status, newStatus: input.status, reason: input.reason });
      return tx.dealerProfile.findUniqueOrThrow({ where: { id: dealerId }, include });
    });
  }

  async softDelete(dealerId: bigint, actor: AuthActor): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const dealer = await tx.dealerProfile.findUnique({ where: { id: dealerId }, include: { user: true } });
      if (!dealer) throw notFound("Dealer not found", "DEALER_NOT_FOUND");
      if (dealer.deletedAt || dealer.user.deletedAt) return;
      const now = new Date();
      await tx.dealerProfile.update({ where: { id: dealerId }, data: { deletedAt: now } });
      await tx.user.update({ where: { id: dealer.userId }, data: { deletedAt: now, status: "INACTIVE", tokenVersion: { increment: 1 } } });
      await tx.authSession.updateMany({ where: { userId: dealer.userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.dealerStaffAssignment.updateMany({ where: { dealerId, active: true }, data: { active: false, removedAt: now } });
      await audit(tx, actor, "ADMIN_DEALER_DELETED", { dealerId: dealerId.toString() });
    });
  }

  async getStaffAssignments(dealerId: bigint): Promise<AdminDealerStaffAssignment[]> {
    const dealer = await prisma.dealerProfile.findFirst({ where: { id: dealerId, deletedAt: null, user: { deletedAt: null } }, select: { id: true } });
    if (!dealer) throw notFound("Dealer not found", "DEALER_NOT_FOUND");
    return prisma.dealerStaffAssignment.findMany({ where: { dealerId, active: true }, include: staffAssignmentInclude, orderBy: { assignedAt: "desc" } });
  }

  async replaceStaffAssignments(dealerId: bigint, staffIds: bigint[], actor: AuthActor, rsmUserId?: bigint): Promise<AdminDealerStaffAssignment[]> {
    return prisma.$transaction(async (tx) => {
      const dealer = await tx.dealerProfile.findFirst({ where: { id: dealerId, deletedAt: null, user: { deletedAt: null } }, select: { id: true } });
      if (!dealer) throw notFound("Dealer not found", "DEALER_NOT_FOUND");
      const requested = Array.from(new Set(staffIds));
      await ensureStaff(tx, requested);
      if (rsmUserId !== undefined) {
        const rsm = await resolveRsm(tx, rsmUserId);
        await tx.dealerProfile.update({ where: { id: dealerId }, data: { rsmUserId: rsm?.rsmUserId ?? null, region: rsm?.region ?? null } });
      }
      const now = new Date();
      const current = await tx.dealerStaffAssignment.findMany({ where: { dealerId } });
      const requestedSet = new Set(requested.map(String));
      const currentByStaff = new Map(current.map((assignment) => [assignment.staffId.toString(), assignment]));
      const added: string[] = [];
      const removed: string[] = [];
      for (const staffId of requested) {
        const existing = currentByStaff.get(staffId.toString());
        if (existing) {
          if (!existing.active) added.push(staffId.toString());
          await tx.dealerStaffAssignment.update({ where: { id: existing.id }, data: { active: true, removedAt: null, assignedByUserId: actor.userId } });
        } else {
          added.push(staffId.toString());
          await tx.dealerStaffAssignment.create({ data: { dealerId, staffId, assignedByUserId: actor.userId } });
        }
      }
      for (const assignment of current) {
        if (assignment.active && !requestedSet.has(assignment.staffId.toString())) {
          removed.push(assignment.staffId.toString());
          await tx.dealerStaffAssignment.update({ where: { id: assignment.id }, data: { active: false, removedAt: now } });
        }
      }
      await audit(tx, actor, "ADMIN_DEALER_STAFF_ASSIGNMENTS_UPDATED", { dealerId: dealerId.toString(), addedStaffIds: added, removedStaffIds: removed, rsmUserId: rsmUserId?.toString() });
      invalidateStaffAssignmentCache();
      return tx.dealerStaffAssignment.findMany({ where: { dealerId, active: true }, include: staffAssignmentInclude, orderBy: { assignedAt: "desc" } });
    });
  }
}

export const adminDealerRepository = new PostgresAdminDealerRepository();


