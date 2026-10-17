import "server-only";

import catalogueJson from "../../../../public/data/omsonsdata.json";
import { buildCatalogueIndex, findCatalogueEntry, mergeCatalogueRecords, type CatalogueProduct, type CatalogueVariant } from "@/lib/catalogue";
import { mergeCatalogueProducts } from "@/lib/catalogueClient";
import cataloguePricing from "@/lib/cataloguePricing";
import productSearch from "@/lib/productSearch.js";
import { prisma } from "@/server/db/prisma";
import { listPostgresCatalogue } from "@/server/modules/products/postgres-catalogue";

// The same merge the order form runs in the browser (JSON catalogue + admin products
// from Postgres), so the agent quotes exactly what the dealer would see there.
const TTL_MS = 60_000;
let cache: { at: number; value: Promise<ReturnType<typeof build>> } | null = null;
const jsonProducts = mergeCatalogueRecords(catalogueJson as unknown as CatalogueProduct[]).products;

function build(postgresProducts: CatalogueProduct[]) {
  const products = mergeCatalogueProducts(jsonProducts, [], postgresProducts);
  return { products, index: buildCatalogueIndex(products), searchable: products.map(productSearch.normalizeProductForSearch) };
}

export function loadCatalogue() {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const value = listPostgresCatalogue().then((rows) => build(rows as unknown as CatalogueProduct[]));
    cache = { at: Date.now(), value };
    value.catch(() => { cache = null; });
  }
  return cache.value;
}

export async function findCatalogueItem(sku: string) {
  return findCatalogueEntry((await loadCatalogue()).index, sku);
}

/** List and dealer-net price for one pack (the unit dealers order in), in rupees. null when the catalogue has no price. */
export function priceVariant(variant: CatalogueVariant, discountPercent: number) {
  const pricing = cataloguePricing.variantPricing(variant);
  if (!pricing) return null;
  return {
    packSize: pricing.packSize,
    priceBasis: pricing.priceBasis,
    listPricePerPack: pricing.packPricePaise / 100,
    discountPercent,
    netPricePerPack: Math.round(pricing.packPricePaise * (1 - discountPercent / 100)) / 100,
  };
}

/** The dealer's base discount, the same figure the order form applies (DealerProfile.discountPercent). */
export async function dealerDiscountPercent(dealerId: bigint) {
  const dealer = await prisma.dealerProfile.findUnique({ where: { id: dealerId }, select: { discountPercent: true } });
  return Math.min(100, Math.max(0, Number(dealer?.discountPercent ?? 0)));
}
