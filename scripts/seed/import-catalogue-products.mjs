#!/usr/bin/env node
// Imports the JSON product catalogue (public/data/*.json) into PostgreSQL so every
// product on /Products can be edited from /Pages/products. Runs the same merge
// /Products runs, so the imported rows are exactly what the site shows today.
//
//   DATABASE_URL='postgres://…' node scripts/seed/import-catalogue-products.mjs [--dry-run|--commit]
//
// --dry-run (default) reports what would be created; --commit writes. Re-runnable:
// products whose productCode already exists are skipped (admin rows already win).
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const commit = process.argv.includes("--commit");

// Read before prisma.mjs runs dotenv, so .env can never pick the target.
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("Pass DATABASE_URL inline; .env is deliberately not used."); process.exit(1); }
const target = new URL(DATABASE_URL);
console.log(`TARGET host=${target.hostname} db=${target.pathname.slice(1)} mode=${commit ? "commit" : "dry-run"}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const jiti = createJiti(import.meta.url, { alias: { "@": path.join(ROOT, "src") } });
const { mergeCatalogueProducts } = await jiti.import(path.join(ROOT, "src/lib/catalogueClient.ts"));
const { stripHtml } = await jiti.import(path.join(ROOT, "src/lib/catalogue.ts"));
const { getVariantOrderPricing } = createRequire(import.meta.url)(path.join(ROOT, "src/lib/cataloguePricing.js"));
const { PrismaClient } = await import("../prisma.mjs");
const prisma = new PrismaClient();

const text = (v) => String(v ?? "").trim();
const readJson = async (file) => JSON.parse(await readFile(path.join(ROOT, "public/data", file), "utf8"));
const products = mergeCatalogueProducts(
  await readJson("omsons_products_from_excel_with_images.json"),
  await readJson("nested_omsons_products.json"),
);

const report = { catalogue: products.length, created: 0, existing: 0, noVariants: [], skuConflicts: [], lossySpecs: [], subPaisaPrices: [], noCategory: [] };

/** Rupees → paise. Prices are at most 2 decimals; anything finer is reported, not silently rounded away. */
function toPaise(rupees, where) {
  const value = Number(rupees) > 0 ? Number(rupees) : 0;
  const paise = Math.round(value * 100);
  if (Math.abs(paise - value * 100) > 1e-6) report.subPaisaPrices.push(`${where}: ${rupees}`);
  return BigInt(paise);
}

/** Same layout the admin form's buildDescription writes and both description parsers read back. */
function describe(product, variants) {
  const parts = [stripHtml(product.descriptionHtml)].filter(Boolean);
  const features = (product.features ?? []).map(text).filter(Boolean);
  if (features.length) parts.push(`ABOUT THIS ITEM\n${features.map((item) => `- ${item}`).join("\n")}`);
  const specLines = variants.map((variant) => {
    const specs = Object.entries(variant.specs ?? {}).map(([key, value]) => [text(key), text(value)]).filter(([key, value]) => key && value);
    for (const [key, value] of specs) {
      if (/[:;\n]/.test(key) || /[;\n]/.test(value)) report.lossySpecs.push(`${variant.sku} ${key}: ${value}`);
    }
    return specs.length ? `${text(variant.sku)} - ${specs.map(([key, value]) => `${key}: ${value}`).join("; ")}` : "";
  }).filter(Boolean);
  if (specLines.length) parts.push(`VARIANT SPECIFICATIONS\n${specLines.join("\n")}`);
  return parts.join("\n\n");
}

const existingCodes = new Set((await prisma.product.findMany({ select: { productCode: true } })).map((row) => text(row.productCode)).filter(Boolean));
const takenSkus = new Set((await prisma.productVariant.findMany({ select: { sku: true } })).map((row) => text(row.sku)).filter(Boolean));
const categoryIds = new Map((await prisma.productCategory.findMany({ select: { id: true, name: true } })).map((row) => [row.name.toLowerCase(), row.id]));

async function categoryIdFor(name) {
  const clean = text(name).slice(0, 160);
  if (!clean) return null;
  const key = clean.toLowerCase();
  if (!categoryIds.has(key)) {
    categoryIds.set(key, commit ? (await prisma.productCategory.create({ data: { name: clean }, select: { id: true } })).id : null);
  }
  return categoryIds.get(key);
}

// Reversed so the admin list (newest id first) shows the catalogue in its usual order.
for (const product of [...products].reverse()) {
  const code = text(product.sku || product.id);
  if (existingCodes.has(code)) { report.existing++; continue; }

  const variants = [];
  for (const variant of product.variants ?? []) {
    const sku = text(variant.sku || variant.id);
    if (!sku || takenSkus.has(sku)) { if (sku) report.skuConflicts.push(`${code}: ${sku}`); continue; }
    takenSkus.add(sku);
    variants.push({ ...variant, sku });
  }
  if (!variants.length) { report.noVariants.push(code); continue; }
  if (!text(product.category)) report.noCategory.push(code);

  const data = {
    productCode: code,
    name: text(product.name).slice(0, 300) || code,
    description: describe(product, variants) || null,
    imageUrl: text(product.images?.[0]) || null,
    categoryId: await categoryIdFor(product.category),
    active: true,
    variants: {
      create: variants.map((variant) => {
        const pack = Math.max(1, Math.trunc(Number(variant.pack)) || 1);
        const { baseListPrice } = getVariantOrderPricing(variant.price, pack, product);
        return {
          sku: variant.sku,
          catalogueNumber: variant.sku,
          unitName: "Pcs.",
          packSize: pack,
          unitPricePaise: toPaise(variant.price, variant.sku),
          packPricePaise: BigInt(Math.round(baseListPrice * 100)),
          active: variant.inStock !== false,
        };
      }),
    },
  };

  if (commit) await prisma.product.create({ data });
  existingCodes.add(code);
  report.created++;
}

await prisma.$disconnect();

const sample = (list) => `${list.length}${list.length ? ` e.g. ${list.slice(0, 5).join(" | ")}` : ""}`;
console.log(`catalogue products: ${report.catalogue}`);
console.log(`${commit ? "created" : "would create"}: ${report.created}`);
console.log(`already in DB (skipped): ${report.existing}`);
console.log(`variant SKU already taken (variant skipped): ${sample(report.skuConflicts)}`);
console.log(`no importable variants (product skipped): ${sample(report.noVariants)}`);
console.log(`no category: ${sample(report.noCategory)}`);
console.log(`spec entries that won't round-trip (":" / ";" / newline): ${sample(report.lossySpecs)}`);
console.log(`prices finer than a paisa: ${sample(report.subPaisaPrices)}`);
