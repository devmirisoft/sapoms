/**
 * Pack / piece pricing: the one place catalogue prices are computed.
 *
 * Every variant states how its price is printed (omsonsdata.json, mirrored in
 * product_variants): priceBasis ("pack" | "piece"), packSize, packUnit, pricePerPack and
 * pricePerPiece in rupees. Nothing is inferred from names or categories. The pack price
 * is authoritative and all maths is integer paise: a line costs quantityPacks × packPricePaise.
 */

function toPaise(rupees) {
  const value = Number(rupees);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0;
}

/** "pc" | "m" | "set" from the catalogue's packUnit or the DB's free-text unit name ("Pcs."). */
function unitLabel(unit) {
  const value = String(unit ?? "").trim().toLowerCase();
  if (/^(m|mtrs?\.?|metres?|meters?)$/.test(value)) return "m";
  if (/^sets?\.?$/.test(value)) return "set";
  return "pc";
}

/**
 * A variant's prices, or null when it has none ("on request"). A row without explicit
 * per-pack / per-piece prices reads its printed `price` by its stated basis, "piece" by default.
 */
function variantPricing(variant) {
  if (!variant) return null;
  const priceBasis = /** @type {"pack" | "piece"} */ (variant.priceBasis === "pack" ? "pack" : "piece");
  const packSize = Math.max(1, Math.trunc(Number(variant.packSize ?? variant.pack)) || 1);
  const printedPaise = toPaise(variant.price);
  const packPricePaise = toPaise(variant.pricePerPack)
    || toPaise(variant.pricePerPiece) * packSize
    || (priceBasis === "pack" ? printedPaise : printedPaise * packSize);
  if (!packPricePaise) return null;
  return {
    priceBasis,
    packSize,
    packUnit: unitLabel(variant.packUnit),
    packPricePaise,
    piecePricePaise: toPaise(variant.pricePerPiece) || Math.round(packPricePaise / packSize),
    packAssumed: variant.packAssumed === true,
  };
}

/** What `quantityPacks` packs of a variant cost. null when it has no price. */
function linePricing(variant, quantityPacks) {
  const pricing = variantPricing(variant);
  if (!pricing) return null;
  const packs = Math.max(0, Math.trunc(Number(quantityPacks)) || 0);
  return { ...pricing, quantityPacks: packs, linePaise: packs * pricing.packPricePaise, pieces: packs * pricing.packSize };
}

/** A product's cheapest pack: what listing cards show and sort by. */
function cheapestPricing(product) {
  let cheapest = null;
  for (const variant of product?.variants ?? []) {
    const pricing = variantPricing(variant);
    if (pricing && (!cheapest || pricing.packPricePaise < cheapest.packPricePaise)) cheapest = pricing;
  }
  return cheapest;
}

/** Admin form: the printed price is the pack or the piece price per its basis; derive the other. */
function pricesFromPrinted(priceBasis, packSizeInput, printedPaise) {
  const packSize = Math.max(1, Math.trunc(Number(packSizeInput)) || 1);
  const printed = Math.max(0, Math.round(Number(printedPaise)) || 0);
  const packPricePaise = priceBasis === "pack" ? printed : printed * packSize;
  const basis = /** @type {"pack" | "piece"} */ (priceBasis === "pack" ? "pack" : "piece");
  return { priceBasis: basis, packSize, packPricePaise, piecePricePaise: Math.round(packPricePaise / packSize) };
}

/** ₹7,400 for whole rupees, ₹45.40 otherwise. */
function formatRupees(paise) {
  const decimals = paise % 100 === 0 ? 0 : 2;
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: 2 })}`;
}

/** "₹7,400 / pack of 100 (₹74/pc)" for pack-priced variants, "₹440/pc · pack of 10 = ₹4,400" for piece-priced ones. */
function formatPriceLine(pricing) {
  if (!pricing) return "Price on request";
  const { priceBasis, packSize, packUnit, packPricePaise, piecePricePaise } = pricing;
  const piece = `${formatRupees(piecePricePaise)}/${packUnit}`;
  if (packSize === 1) return piece;
  const pack = `pack of ${packSize}${packUnit === "pc" ? "" : ` ${packUnit}`}`;
  return priceBasis === "pack"
    ? `${formatRupees(packPricePaise)} / ${pack} (${piece})`
    : `${piece} · ${pack} = ${formatRupees(packPricePaise)}`;
}

module.exports = {
  toPaise,
  unitLabel,
  variantPricing,
  linePricing,
  cheapestPricing,
  pricesFromPrinted,
  formatRupees,
  formatPriceLine,
};
