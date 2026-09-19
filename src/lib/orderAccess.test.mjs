import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

const files = {
  source: "src/lib/orderAccess.ts",
  postgresOrders: "src/lib/postgresOrders.ts",
  route: "src/app/api/order-access/[id]/route.ts",
  detailPage: "src/app/orders/[id]/page.tsx",
  helper: "src/lib/legacyOrderDetail.ts",
};
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await fs.readFile(path.resolve(file), "utf8")])));
const forbidden = /orderdatalist|orderhispegination|orderpegination|staffOrderrPagination|staffDealers|getdealer|php-compat|mirisoft|dealerapi|BACKEND_URL/;

test("order access resolves only PostgreSQL lookup identities", () => {
  assert.match(source.source, /findPostgresOrderByLookupId\(id\)/);
  assert.match(source.source, /mapPostgresOrderToLegacy\(order\)/);
  assert.match(source.source, /OrderAccessOptions/);
  assert.doesNotMatch(source.source, forbidden);
});

test("order access enforces admin dealer staff and accountant scopes", () => {
  assert.match(source.source, /role === "admin" \|\| options\.actor\.role === "accountant"/);
  assert.match(source.source, /options\.actor\.role === "dealer"/);
  assert.match(source.source, /options\.actor\.role === "staff"/);
  assert.match(source.source, /assignedDealerIds/);
  assert.match(source.source, /This order is outside your assigned order scope/);
});

test("order access route derives identity from requireAuth and staff assignments", () => {
  assert.match(source.route, /requireAuth\(\)/);
  assert.match(source.route, /orderActorFromAuth\(authActor\)/);
  assert.match(source.route, /fetchStaffAssignedDealerIds\(actor\.actorId\)/);
  assert.match(source.route, /resolveOrderAccess\(id,/);
});

test("order detail page uses native order access and native compatibility helper", () => {
  assert.match(source.detailPage, /\/api\/order-access\//);
  assert.match(source.detailPage, /fetchLegacyOrderDetail\(id\)/);
  assert.doesNotMatch(source.detailPage, forbidden);
  assert.match(source.helper, /\/api\/order-access\/\$\{encodeURIComponent\(orderId\)\}/);
  assert.match(source.helper, /\/api\/staff\/dealers\/\$\{id\}/);
  assert.doesNotMatch(source.helper, forbidden);
});
test("a direct order URL uses exactly the order list's staff scope", () => {
  // Anything looser would let Staff open an order before RSM approval, or an
  // RSM/ASM reach orders outside its Sales Managers, just by URL.
  assert.match(source.source, /isOrderInActorScope\(options\.actor, lookupId, options\.assignedDealerIds\)/);
});

test("single-order scope reuses the same predicate as the list query", () => {
  assert.match(source.postgresOrders, /export async function isOrderInRsmScope/);
  assert.match(source.postgresOrders, /if \(!actor\.isRsm \|\| !actor\.userId\) return false/);
  assert.match(source.postgresOrders, /export async function isOrderInActorScope/);
  // Reusing actorWhere is what keeps detail and list scope in sync.
  assert.match(source.postgresOrders, /const scopeWhere = await actorWhere\(actor, assignedDealerIds\)/);
});
