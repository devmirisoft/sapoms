import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const addStaffPage = readFileSync("src/app/dashboard/admin/staff/addstaff/page.tsx", "utf8");
const editStaffPage = readFileSync("src/app/dashboard/admin/staff/[id]/page.tsx", "utf8");
const staffSchemas = readFileSync("src/server/modules/admin/staff/staff.schemas.ts", "utf8");
const staffRepo = readFileSync("src/server/modules/admin/staff/staff.repository.ts", "utf8");
const staffMapper = readFileSync("src/server/modules/admin/staff/staff.mapper.ts", "utf8");
const dealerRepo = readFileSync("src/server/modules/admin/dealers/dealers.repository.ts", "utf8");
const staffRoute = readFileSync("src/app/api/admin/staff/route.ts", "utf8");
const staffStatusRoute = readFileSync("src/app/api/admin/staff/[staffId]/status/route.ts", "utf8");
const staffListPage = readFileSync("src/app/dashboard/admin/staff/stafflist/page.tsx", "utf8");
const staffDiagnosticRoute = readFileSync("src/app/api/admin/staff/[staffId]/diagnostic-password/route.ts", "utf8");
const diagnosticService = readFileSync("src/server/modules/admin/diagnostic-passwords.service.ts", "utf8");
const authProvider = readFileSync("src/server/auth/providers/postgres-auth.provider.ts", "utf8");

test("admin staff mapper does not expose password fields", () => {
  assert.equal(staffMapper.includes("password"), false);
});

test("Add and Edit Staff show only business staff role choices", () => {
  for (const source of [addStaffPage, editStaffPage]) {
    assert.match(source, /label: 'Staff'/);
    assert.match(source, /label: 'Sales Manager'/);
    assert.match(source, /label: 'ASM'/);
    assert.match(source, /label: 'RSM'/);
    assert.match(source, /label: 'NSM'/);
    assert.match(source, /Select a role/);
    assert.doesNotMatch(source, /label: 'Admin'/);
    assert.doesNotMatch(source, /label: 'Accountant'/);
    assert.doesNotMatch(source, /label: 'Dealer'/);
    assert.doesNotMatch(source, /value: 'ADMIN'/);
    assert.doesNotMatch(source, /value: 'ACCOUNTANT'/);
    assert.doesNotMatch(source, /value: 'DEALER'/);
    assert.doesNotMatch(source, /value: 'STAFF', label:/);
  }
});

test("Add and Edit Staff map Executive and Staff labels to STAFF subtypes", () => {
  for (const source of [addStaffPage, editStaffPage]) {
    assert.match(source, /value: 'EXECUTIVE'[^\n]*authRole: 'STAFF'[^\n]*staffRoleType: '1'/);
    assert.match(source, /value: 'FIELD_EXECUTIVE'[^\n]*authRole: 'STAFF'[^\n]*staffRoleType: '2'/);
    assert.match(source, /role: selectedRole\.authRole/);
    assert.match(source, /staffRoleType: selectedRole\.staffRoleType/);
  }
  assert.match(editStaffPage, /if \(staffType === '2'\) return 'FIELD_EXECUTIVE'/);
  assert.match(editStaffPage, /if \(staffType === '1'\) return 'EXECUTIVE'/);
});

test("RSM and NSM map to their auth roles with RSM region only", () => {
  for (const source of [addStaffPage, editStaffPage]) {
    assert.match(source, /value: 'RSM'[^\n]*authRole: 'RSM'[^\n]*staffRoleType: 'RSM'/);
    assert.match(source, /value: 'NSM'[^\n]*authRole: 'NSM'[^\n]*staffRoleType: undefined/);
    assert.match(source, /role === "RSM"|role === 'RSM'/);
    assert.match(source, /SALES_REGION_OPTIONS/);
    assert.match(source, /salesRegion: selectedRole\.authRole === 'RSM' \? salesRegion : undefined/);
  }
});

test("staff API accepts only staff-management roles and requires concrete STAFF subtype", () => {
  assert.match(staffSchemas, /const createRole = z\.enum\(\["NSM", "RSM", "ASM", "STAFF"\]\)/);
  assert.match(staffSchemas, /const updateRole = z\.enum\(\["STAFF", "RSM", "ASM", "NSM"\]\)/);
  assert.doesNotMatch(staffSchemas, /"ADMIN", "NSM", "ACCOUNTANT", "RSM", "STAFF"/);
  assert.match(staffSchemas, /value\.role === "STAFF" && value\.staffRoleType !== "1" && value\.staffRoleType !== "2"/);
  assert.match(staffSchemas, /STAFF_ROLE_TYPE_REQUIRED/);
});

test("RSM region is required and cleared for non-RSM staff choices", () => {
  assert.match(staffSchemas, /value\.role === "RSM" && !value\.salesRegion/);
  assert.match(staffSchemas, /RSM_REGION_REQUIRED/);
  assert.match(staffSchemas, /value\.role && value\.role !== "RSM"\) value\.salesRegion = undefined/);
  assert.match(staffRepo, /input\.role === "ASM" \? "ASM"/);
  assert.match(staffRepo, /resolveRsm/);
  assert.match(staffRepo, /resolveAsm/);
  assert.match(staffRepo, /assertSubset/);
  assert.match(staffRepo, /salesRegion: input\.role === "RSM" \? input\.salesRegion : null/);
  assert.match(staffRepo, /staffData\.staffRoleType = null/);
});

test("dealer staff assignment accepts staff-like profiles and keeps RSM region selection separate", () => {
  assert.match(dealerRepo, /role: \{ in: \["STAFF", "RSM", "ASM"\] \}, status: "ACTIVE", deletedAt: null/);
  assert.match(dealerRepo, /async function resolveRsm/);
  assert.match(dealerRepo, /role: "RSM"/);
  assert.match(dealerRepo, /staffProfile: \{ select: \{ salesRegion: true \} \}/);
});

test("staff directory route allows staff-like reads for dealer assignment without opening write access", () => {
  assert.match(staffRoute, /const actor = await requireAuth\(\)/);
  assert.match(staffRoute, /isAdminLike\(actor\) \|\| isStaffLike\(actor\)/);
  assert.match(staffRoute, /eventType: "STAFF_DIRECTORY_VIEWED"/);
  assert.match(staffRoute, /const actor = await requireAdmin\(\)/);
});

test("ASM territory is states only, a subset of the parent RSM states, with no cities of its own", () => {
  assert.match(staffRepo, /assertSubset\(assignedStates, rsm\.assignedStates, "ASM_STATES_OUTSIDE_RSM_SCOPE"\)/);
  assert.match(staffSchemas, /ASM_STATES_REQUIRED/);
  assert.doesNotMatch(staffSchemas, /ASM_CITIES_REQUIRED/);
  assert.match(staffRepo, /parentRsmId = rsm\.id;\r?\n\s*assignedCities = \[\];/);
  assert.match(staffRepo, /staffData\.assignedStates = assignedStates;\r?\n\s*staffData\.assignedCities = \[\];/);
});

test("Sales Manager holds its own cities, carved out of its ASM's states and never wider", () => {
  // Create and update both re-check against the ASM: it may have changed, or shrunk.
  assert.equal(staffRepo.match(/assertSubset\(assignedCities, citiesForStates\(asm\.assignedStates\), "EXECUTIVE_CITIES_OUTSIDE_ASM_SCOPE", "cities"\)/g)?.length, 2);
  assert.match(staffRepo, /select: \{ id: true, parentRsmId: true, assignedStates: true \}/);
  assert.match(staffSchemas, /EXECUTIVE_CITIES_REQUIRED/);
});

test("Sales Manager states are derived from its cities, not picked in the form", () => {
  assert.match(staffRepo, /assignedStates = statesForCities\(assignedCities, asm\.assignedStates\)/);
  assert.match(staffRepo, /staffData\.assignedStates = statesForCities\(assignedCities, asm\.assignedStates\)/);
  assert.match(staffSchemas, /value\.staffRoleType === "1"\) \{ value\.parentRsmId = undefined; value\.assignedStates = undefined; \}/);
});

test("staff subtype 2 keeps no territory of its own", () => {
  assert.match(staffSchemas, /value\.staffRoleType === "2"\) \{ value\.parentAsmId = undefined; value\.assignedStates = undefined; value\.assignedCities = undefined; \}/);
});

test("staff creation caps NSM at one and RSM at the number of sales regions", () => {
  assert.match(staffRepo, /import \{ SALES_REGION_OPTIONS \} from "@\/lib\/salesRegions";/);
  assert.match(staffRepo, /existingNsm >= 1.*NSM_LIMIT_REACHED/s);
  assert.match(staffRepo, /existingRsm >= SALES_REGION_OPTIONS\.length.*RSM_LIMIT_REACHED/s);
});

test("staff update accepts hierarchy and territory changes", () => {
  // The update schema used to drop these silently, so edits never persisted.
  const updateBlock = staffSchemas.slice(staffSchemas.indexOf("const updateSchema"));
  for (const field of ["parentRsmId", "parentAsmId", "assignedStates", "assignedCities", "reportingManagerId"]) {
    assert.match(updateBlock, new RegExp(`${field}[,:]`));
  }
});

test("Add and Edit Staff both offer ASM and Sales Manager city pickers from one places source", () => {
  for (const source of [addStaffPage, editStaffPage]) {
    assert.match(source, /from '@\/lib\/places'/);
    assert.doesNotMatch(source, /^import places from/m);
    assert.match(source, /smCitiesByState/);
    assert.match(source, /assignedCities: role === 'EXECUTIVE' \? assignedCities : undefined/);
    assert.match(source, /Limited to the cities assigned to the selected ASM\./);
  }
});

test("deactivating staff revokes sessions and bumps the token version", () => {
  // Both the status endpoint and a status-carrying edit must go through the
  // same helper, or one path leaves an inactive staff member still signed in.
  assert.match(staffRepo, /async function applyUserStatus[\s\S]*?tokenVersion: \{ increment: 1 \}[\s\S]*?authSession\.updateMany[\s\S]*?revokedAt: new Date\(\)/);
  assert.match(staffRepo, /async updateStatus\([\s\S]*?applyUserStatus\(tx, staff\.userId, input\.status\)/);
  assert.match(staffRepo, /if \(input\.status !== undefined\) await applyUserStatus\(tx, current\.userId, input\.status\)/);
  assert.doesNotMatch(staffRepo, /userData\.status = input\.status/);
});

test("staff status endpoint is admin-only and validates the status value", () => {
  assert.match(staffStatusRoute, /requireAdmin\(\)/);
  assert.match(staffStatusRoute, /parseUpdateStaffStatusInput/);
  assert.match(staffSchemas, /const statusSchema[\s\S]*?z\.enum\(\["ACTIVE", "INACTIVE", "SUSPENDED"\]\)/);
  assert.match(staffSchemas, /export function parseUpdateStaffStatusInput/);
});

test("staff list can toggle a staff member active or inactive", () => {
  assert.match(staffListPage, /\/status`/);
  assert.match(staffListPage, /Deactivate" : "Activate/);
});

test("staff temporary passwords reuse the dealer diagnostic-password flow", () => {
  assert.match(staffDiagnosticRoute, /requireAdmin\(\)/);
  for (const method of ["GET", "POST", "DELETE"]) {
    assert.match(staffDiagnosticRoute, new RegExp(`export async function ${method}`));
  }
  assert.match(staffDiagnosticRoute, /\{ staffId: id \}/);
  // One owner column is ever set, so a staff password can never resolve a dealer.
  assert.match(diagnosticService, /hashPassword\(password\)/);
  assert.match(diagnosticService, /ADMIN_STAFF_DIAGNOSTIC_PASSWORD_CREATED/);
  assert.match(diagnosticService, /ADMIN_STAFF_DIAGNOSTIC_PASSWORD_REVOKED/);
  assert.match(editStaffPage, /Diagnostic Password/);
  assert.match(editStaffPage, /diagnosticPassword\.length < 5/);
});

test("staff login falls back to a temporary password only after the real hash fails", () => {
  assert.match(authProvider, /verifyPassword\(input\.password, user\.passwordHash\)/);
  assert.match(authProvider, /if \(!passwordMatches\)/);
  assert.match(authProvider, /staffId: user\.staffProfile\.id/);
  assert.match(authProvider, /revokedAt: null, expiresAt: \{ gt: now \}/);
});

test("staff list shows who each staff member reports to instead of a password", () => {
  assert.doesNotMatch(staffListPage, /password/i);
  assert.match(staffListPage, /Reports To/);
  assert.match(staffListPage, /function reportingManagerOf/);
});
