import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const source = await fs.readFile(path.resolve("src/server/modules/admin/staff/staff.paging.ts"), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { staffPageWindow } = await import(`data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`);

// Walk the combined list (1 NSM + 25 staff) page by page: every staff row must
// appear exactly once, in order, right after the NSM row on page 1.
test("nsm rows shift the staff window without dropping or repeating a row", () => {
  const take = 10;
  const seen = [];
  for (const skip of [0, 10, 20]) {
    const window = staffPageWindow(1, skip, take);
    const nsmOnPage = Math.max(0, Math.min(take, 1 - skip));
    for (let i = 0; i < window.take && window.skip + i < 25; i += 1) seen.push(window.skip + i);
    assert.equal(nsmOnPage + Math.min(window.take, Math.max(0, 25 - window.skip)) <= take, true);
  }
  assert.deepEqual(seen, Array.from({ length: 25 }, (_, i) => i));
});

test("no nsm leaves the window untouched", () => {
  assert.deepEqual(staffPageWindow(0, 20, 10), { skip: 20, take: 10 });
});
