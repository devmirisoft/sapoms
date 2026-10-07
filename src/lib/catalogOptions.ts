// Catalogue-JSON lookups shared by the admin Hot Items and Today's Sale pages.

export type CatalogOption = {
  sku: string;
  name: string;
  displayName: string;
  specs: string;
  image: string;
};

type CatalogueImageSource = {
  images?: unknown;
  Images?: unknown;
};

type CatalogueSpecsSource = {
  specsText?: unknown;
  SpecsText?: unknown;
  specs?: unknown;
  Specs?: unknown;
  specifications?: unknown;
  Specifications?: unknown;
  specification?: unknown;
};

type CatalogueVariantRecord = CatalogueImageSource & {
  sku?: unknown;
  SKU?: unknown;
  name?: unknown;
  Name?: unknown;
} & CatalogueSpecsSource;

export type CatalogueProductRecord = CatalogueImageSource & {
  sku?: unknown;
  SKU?: unknown;
  name?: unknown;
  Name?: unknown;
  variants?: unknown;
} & CatalogueSpecsSource;

// ─── API + catalog helpers ───────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV !== "production";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function firstString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";

  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      return item.trim();
    }
  }

  return "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatSpecObject(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([key, specValue]) => {
      const cleanKey = String(key).trim();
      const cleanValue = String(specValue ?? "").trim();
      if (!cleanKey || !cleanValue) return "";
      return `${cleanKey}: ${cleanValue}`;
    })
    .filter(Boolean)
    .join(" · ");
}

function getSpecs(value: CatalogueSpecsSource): string {
  const candidates = [
    value.specsText,
    value.SpecsText,
    value.specs,
    value.Specs,
    value.specifications,
    value.Specifications,
    value.specification,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" || Array.isArray(candidate)) {
      const text = firstString(candidate);
      if (text) return text;
    }

    if (isPlainObject(candidate)) {
      const formatted = formatSpecObject(candidate);
      if (formatted) return formatted;
    }
  }

  return "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanCatalogueName(name: string, sku: string): string {
  const cleanName = String(name ?? "").trim();
  const cleanSku = String(sku ?? "").trim();

  if (!cleanName || !cleanSku) return cleanName;

  const escapedSku = escapeRegExp(cleanSku);
  const patterns = [
    new RegExp(`\\s*[-–—]\\s*${escapedSku}\\s*$`, "i"),
    new RegExp(`\\s*\\(?\\s*${escapedSku}\\s*\\)?\\s*$`, "i"),
  ];

  for (const pattern of patterns) {
    const next = cleanName.replace(pattern, "").trim();
    if (next && next !== cleanSku) return next;
  }

  return cleanName;
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  endpointLabel = "request"
): Promise<T> {
  const response = await fetch(input, init);
  const responseText = await response.text();
  const preview = responseText.replace(/\s+/g, " ").trim().slice(0, 250);
  const previewSuffix = IS_DEV && preview ? `: ${preview}` : "";

  if (!response.ok) {
    throw new Error(
      `${endpointLabel} failed with HTTP ${response.status}${previewSuffix}`
    );
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw new Error(
      `${endpointLabel} returned invalid JSON${previewSuffix}`
    );
  }
}

function getFirstImage(item: CatalogueImageSource): string {
  return firstString(item.images) || firstString(item.Images);
}

export function buildCatalogOptions(products: CatalogueProductRecord[]): CatalogOption[] {
  const seen = new Set<string>();
  const options: CatalogOption[] = [];

  for (const product of products) {
    const productSku = String(product.sku ?? product.SKU ?? "").trim();
    const productName = String(product.name ?? product.Name ?? "").trim();
    const productSpecs = getSpecs(product);
    const productImage = getFirstImage(product);
    const productDisplayName = cleanCatalogueName(productName, productSku);

    if (productSku && productName && !seen.has(productSku.toLowerCase())) {
      seen.add(productSku.toLowerCase());
      options.push({
        sku: productSku,
        name: productName,
        displayName: productDisplayName,
        specs: productSpecs,
        image: productImage,
      });
    }

    const variants = Array.isArray(product.variants)
      ? product.variants.filter(isRecord)
      : [];

    for (const variant of variants) {
      const typedVariant = variant as CatalogueVariantRecord;
      const variantSku = String(typedVariant.sku ?? typedVariant.SKU ?? "").trim();
      const variantName = String(typedVariant.name ?? typedVariant.Name ?? productName).trim();
      const variantSpecs = getSpecs(typedVariant) || productSpecs;
      const variantImage = getFirstImage(typedVariant) || productImage;
      const variantDisplayName = cleanCatalogueName(variantName || productName, variantSku);
      if (!variantSku || seen.has(variantSku.toLowerCase())) continue;
      seen.add(variantSku.toLowerCase());
      options.push({
        sku: variantSku,
        name: variantName || productName,
        displayName: variantDisplayName,
        specs: variantSpecs,
        image: variantImage,
      });
    }
  }

  return options;
}

export async function fetchCatalogueProducts(): Promise<CatalogueProductRecord[]> {
  const json = await fetchJson<unknown>(
    "/data/omsons_products_from_excel_with_images.json",
    { cache: "no-store" },
    "Catalogue JSON"
  );

  return Array.isArray(json) ? (json.filter(isRecord) as CatalogueProductRecord[]) : [];
}
