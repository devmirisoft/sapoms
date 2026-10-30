export type CatalogueVariant = {
  id: string;
  sku: string;
  slug?: string;
  name: string;
  specs?: Record<string, string>;
  specsText?: string;
  pack?: number;
  price?: number | null;
  priceLabel?: string;
  inStock?: boolean;
  images?: string[];
  // How the catalogue prints this variant's price; read only through cataloguePricing.js.
  priceBasis?: "pack" | "piece";
  packSize?: number;
  packUnit?: string;
  pricePerPack?: number | null;
  pricePerPiece?: number | null;
  packAssumed?: boolean;
};

export type CatalogueProduct = {
  id: string;
  sku: string;
  slug?: string;
  name: string;
  category?: string;
  categories?: string[];
  page?: number;
  features?: string[];
  descriptionHtml?: string;
  images?: string[];
  variants?: CatalogueVariant[];
};

export type CatalogueSectionGroup<T extends CatalogueProduct = CatalogueProduct> = {
  section: string;
  products: T[];
};

export type CatalogueIndex<T extends CatalogueProduct = CatalogueProduct> = {
  sections: CatalogueSectionGroup<T>[];
  products: T[];
  productsBySku: Record<string, T>;
  variantsBySku: Record<string, {
    product: T;
    variant: CatalogueVariant;
  }>;
};

const SECTION_FALLBACK = "Uncategorized";

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => HTML_ENTITIES[String(name).toLowerCase()] ?? match);
}

export function stripHtml(value: string | undefined | null): string {
  if (!value) return "";
  return collapseWhitespace(decodeHtmlEntities(value.replace(/<[^>]*>/g, " ")));
}

export function normalizeText(value: string | undefined | null): string {
  return stripHtml(value)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"');
}

export function normalizeCatalogueNumber(value: string | undefined | null): string {
  return stripHtml(value)
    .toLowerCase()
    .replace(/[â€™â€˜]/g, "'")
    .replace(/[â€œâ€]/g, '"')
    .replace(/[\s/_-]+/g, "");
}

export function getCatalogueSection(product: CatalogueProduct): string {
  const fromCategory = product.category?.trim();
  if (fromCategory) return fromCategory;

  const fromPath = product.categories?.[0]?.split(">")?.pop()?.trim();
  if (fromPath) return fromPath;

  return SECTION_FALLBACK;
}

function firstMeaningfulWords(value: string, limit = 18): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, limit)
    .join(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Catalogue sources frequently store the description as a bare "<SKU> - <name>"
 * echo of the product itself, which renders as a duplicate of the title on
 * product cards. Strip the product's own SKU prefix before comparing so those
 * echoes are recognised regardless of whether the SKU is numeric ("254") or
 * alphanumeric ("254B" / "OM285").
 */
function stripSelfReference(description: string, product: CatalogueProduct): string {
  let cleaned = description;

  const sku = String(product.sku ?? "").trim();
  if (sku) {
    cleaned = cleaned.replace(
      new RegExp(`^\\s*${escapeRegExp(sku)}\\s*[-–—:]?\\s*`, "i"),
      "",
    );
  }

  // Fall back to a generic leading catalogue-number prefix ("254B - ", "12 – ").
  cleaned = cleaned.replace(/^\s*[A-Za-z]{0,4}\d+[A-Za-z]{0,3}\s*[-–—:]\s*/, "");

  return cleaned.trim();
}

/**
 * Compare on words alone so punctuation, ampersands and trailing full stops
 * cannot hide the fact that two snippets carry the same text.
 */
function comparableText(value: string): string {
  return normalizeText(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Crude singular form so "Adapter" and "Adapters" compare as one word. */
function stemWord(word: string): string {
  if (word.length <= 3 || !word.endsWith("s")) return word;

  // Only "-es" after a sibilant is a plural suffix ("boxes", "dishes");
  // in "bottles" the plural is the bare "s", so stripping "es" would
  // leave "bottl" and stop it matching the singular "bottle".
  if (/(?:s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ss")) return word;

  return word.slice(0, -1);
}

function contentWords(value: string): string[] {
  return comparableText(value)
    .split(" ")
    .filter(Boolean)
    .map(stemWord);
}

/** Connective words that carry no product meaning on their own. */
const FILLER_WORDS = new Set([
  "a", "an", "and", "or", "the", "with", "without", "for", "of", "in", "on",
  "to", "by", "type",
]);

/** True when two short words differ by at most one edit (typo tolerance). */
function isNearMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  // Short words are kept strict: "class" and "glass" are one edit apart but
  // mean entirely different things on a lab-glassware catalogue.
  if (Math.min(a.length, b.length) < 6) return false;

  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }

    if (++edits > 1) return false;

    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }

  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * True when `text` contributes no real information beyond `reference` — an
 * exact match, a subset, or merely a reordering/pluralisation of its words.
 *
 * Note the asymmetry: text wholly contained in the reference is redundant,
 * but text that *extends* the reference ("<name> Class A") is not.
 */
export function addsNothingBeyond(text: string, reference: string): boolean {
  const left = comparableText(text);
  const right = comparableText(reference);
  if (!left || !right) return !left;

  if (left === right || right.includes(left)) return true;

  const referenceWords = new Set(contentWords(reference));
  const novelWords = contentWords(text).filter(
    (word) =>
      !referenceWords.has(word) &&
      !FILLER_WORDS.has(word) &&
      // Catalogue text is riddled with typos ("Vaccum" for "Vacuum"); a word
      // one edit away from one already in the name is not new information.
      !Array.from(referenceWords).some((candidate) => isNearMatch(word, candidate)),
  );

  return novelWords.length === 0;
}

/** True when the descriptor adds nothing beyond the product name. */
function echoesProductName(descriptor: string, product: CatalogueProduct): boolean {
  return addsNothingBeyond(descriptor, product.name);
}

export function getCatalogueProductDescriptor(product: CatalogueProduct): string {
  const pieces: string[] = [];
  const description = stripHtml(product.descriptionHtml);
  const cleanedDescription = stripSelfReference(description, product);

  if (cleanedDescription && !echoesProductName(cleanedDescription, product)) {
    pieces.push(firstMeaningfulWords(cleanedDescription));
  }

  const featureHints = (product.features ?? [])
    .map((feature) => collapseWhitespace(feature))
    .filter((feature) => /class|certificate|nabl|iso|astm|usp|amber|clear|colour|color|wide mouth|tpx|pp/i.test(feature));

  if (!pieces.length && featureHints.length) {
    pieces.push(firstMeaningfulWords(featureHints.slice(0, 2).join(" · ")));
  }

  const descriptor = pieces.join(" ");
  return descriptor && !echoesProductName(descriptor, product) ? descriptor : "";
}

export function getCatalogueProductLabel(product: CatalogueProduct): string {
  const descriptor = getCatalogueProductDescriptor(product);
  return descriptor ? `${product.name} - ${descriptor}` : product.name;
}

export function getVariantSpecSummary(variant: CatalogueVariant): string {
  const specEntries = Object.entries(variant.specs ?? {})
    .filter(([, value]) => String(value ?? "").trim().length > 0);

  if (specEntries.length > 0) {
    const preferredKeys = [
      "Capacity",
      "Capacity (mL)",
      "Capacity (ml)",
      "Size",
      "Effective Length",
      "Length",
      "Volume",
    ];

    for (const key of preferredKeys) {
      const match = specEntries.find(([specKey]) => normalizeText(specKey).includes(normalizeText(key)));
      if (match) {
        return `${match[0]} ${match[1]}`.trim();
      }
    }

    return specEntries
      .slice(0, 2)
      .map(([key, value]) => `${key} ${value}`.trim())
      .join(" · ");
  }

  if (variant.specsText) {
    const parts = variant.specsText
      .split(";")
      .map((part) => collapseWhitespace(part))
      .filter(Boolean);
    if (parts.length > 0) {
      return parts.slice(0, 2).join(" · ");
    }
  }

  return "Specification not listed";
}

export function getVariantLabel(product: CatalogueProduct, variant: CatalogueVariant): string {
  const summary = getVariantSpecSummary(variant);
  const packLabel = `Pack of ${variant.pack ?? 1}`;
  return `${variant.sku} - ${summary} - ${packLabel}`;
}

export function buildCatalogueSearchText(product: CatalogueProduct): string {
  const parts: string[] = [
    product.name ?? "",
    product.sku ?? "",
    product.category ?? "",
    ...(product.categories ?? []),
    ...(product.features ?? []),
    stripHtml(product.descriptionHtml),
  ];

  for (const variant of product.variants ?? []) {
    parts.push(
      variant.sku ?? "",
      variant.id ?? "",
      variant.name ?? "",
      variant.specsText ?? "",
      ...(variant.specs ? Object.entries(variant.specs).map(([key, value]) => `${key} ${value}`) : []),
    );
  }

  return normalizeText(parts.join(" "));
}

export function buildCatalogueNumberSearchText(product: CatalogueProduct): string {
  const parts: string[] = [
    product.id ?? "",
    product.sku ?? "",
  ];

  for (const variant of product.variants ?? []) {
    parts.push(
      variant.id ?? "",
      variant.sku ?? "",
    );
  }

  return parts.map(normalizeCatalogueNumber).join(" ");
}

export function matchesCatalogueQuery(product: CatalogueProduct, query: string): boolean {
  const q = normalizeText(query);
  const catalogueQuery = normalizeCatalogueNumber(query);
  if (!q) return true;
  return (
    buildCatalogueSearchText(product).includes(q) ||
    Boolean(catalogueQuery && buildCatalogueNumberSearchText(product).includes(catalogueQuery))
  );
}

export function buildCatalogueIndex<T extends CatalogueProduct>(products: T[]): CatalogueIndex<T> {
  const sections = new Map<string, CatalogueSectionGroup<T>>();
  const productsBySku: Record<string, T> = {};
  const variantsBySku: CatalogueIndex<T>["variantsBySku"] = {};
  const flatProducts: T[] = [];

  for (const product of products) {
    const section = getCatalogueSection(product);
    const existingSection = sections.get(section);
    if (existingSection) {
      existingSection.products.push(product);
    } else {
      sections.set(section, { section, products: [product] });
    }

    flatProducts.push(product);
    productsBySku[String(product.sku)] = product;

    for (const variant of product.variants ?? []) {
      variantsBySku[String(variant.sku)] = { product, variant };
    }
  }

  // Ids are only a fallback. Postgres rows carry numeric DB ids that can equal another
  // product's catalogue number (DB id 116 is Whirling Hygrometers; code "116" is a flask).
  const taken = (key: string) => Object.hasOwn(productsBySku, key) || Object.hasOwn(variantsBySku, key);
  for (const product of products) {
    if (!taken(String(product.id))) productsBySku[String(product.id)] = product;
    for (const variant of product.variants ?? []) {
      if (!taken(String(variant.id))) variantsBySku[String(variant.id)] = { product, variant };
    }
  }

  return {
    sections: Array.from(sections.values()),
    products: flatProducts,
    productsBySku,
    variantsBySku,
  };
}

// "Cap. (ml)", "Capacity (mL)" and "Capacity (ml)" name one spec; spelling alone isn't a conflict.
function specKeyForm(key: string): string {
  return key.trim().toLowerCase().replace(/^cap\.?(?=\s|\(|$)/, "capacity").replace(/[^a-z0-9]+/g, " ").trim();
}

function variantFingerprint(productSku: string, variant: CatalogueVariant): string {
  const specs = Object.entries(variant.specs ?? {}).map(([key, value]) => [specKeyForm(key), String(value ?? "").trim()]).sort();
  return JSON.stringify([productSku, variant.priceBasis ?? null, variant.packSize ?? variant.pack ?? null, variant.pricePerPack ?? variant.price ?? null, specs]);
}

/**
 * The catalogue file has one record per printed page, so one product can span several
 * records ("670", "670--p2", …). Merges them by product sku with the union of their variants.
 * A variant sku whose copies disagree (price, pack, basis or specs, or listed under two
 * products) is kept once with its prices removed, so neither copy is picked, and is
 * returned in `conflicts`.
 */
export function mergeCatalogueRecords(records: CatalogueProduct[]): { products: CatalogueProduct[]; conflicts: Set<string> } {
  const products = new Map<string, CatalogueProduct & { variants: CatalogueVariant[] }>();
  const fingerprints = new Map<string, string>();
  const conflicts = new Set<string>();

  for (const record of records) {
    const sku = String(record.sku ?? "").trim();
    if (!sku) continue;
    const product = products.get(sku) ?? { ...record, id: sku, variants: [] };
    if (!product.features?.length && record.features?.length) product.features = record.features;
    for (const variant of record.variants ?? []) {
      const variantSku = String(variant.sku ?? "").trim();
      const fingerprint = variantFingerprint(sku, variant);
      const seen = variantSku ? fingerprints.get(variantSku) : undefined;
      if (seen === undefined) {
        if (variantSku) fingerprints.set(variantSku, fingerprint);
        product.variants.push(variant);
      } else if (seen !== fingerprint) {
        conflicts.add(variantSku);
      }
    }
    products.set(sku, product);
  }

  const unpriced = { price: null, priceLabel: "on request", pricePerPack: null, pricePerPiece: null };
  return {
    products: Array.from(products.values(), (product) => ({
      ...product,
      variants: product.variants.map((variant) => (conflicts.has(String(variant.sku ?? "").trim()) ? { ...variant, ...unpriced } : variant)),
    })),
    conflicts,
  };
}

export function groupProductsBySection<T extends CatalogueProduct>(products: T[]): CatalogueSectionGroup<T>[] {
  return buildCatalogueIndex(products).sections;
}

export function findCatalogueEntry<T extends CatalogueProduct>(
  index: CatalogueIndex<T>,
  sku: string,
): { product: T; variant?: CatalogueVariant } | null {
  const raw = String(sku ?? "").trim();
  if (!raw) return null;

  const variantMatch = index.variantsBySku[raw];
  if (variantMatch) {
    return {
      product: variantMatch.product,
      variant: variantMatch.variant,
    };
  }

  const product = index.productsBySku[raw];
  return product ? { product } : null;
}

// Order-form search. Codes are "base/variant" (4/1, 243P/7, 70/2A) or hyphenated (OM557-02-01).
// Ranked: exact code, same base ("4" -> 4/1..4/7), code prefix, code contains, then name/category text.
// A query with a separator ("4/", "70/2") keeps only code-prefix hits and shows them all, so "4/"
// never lists 524/4; if no code has that prefix (a name like "hot-plate") it falls back to the ranking.
export function rankCatalogueMatches<T extends { searchSku: string; searchText: string }>(options: T[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return { matches: options, showAll: false };

  const rank = (option: T) => {
    const sku = option.searchSku;
    if (sku === needle) return 0;
    if (sku.split(/[/-]/)[0] === needle) return 1;
    if (sku.startsWith(needle)) return 2;
    if (sku.includes(needle)) return 3;
    return option.searchText.includes(needle) ? 4 : -1;
  };
  const hits = options
    .map((option) => ({ option, rank: rank(option) }))
    .filter((hit) => hit.rank >= 0)
    .sort((a, b) => a.rank - b.rank);
  const prefixHits = /[/-]/.test(needle) ? hits.filter((hit) => hit.rank <= 2) : [];

  return prefixHits.length
    ? { matches: prefixHits.map((hit) => hit.option), showAll: true }
    : { matches: hits.map((hit) => hit.option), showAll: false };
}
