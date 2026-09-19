import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

const routePath = path.resolve("src/app/api/dashboard-search/route.ts");
const hookPath = path.resolve("src/hooks/useSmartSearch.tsx");

test("dashboard search uses authenticated PostgreSQL access only", async () => {
  const [route, hook] = await Promise.all([
    fs.readFile(routePath, "utf8"),
    fs.readFile(hookPath, "utf8"),
  ]);
  const combined = `${route}\n${hook}`;

  assert.match(route, /requireAuth\(\)/);
  assert.match(route, /prisma\.dealerProfile\.findMany/);
  assert.match(route, /prisma\.staffProfile\.findMany/);
  assert.match(route, /prisma\.product\.findMany/);
  assert.match(route, /prisma\.order\.findMany/);
  assert.match(route, /user:\s*\{/);
  assert.doesNotMatch(combined, /mirisoft|php-compat|dealerpegination|staffpegination|orderpegination|productname/);
  assert.doesNotMatch(combined, /x-omsons-actor|actorFromRequestHeaders/i);
});

test("dashboard search keeps role scopes and legacy response aliases", async () => {
  const route = await fs.readFile(routePath, "utf8");

  assert.match(route, /actor\.role === "ADMIN" \|\| actor\.role === "ACCOUNTANT"/);
  assert.match(route, /actor\.role === "DEALER"[\s\S]*dealerId: actor\.dealerId/);
  // Staff order hits use the order list's own scope (chain, RSM gate, warehouse).
  assert.match(route, /isStaffLike\(actor\)[\s\S]*actorWhere\(orderActor, assignedDealerIds\.map\(String\)\)/);
  assert.match(route, /actor\.role === "ADMIN" \|\| isStaffLike\(actor\)/);
  assert.match(route, /staffAssignments: \{ some: \{ staffId: actor\.staffId/);
  assert.match(route, /actor\.role === "ACCOUNTANT"[\s\S]*Promise\.resolve\(\[\]\)/);

  for (const alias of ["Dealer_Id", "Dealer_Name", "Dealer_Dealercode", "staff_id", "staff_name", "staff_email"]) {
    assert.match(route, new RegExp(alias));
  }
  assert.match(route, /mapPostgresOrderToLegacy/);
  assert.match(route, /buildDashboardSearchResponse/);
});

test("dashboard search supports expected identifiers and inactive filtering", async () => {
  const route = await fs.readFile(routePath, "utf8");

  for (const field of ["businessName", "dealerCode", "displayName", "name", "catalogueNumber", "sku", "orderNumber"]) {
    assert.match(route, new RegExp(field));
  }
  assert.match(route, /mode: "insensitive"/);
  assert.match(route, /active: true/);
  assert.match(route, /deletedAt: null/);
  assert.match(route, /status: "ACTIVE"/);
});


