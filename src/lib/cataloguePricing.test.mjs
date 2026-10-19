import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import pricing from "./cataloguePricing.js";

// The real catalogue, merged per product exactly as the app loads it.
const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve("src") } });
const { mergeCatalogueRecords } = await jiti.import(path.resolve("src/lib/catalogue.ts"));
const { products, conflicts } = mergeCatalogueRecords(JSON.parse(fs.readFileSync(path.resolve("public/data/omsonsdata.json"), "utf8")));
const variants = new Map(products.flatMap((product) => product.variants.map((variant) => [variant.sku, variant])));

// [catalogue number, packs, expected line total in paise]
const LINES = [
  ["OM501-45", 1, 185000],   // ₹1,850 per pack of 25 (₹74/pc)
  ["OM260-020", 2, 960000],  // ₹9,600
  ["OM426-20", 3, 690000],   // ₹6,900
  ["159/1", 1, 440000],      // ₹4,400: ₹440/pc × 10
  ["381/1", 1, 4200],        // ₹42 per pack of 10
  ["382/1", 1, 24000],       // ₹240
  ["364/1", 1, 45400],       // ₹454 per 10 m
  ["367/1", 1, 91000],       // ₹910
  ["674/1", 1, 405000],      // ₹4,050.00
  ["663/1", 3, 59040],       // ₹590.40: ₹16.40/pc × 12 × 3
  ["227/1", 1, 46600],       // ₹466 a set
];

for (const [sku, packs, expected] of LINES) {
  test(`${sku} × ${packs} pack${packs > 1 ? "s" : ""} costs ₹${(expected / 100).toFixed(2)}`, () => {
    const line = pricing.linePricing(variants.get(sku), packs);
    assert.equal(line?.linePaise, expected);
    assert.ok(Number.isInteger(line.linePaise));
    assert.equal(line.pieces, packs * line.packSize);
  });
}

test("a variant the file contradicts itself on is reported, not priced", () => {
  assert.ok(conflicts.has("126/8"));
  assert.equal(pricing.variantPricing(variants.get("126/8")), null);
});

test("price lines read as the catalogue prints them", () => {
  const line = (sku) => pricing.formatPriceLine(pricing.variantPricing(variants.get(sku)));
  assert.equal(line("OM501-45"), "₹1,850 / pack of 25 (₹74/pc)");
  assert.equal(line("159/1"), "₹440/pc · pack of 10 = ₹4,400");
  assert.equal(line("364/1"), "₹454 / pack of 10 m (₹45.40/m)");
  assert.equal(line("227/1"), "₹466/set");
  assert.equal(pricing.formatPriceLine(null), "Price on request");
});

test("rows without explicit pack/piece prices read their printed price by stated basis", () => {
  assert.equal(pricing.variantPricing({ price: 440, pack: 10 }).packPricePaise, 440000);
  assert.equal(pricing.variantPricing({ price: 7400, pack: 100, priceBasis: "pack" }).packPricePaise, 740000);
  assert.equal(pricing.variantPricing({ pricePerPiece: 94, packSize: 10 }).packPricePaise, 94000);
  assert.equal(pricing.variantPricing({ price: 0, pack: 5 }), null);
});

test("admin prices: the pack price is authoritative and the piece price is rounded to the paisa", () => {
  assert.deepEqual(pricing.pricesFromPrinted("pack", 3, 10000), { priceBasis: "pack", packSize: 3, packPricePaise: 10000, piecePricePaise: 3333 });
  assert.deepEqual(pricing.pricesFromPrinted("piece", 12, 1640), { priceBasis: "piece", packSize: 12, packPricePaise: 19680, piecePricePaise: 1640 });
});
