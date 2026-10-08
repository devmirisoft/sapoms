import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { paginationToPrisma } from "@/server/admin/admin-pagination";
import type { AdminProductListInput, AdminProductRecord, ProductWriteInput } from "./products.types";

function buildWhere(input: AdminProductListInput): Prisma.ProductWhereInput {
  const search = input.search.trim();
  if (!search) return {};
  return {
    OR: [
      { name: { contains: search, mode: "insensitive" } },
      { productCode: { contains: search, mode: "insensitive" } },
      { category: { name: { contains: search, mode: "insensitive" } } },
      { variants: { some: { sku: { contains: search, mode: "insensitive" } } } },
      { variants: { some: { catalogueNumber: { contains: search, mode: "insensitive" } } } },
    ],
  };
}

const include = {
  category: { select: { id: true, name: true, slug: true } },
  variants: { orderBy: { id: "asc" as const } },
} satisfies Prisma.ProductInclude;

async function resolveCategoryId(categoryName?: string): Promise<bigint | null> {
  const name = String(categoryName ?? "").trim().slice(0, 160);
  if (!name) return null;
  const existing = await prisma.productCategory.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } });
  if (existing) return existing.id;
  const created = await prisma.productCategory.create({ data: { name }, select: { id: true } });
  return created.id;
}

export class PostgresAdminProductRepository {
  async list(input: AdminProductListInput): Promise<{ items: AdminProductRecord[]; total: number }> {
    const where = buildWhere(input);
    const { skip, take } = paginationToPrisma(input);
    const [items, total] = await Promise.all([
      prisma.product.findMany({ where, include, orderBy: { id: "desc" }, skip, take }),
      prisma.product.count({ where }),
    ]);
    return { items, total };
  }

  async findById(productId: bigint): Promise<AdminProductRecord | null> {
    return prisma.product.findUnique({ where: { id: productId }, include });
  }

  async create(input: ProductWriteInput): Promise<AdminProductRecord> {
    const categoryId = await resolveCategoryId(input.categoryName);
    return prisma.product.create({
      data: { productCode: input.productCode || null, name: input.name, description: input.description || null, imageUrl: input.imageUrl || null, categoryId, active: input.active ?? true, variants: { create: input.variants.map((variant) => ({ sku: variant.sku || null, catalogueNumber: variant.catalogueNumber || variant.sku || null, unitName: variant.unitName || null, packSize: variant.packSize ?? null, unitPricePaise: variant.unitPricePaise ?? BigInt(0), packPricePaise: variant.packPricePaise ?? BigInt(0), active: variant.active ?? true })) } },
      include,
    });
  }

  async update(productId: bigint, input: ProductWriteInput): Promise<AdminProductRecord> {
    const categoryId = await resolveCategoryId(input.categoryName);
    return prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: productId }, data: { productCode: input.productCode || null, name: input.name, description: input.description || null, imageUrl: input.imageUrl || null, categoryId, active: input.active ?? true } });
      const keepVariantIds = input.variants.map((variant) => variant.id).filter((id): id is string => Boolean(id && /^\d+$/.test(id))).map((id) => BigInt(id));
      await tx.productVariant.deleteMany({ where: { productId, ...(keepVariantIds.length ? { id: { notIn: keepVariantIds } } : {}) } });
      for (const variant of input.variants) {
        const data = { sku: variant.sku || null, catalogueNumber: variant.catalogueNumber || variant.sku || null, unitName: variant.unitName || null, packSize: variant.packSize ?? null, unitPricePaise: variant.unitPricePaise ?? BigInt(0), packPricePaise: variant.packPricePaise ?? BigInt(0), active: variant.active ?? true };
        if (variant.id && /^\d+$/.test(variant.id)) await tx.productVariant.update({ where: { id: BigInt(variant.id), productId }, data });
        else await tx.productVariant.create({ data: { ...data, productId } });
      }
      return tx.product.findUniqueOrThrow({ where: { id: productId }, include });
    });
  }

  async delete(productId: bigint): Promise<void> {
    await prisma.product.update({ where: { id: productId }, data: { active: false, variants: { updateMany: { where: {}, data: { active: false } } } } });
  }
}

export const adminProductRepository = new PostgresAdminProductRepository();
