import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const filePath = path.resolve("src/lib/staffHierarchy.ts");
const transpiled = ts.transpileModule(await fs.readFile(filePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: filePath,
}).outputText;
const h = await import(`data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`);

// Shaped like the live data: only RSMs carry a region.
const staff = [
  { id: "85", role: "RSM", staffRoleType: "RSM", salesRegion: "WEST_2", assignedStates: ["Gujarat", "Madhya Pradesh"], status: "ACTIVE" },
  { id: "84", role: "RSM", staffRoleType: "RSM", salesRegion: "NORTH_2", assignedStates: ["Haryana", "Punjab"], status: "ACTIVE" },
  { id: "90", role: "RSM", staffRoleType: "RSM", salesRegion: "EAST", assignedStates: ["Bihar"], status: "INACTIVE" },
  { id: "86", role: "ASM", staffRoleType: "ASM", salesRegion: "", parentRsmId: "85", assignedStates: ["Gujarat"], status: "ACTIVE" },
  { id: "87", role: "STAFF", staffRoleType: "1", salesRegion: "", parentRsmId: "85", assignedStates: ["Gujarat"], status: "ACTIVE" },
  // Floating: EAST's RSM is inactive, so this ASM carries its own region.
  { id: "91", role: "ASM", staffRoleType: "ASM", salesRegion: "EAST", parentRsmId: "", assignedStates: ["Bihar"], status: "ACTIVE" },
];
const ids = (groups) => groups.map((group) => [group.label, group.staff.map((entry) => entry.id)]);

test("reports-to lists the region's ASMs, then its RSM", () => {
  assert.deepEqual(ids(h.reportsToGroups(staff, "WEST_2")), [["ASM", ["86"]], ["RSM", ["85"]]]);
  assert.deepEqual(ids(h.reportsToGroups(staff, "NORTH_2")), [["RSM", ["84"]]]);
  // EAST's RSM is inactive: only the floating ASM is offered.
  assert.deepEqual(ids(h.reportsToGroups(staff, "EAST")), [["ASM", ["91"]]]);
  assert.deepEqual(h.reportsToGroups(staff, "SOUTH_1"), []);
  assert.deepEqual(h.reportsToGroups(staff, ""), []);
});

test("picking an ASM fills its RSM; picking the RSM leaves the ASM empty", () => {
  assert.deepEqual(h.pickReportsTo(staff, "86"), { parentAsmId: "86", parentRsmId: "85" });
  assert.deepEqual(h.pickReportsTo(staff, "84"), { parentAsmId: "", parentRsmId: "84" });
  assert.deepEqual(h.pickReportsTo(staff, ""), { parentAsmId: "", parentRsmId: "" });
});

test("city scope follows whoever the Sales Manager reports to", () => {
  assert.deepEqual(h.cityScopeStates(staff, "86", "85"), ["Gujarat"]);
  assert.deepEqual(h.cityScopeStates(staff, "", "84"), ["Haryana", "Punjab"]);
  // No ASM or RSM to report to: the region's own state list.
  assert.deepEqual(h.cityScopeStates(staff, "", "", ["Kerala"]), ["Kerala"]);
});

test("a saved parent restores its region", () => {
  assert.equal(h.regionOfStaff(staff, "85"), "WEST_2");
  assert.equal(h.regionOfStaff(staff, "86"), "WEST_2");
  assert.equal(h.regionOfStaff(staff, "87"), "WEST_2");
  assert.equal(h.regionOfStaff(staff, "91"), "EAST");
  assert.equal(h.regionOfStaff(staff, "nope"), "");
  assert.equal(h.regionRsm(staff, "NORTH_2")?.id, "84");
});
