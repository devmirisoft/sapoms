#!/usr/bin/env node
// Makes product_variants carry the pack/piece pricing of public/data/omsonsdata.json, the
// source of truth: price_basis, pack_size, unit_name, pack_assumed, unit_price_paise (the
// piece price) and pack_price_paise (the authoritative pack price), plus product names.
//
//   DATABASE_URL='postgres://…' node scripts/seed/sync-pricing-from-omsonsdata.mjs [--dry-run|--commit]
//
// --dry-run (default) only reads, and only columns that exist before the
// 20261017120000_pack_piece_pricing migration, so it works against today's DB. --commit
// needs that migration. Variants match by (product_code, variant sku). Reported: every price
// and pack-size change, DB variants with no match in the file (they keep the default "piece"
// basis), variants the file contradicts itself on and unpriced ones (both left unchanged).
// Re-runnable: a second run changes nothing.
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
const { mergeCatalogueRecords } = await jiti.import(path.join(ROOT, "src/lib/catalogue.ts"));
const { variantPricing, formatPriceLine, formatRupees } = createRequire(import.meta.url)(path.join(ROOT, "src/lib/cataloguePricing.js"));
const { PrismaClient } = await import("../prisma.mjs");
const prisma = new PrismaClient();

const text = (v) => String(v ?? "").trim();
const rupees = (paise) => formatRupees(Number(paise));
const UNIT_NAMES = { pc: "Pcs.", m: "m", set: "Set" };

const { products: fileProducts, conflicts } = mergeCatalogueRecords(JSON.parse(await readFile(path.join(ROOT, "public/data/omsonsdata.json"), "utf8")));
const fileByCode = new Map(fileProducts.map((product) => [text(product.sku), product]));

const report = { matched: 0, unchanged: 0, packBasis: 0, priceChanges: [], packChanges: [], noMatch: [], conflicts: [], unpriced: [], names: [] };

const dbProducts = await prisma.product.findMany({
  where: { active: true },
  select: {
    id: true, productCode: true, name: true,
    variants: { select: { id: true, sku: true, catalogueNumber: true, unitName: true, packSize: true, unitPricePaise: true, packPricePaise: true }, orderBy: { id: "asc" } },
  },
  orderBy: { id: "asc" },
});

for (const product of dbProducts) {
  const code = text(product.productCode);
  const file = fileByCode.get(code);
  const fileVariants = new Map((file?.variants ?? []).map((variant) => [text(variant.sku), variant]));
  const updates = [];

  for (const row of product.variants) {
    const label = `${code}: ${text(row.sku) || text(row.catalogueNumber) || row.id}`;
    const key = [text(row.sku), text(row.catalogueNumber)].find((k) => k && fileVariants.has(k));
    if (!key) {
      const unitTimesPack = row.unitPricePaise * BigInt(row.packSize ?? 1);
      const odd = row.packPricePaise && row.packPricePaise !== unitTimesPack ? ` (stored pack ${rupees(row.packPricePaise)} ≠ ${rupees(row.unitPricePaise)} × ${row.packSize ?? 1})` : "";
      report.noMatch.push(`${label}${odd}`);
      continue;
    }
    if (conflicts.has(key)) { report.conflicts.push(label); continue; }
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
    if (!priceChanged && !packChanged) report.unchanged++;
    updates.push({ id: row.id, data });
  }

  const name = text(file?.name);
  const rename = Boolean(name) && name !== text(product.name);
  if (rename) report.names.push(`${code}: "${product.name}" → "${name}"`);

  if (commit && (updates.length || rename)) {
    await prisma.$transaction([
      ...(rename ? [prisma.product.update({ where: { id: product.id }, data: { name } })] : []),
      ...updates.map(({ id, data }) => prisma.productVariant.update({ where: { id }, data })),
    ], { timeout: 120_000, maxWait: 15_000 });
  }
}

await prisma.$disconnect();

const list = (title, lines) => {
  console.log(`\n${title}: ${lines.length}`);
  lines.forEach((line) => console.log(`  ${line}`));
};
console.log(`\nactive DB products: ${dbProducts.length}   variants matched to the file: ${report.matched} (per-pack basis: ${report.packBasis}, no price or pack change: ${report.unchanged})`);
list("PRICE CHANGES (DB → file)", report.priceChanges);
list("PACK-SIZE CHANGES", report.packChanges);
list("NAME CHANGES", report.names);
list("NO MATCH IN FILE (left as is, basis \"piece\")", report.noMatch);
list("FILE CONTRADICTS ITSELF (left as is)", report.conflicts);
list("NO PRICE IN FILE (left as is)", report.unpriced);
console.log(`\n${commit ? "Written." : "Dry run: nothing written."}`);
