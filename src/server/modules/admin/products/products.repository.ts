import "server-only";

import { Prisma, type OrderStatus } from "@prisma/client";
import { disableOrderLines } from "@/lib/orderEditApply";
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
      data: { productCode: input.productCode || null, name: input.name, description: input.description || null, imageUrl: input.imageUrl || null, categoryId, active: input.active ?? true, variants: { create: input.variants.map((variant) => ({ sku: variant.sku || null, catalogueNumber: variant.catalogueNumber || variant.sku || null, unitName: variant.unitName || null, packSize: variant.packSize ?? null, priceBasis: variant.priceBasis, unitPricePaise: variant.unitPricePaise ?? BigInt(0), packPricePaise: variant.packPricePaise ?? BigInt(0), active: variant.active ?? true })) } },
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
        // Saved as In Stock: a disable note left from the toggle no longer applies.
        const data = { sku: variant.sku || null, catalogueNumber: variant.catalogueNumber || variant.sku || null, unitName: variant.unitName || null, packSize: variant.packSize ?? null, priceBasis: variant.priceBasis, unitPricePaise: variant.unitPricePaise ?? BigInt(0), packPricePaise: variant.packPricePaise ?? BigInt(0), active: variant.active ?? true, ...(variant.active === false ? {} : { disabledNote: null }) };
        if (variant.id && /^\d+$/.test(variant.id)) await tx.productVariant.update({ where: { id: BigInt(variant.id), productId }, data });
        else await tx.productVariant.create({ data: { ...data, productId } });
      }
      return tx.product.findUniqueOrThrow({ where: { id: productId }, include });
    });
  }

  async delete(productId: bigint): Promise<void> {
    await prisma.product.update({ where: { id: productId }, data: { active: false, variants: { updateMany: { where: {}, data: { active: false } } } } });
  }

  async findVariant(variantId: bigint) {
    return prisma.productVariant.findUnique({ where: { id: variantId }, select: { id: true, productId: true, sku: true, catalogueNumber: true, active: true, disabledNote: true } });
  }

  async setVariantActive(variantId: bigint, active: boolean, note: string) {
    await prisma.productVariant.update({ where: { id: variantId }, data: { active, disabledNote: active ? null : note } });
  }

  /**
   * Zero this catalogue number's lines on placed, not-yet-dispatched orders. Lines with
   * any dispatch are never matched. One transaction per order, so an order that fails
   * (e.g. a wallet error) is reported and the rest still go through; re-running picks
   * up only the lines still pending.
   */
  async disableOpenOrderLines(variant: { id: bigint; sku: string | null; catalogueNumber: string | null }, note: string) {
    const catNos = Array.from(new Set([variant.sku, variant.catalogueNumber].map((value) => (value ?? "").trim()).filter(Boolean)));
    const lines = await prisma.orderItem.findMany({
      where: {
        disabledNote: null,
        dispatches: { none: {} },
        order: { status: { in: OPEN_ORDER_STATUSES } },
        OR: [{ productVariantId: variant.id }, ...catNos.map((catNo) => ({ catalogueNumberSnapshot: { equals: catNo, mode: "insensitive" as const } }))],
      },
      select: { id: true, orderId: true },
    });
    const byOrder = new Map<bigint, bigint[]>();
    for (const line of lines) byOrder.set(line.orderId, [...(byOrder.get(line.orderId) ?? []), line.id]);

    const affected: Awaited<ReturnType<typeof disableOrderLines>> = [];
    const failedOrderIds: string[] = [];
    // ponytail: sequential per-order transactions; batch them if a catalogue number ever sits on hundreds of open orders.
    for (const [orderId, itemIds] of byOrder) {
      try {
        affected.push(...await prisma.$transaction((tx) => disableOrderLines(tx, orderId, itemIds, note)));
      } catch (error) {
        console.error("[disableOpenOrderLines]", orderId.toString(), error);
        failedOrderIds.push(orderId.toString());
      }
    }
    return { affected, failedOrderIds };
  }
}

// Placed and still waiting on dispatch; drafts, declined, cancelled and finished orders are left alone.
const OPEN_ORDER_STATUSES: OrderStatus[] = ["AWAITING_ACCEPTANCE", "ACCEPTED", "PROCESSING", "PARTIALLY_READY", "READY"];

export const adminProductRepository = new PostgresAdminProductRepository();
