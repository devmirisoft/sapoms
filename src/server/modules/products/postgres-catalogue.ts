import "server-only";

import { prisma } from "@/server/db/prisma";

function rupeesFromPaise(value: bigint) { return Number(value) / 100; }

type CatalogueRecord = {
  id: bigint;
  productCode: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  active: boolean;
  category: { name: string } | null;
  variants: Array<{
    id: bigint;
    sku: string | null;
    catalogueNumber: string | null;
    unitName: string | null;
    packSize: number | null;
    unitPricePaise: bigint;
    packPricePaise: bigint;
    active: boolean;
  }>;
};

function mapProduct(record: CatalogueRecord) {
  return {
    id: record.id.toString(),
    sku: record.productCode || record.id.toString(),
    product_id: record.id.toString(),
    productCode: record.productCode || "",
    name: record.name,
    product_name: record.name,
    descriptionHtml: record.description || "",
    product_discription: record.description || "",
    imageUrl: record.imageUrl || "",
    images: record.imageUrl ? [record.imageUrl] : [],
    active: record.active,
    category: record.category?.name || "",
    categories: record.category?.name ? [record.category.name] : [],
    variants: record.variants.map((variant) => ({
      id: variant.id.toString(),
      variant_id: variant.id.toString(),
      productId: record.id.toString(),
      sku: variant.sku || variant.catalogueNumber || variant.id.toString(),
      catalogueNumber: variant.catalogueNumber || variant.sku || "",
      product_cat: variant.catalogueNumber || variant.sku || "",
      name: variant.catalogueNumber || variant.sku || record.name,
      unitName: variant.unitName || "",
      product_unit: variant.unitName || "",
      pack: variant.packSize ?? 1,
      packSize: variant.packSize ?? 1,
      product_quantity: variant.packSize ?? 1,
      price: rupeesFromPaise(variant.unitPricePaise),
      unitPrice: rupeesFromPaise(variant.unitPricePaise),
      product_price: rupeesFromPaise(variant.unitPricePaise),
      unitPricePaise: variant.unitPricePaise.toString(),
      packPricePaise: variant.packPricePaise.toString(),
      active: variant.active,
      inStock: record.active && variant.active,
      images: record.imageUrl ? [record.imageUrl] : [],
    })),
  };
}

/**
 * Admin-managed products in the legacy catalogue shape; the client merges these over the JSON catalogue.
 * Deleted / fully out-of-stock products still come back (with no variants) so the merge can hide their JSON twin.
 */
export async function listPostgresCatalogue({ includeInactive = false } = {}) {
  const products = await prisma.product.findMany({
    include: { category: { select: { id: true, name: true, slug: true } }, variants: { where: includeInactive ? {} : { active: true }, orderBy: { id: "asc" } } },
    orderBy: { name: "asc" },
  });
  return products.map(mapProduct);
}
