import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";

const route = await fs.readFile("src/app/api/order-notes/route.ts", "utf8");
const helper = await fs.readFile("src/lib/postgresOrderAnnotations.ts", "utf8");
const orderAccess = await fs.readFile("src/lib/orderAccess.ts", "utf8");

function bodyOf(source, name) {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} not found`);
  const next = source.indexOf("\nexport async function", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

const postRoute = bodyOf(route, "POST");
const getRoute = bodyOf(route, "GET");
const upsertOrderNote = bodyOf(helper, "upsertOrderNote");
const assertOrderAccess = bodyOf(helper, "assertOrderAccess");
const forbidden = /mongodb|getDb|php-compat|orderdatalist|orderhispegination|orderpegination|collection\("order_notes"\)|fetch\(/;

test("unauthenticated order-note requests fail instead of using nullable auth", () => {
  assert.doesNotMatch(route, /requireAuth\(\)\.catch\(\(\) => null\)/);
  assert.match(getRoute, /const actor = await requireAuth\(\)/);
  assert.match(postRoute, /const actor = await requireAuth\(\)/);
  assert.match(route, /status === 401 \? "Unauthenticated"/);
});

test("order-note route ignores spoofed actor headers and query actor identity", () => {
  assert.doesNotMatch(route, /x-omsons-|actorFromRequestHeaders|actor_id|actorId\s*=\s*req\.nextUrl|role\s*=\s*req\.nextUrl/i);
  assert.match(route, /requireAuth\(\)/);
});

test("PostgreSQL note permissions cover admin dealer staff accountant boundaries", () => {
  assert.match(assertOrderAccess, /isAdminLike\(actor\)/);
  assert.match(assertOrderAccess, /actor\.role === "DEALER"[\s\S]*order\.dealerId === actor\.dealerId/);
  assert.match(assertOrderAccess, /actor\.role === "STAFF" && actor\.staffId/);
  assert.match(assertOrderAccess, /order\.assignedStaffId === actor\.staffId/);
  assert.match(assertOrderAccess, /dealerStaffAssignment\.findFirst/);
  assert.match(assertOrderAccess, /actor\.role === "ACCOUNTANT"[\s\S]*PostgresOrderAnnotationError\(403/);
  assert.match(assertOrderAccess, /outside your assigned order scope/);
});

test("PostgreSQL order-note mutation stores note and actor in one Prisma transaction", () => {
  assert.match(upsertOrderNote, /const order = await requirePostgresOrderAccess\(body\.orderId \|\| body\.order_id, actor\)/);
  assert.match(upsertOrderNote, /prisma\.\$transaction\(async \(tx\) => \{/);
  assert.match(upsertOrderNote, /tx\.order\.update\(\{ where: \{ id: order\.id \}, data: \{ note \}/);
  assert.match(upsertOrderNote, /tx\.orderNote\.create\(\{ data: \{ orderId: order\.id, note, actorUserId: actor\.userId, actorRole: actor\.role \}/);
  assert.match(helper, /actorUserId: note\.actorUserId/);
  assert.match(helper, /actorRole: note\.actorRole/);
});

test("PostgreSQL order-note path is isolated from Mongo and PHP writes", () => {
  assert.match(postRoute, /const saved = await upsertOrderNote\(actor, body\)/);
  assert.match(postRoute, /Order notes are available only for PostgreSQL orders/);
  assert.doesNotMatch(helper + route, forbidden);
});

test("order access helper is PostgreSQL-only", () => {
  assert.match(getRoute, /const rows = await listOrderNotes\(actor, requestedIds\)/);
  assert.match(orderAccess, /findPostgresOrderByLookupId\(id\)/);
  assert.doesNotMatch(orderAccess, forbidden);
});