import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const source = await fs.readFile(path.resolve("src/lib/staffDob.ts"), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { adultDobCutoff, isAdultDob } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("staff must be 18 or older", () => {
  const now = new Date(2026, 8, 29);
  assert.equal(adultDobCutoff(now), "2008-09-29");
  assert.equal(isAdultDob("2008-09-29", now), true);
  assert.equal(isAdultDob("2008-09-30", now), false);
  // leap day: born 1 Mar 2010 is not yet 18 on 29 Feb 2028
  assert.equal(isAdultDob("2010-03-01", new Date(2028, 1, 29)), false);
  assert.equal(isAdultDob("2010-02-28", new Date(2028, 1, 29)), true);
});
