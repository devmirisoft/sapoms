import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { paginationToPrisma } from "@/server/admin/admin-pagination";
import type { AdminOrderListInput, AdminOrderRecord } from "./orders.types";

function buildWhere(input: AdminOrderListInput): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];

  if (input.search) {
    const search = input.search;
    and.push({
      OR: [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { legacyPhpId: { contains: search, mode: "insensitive" } },
        { dealer: { businessName: { contains: search, mode: "insensitive" } } },
        { dealer: { dealerCode: { contains: search, mode: "insensitive" } } },
      ],
    });
  }

  if (input.status) {
    and.push({ status: input.status as Prisma.EnumOrderStatusFilter["equals"] });
  }
  if (input.dealerId) {
    and.push({ dealerId: input.dealerId });
  }
  if (input.staffId) {
    and.push({ assignedStaffId: input.staffId });
  }
  if (input.dateFrom || input.dateTo) {
    and.push({
      orderDate: {
        ...(input.dateFrom ? { gte: input.dateFrom } : {}),
        ...(input.dateTo ? { lte: input.dateTo } : {}),
      },
    });
  }

  return and.length ? { AND: and } : {};
}

const listInclude = {
  dealer: { select: { id: true, businessName: true, dealerCode: true } },
  assignedStaff: { select: { id: true, displayName: true } },
  ledgerBills: { orderBy: { billDate: "desc" as const } },
} satisfies Prisma.OrderInclude;

const detailInclude = {
  ...listInclude,
  items: { orderBy: { id: "asc" as const } },
  // Carries the settled-from-wallet position onto the admin order view.
  ledgerBills: { orderBy: { billDate: "desc" as const } },
} satisfies Prisma.OrderInclude;

export class PostgresAdminOrderRepository {
  async list(input: AdminOrderListInput): Promise<{ items: AdminOrderRecord[]; total: number }> {
    const where = buildWhere(input);
    const { skip, take } = paginationToPrisma(input);
    const [items, total] = await prisma.$transaction([
      prisma.order.findMany({ where, include: listInclude, orderBy: { orderDate: "desc" }, skip, take }),
      prisma.order.count({ where }),
    ]);
    return { items, total };
  }

  async findById(orderId: bigint): Promise<AdminOrderRecord | null> {
    return prisma.order.findUnique({ where: { id: orderId }, include: detailInclude });
  }
}

export const adminOrderRepository = new PostgresAdminOrderRepository();