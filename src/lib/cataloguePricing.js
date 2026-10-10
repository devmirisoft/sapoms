function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function collectProductText(product) {
  if (!product || typeof product !== "object") return "";
  const values = [
    product.sku,
    product.SKU,
    product.catalogueProductSku,
    product.productname,
    product.variantCode,
    product.category,
    product.catalogueSection,
    product.name,
    product.productName,
    product.displayName,
    product.Name,
  ];

  const categories = Array.isArray(product.categories)
    ? product.categories
    : Array.isArray(product.Categories)
      ? product.Categories
      : [];

  return [...values, ...categories]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value))
    .join(" ");
}

function isSyringeFiltersProduct(product) {
  return /\bsyringe\s+filters?\b/i.test(collectProductText(product));
}

// OM401–OM434: membrane disc filters and absorbent pads are priced per pack of 25/100.
function isMembraneDiscFilterProduct(product) {
  return /\bmembrane\s+disc\s+filters?\b|\babsorbent\s+pads?\b/i.test(collectProductText(product));
}

function isTenMetreTubingProduct(product) {
  const sku = String(product?.sku ?? product?.SKU ?? product?.catalogueProductSku ?? "").trim();
  if (/^(364|365|366)$/.test(sku)) return true;
  return /\b(364|365|366)(?:\/\d+)?\b/.test(collectProductText(product));
}

/**
 * Catalogue variant prices are rupees per individual unit. Order rows also
 * store rupees per individual unit because quantity * packSize is sent to PHP.
 */
function variantPriceToUnitRupees(priceInput) {
  const unitPrice = positiveNumber(priceInput);
  if (!unitPrice) return 0;
  return roundMoney(unitPrice);
}

function getVariantOrderPricing(priceInput, packSizeInput, product) {
  const price = variantPriceToUnitRupees(priceInput);
  const packSize = Math.max(1, positiveNumber(packSizeInput) || 1);
  if (!price) return { unitPrice: 0, baseListPrice: 0, priceBasis: "unit" };

  if (isSyringeFiltersProduct(product) || isMembraneDiscFilterProduct(product) || isTenMetreTubingProduct(product)) {
    return {
      unitPrice: roundMoney(price / packSize),
      baseListPrice: price,
      priceBasis: "pack",
    };
  }

  return {
    unitPrice: price,
    baseListPrice: roundMoney(price * packSize),
    priceBasis: "unit",
  };
}

module.exports = {
  getVariantOrderPricing,
  isSyringeFiltersProduct,
  isMembraneDiscFilterProduct,
  isTenMetreTubingProduct,
  variantPriceToUnitRupees,
  variantPackPriceToUnitRupees: variantPriceToUnitRupees,
};
