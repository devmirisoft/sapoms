#!/usr/bin/env node
// Fills gaps in existing PostgreSQL products from public/data/omsonsdata.json.
// The DB wins wherever it has data; the file only supplies what the DB lacks:
//   - variants the product doesn't have (active or not) are created
//   - variants still at ₹0 take the file's price and pack size
//   - variants without a VARIANT SPECIFICATIONS line get one; a missing ABOUT THIS ITEM block is added
// Deleted (inactive) products, products not in the DB, and variants the file contradicts itself on are skipped.
//
//   DATABASE_URL='postgres://…' node scripts/seed/backfill-from-omsonsdata.mjs [--dry-run|--commit] [--show=<productCode>]
//
// Re-runnable: a second run finds nothing left to fill.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commit = process.argv.includes("--commit");

// Read before prisma.mjs runs dotenv, so .env can never pick the target.
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("Pass DATABASE_URL inline; .env is deliberately not used."); process.exit(1); }
const target = new URL(DATABASE_URL);
console.log(`TARGET host=${target.hostname} db=${target.pathname.slice(1)} mode=${commit ? "commit" : "dry-run"}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { getVariantOrderPricing } = createRequire(import.meta.url)(path.join(ROOT, "src/lib/cataloguePricing.js"));
const { PrismaClient } = await import("../prisma.mjs");
const prisma = new PrismaClient();

const ABOUT = "ABOUT THIS ITEM";
const SPECS = "VARIANT SPECIFICATIONS";
const text = (v) => String(v ?? "").trim();
const toPaise = (rupees) => BigInt(Math.round((Number(rupees) > 0 ? Number(rupees) : 0) * 100));
const packOf = (variant) => Math.max(1, Math.trunc(Number(variant.pack)) || 1);
// "Cap. (ml)", "Capacity (mL)" and "Capacity (ml)" are one column; spelling differences aren't conflicts.
const keyForm = (key) => text(key).toLowerCase().replace(/^cap\.?(?=\s|\(|$)/, "capacity").replace(/[^a-z0-9]+/g, " ").trim();
const specsForm = (specs) => JSON.stringify(Object.entries(specs ?? {}).map(([k, v]) => [keyForm(k), text(v)]).sort());

const report = {
  matched: 0, touched: 0, perProduct: [], added: [], priced: [], specLines: 0, aboutBlocks: 0,
  conflicts: new Set(), skuTaken: [], dbPriceDiffers: 0, notInDb: 0, inactiveSkipped: 0, lossySpecs: [],
};

// ---- File: merge the per-catalogue-page duplicates ("670", "670--p2", …) into one product per SKU.
const records = JSON.parse(await readFile(path.join(ROOT, "public/data/omsonsdata.json"), "utf8"));
const fileProducts = new Map();
const variantSources = new Map(); // variant sku -> Set of distinct (product, price, pack, specs)
for (const record of records) {
  const code = text(record.sku);
  const product = fileProducts.get(code) ?? { ...record, sku: code, variants: [] };
  if (!product.features?.length && record.features?.length) product.features = record.features;
  for (const variant of record.variants ?? []) {
    const sku = text(variant.sku);
    if (!sku) continue;
    const fingerprint = JSON.stringify([code, variant.price ?? null, packOf(variant), specsForm(variant.specs)]);
    const seen = variantSources.get(sku) ?? new Set();
    seen.add(fingerprint);
    variantSources.set(sku, seen);
    if (!product.variants.some((v) => text(v.sku) === sku)) product.variants.push({ ...variant, sku });
  }
  fileProducts.set(code, product);
}
// Same SKU with different data (or under two products) can't be trusted either way.
for (const [sku, seen] of variantSources) if (seen.size > 1) report.conflicts.add(sku);

// ---- Description helpers: same layout the admin form and parsePostgresDescription use.
const isHeader = (line, header) => line.trim().toUpperCase() === header;

/** SKUs that already have a spec line, and the key spellings those lines use. */
function parseSpecSection(description) {
  const skus = new Set();
  const keys = [];
  let mode = "description";
  for (const line of description.split(/\r?\n/)) {
    if (isHeader(line, ABOUT)) { mode = "about"; continue; }
    if (isHeader(line, SPECS)) { mode = "specs"; continue; }
    const match = mode === "specs" && line.trim().match(/^(.+?)\s+-\s+(.+)$/);
    if (!match) continue;
    skus.add(match[1].trim());
    for (const entry of match[2].split(";")) if (text(entry.split(":")[0])) keys.push(text(entry.split(":")[0]));
  }
  return { skus, keys };
}

/** `spelling` maps keyForm -> the spelling this product already uses, so one capacity column stays one. */
function specLine(variant, spelling) {
  const specs = Object.entries(variant.specs ?? {}).map(([k, v]) => [text(k), text(v)]).filter(([k, v]) => k && v);
  for (const [k, v] of specs) if (/[:;\n]/.test(k) || /[;\n]/.test(v)) report.lossySpecs.push(`${variant.sku} ${k}: ${v}`);
  const spell = (k) => spelling.get(keyForm(k)) ?? (spelling.set(keyForm(k), k), k);
  return specs.length ? `${variant.sku} - ${specs.map(([k, v]) => `${spell(k)}: ${v}`).join("; ")}` : "";
}

function fillDescription(description, features, newSpecLines) {
  const lines = description ? description.split(/\r?\n/) : [];
  const find = (header) => lines.findIndex((line) => isHeader(line, header));
  const appendBlock = (block) => lines.push(...(lines.some((l) => l.trim()) ? [""] : []), ...block);

  if (newSpecLines.length) {
    const start = find(SPECS);
    if (start === -1) appendBlock([SPECS, ...newSpecLines]);
    else {
      // End of the specs section: the next ABOUT header after it, else the end of the text.
      const about = lines.findIndex((line, i) => i > start && isHeader(line, ABOUT));
      let at = about === -1 ? lines.length : about;
      while (at > start + 1 && !lines[at - 1].trim()) at--;
      lines.splice(at, 0, ...newSpecLines);
    }
  }
  if (features.length && find(ABOUT) === -1) {
    const block = [ABOUT, ...features.map((f) => `- ${f}`)];
    const specs = find(SPECS);
    if (specs === -1) appendBlock(block);
    else lines.splice(specs, 0, ...block, "");
    report.aboutBlocks++;
  }
  return lines.join("\n");
}

// ---- DB
const dbProducts = await prisma.product.findMany({ include: { variants: true }, orderBy: { id: "asc" } });
const dbCodes = new Set(dbProducts.map((p) => text(p.productCode)));
const takenSkus = new Map(); // variant sku -> product id
for (const p of dbProducts) for (const v of p.variants) if (text(v.sku)) takenSkus.set(text(v.sku), p.id);
report.notInDb = [...fileProducts.keys()].filter((code) => !dbCodes.has(code)).length;

for (const dbProduct of dbProducts) {
  const code = text(dbProduct.productCode);
  const file = fileProducts.get(code);
  if (!file) continue;
  if (!dbProduct.active) { report.inactiveSkipped++; continue; }
  report.matched++;

  const byKey = new Map();
  for (const v of dbProduct.variants) for (const key of [text(v.sku), text(v.catalogueNumber)]) if (key) byKey.set(key, v);

  const creates = [];
  const updates = [];
  const specCandidates = []; // file variants whose DB twin (existing or new) is active
  for (const fv of file.variants) {
    if (report.conflicts.has(fv.sku)) continue;
    const dbv = byKey.get(fv.sku);
    const pack = packOf(fv);
    const { baseListPrice } = getVariantOrderPricing(fv.price, pack, file);

    if (!dbv) {
      if (takenSkus.has(fv.sku)) { report.skuTaken.push(`${code}: ${fv.sku}`); continue; }
      takenSkus.set(fv.sku, dbProduct.id);
      creates.push({ sku: fv.sku, catalogueNumber: fv.sku, unitName: "Pcs.", packSize: pack, unitPricePaise: toPaise(fv.price), packPricePaise: toPaise(baseListPrice), active: fv.inStock !== false });
      report.added.push(fv.sku);
      if (fv.inStock !== false) specCandidates.push(fv);
      continue;
    }
    if (!dbv.active) continue;
    specCandidates.push(fv);
    if (dbv.unitPricePaise === 0n && Number(fv.price) > 0) {
      updates.push({ id: dbv.id, data: { packSize: pack, unitPricePaise: toPaise(fv.price), packPricePaise: toPaise(baseListPrice) } });
      report.priced.push(`${fv.sku} ₹${fv.price}×${pack}`);
    } else if (dbv.unitPricePaise !== 0n && Number(fv.price) > 0 && dbv.unitPricePaise !== toPaise(fv.price)) {
      report.dbPriceDiffers++;
    }
  }

  const description = dbProduct.description ?? "";
  const { skus: haveSpecs, keys: dbKeys } = parseSpecSection(description);
  const spelling = new Map();
  for (const key of dbKeys) if (!spelling.has(keyForm(key))) spelling.set(keyForm(key), key);
  const hasSpecLine = (fv) => [fv.sku, text(byKey.get(fv.sku)?.sku), text(byKey.get(fv.sku)?.catalogueNumber)].some((k) => k && haveSpecs.has(k));
  const newSpecLines = specCandidates.filter((fv) => !hasSpecLine(fv)).map((fv) => specLine(fv, spelling)).filter(Boolean);
  const features = (file.features ?? []).map(text).filter(Boolean);
  const nextDescription = fillDescription(description, features, newSpecLines);
  report.specLines += newSpecLines.length;

  if (process.argv.includes(`--show=${code}`)) console.log(`\n--- ${code} description after backfill ---\n${nextDescription}\n---`);
  const descriptionChanged = nextDescription !== description;
  if (!creates.length && !updates.length && !descriptionChanged) continue;
  report.touched++;
  report.perProduct.push(`${code.padEnd(7)} db=${dbProduct.variants.length} +${creates.length} priced=${updates.length} specs+${newSpecLines.length} "${dbProduct.name.slice(0, 50)}"`);

  if (commit) {
    // createMany is one INSERT; a nested create is one round trip per variant and blows the
    // default 5s transaction timeout on a remote DB for products like 604 (+312 variants).
    await prisma.$transaction([
      ...(descriptionChanged ? [prisma.product.update({ where: { id: dbProduct.id }, data: { description: nextDescription } })] : []),
      ...(creates.length ? [prisma.productVariant.createMany({ data: creates.map((c) => ({ ...c, productId: dbProduct.id })) })] : []),
      ...updates.map(({ id, data }) => prisma.productVariant.update({ where: { id }, data })),
    ], { timeout: 60_000, maxWait: 15_000 });
  }
}

await prisma.$disconnect();

const sample = (list) => `${list.length}${list.length ? ` e.g. ${list.slice(0, 6).join(" | ")}` : ""}`;
console.log(`file products (deduped): ${fileProducts.size}   matched active DB products: ${report.matched}`);
console.log(`${commit ? "updated" : "would update"} products: ${report.touched}`);
report.perProduct.forEach((line) => console.log(`    ${line}`));
console.log(`  variants added: ${sample(report.added)}`);
console.log(`  ₹0 variants priced: ${sample(report.priced)}`);
console.log(`  spec lines added: ${report.specLines}   ABOUT blocks added: ${report.aboutBlocks}`);
console.log(`left alone — DB price differs from file: ${report.dbPriceDiffers}`);
console.log(`skipped — file contradicts itself: ${sample([...report.conflicts])}`);
console.log(`skipped — SKU already used by another DB product: ${sample(report.skuTaken)}`);
console.log(`skipped — product inactive in DB: ${report.inactiveSkipped}   not in DB: ${report.notInDb}`);
console.log(`spec entries that won't round-trip (":" / ";" / newline): ${sample(report.lossySpecs)}`);
