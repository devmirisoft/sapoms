import test from "node:test";
import assert from "node:assert/strict";
import pricing from "./cataloguePricing.js";

test("manual order keeps catalogue price as per-unit rupees", () => {
  assert.equal(pricing.variantPriceToUnitRupees(440), 440);
});

test("single-unit packs keep their catalogue price", () => {
  assert.equal(pricing.variantPriceToUnitRupees(125), 125);
});

test("per-unit values round consistently to paise without pack division", () => {
  assert.equal(pricing.variantPriceToUnitRupees(100.555), 100.56);
});

test("legacy helper name also keeps catalogue price as per-unit rupees", () => {
  assert.equal(pricing.variantPackPriceToUnitRupees(5200, 100), 5200);
});

test("normal catalogue products use unit price times pack size", () => {
  assert.deepEqual(
    pricing.getVariantOrderPricing(266, 10, {
      category: "Accessories",
      categories: ["Laboratory Glassware > Extraction Apparatus"],
    }),
    { unitPrice: 266, baseListPrice: 2660, priceBasis: "unit" }
  );
});

test("syringe filters use catalogue price as pack price", () => {
  assert.deepEqual(
    pricing.getVariantOrderPricing(6200, 100, {
      category: "Filters & Membrane",
      categories: ["Syringe Filters > Sterile"],
      name: "PTFE Syringe Filters, Hydrophobic, Sterile",
    }),
    { unitPrice: 62, baseListPrice: 6200, priceBasis: "pack" }
  );
});

test("cat nos 364, 365, and 366 use catalogue price as 10 mtrs price", () => {
  for (const sku of ["364", "365", "366"]) {
    assert.deepEqual(
      pricing.getVariantOrderPricing(1100, 10, {
        sku,
        category: "Rubberware",
        name: "Tubings, Red Colour",
      }),
      { unitPrice: 110, baseListPrice: 1100, priceBasis: "pack" }
    );
  }
});

test("membrane disc filters and absorbent pads use catalogue price as pack price", () => {
  for (const name of ["PVDF Membrane Disc Filter", "Absorbent Pads (Nutrient Pads) Sterile"]) {
    assert.deepEqual(
      pricing.getVariantOrderPricing(3400, 100, { sku: "OM409", category: "Filters & Membrane", name }),
      { unitPrice: 34, baseListPrice: 3400, priceBasis: "pack" }
    );
  }
});
