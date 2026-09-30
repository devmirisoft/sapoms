import { Prisma, type DealerRequest } from "@prisma/client";
import { prisma } from "@/server/db/prisma";

type Query = Record<string, unknown>;
type Update = { $set?: Record<string, unknown> };

type FindOptions = {
  orderBy?: Prisma.DealerRequestOrderByWithRelationInput[];
  skip?: number;
  take?: number;
};

function idValue(value: unknown) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  if (value && typeof value === "object" && "toString" in value) {
    const text = String((value as { toString(): string }).toString());
    if (/^\d+$/.test(text)) return BigInt(text);
  }
  return null;
}

function dateOrNull(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function jsonValue(value: unknown) {
  return value === undefined ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

function toWhere(query?: Query): Prisma.DealerRequestWhereInput {
  if (!query || Object.keys(query).length === 0) return {};

  const and: Prisma.DealerRequestWhereInput[] = [];

  if (Array.isArray(query.$and)) {
    and.push(...query.$and.map((entry) => toWhere(entry as Query)));
  }

  if (Array.isArray(query.$or)) {
    and.push({ OR: query.$or.map((entry) => toWhere(entry as Query)) });
  }

  if (query._id !== undefined || query.id !== undefined) {
    const id = idValue(query._id ?? query.id);
    if (id === null) and.push({ id: BigInt(-1) });
    else and.push({ id });
  }

  if (typeof query.status === "string") and.push({ status: query.status });
  if (typeof query.submittedById === "string") and.push({ submittedById: query.submittedById });
  if (query.rsmUserId !== undefined) and.push({ rsmUserId: idValue(query.rsmUserId) ?? BigInt(-1) });
  if (query.openRequestKey !== undefined) and.push({ openRequestKey: query.openRequestKey === null ? null : String(query.openRequestKey) });

  for (const key of ["dealerName", "dealerCode", "city", "contactEmail", "contactPhone", "assignedStaffNames", "submittedByName", "requestReference"] as const) {
    const value = query[key];
    if (value instanceof RegExp) and.push({ [key]: { contains: value.source.replace(/\\/g, ""), mode: "insensitive" } });
    else if (typeof value === "string") and.push({ [key]: value });
  }

  const approvalToken = (query["approvalLock.token"] ?? (query.approvalLock && typeof query.approvalLock === "object" ? (query.approvalLock as Query).token : undefined));
  if (typeof approvalToken === "string") {
    and.push({ approvalLock: { path: ["token"], equals: approvalToken } as Prisma.JsonFilter<"DealerRequest"> });
  }

  if (query.$or && Array.isArray(query.$or)) {
    // handled above
  } else if (query.$or && typeof query.$or === "object") {
    and.push(toWhere(query.$or as Query));
  }

  return and.length === 0 ? {} : and.length === 1 ? and[0] : { AND: and };
}

function toRecord(row: DealerRequest | null) {
  if (!row) return null;
  return {
    ...row,
    _id: { toString: () => row.id.toString() },
    id: row.id.toString(),
    submittedAt: row.submittedAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? "",
    rejectedAt: row.rejectedAt?.toISOString() ?? "",
    reviewedAt: row.reviewedAt?.toISOString() ?? "",
    resubmittedAt: row.resubmittedAt?.toISOString() ?? "",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toData(input: Record<string, unknown>): Prisma.DealerRequestUncheckedCreateInput & Prisma.DealerRequestUncheckedUpdateInput {
  const data: Record<string, unknown> = { ...input };
  delete data._id;
  if (data.requestReference === "") data.requestReference = null;
  if (data.openRequestKey === undefined) data.openRequestKey = null;
  for (const key of ["submittedAt", "acceptedAt", "rejectedAt", "reviewedAt", "resubmittedAt", "createdAt", "updatedAt"]) {
    if (key in data) data[key] = dateOrNull(data[key]);
  }
  if ("formSnapshot" in data) data.formSnapshot = jsonValue(data.formSnapshot);
  if ("approvalLock" in data) data.approvalLock = data.approvalLock === null ? Prisma.JsonNull : jsonValue(data.approvalLock);
  if ("auditTrail" in data) data.auditTrail = jsonValue(data.auditTrail ?? []);
  return data as Prisma.DealerRequestUncheckedCreateInput & Prisma.DealerRequestUncheckedUpdateInput;
}

export async function ensurePostgresDealerRequestIndexes() {
  return undefined;
}

export function getPostgresDealerRequestCollection() {
  return {
    async countDocuments(query: Query) {
      return prisma.dealerRequest.count({ where: toWhere(query) });
    },
    find(query: Query) {
      const options: FindOptions = {};
      return {
        sort(sort: Record<string, 1 | -1>) {
          options.orderBy = Object.entries(sort).map(([key, value]) => ({ [key]: value === -1 ? "desc" : "asc" })) as Prisma.DealerRequestOrderByWithRelationInput[];
          return this;
        },
        skip(skip: number) {
          options.skip = skip;
          return this;
        },
        limit(limit: number) {
          options.take = limit;
          return this;
        },
        async toArray() {
          const rows = await prisma.dealerRequest.findMany({ where: toWhere(query), orderBy: options.orderBy, skip: options.skip, take: options.take });
          return rows.map((row) => toRecord(row)!);
        },
      };
    },
    async findOne(query: Query) {
      const row = await prisma.dealerRequest.findFirst({ where: toWhere(query) });
      return toRecord(row);
    },
    async insertOne(doc: Record<string, unknown>) {
      const created = await prisma.dealerRequest.create({ data: toData(doc) as Prisma.DealerRequestUncheckedCreateInput });
      return { insertedId: { toString: () => created.id.toString() } };
    },
    async updateOne(query: Query, update: Update) {
      await prisma.dealerRequest.updateMany({ where: toWhere(query), data: toData(update.$set ?? {}) });
    },
    async findOneAndUpdate(query: Query, update: Update, _options?: unknown) {
      const existing = await prisma.dealerRequest.findFirst({ where: toWhere(query), select: { id: true } });
      if (!existing) return null;
      const updated = await prisma.dealerRequest.update({ where: { id: existing.id }, data: toData(update.$set ?? {}) });
      return toRecord(updated);
    },
  };
}

export function isPostgresDealerRequestDependencyError(error: unknown) {
  return error instanceof Prisma.PrismaClientInitializationError || error instanceof Prisma.PrismaClientRustPanicError;
}