import "server-only";

import enrichedJson from "../../../../public/data/omsons_products_from_excel_with_images.json";
import completeJson from "../../../../public/data/nested_omsons_products.json";
import { buildCatalogueIndex, findCatalogueEntry, type CatalogueProduct, type CatalogueVariant } from "@/lib/catalogue";
import { mergeCatalogueProducts } from "@/lib/catalogueClient";
import cataloguePricing from "@/lib/cataloguePricing";
import productSearch from "@/lib/productSearch.js";
import { prisma } from "@/server/db/prisma";
import { listPostgresCatalogue } from "@/server/modules/products/postgres-catalogue";

// The same merge the order form runs in the browser (JSON catalogue + admin products
// from Postgres), so the agent quotes exactly what the dealer would see there.
const TTL_MS = 60_000;
let cache: { at: number; value: Promise<ReturnType<typeof build>> } | null = null;

function build(postgresProducts: CatalogueProduct[]) {
  const products = mergeCatalogueProducts(enrichedJson as CatalogueProduct[], completeJson as CatalogueProduct[], postgresProducts);
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

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** What one pack of a variant costs at list, in rupees. null when the catalogue has no price. */
export function linePricing(product: CatalogueProduct, variant: CatalogueVariant) {
  const packSize = Math.max(1, Math.trunc(Number(variant.pack)) || 1);
  const { unitPrice, baseListPrice } = cataloguePricing.getVariantOrderPricing(variant.price, packSize, product);
  return unitPrice ? { packSize, unitPrice, packPrice: baseListPrice } : null;
}

/** List and dealer-net price for one pack (the unit dealers order in). null when the catalogue has no price. */
export function priceVariant(product: CatalogueProduct, variant: CatalogueVariant, discountPercent: number) {
  const pricing = linePricing(product, variant);
  if (!pricing) return null;
  return {
    packSize: pricing.packSize,
    listPricePerPack: pricing.packPrice,
    discountPercent,
    netPricePerPack: roundMoney(pricing.packPrice * (1 - discountPercent / 100)),
  };
}

/** The dealer's base discount, the same figure the order form applies (DealerProfile.discountPercent). */
export async function dealerDiscountPercent(dealerId: bigint) {
  const dealer = await prisma.dealerProfile.findUnique({ where: { id: dealerId }, select: { discountPercent: true } });
  return Math.min(100, Math.max(0, Number(dealer?.discountPercent ?? 0)));
}
