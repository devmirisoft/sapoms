import assert from "node:assert/strict";
import test from "node:test";

import csv from "./csv.js";

const { csvRow } = csv;

test("plain cells are written unquoted", () => {
  assert.equal(csvRow(["ORD-1", "2026-01-04", 1200]), "ORD-1,2026-01-04,1200");
});

test("commas, quotes and newlines are quoted and escaped", () => {
  assert.equal(csvRow(["Sharma, Sons"]), '"Sharma, Sons"');
  assert.equal(csvRow(['He said "hi"']), '"He said ""hi"""');
  assert.equal(csvRow(["line1\nline2"]), '"line1\nline2"');
});

test("empty, null and undefined cells stay empty", () => {
  assert.equal(csvRow(["", null, undefined, 0]), ",,,0");
});
