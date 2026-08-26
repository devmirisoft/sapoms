import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const salesScope = readFileSync("src/server/auth/sales-scope.ts", "utf8");
const adminRoute = readFileSync("src/server/admin/admin-route.ts", "utf8");
const staffSchemas = readFileSync("src/server/modules/admin/staff/staff.schemas.ts", "utf8");
const staffRepo = readFileSync("src/server/modules/admin/staff/staff.repository.ts", "utf8");
const dealerRepo = readFileSync("src/server/modules/admin/dealers/dealers.repository.ts", "utf8");
const dealerSchemas = readFileSync("src/server/modules/admin/dealers/dealers.schemas.ts", "utf8");
const dealerMapper = readFileSync("src/server/modules/admin/dealers/dealers.mapper.ts", "utf8");
const staffUi = readFileSync("src/app/dashboard/admin/staff/addstaff/page.tsx", "utf8");

const block = (name) => schema.match(new RegExp(`(?:enum|model) ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] || "";

test("schema adds NSM/RSM roles and SalesRegion without regional roles", () => {
  assert.match(block("UserRole"), /\bNSM\b/);
  assert.match(block("UserRole"), /\bRSM\b/);
  assert.match(block("AuthRole"), /\bNSM\b/);
  assert.match(block("AuthRole"), /\bRSM\b/);
  assert.match(block("SalesRegion"), /\bNORTH_1\b[\s\S]*\bNORTH_2\b[\s\S]*\bSOUTH_1\b[\s\S]*\bWEST_2\b[\s\S]*\bROM\b[\s\S]*\bCENTRAL\b/);
  assert.doesNotMatch(schema, /RSM_NORTH|RSM_SOUTH|RSM_EAST|RSM_WEST/);
});

test("RSM region and dealer regional manager are modeled separately from staff assignments", () => {
  assert.match(block("StaffProfile"), /salesRegion\s+SalesRegion\?\s+@map\("sales_region"\)/);
  assert.match(block("DealerProfile"), /region\s+SalesRegion\?/);
  assert.match(block("DealerProfile"), /rsmUserId\s+BigInt\?\s+@map\("rsm_user_id"\)/);
  assert.match(block("DealerProfile"), /regionalManager\s+User\?/);
  assert.match(block("DealerProfile"), /staffAssignments\s+DealerStaffAssignment\[\]/);
});

test("NSM is centralized as admin-like without broad role duplication in requireAdmin", () => {
  assert.match(salesScope, /function isAdminLike[\s\S]*actor\.role === "ADMIN" \|\| actor\.role === "NSM"/);
  assert.match(adminRoute, /isAdminLike\(actor\)/);
  assert.doesNotMatch(adminRoute, /\["ADMIN",\s*"NSM"\]/);
});

test("staff creation keeps staff-management choices separate from admin and accountant flows", () => {
  assert.match(staffSchemas, /z\.enum\(\["NSM", "RSM", "ASM", "STAFF"\]\)/);
  assert.doesNotMatch(staffSchemas, /z\.enum\(\["ADMIN", "NSM", "ACCOUNTANT", "RSM", "STAFF"\]\)/);
  assert.match(staffSchemas, /value\.role === "RSM" && !value\.salesRegion/);
  assert.match(staffSchemas, /value\.role && value\.role !== "RSM"\) value\.salesRegion = undefined/);
  assert.match(staffSchemas, /value\.role === "STAFF" && value\.staffRoleType !== "1" && value\.staffRoleType !== "2"/);
  assert.match(staffRepo, /if \(input\.role === "NSM"\)/);
  assert.match(staffRepo, /input\.role === "RSM" \? input\.salesRegion : null/);
  assert.match(staffUi, /value: 'EXECUTIVE', label: 'Sales Manager', authRole: 'STAFF', staffRoleType: '1'/);
  assert.match(staffUi, /value: 'FIELD_EXECUTIVE', label: 'Staff', authRole: 'STAFF', staffRoleType: '2'/);
  assert.match(staffUi, /value: 'RSM', label: 'RSM', authRole: 'RSM'/);
  assert.match(staffUi, /value: 'NSM', label: 'NSM', authRole: 'NSM'/);
  assert.doesNotMatch(staffUi, /value: 'ADMIN'|label: 'Admin'|value: 'ACCOUNTANT'|label: 'Accountant'|value: 'DEALER'|label: 'Dealer'|value: 'STAFF', label: 'Staff'/);
  assert.match(staffUi, /role === 'RSM'/);
});

test("dealer RSM assignment derives region server-side from the selected RSM", () => {
  assert.match(dealerSchemas, /rsmUserId: body\.rsmUserId \?\? body\.rsmId \?\? body\.regionalManagerId/);
  assert.match(dealerRepo, /async function resolveRsm/);
  assert.match(dealerRepo, /role: "RSM"/);
  assert.match(dealerRepo, /staffProfile: \{ select: \{ salesRegion: true \} \}/);
  assert.match(dealerRepo, /region: rsm\?\.region/);
  assert.match(dealerRepo, /regionalManager = rsm\?\.rsmUserId \? \{ connect: \{ id: rsm\.rsmUserId \} \} : \{ disconnect: true \}/);
});

test("dealer response separates regional manager and normal assigned staff", () => {
  assert.match(dealerMapper, /assignedStaff/);
  assert.match(dealerMapper, /regionalManager: rsm/);
  assert.match(dealerMapper, /Dealer_Region: region/);
  assert.match(dealerMapper, /Dealer_RSM: rsm\?\.name/);
});

test("sales scope rejects cross-region RSM requests and supports NSM regional filters", () => {
  assert.match(salesScope, /actor\.role === "RSM"[\s\S]*normalized && normalized !== region[\s\S]*throw Object\.assign/);
  assert.match(salesScope, /isAdminLike\(actor\) \|\| actor\.role === "ACCOUNTANT"/);
  assert.match(salesScope, /buildDealerRegionWhere/);
  assert.match(salesScope, /buildOrderRegionWhere/);
});

test("RSM discount request scope covers their reporting team, not just their region", () => {
  const listRoute = readFileSync("src/app/api/custom-discount-requests/route.ts", "utf8");
  const idRoute = readFileSync("src/app/api/custom-discount-requests/[id]/route.ts", "utf8");
  const drafts = readFileSync("src/lib/postgresDiscountDrafts.ts", "utf8");

  // parentRsmId is denormalized on write, so one flat query returns the subtree.
  assert.match(salesScope, /function resolveRsmTeamStaffIds[\s\S]*parentRsmId: actor\.staffId/);
  assert.match(salesScope, /\[actor\.staffId, \.\.\.team\.map\(\(member\) => member\.id\)\]/);

  // Region OR team, and an unscoped region must never widen an RSM to everything.
  assert.match(salesScope, /function buildRsmDiscountRequestWhere/);
  assert.match(salesScope, /clauses\.push\(\{ dealer: dealerWhere \}\)/);
  assert.match(salesScope, /clauses\.push\(\{ staffId: \{ in: teamStaffIds \} \}\)/);
  assert.match(salesScope, /if \(clauses\.length === 0\) return \{ id: BigInt\(-1\) \}/);

  // Listing and single-request authorization stay in agreement.
  assert.match(listRoute, /buildRsmDiscountRequestWhere\(actor, prisma\)/);
  assert.doesNotMatch(listRoute, /where\.dealer = await buildDealerRegionWhere/);
  assert.match(idRoute, /assertRsmDiscountScope\(actor: AuthActor, dealerId: bigint, requestStaffId: bigint \| null\)/);
  assert.match(idRoute, /teamStaffIds\.some\(\(staffId\) => staffId === requestStaffId\)/);
  assert.match(idRoute, /assertRsmDiscountScope\(actor, row\.dealerId, row\.staffId\)/);
  assert.match(idRoute, /assertRsmDiscountScope\(actor, existing\.dealerId, existing\.staffId\)/);

  // The RSM needs to see which of their team raised each request.
  assert.match(drafts, /staff: \{ select: \{ id: true, displayName: true, staffRoleType: true \} \}/);
  assert.match(drafts, /staffName: row\.staff\?\.displayName/);
});
