#!/usr/bin/env node
// Makes the PostgreSQL catalogue match public/data/omsonsdata.json, the source of truth, for
// products already in the DB:
//   - pricing: price_basis, pack_size, unit_name, pack_assumed, unit_price_paise (the piece
//     price) and pack_price_paise (the authoritative pack price)
//   - names (except KEEP_NAMES) and descriptions (base text, ABOUT THIS ITEM, VARIANT SPECIFICATIONS)
//   - variants the file no longer lists, and products it no longer has, are deactivated
// Orders are never read or written: order lines keep their own snapshots. Variants missing from
// the DB are added by backfill-from-omsonsdata.mjs (run it first) and new products by
// import-catalogue-products.mjs.
//
//   DATABASE_URL='postgres://…' node scripts/seed/sync-pricing-from-omsonsdata.mjs [--dry-run|--commit]
//
// Variants match by (product_code, sku or catalogue number). Variants the file contradicts
// itself on keep their DB price and spec line; unpriced ones keep their DB price. Only rows that
// differ are written, so a re-run reports 0 changes. Needs the 20261017120000_pack_piece_pricing migration.
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
const { mergeCatalogueRecords, stripHtml } = await jiti.import(path.join(ROOT, "src/lib/catalogue.ts"));
const { variantPricing, formatPriceLine, formatRupees } = createRequire(import.meta.url)(path.join(ROOT, "src/lib/cataloguePricing.js"));
const { describe, specLinesOf } = await import("./omsonsdata-describe.mjs");
const { PrismaClient } = await import("../prisma.mjs");
const prisma = new PrismaClient();

const text = (v) => String(v ?? "").trim();
const rupees = (paise) => formatRupees(Number(paise));
const UNIT_NAMES = { pc: "Pcs.", m: "m", set: "Set" };
// The file gives 605 exactly 604's name, dropping "& Vacuum Tubulation".
const KEEP_NAMES = new Set(["605"]);

const { products: fileProducts, conflicts } = mergeCatalogueRecords(JSON.parse(await readFile(path.join(ROOT, "public/data/omsonsdata.json"), "utf8")));
const fileByCode = new Map(fileProducts.map((product) => [text(product.sku), product]));

const report = {
  matched: 0, packBasis: 0, rowsWritten: 0, priceChanges: [], packChanges: [], names: [], keptNames: [], descriptions: [],
  variantsDeactivated: [], productsDeactivated: [], conflicts: [], unpriced: [], lossySpecs: [],
};

const dbProducts = await prisma.product.findMany({
  where: { active: true },
  select: {
    id: true, productCode: true, name: true, description: true,
    variants: {
      select: { id: true, sku: true, catalogueNumber: true, unitName: true, packSize: true, unitPricePaise: true, packPricePaise: true, priceBasis: true, packAssumed: true, active: true },
      orderBy: { id: "asc" },
    },
  },
  orderBy: { id: "asc" },
});

for (const product of dbProducts) {
  const code = text(product.productCode);
  const file = fileByCode.get(code);

  if (!file) {
    report.productsDeactivated.push(`${code} "${product.name}" (${product.variants.length} variants)`);
    if (commit) await prisma.product.update({ where: { id: product.id }, data: { active: false, variants: { updateMany: { where: {}, data: { active: false } } } } });
    continue;
  }

  const fileVariants = new Map(file.variants.map((variant) => [text(variant.sku), variant]));
  const updates = [];
  const deactivate = [];
  const keepLines = new Map();
  const storedLines = specLinesOf(product.description);

  for (const row of product.variants) {
    const label = `${code}: ${text(row.sku) || text(row.catalogueNumber) || row.id}`;
    const key = [text(row.sku), text(row.catalogueNumber)].find((k) => k && fileVariants.has(k));
    if (!key) {
      if (row.active) { deactivate.push(row.id); report.variantsDeactivated.push(label); }
      continue;
    }
    if (conflicts.has(key)) {
      report.conflicts.push(label);
      if (storedLines.has(key)) keepLines.set(key, storedLines.get(key));
      continue;
    }
    const pricing = variantPricing(fileVariants.get(key));
    if (!pricing) { report.unpriced.push(label); continue; }

    report.matched++;
    if (pricing.priceBasis === "pack") report.packBasis++;
    const data = {
      priceBasis: pricing.priceBasis,
      packSize: pricing.packSize,
      unitName: UNIT_NAMES[pricing.packUnit],
      packAssumed: pricing.packAssumed,
      unitPricePaise: BigInt(pricing.piecePricePaise),
      packPricePaise: BigInt(pricing.packPricePaise),
    };
    const priceChanged = row.unitPricePaise !== data.unitPricePaise || row.packPricePaise !== data.packPricePaise;
    const packChanged = (row.packSize ?? 1) !== data.packSize;
    if (priceChanged) report.priceChanges.push(`${key}: ${rupees(row.unitPricePaise)}/pc, pack ${rupees(row.packPricePaise)}  →  ${formatPriceLine(pricing)}`);
    if (packChanged) report.packChanges.push(`${key}: pack of ${row.packSize ?? 1} → ${data.packSize}`);
    if (priceChanged || packChanged || row.priceBasis !== data.priceBasis || row.unitName !== data.unitName || row.packAssumed !== data.packAssumed) {
      updates.push({ id: row.id, data });
    }
  }

  const name = text(file.name);
  const nameDiffers = Boolean(name) && name !== text(product.name);
  const rename = nameDiffers && !KEEP_NAMES.has(code);
  if (rename) report.names.push(`${code}: "${product.name}" → "${name}"`);
  else if (nameDiffers) report.keptNames.push(`${code}: kept "${product.name}" (file: "${name}")`);

  const description = describe(stripHtml(file.descriptionHtml), file.features, file.variants, { keepLines, lossy: report.lossySpecs });
  const describeChanged = description !== text(product.description);
  if (describeChanged) report.descriptions.push(code);

  report.rowsWritten += updates.length + deactivate.length + (rename || describeChanged ? 1 : 0);
  if (commit && (updates.length || deactivate.length || rename || describeChanged)) {
    await prisma.$transaction([
      ...(rename || describeChanged ? [prisma.product.update({ where: { id: product.id }, data: { ...(rename ? { name } : {}), ...(describeChanged ? { description } : {}) } })] : []),
      ...updates.map(({ id, data }) => prisma.productVariant.update({ where: { id }, data })),
      ...(deactivate.length ? [prisma.productVariant.updateMany({ where: { id: { in: deactivate } }, data: { active: false } })] : []),
    ], { timeout: 120_000, maxWait: 15_000 });
  }
}

await prisma.$disconnect();

const list = (title, lines, limit = Infinity) => {
  console.log(`\n${title}: ${lines.length}`);
  lines.slice(0, limit).forEach((line) => console.log(`  ${line}`));
  if (lines.length > limit) console.log(`  … ${lines.length - limit} more`);
};
console.log(`\nactive DB products: ${dbProducts.length}   priced variants matched to the file: ${report.matched} (per-pack basis: ${report.packBasis})`);
console.log(`${commit ? "rows written" : "rows that would be written"}: ${report.rowsWritten + report.productsDeactivated.length}`);
list("PRICE CHANGES (DB → file)", report.priceChanges);
list("PACK-SIZE CHANGES", report.packChanges);
list("NAME CHANGES", report.names);
list("NAMES KEPT", report.keptNames);
list("DESCRIPTIONS REBUILT", report.descriptions, 40);
list("VARIANTS DEACTIVATED (not in the file)", report.variantsDeactivated);
list("PRODUCTS DEACTIVATED (not in the file)", report.productsDeactivated);
list("FILE CONTRADICTS ITSELF (price and spec line kept)", report.conflicts);
list("NO PRICE IN FILE (DB price kept)", report.unpriced, 40);
list("SPEC ENTRIES THAT WON'T ROUND-TRIP", report.lossySpecs);
console.log(`\n${commit ? "Written." : "Dry run: nothing written."}`);
