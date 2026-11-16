import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const source = await fs.readFile(path.resolve("src/lib/orderDisplay.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { formatDisplayOrderNumber, orderNumberSearch, highlightOrderNumber } = await import(
  `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
);

const MARK = (text) => `<mark class="bg-brand-600 text-white rounded-sm px-0.5">${text}</mark>`;
const sequence = (html) => html.slice(html.lastIndexOf("DMS-") + 4);

test("formatDisplayOrderNumber strips leading zeros and pads to 3 digits", () => {
  assert.equal(sequence(formatDisplayOrderNumber("1")), "001");
  assert.equal(sequence(formatDisplayOrderNumber("02269")), "2269");
  assert.equal(formatDisplayOrderNumber("OM/26-27/DMS-051"), "OM/26-27/DMS-051");
  assert.equal(formatDisplayOrderNumber(""), "");
});

test("orderNumberSearch: zeros-only input does not filter", () => {
  for (const typed of ["", "  ", "0", "00", "000"]) assert.equal(orderNumberSearch(typed), null, JSON.stringify(typed));
});

test("orderNumberSearch: bare numbers are prefixes, padded numbers are exact", () => {
  assert.deepEqual(orderNumberSearch("2269"), { value: "2269", pattern: "2269%" });
  assert.deepEqual(orderNumberSearch("02269"), { value: "2269", pattern: "2269" });
  assert.deepEqual(orderNumberSearch("002"), { value: "2", pattern: "2" });
  assert.deepEqual(orderNumberSearch(" 007 "), { value: "7", pattern: "7" });
  // shorter than the 3-digit display width, so still mid-typing
  assert.deepEqual(orderNumberSearch("02"), { value: "2", pattern: "2%" });
  assert.deepEqual(orderNumberSearch("01"), { value: "1", pattern: "1%" });
});

test("orderNumberSearch escapes LIKE wildcards", () => {
  assert.equal(orderNumberSearch("%").pattern, "\\%%");
  assert.equal(orderNumberSearch("_").pattern, "\\_%");
  assert.equal(orderNumberSearch("\\").pattern, "\\\\%");
});

test("highlightOrderNumber marks the sequence, never mangles the number", () => {
  const exact = highlightOrderNumber("2270", "2270");
  assert.equal(sequence(exact), MARK("2270"));
  assert.doesNotMatch(exact.replace(/<[^>]+>/g, ""), /mark>/, "the old bug rendered DMS-mark>");

  assert.equal(sequence(highlightOrderNumber("02269", "2269")), MARK("2269"));
  assert.equal(sequence(highlightOrderNumber("02269", "02269")), MARK("2269"));
  assert.equal(sequence(highlightOrderNumber("2", "002")), `00${MARK("2")}`);
});

test("highlightOrderNumber leaves the year alone", () => {
  const html = highlightOrderNumber("OM/26-27/DMS-230", "2");
  assert.equal(html, `OM/26-27/DMS-${MARK("2")}30`);
});

test("highlightOrderNumber without a match is the plain display number", () => {
  assert.equal(highlightOrderNumber("230", ""), formatDisplayOrderNumber("230"));
  assert.equal(highlightOrderNumber("230", "9"), formatDisplayOrderNumber("230"));
  assert.equal(highlightOrderNumber("230", "00"), formatDisplayOrderNumber("230"));
});
