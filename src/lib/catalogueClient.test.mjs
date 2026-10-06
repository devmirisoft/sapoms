import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// Fresh module per test (catalogueClient caches at module level); jiti resolves the "@/" alias.
async function importCatalogueClient() {
  const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve("src") }, moduleCache: false });
  return jiti.import(path.resolve("src/lib/catalogueClient.ts"));
}

test("loadCatalogueProducts merges complete nested variants into enriched catalogue products", async () => {
  const originalFetch = globalThis.fetch;
  const client = await importCatalogueClient();

  globalThis.fetch = async (url) => {
    const pathName = String(url);
    if (pathName.includes("omsons_products_from_excel_with_images")) {
      return {
        ok: true,
        json: async () => [
          {
            id: "58",
            sku: "58",
            name: "Volumetric Flask Amber",
            images: ["/image-enriched.jpg"],
            variants: [
              { id: "58/1", sku: "58/1", price: 100, images: ["/variant-enriched.jpg"] },
              { id: "58/2", sku: "58/2", price: 200 },
            ],
          },
        ],
      };
    }

    if (pathName.includes("nested_omsons_products")) {
      return {
        ok: true,
        json: async () => [
          {
            id: "58",
            sku: "58",
            name: "Volumetric Flask Amber",
            images: ["/nested.jpg"],
            variants: [
              { id: "58/1", sku: "58/1", price: 90 },
              { id: "58/2", sku: "58/2", price: 190 },
              { id: "58/3", sku: "58/3", price: 300 },
            ],
          },
        ],
      };
    }

    throw new Error(`Unexpected URL ${pathName}`);
  };

  try {
    const products = await client.loadCatalogueProducts();
    const product = products.find((item) => item.sku === "58");
    assert.deepEqual(product.variants.map((variant) => variant.sku), ["58/1", "58/2", "58/3"]);
    assert.equal(product.images[0], "/image-enriched.jpg");
    assert.equal(product.variants[0].price, 100);
    assert.equal(product.variants[0].images[0], "/variant-enriched.jpg");
    assert.equal(product.variants[2].images[0], "/image-enriched.jpg");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loadCatalogueProducts normalizes merged variant specification aliases", async () => {
  const originalFetch = globalThis.fetch;
  const client = await importCatalogueClient();
  const nestedVariants = Array.from({ length: 15 }, (_, index) => {
    const variantNumber = index + 1;
    return {
      id: `58/${variantNumber}`,
      sku: `58/${variantNumber}`,
      price: 90 + variantNumber,
      specs: {
        "Capacity (ml)": String(variantNumber),
        "Neck Size": "14/23",
        "Tolerance (±mL)": "0.025",
        Neck: `neck-${variantNumber}`,
        "Dia x Height OD (mm)": `dia-${variantNumber}`,
        "Secondary Only": `secondary-${variantNumber}`,
      },
    };
  });

  globalThis.fetch = async (url) => {
    const pathName = String(url);
    if (pathName.includes("omsons_products_from_excel_with_images")) {
      return {
        ok: true,
        json: async () => [
          {
            id: "58",
            sku: "58",
            name: "Volumetric Flask Amber",
            images: ["/image-enriched.jpg"],
            variants: [
              {
                id: "58/1",
                sku: "58/1",
                price: 100,
                images: ["/variant-enriched.jpg"],
                specs: {
                  "Capacity (ml)": "1",
                  "Neck OD": "10-enriched",
                  "Dia x Height (mm)": "13x65-enriched",
                  "Tolerance (±mL)": "0.025",
                  "Unrelated Spec": "keep-enriched",
                },
              },
              {
                id: "58/2",
                sku: "58/2",
                price: 200,
                specs: {
                  "Neck OD": "",
                  "Dia x Height (mm)": "",
                  "Unrelated Spec": "keep-second",
                },
              },
            ],
          },
        ],
      };
    }

    if (pathName.includes("nested_omsons_products")) {
      return {
        ok: true,
        json: async () => [
          {
            id: "58",
            sku: "58",
            name: "Volumetric Flask Amber",
            images: ["/nested.jpg"],
            variants: nestedVariants,
          },
        ],
      };
    }

    throw new Error(`Unexpected URL ${pathName}`);
  };

  try {
    const products = await client.loadCatalogueProducts();
    const product = products.find((item) => item.sku === "58");
    const expectedSkus = Array.from({ length: 15 }, (_, index) => `58/${index + 1}`);
    assert.deepEqual(product.variants.map((variant) => variant.sku), expectedSkus);

    const allSpecKeys = new Set(product.variants.flatMap((variant) => Object.keys(variant.specs ?? {})));
    assert.equal(allSpecKeys.has("Neck"), true);
    assert.equal(allSpecKeys.has("Neck OD"), false);
    assert.equal(allSpecKeys.has("Dia x Height (mm)"), true);
    assert.equal(allSpecKeys.has("Dia x Height OD (mm)"), false);

    assert.equal(product.variants[0].specs.Neck, "10-enriched");
    assert.equal(product.variants[0].specs["Dia x Height (mm)"], "13x65-enriched");
    assert.equal(product.variants[1].specs.Neck, "neck-2");
    assert.equal(product.variants[1].specs["Dia x Height (mm)"], "dia-2");
    assert.equal(product.variants[0].specs["Unrelated Spec"], "keep-enriched");
    assert.equal(product.variants[2].specs["Secondary Only"], "secondary-3");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loadCatalogueProducts normalizes PostgreSQL products into the catalogue shape", async () => {
  const originalFetch = globalThis.fetch;
  const client = await importCatalogueClient();

  globalThis.fetch = async (url) => {
    const pathName = String(url);
    if (pathName.includes("omsons_products_from_excel_with_images") || pathName.includes("nested_omsons_products")) return { ok: true, json: async () => [] };
    if (pathName === "/api/products") {
      return { ok: true, json: async () => ({ success: true, data: [{ id: "pg-152", sku: "PG-152", productCode: "PG-152", name: "Sandbox PostgreSQL Joint", category: "JOINTS", categories: ["JOINTS"], imageUrl: "https://res.cloudinary.com/demo/image/upload/sample.jpg", images: ["https://res.cloudinary.com/demo/image/upload/sample.jpg"], active: true, descriptionHtml: "Base description\n\nABOUT THIS ITEM\n- First point\n- Second point\n\nVARIANT SPECIFICATIONS\n152/1 - Socket Size: 10/19; Diameter: 13; Height: 120\n152/2 - Socket Size: 12/21; Diameter: 14; Height: 125", variants: [{ id: "v1", sku: "152/1", catalogueNumber: "152/1", packSize: 10, unitPricePaise: "9400", price: 94, active: true }, { id: "v2", sku: "152/2", catalogueNumber: "152/2", packSize: 10, unitPricePaise: "9900", price: 99, active: true }] }] }) };
    }
    throw new Error(`Unexpected URL ${pathName}`);
  };

  try {
    const products = await client.loadCatalogueProducts();
    const product = products.find((item) => item.sku === "PG-152");
    assert.equal(product.name, "Sandbox PostgreSQL Joint");
    assert.deepEqual(product.categories, ["JOINTS"]);
    assert.equal(product.images[0], "https://res.cloudinary.com/demo/image/upload/sample.jpg");
    assert.deepEqual(product.features, ["First point", "Second point"]);
    assert.equal(product.descriptionHtml, "Base description");
    assert.equal(product.variants.length, 2);
    assert.equal(product.variants[0].pack, 10);
    assert.equal(product.variants[0].price, 94);
    assert.equal(product.variants[0].inStock, true);
    assert.equal(product.variants[0].specs["Socket Size"], "10/19");
    assert.equal(product.variants[1].specs.Height, "125");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loadCatalogueProducts lets PostgreSQL products win duplicate catalogue SKUs", async () => {
  const originalFetch = globalThis.fetch;
  const client = await importCatalogueClient();

  globalThis.fetch = async (url) => {
    const pathName = String(url);
    if (pathName.includes("omsons_products_from_excel_with_images")) return { ok: true, json: async () => [{ id: "DUP", sku: "DUP", name: "JSON Product", variants: [] }] };
    if (pathName.includes("nested_omsons_products")) return { ok: true, json: async () => [] };
    if (pathName === "/api/products") return { ok: true, json: async () => ({ success: true, data: [{ id: "pg-dup", sku: "DUP", name: "PostgreSQL Product", active: true, variants: [{ id: "pg-v", sku: "DUP/1", catalogueNumber: "DUP/1", price: 12, packSize: 1, active: true }] }] }) };
    throw new Error(`Unexpected URL ${pathName}`);
  };

  try {
    const products = await client.loadCatalogueProducts();
    const matches = products.filter((item) => item.sku === "DUP");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].name, "PostgreSQL Product");
    assert.equal(matches[0].variants[0].sku, "DUP/1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mergeCatalogueProducts hides deleted PostgreSQL products and keeps JSON-only extras", async () => {
  const { mergeCatalogueProducts } = await importCatalogueClient();
  const json = (sku, extra = {}) => ({
    id: sku, sku, name: `JSON ${sku}`, category: "Flasks",
    categories: ["Flasks > Volumetric", "Flasks"],
    images: [`/${sku}-1.jpg`, `/${sku}-2.jpg`],
    variants: [{ id: `${sku}/1`, sku: `${sku}/1`, price: 10, pack: 1 }],
    ...extra,
  });
  const pg = (sku, extra = {}) => ({
    id: `pg-${sku}`, sku, name: `PG ${sku}`, category: "Flasks", imageUrl: `/${sku}-1.jpg`, active: true,
    variants: [{ id: `v-${sku}`, sku: `${sku}/1`, catalogueNumber: `${sku}/1`, unitPricePaise: "2000", packSize: 1, active: true }],
    ...extra,
  });

  const products = mergeCatalogueProducts(
    [json("DEL"), json("EMPTY"), json("SAME"), json("MOVED")],
    [],
    [
      pg("DEL", { active: false }),
      pg("EMPTY", { variants: [] }),
      pg("SAME"),
      pg("MOVED", { category: "Beakers", imageUrl: "/new.jpg" }),
    ],
  );
  const bySku = Object.fromEntries(products.map((product) => [product.sku, product]));

  assert.equal(bySku.DEL, undefined, "deleted in admin must not fall back to JSON");
  assert.equal(bySku.EMPTY, undefined, "no active variants must not fall back to JSON");
  assert.equal(bySku.SAME.name, "PG SAME");
  assert.equal(bySku.SAME.variants[0].price, 20);
  assert.deepEqual(bySku.SAME.images, ["/SAME-1.jpg", "/SAME-2.jpg"]);
  assert.deepEqual(bySku.SAME.categories, ["Flasks > Volumetric", "Flasks"]);
  assert.deepEqual(bySku.MOVED.images, ["/new.jpg"]);
  assert.deepEqual(bySku.MOVED.categories, ["Beakers"]);
});
