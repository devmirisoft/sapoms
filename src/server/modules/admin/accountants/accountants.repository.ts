import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { paginationToPrisma } from "@/server/admin/admin-pagination";
import { hashPassword } from "@/server/auth/password";
import { normalizeEmail } from "@/server/auth/providers/postgres-auth.provider";
import type { AdminAccountantListInput, AdminAccountantMutationInput, AdminAccountantRecord } from "./accountants.types";

function buildWhere(input: AdminAccountantListInput): Prisma.AccountantProfileWhereInput {
  const search = input.search.trim();
  if (!search) return {};
  return {
    OR: [
      { displayName: { contains: search, mode: "insensitive" } },
      { designation: { contains: search, mode: "insensitive" } },
      { user: { email: { contains: search, mode: "insensitive" } } },
    ],
  };
}

const include = {
  user: { select: { id: true, email: true, status: true, createdAt: true } },
} satisfies Prisma.AccountantProfileInclude;

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export class AccountantEmailConflictError extends Error {}

export class PostgresAdminAccountantRepository {
  async list(input: AdminAccountantListInput): Promise<{ items: AdminAccountantRecord[]; total: number }> {
    const where = buildWhere(input);
    const { skip, take } = paginationToPrisma(input);
    const [items, total] = await Promise.all([
      prisma.accountantProfile.findMany({ where, include, orderBy: { id: "desc" }, skip, take }),
      prisma.accountantProfile.count({ where }),
    ]);
    return { items, total };
  }

  async findById(accountantId: bigint): Promise<AdminAccountantRecord | null> {
    return prisma.accountantProfile.findUnique({ where: { id: accountantId }, include });
  }

  async create(input: Required<Pick<AdminAccountantMutationInput, "name" | "email" | "password">> & AdminAccountantMutationInput): Promise<AdminAccountantRecord> {
    try {
      const user = await prisma.user.create({
        data: {
          email: input.email.trim(),
          normalizedEmail: normalizeEmail(input.email),
          passwordHash: await hashPassword(input.password),
          role: "ACCOUNTANT",
          status: input.status ?? "ACTIVE",
          accountantProfile: {
            create: {
              displayName: input.name.trim(),
              designation: input.designation?.trim() || input.phone?.trim() || null,
            },
          },
        },
        include: { accountantProfile: { include } },
      });
      if (!user.accountantProfile) throw new Error("Missing accountant profile after create");
      return user.accountantProfile;
    } catch (error) {
      if (isUniqueConflict(error)) throw new AccountantEmailConflictError("Email already registered");
      throw error;
    }
  }

  async update(accountantId: bigint, input: AdminAccountantMutationInput): Promise<AdminAccountantRecord | null> {
    const existing = await prisma.accountantProfile.findUnique({ where: { id: accountantId }, select: { userId: true } });
    if (!existing) return null;

    const userData: Prisma.UserUpdateInput = {};
    if (input.email) {
      userData.email = input.email.trim();
      userData.normalizedEmail = normalizeEmail(input.email);
    }
    if (input.password) userData.passwordHash = await hashPassword(input.password);
    if (input.status) userData.status = input.status;

    const profileData: Prisma.AccountantProfileUpdateInput = {};
    if (input.name?.trim()) profileData.displayName = input.name.trim();
    if (input.designation !== undefined || input.phone !== undefined) {
      profileData.designation = input.designation?.trim() || input.phone?.trim() || null;
    }

    try {
      await prisma.$transaction([
        Object.keys(userData).length ? prisma.user.update({ where: { id: existing.userId }, data: userData }) : prisma.user.findUniqueOrThrow({ where: { id: existing.userId } }),
        Object.keys(profileData).length ? prisma.accountantProfile.update({ where: { id: accountantId }, data: profileData }) : prisma.accountantProfile.findUniqueOrThrow({ where: { id: accountantId } }),
      ]);
    } catch (error) {
      if (isUniqueConflict(error)) throw new AccountantEmailConflictError("Email already registered");
      throw error;
    }

    return prisma.accountantProfile.findUnique({ where: { id: accountantId }, include });
  }

  async deactivate(accountantId: bigint): Promise<AdminAccountantRecord | null> {
    return this.update(accountantId, { status: "INACTIVE" });
  }
}

export const adminAccountantRepository = new PostgresAdminAccountantRepository();
