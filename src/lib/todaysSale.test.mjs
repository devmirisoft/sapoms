import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const source = (await fs.readFile(path.resolve("src/lib/todaysSale.ts"), "utf8"))
  .replace("@/lib/orderDate.js", pathToFileURL(path.resolve("src/lib/orderDate.js")).href);
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sale = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`);

const item = (over = {}) => ({ SKU: "PYC-25", name: "Pycnometer", discountPercent: 10, ...over });

test("valid sale parses and dedupes SKUs case-insensitively", () => {
  const parsed = sale.parseTodaysSale({ saleDate: "2026-10-07", items: [item(), item({ SKU: "pyc-25" }), item({ SKU: "B-1" })] });
  assert.deepEqual(parsed.items.map((i) => i.SKU), ["PYC-25", "B-1"]);
  assert.equal(parsed.items[0].active, true);
});

test("bad dates and out-of-range percents are rejected", () => {
  for (const saleDate of ["", "2026-02-30", "07-10-2026", undefined]) {
    assert.equal(sale.parseTodaysSale({ saleDate, items: [] }), null);
  }
  for (const discountPercent of [0, 95, 12.5, "abc"]) {
    assert.equal(sale.parseTodaysSale({ saleDate: "2026-10-07", items: [item({ discountPercent })] }), null);
  }
});

test("items missing SKU or name are dropped", () => {
  const parsed = sale.parseTodaysSale({ saleDate: "2026-10-07", items: [item({ SKU: " " }), item({ name: "" })] });
  assert.deepEqual(parsed.items, []);
});

test("sale is live only on its date and with items", () => {
  const today = sale.todayIST();
  assert.equal(sale.isSaleLive({ saleDate: today, items: [item()] }), true);
  assert.equal(sale.isSaleLive({ saleDate: "2000-01-01", items: [item()] }), false);
  assert.equal(sale.isSaleLive({ saleDate: today, items: [] }), false);
});
