import type { Prisma } from "@prisma/client";
import { paginationToPrisma } from "@/server/admin/admin-pagination";
import { prisma } from "@/server/db/prisma";
import type { AdminAuditLogListInput } from "./audit-logs.types";

function buildWhere(input: AdminAuditLogListInput): Prisma.AuthAuditLogWhereInput {
  const and: Prisma.AuthAuditLogWhereInput[] = [];

  if (input.search) {
    const search = input.search;
    and.push({
      OR: [
        { actorName: { contains: search, mode: "insensitive" } },
        { actorEmail: { contains: search, mode: "insensitive" } },
        { entityId: { contains: search, mode: "insensitive" } },
        { action: { contains: search, mode: "insensitive" } },
        { entity: { contains: search, mode: "insensitive" } },
        { eventType: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  if (input.action) and.push({ action: input.action });
  if (input.entity) and.push({ entity: input.entity });
  if (input.actorRole) and.push({ role: input.actorRole });
  if (input.entityId) and.push({ entityId: input.entityId });

  if (input.dateFrom || input.dateTo) {
    and.push({
      createdAt: {
        ...(input.dateFrom ? { gte: input.dateFrom } : {}),
        ...(input.dateTo ? { lte: input.dateTo } : {}),
      },
    });
  }

  return and.length ? { AND: and } : {};
}

export const auditLogsRepository = {
  async list(input: AdminAuditLogListInput) {
    const where = buildWhere(input);
    const { skip, take } = paginationToPrisma(input);

    // Paged in SQL — this table only grows, so it must never be read whole.
    const [items, total] = await prisma.$transaction([
      prisma.authAuditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
      prisma.authAuditLog.count({ where }),
    ]);

    return { items, total };
  },
};

export type AdminAuditLogRow = Awaited<ReturnType<typeof auditLogsRepository.list>>["items"][number];
