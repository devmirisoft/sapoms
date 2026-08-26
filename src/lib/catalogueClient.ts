import type { CatalogueProduct } from "@/lib/catalogue";
import { addsNothingBeyond, stripHtml } from "@/lib/catalogue";

let cachedProducts: CatalogueProduct[] | null = null;
let cataloguePromise: Promise<CatalogueProduct[]> | null = null;

type CatalogueVariant = NonNullable<CatalogueProduct["variants"]>[number];

const SPEC_KEY_ALIASES: Record<string, string> = {
  "neck": "Neck",
  "neck od": "Neck",
  "dia x height mm": "Dia x Height (mm)",
  "dia x height od mm": "Dia x Height (mm)",
};

function keyFor(value: unknown) {
  return String(value ?? "").trim();
}

function specAliasKeyFor(value: string) {
  return value
    .toLowerCase()
    .replace(/\u00d7/g, "x")
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalSpecKeyFor(key: string) {
  const trimmedKey = key.trim();
  return SPEC_KEY_ALIASES[specAliasKeyFor(trimmedKey)] ?? trimmedKey;
}

function hasSpecValue(value: unknown) {
  return String(value ?? "").trim().length > 0;
}

function textValue(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rupeesFromPaiseValue(value: unknown) {
  if (typeof value === "number") return value / 100;
  if (typeof value === "bigint") return Number(value) / 100;
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed / 100 : 0;
}

function parsePostgresDescription(description: string) {
  const features: string[] = [];
  const variantSpecs = new Map<string, Record<string, string>>();
  const baseParts: string[] = [];
  let mode: "description" | "about" | "specs" = "description";

  for (const rawLine of description.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const normalized = line.toUpperCase();
    if (normalized === "ABOUT THIS ITEM") {
      mode = "about";
      continue;
    }
    if (normalized === "VARIANT SPECIFICATIONS") {
      mode = "specs";
      continue;
    }

    if (mode === "about") {
      const feature = line.replace(/^[-*•\s]+/, "").trim();
      if (feature) features.push(feature);
      continue;
    }

    if (mode === "specs") {
      const [catalogueNumberPart, specsPart] = line.split(/\s+-\s+/, 2);
      const catalogueNumber = textValue(catalogueNumberPart);
      if (!catalogueNumber || !specsPart) continue;
      const specs: Record<string, string> = {};
      specsPart.split(";").forEach((entry) => {
        const [key, ...valueParts] = entry.split(":");
        const specKey = textValue(key);
        const specValue = textValue(valueParts.join(":"));
        if (specKey && specValue) specs[specKey] = specValue;
      });
      if (Object.keys(specs).length) variantSpecs.set(catalogueNumber, specs);
      continue;
    }

    baseParts.push(line);
  }

  return { descriptionHtml: baseParts.join("<br />"), features, variantSpecs };
}

function normalizePostgresProduct(product: CatalogueProduct & Record<string, unknown>): CatalogueProduct {
  const rawDescription = textValue(product.descriptionHtml ?? product.product_discription ?? product.description);
  const parsedDescription = parsePostgresDescription(rawDescription);
  const productSku = textValue(product.sku ?? product.productCode ?? product.id);
  const images = Array.isArray(product.images)
    ? product.images.map(textValue).filter(Boolean)
    : textValue(product.imageUrl) ? [textValue(product.imageUrl)] : [];
  const category = textValue(product.category);
  const categories = Array.isArray(product.categories)
    ? product.categories.map(textValue).filter(Boolean)
    : category ? [category] : [];

  const variants = (Array.isArray(product.variants) ? product.variants : []).map((variant, index) => {
    const row = variant as CatalogueVariant & Record<string, unknown>;
    const catalogueNumber = textValue(row.catalogueNumber ?? row.product_cat ?? row.sku ?? row.id);
    const variantSku = textValue(row.sku ?? catalogueNumber ?? row.id) || productSku + "/" + (index + 1);
    const pack = Math.max(1, Math.trunc(numberValue(row.pack ?? row.packSize ?? row.product_quantity, 1)) || 1);
    const specs = mergeVariantSpecs(
      row.specs as Record<string, string> | undefined,
      parsedDescription.variantSpecs.get(catalogueNumber) ?? parsedDescription.variantSpecs.get(variantSku),
    ) ?? {};

    return {
      id: textValue(row.id ?? variantSku),
      sku: variantSku,
      slug: textValue(row.slug ?? variantSku),
      name: textValue(row.name) || catalogueNumber || product.name,
      specs,
      specsText: textValue(row.specsText),
      pack,
      price: numberValue(row.price ?? row.unitPrice ?? row.product_price, rupeesFromPaiseValue(row.unitPricePaise)),
      priceLabel: textValue(row.priceLabel),
      inStock: row.inStock === undefined ? row.active !== false && product.active !== false : Boolean(row.inStock),
      images: Array.isArray(row.images) && row.images.length ? row.images.map(textValue).filter(Boolean) : images,
    };
  });

  return normalizeCatalogueProductSpecs({
    id: textValue(product.id ?? productSku),
    sku: productSku,
    slug: textValue(product.slug ?? productSku),
    name: textValue(product.name),
    category,
    categories,
    page: numberValue(product.page, 0),
    features: Array.isArray(product.features) && product.features.length
      ? product.features.map(textValue).filter(Boolean)
      : parsedDescription.features,
    descriptionHtml: parsedDescription.descriptionHtml || rawDescription,
    images,
    variants,
  });
}

function mergeVariantSpecs(
  primarySpecs?: Record<string, string>,
  fallbackSpecs?: Record<string, string>
) {
  if (!primarySpecs && !fallbackSpecs) return undefined;

  const merged: Record<string, string> = {};

  const applySpecs = (specs: Record<string, string> | undefined, preferNonEmpty: boolean) => {
    for (const [key, value] of Object.entries(specs ?? {})) {
      const canonicalKey = canonicalSpecKeyFor(key);
      if (!canonicalKey) continue;

      const existingValue = merged[canonicalKey];
      if (preferNonEmpty && hasSpecValue(value)) {
        merged[canonicalKey] = value;
        continue;
      }

      if (!hasSpecValue(existingValue)) {
        merged[canonicalKey] = value;
      }
    }
  };

  applySpecs(fallbackSpecs, false);
  applySpecs(primarySpecs, true);

  return merged;
}

function normalizeCatalogueProductSpecs(product: CatalogueProduct): CatalogueProduct {
  const variants = product.variants?.map((variant) => ({
    ...variant,
    specs: mergeVariantSpecs(variant.specs),
  }));

  return variants ? { ...product, variants } : product;
}

/**
 * A description that only echoes "<SKU> - <name>" carries no information beyond
 * the title. The enriched export stores that echo for every row, so preferring
 * it by truthiness alone discards the richer text held in the nested export.
 */
function descriptionIsInformative(
  description: string | undefined,
  product: CatalogueProduct
): boolean {
  const text = stripHtml(description);
  if (!text) return false;
  if (!product.name) return true;

  // Drop the leading catalogue number so "254B - <name>" is judged on its words.
  const withoutSku = text
    .replace(new RegExp(`^\\s*${escapeRegExp(String(product.sku ?? "").trim())}\\s*[-–—:]?\\s*`, "i"), "")
    .trim();

  return !addsNothingBeyond(withoutSku || text, product.name);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickBetterDescription(
  enrichedProduct: CatalogueProduct,
  completeProduct: CatalogueProduct
): string | undefined {
  if (descriptionIsInformative(enrichedProduct.descriptionHtml, enrichedProduct)) {
    return enrichedProduct.descriptionHtml;
  }
  if (descriptionIsInformative(completeProduct.descriptionHtml, enrichedProduct)) {
    return completeProduct.descriptionHtml;
  }

  return enrichedProduct.descriptionHtml || completeProduct.descriptionHtml;
}

function mergeCatalogueProduct(
  enrichedProduct: CatalogueProduct,
  completeProduct?: CatalogueProduct
): CatalogueProduct {
  if (!completeProduct) return normalizeCatalogueProductSpecs(enrichedProduct);

  const enrichedVariants = Array.isArray(enrichedProduct.variants) ? enrichedProduct.variants : [];
  const completeVariants = Array.isArray(completeProduct.variants) ? completeProduct.variants : [];
  const variantsBySku = new Map<string, NonNullable<CatalogueProduct["variants"]>[number]>();

  for (const variant of completeVariants) {
    const key = keyFor(variant.sku || variant.id);
    if (key) variantsBySku.set(key, { ...variant, specs: mergeVariantSpecs(variant.specs) });
  }

  for (const variant of enrichedVariants) {
    const key = keyFor(variant.sku || variant.id);
    if (key) {
      const fallbackVariant = variantsBySku.get(key);
      variantsBySku.set(key, {
        ...fallbackVariant,
        ...variant,
        specs: mergeVariantSpecs(variant.specs, fallbackVariant?.specs),
      });
    }
  }

  const mergedVariants = Array.from(variantsBySku.values()).map((variant: CatalogueVariant) => ({
    ...variant,
    images: variant.images?.length ? variant.images : enrichedProduct.images ?? completeProduct.images ?? [],
  }));

  return {
    ...completeProduct,
    ...enrichedProduct,
    features: enrichedProduct.features?.length ? enrichedProduct.features : completeProduct.features,
    descriptionHtml: pickBetterDescription(enrichedProduct, completeProduct),
    images: enrichedProduct.images?.length ? enrichedProduct.images : completeProduct.images,
    variants: mergedVariants,
  };
}

function mergeCatalogueProducts(
  enrichedProducts: CatalogueProduct[],
  completeProducts: CatalogueProduct[],
  postgresProducts: CatalogueProduct[] = []
) {
  const completeByKey = new Map<string, CatalogueProduct>();
  for (const product of completeProducts) {
    for (const key of [product.sku, product.id].map(keyFor).filter(Boolean)) {
      completeByKey.set(key, product);
    }
  }

  const seen = new Set<string>();
  const merged = enrichedProducts.map((product) => {
    const key = keyFor(product.sku || product.id);
    if (key) seen.add(key);
    return mergeCatalogueProduct(product, completeByKey.get(key));
  });

  for (const product of completeProducts) {
    const key = keyFor(product.sku || product.id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(normalizeCatalogueProductSpecs(product));
  }

  const outputByKey = new Map<string, CatalogueProduct>();
  const order: string[] = [];
  const addOrReplace = (product: CatalogueProduct) => {
    const key = keyFor(product.sku || product.id);
    if (!key) return;
    if (!outputByKey.has(key)) order.push(key);
    outputByKey.set(key, product);
  };

  merged.forEach(addOrReplace);
  postgresProducts.map(normalizePostgresProduct).forEach(addOrReplace);

  return order.map((key) => outputByKey.get(key)).filter((product): product is CatalogueProduct => Boolean(product));
}

async function fetchCatalogueFile(path: string): Promise<CatalogueProduct[]> {
  const response = await fetch(path, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error("Unable to load the product catalogue.");
  }

  const products = (await response.json()) as CatalogueProduct[];
  return Array.isArray(products) ? products : [];
}

async function fetchPostgresCatalogueProducts(): Promise<CatalogueProduct[]> {
  try {
    const response = await fetch("/api/products", { cache: "no-store", credentials: "include" });
    if (!response.ok) return [];
    const payload = await response.json();
    const products = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    return products as CatalogueProduct[];
  } catch {
    return [];
  }
}

export async function loadCatalogueProducts(): Promise<CatalogueProduct[]> {
  if (cachedProducts) return cachedProducts;
  if (cataloguePromise) return cataloguePromise;

  cataloguePromise = Promise.all([
    fetchCatalogueFile("/data/omsons_products_from_excel_with_images.json"),
    fetchCatalogueFile("/data/nested_omsons_products.json").catch(() => []),
    fetchPostgresCatalogueProducts(),
  ])
    .then(([enrichedProducts, completeProducts, postgresProducts]) => {
      cachedProducts = mergeCatalogueProducts(enrichedProducts, completeProducts, postgresProducts);
      return cachedProducts;
    })
    .finally(() => {
      cataloguePromise = null;
    });

  return cataloguePromise;
}
