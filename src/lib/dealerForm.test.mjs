import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const filePath = path.resolve("src/lib/dealerForm.ts");
const transpiled = ts.transpileModule(await fs.readFile(filePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: filePath,
}).outputText;
const form = await import(`data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`);

// Shaped like the live data: only RSMs carry a region.
const staffList = [
  { staff_id: "85", staff_name: "Kamalpreet", role: "RSM", staff_roletype: "RSM", sales_region: "WEST_2" },
  { staff_id: "84", staff_name: "Surjeet", role: "RSM", staff_roletype: "RSM", sales_region: "NORTH_2" },
  { staff_id: "86", staff_name: "Rupesh", role: "ASM", staff_roletype: "ASM", parent_rsm_id: "85" },
  { staff_id: "87", staff_name: "Mayank", role: "STAFF", staff_roletype: "1", parent_rsm_id: "85", parent_asm_id: "86" },
  { staff_id: "89", staff_name: "No-ASM SM", role: "STAFF", staff_roletype: "1", parent_rsm_id: "85" },
  { staff_id: "88", staff_name: "Office Staff", role: "STAFF", staff_roletype: "2", warehouse: "AHMEDABAD" },
];
const roleOptions = form.buildRoleOptions(staffList);
const empty = { ...form.EMPTY_ROLE_ASSIGNMENTS, executive: "88" };

test("region options list the lowest role first", () => {
  const west = form.buildRegionSalesOptions(roleOptions, staffList, "WEST_2");
  assert.deepEqual(west.map((group) => group.key), ["salesManager", "asm", "rsm"]);
  assert.deepEqual(west[0].staff.map((staff) => staff.staff_id), ["87", "89"]);
  const north = form.buildRegionSalesOptions(roleOptions, staffList, "NORTH_2");
  assert.deepEqual(north.map((group) => [group.key, group.staff.map((staff) => staff.staff_id)]), [["rsm", ["84"]]]);
  assert.deepEqual(form.buildRegionSalesOptions(roleOptions, staffList, ""), []);
});

test("picking a sales person fills the real parents above them", () => {
  assert.deepEqual(form.selectSalesPerson(empty, roleOptions, staffList, "WEST_2", "87"), { rsm: "85", asm: "86", salesManager: "87", executive: "88" });
  assert.deepEqual(form.selectSalesPerson(empty, roleOptions, staffList, "WEST_2", "86"), { rsm: "85", asm: "86", salesManager: "", executive: "88" });
  assert.deepEqual(form.selectSalesPerson(empty, roleOptions, staffList, "WEST_2", "89"), { rsm: "85", asm: "", salesManager: "89", executive: "88" });
  assert.deepEqual(form.selectSalesPerson(empty, roleOptions, staffList, "NORTH_2", "84"), { rsm: "84", asm: "", salesManager: "", executive: "88" });
  // Clearing the pick falls back to the region's RSM only.
  assert.deepEqual(form.selectSalesPerson(empty, roleOptions, staffList, "WEST_2", ""), { rsm: "85", asm: "", salesManager: "", executive: "88" });
});

test("choosing a region auto-links its RSM and keeps the staff member", () => {
  const picked = form.selectSalesPerson(empty, roleOptions, staffList, "WEST_2", "87");
  assert.deepEqual(form.selectRegion(picked, roleOptions, staffList, "NORTH_2"), { rsm: "84", asm: "", salesManager: "", executive: "88" });
  assert.deepEqual(form.selectRegion(picked, roleOptions, staffList, "EAST"), { rsm: "", asm: "", salesManager: "", executive: "88" });
});

test("a saved chain restores its region and dropdown value", () => {
  const saved = form.buildRoleAssignmentsFromIds(["88", "87", "86", "85"], staffList);
  assert.equal(form.regionFromAssignments(saved, staffList), "WEST_2");
  assert.equal(form.regionFromAssignments({ ...form.EMPTY_ROLE_ASSIGNMENTS, salesManager: "87" }, staffList), "WEST_2");
  assert.equal(form.lowestSalesPerson(saved), "87");
});
