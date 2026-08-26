import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidebar = readFileSync("src/components/layout/sidebar.tsx", "utf8");
const page = readFileSync("src/app/dashboard/admin/manage-regions/page.tsx", "utf8");
const regions = readFileSync("src/lib/salesRegions.ts", "utf8");
const regionAssignments = readFileSync("src/lib/regionAssignments.ts", "utf8");
const staffAdd = readFileSync("src/app/dashboard/admin/staff/addstaff/page.tsx", "utf8");
const staffEdit = readFileSync("src/app/dashboard/admin/staff/[id]/page.tsx", "utf8");
const staffSchemas = readFileSync("src/server/modules/admin/staff/staff.schemas.ts", "utf8");

test("admin sidebar exposes Manage Regions", () => {
  assert.match(sidebar, /label: "Manage Regions"/);
  assert.match(sidebar, /href: "\/dashboard\/admin\/manage-regions"/);
});

test("manage regions lists fixed RSM regions and loads places json", () => {
  for (const label of ["North 1", "North 2", "South 1", "South 2", "West 1", "West 2", "East", "ROM", "Central"]) {
    assert.match(regions, new RegExp(`label: "${label}"`));
  }
  assert.match(page, /places from "@\/\.\.\/public\/data\/places\.json"/);
  assert.match(page, /union_territories/);
  assert.match(regionAssignments, /REGION_ASSIGNMENTS_STORAGE_KEY = "sapoms-region-state-assignments"/);
  assert.match(page, /saveRegionAssignments\(assignments\)/);
});

test("RSM creation uses the shared nine-region list", () => {
  assert.match(staffAdd, /SALES_REGION_OPTIONS/);
  assert.match(staffEdit, /SALES_REGION_OPTIONS/);
  assert.match(staffSchemas, /"NORTH_1", "NORTH_2", "SOUTH_1", "SOUTH_2", "WEST_1", "WEST_2", "EAST", "ROM", "CENTRAL"/);
});

test("RSM creation updates Manage Regions state assignments after save", () => {
  assert.match(staffAdd, /mergeRegionAssignment/);
  assert.match(staffAdd, /selectedRole\.authRole === 'RSM'/);
  assert.match(regionAssignments, /function mergeRegionAssignment/);
  assert.match(regionAssignments, /loadRegionAssignments\(\)/);
  assert.match(regionAssignments, /saveRegionAssignments\(assignments\)/);
});
