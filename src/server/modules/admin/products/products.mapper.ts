import type { AdminProductRecord, AdminProductVariantRecord } from "./products.types";

function mapVariant(record: AdminProductVariantRecord) {
  return {
    id: record.id.toString(),
    sku: record.sku || "",
    catalogueNumber: record.catalogueNumber || "",
    unitName: record.unitName || "",
    packSize: record.packSize ?? 0,
    unitPricePaise: record.unitPricePaise.toString(),
    packPricePaise: record.packPricePaise.toString(),
    priceBasis: record.priceBasis,
    active: record.active,
  };
}

export function mapAdminProduct(record: AdminProductRecord) {
  return {
    id: record.id.toString(),
    productCode: record.productCode || "",
    name: record.name || "",
    description: record.description || "",
    imageUrl: record.imageUrl || "",
    category: record.category
      ? {
          id: record.category.id.toString(),
          name: record.category.name,
          slug: record.category.slug || "",
        }
      : null,
    active: record.active,
    variants: record.variants.map(mapVariant),
  };
}