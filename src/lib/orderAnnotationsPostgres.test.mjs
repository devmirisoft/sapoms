import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

const files = {
  schema: "prisma/schema.prisma",
  helper: "src/lib/postgresOrderAnnotations.ts",
  orderNotes: "src/app/api/order-notes/route.ts",
  productNotes: "src/app/api/order-product-notes/route.ts",
  summary: "src/app/api/order-summary-overrides/route.ts",
  overlay: "src/app/api/order-overlays/[id]/route.ts",
  status: "src/lib/postgresOrderStatus.ts",
  cancelled: "src/app/api/order-overlays/cancelled/route.ts",
};
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await fs.readFile(path.resolve(file), "utf8")])));

test("schema adds PostgreSQL note override and overlay models with order relations", () => {
  for (const model of ["model OrderNote", "model OrderProductNote", "model OrderSummaryOverride", "model OrderOverlay"]) assert.match(source.schema, new RegExp(model));
  for (const relation of ["notes\\s+OrderNote\\[\\]", "summaryOverrides\\s+OrderSummaryOverride\\[\\]", "overlays\\s+OrderOverlay\\[\\]", "productNotes\\s+OrderProductNote\\[\\]"]) assert.match(source.schema, new RegExp(relation));
});

test("PostgreSQL branch uses JWT auth and Prisma delegates", () => {
  const combined = source.helper + source.orderNotes + source.productNotes + source.summary + source.overlay + source.cancelled;
  assert.match(combined, /requireAuth\(\)/);
  for (const delegate of ["orderNote", "orderProductNote", "orderSummaryOverride", "orderOverlay"]) assert.match(source.helper + source.overlay, new RegExp(delegate));
  for (const field of ["actorUserId", "actorRole"]) assert.match(source.helper + source.status, new RegExp(field));
  assert.match(source.helper, /actor\.role === "DEALER"/);
  assert.match(source.helper, /isStaffLike\(actor\)/);
  assert.match(source.helper, /isAdminLike\(actor\)/);
  assert.match(source.helper, /dealerStaffAssignment\.findFirst/);
});

test("effective order fields update transactionally with history records", () => {
  assert.match(source.helper, /tx\.order\.update\(\{ where: \{ id: order\.id \}, data: \{ note \}/);
  assert.match(source.helper, /tx\.orderItem\.update\(\{ where: \{ id: item\.id \}, data: \{ productNote: note \}/);
  assert.match(source.helper, /tx\.order\.update\(\{ where: \{ id: order\.id \}, data: \{ grossAmountPaise/);
  assert.match(source.helper, /tx\.orderSummaryOverride\.create/);
  assert.match(source.status, /prisma\.\$transaction/);
  assert.match(source.status, /status: "CANCELLED"/);
  assert.match(source.status, /tx\.orderOverlay\.create/);
  assert.match(source.status, /actorRole: actor\.role/);
});

test("PostgreSQL-only routes keep legacy aliases without Mongo or PHP fallback", () => {
  for (const alias of ["order_id", "dealer_id", "Dealer_Name", "order_amount", "order_discount_amount", "order_net_amount", "normalizedSku"]) assert.match(source.helper, new RegExp(alias));
  assert.match(source.orderNotes, /listOrderNotes\(actor, requestedIds\)/);
  assert.match(source.orderNotes, /upsertOrderNote\(actor, body\)/);
  assert.match(source.productNotes, /listProductNotes\(actor/);
  assert.match(source.productNotes, /upsertProductNote\(actor, body\)/);
  assert.match(source.summary, /createSummaryOverride\(actor, body\)/);
  assert.match(source.overlay, /cancelPostgresOrder\(id, authActor, body\.reason\)/);
  assert.match(source.cancelled, /listPostgresCancelledOverlays/);
  assert.doesNotMatch(source.orderNotes + source.productNotes + source.summary + source.overlay + source.cancelled, /mongodb|getDb|php-compat|orderdatalist|orderhispegination|orderpegination|mirisoft|dealerapi/);
});

test("PostgreSQL helper does not import Mongo or PHP compatibility", () => {
  assert.doesNotMatch(source.helper, /mongodb|getDb|php-compat|fetch\(/);
});



test("permission coverage includes dealer ownership, assigned staff, denied staff, and admin", () => {
  assert.match(source.helper, /order\.dealerId === actor\.dealerId/);
  assert.match(source.helper, /order\.assignedStaffId === actor\.staffId/);
  assert.match(source.helper, /dealerStaffAssignment\.findFirst/);
  assert.match(source.helper, /outside your assigned order scope/);
  assert.match(source.helper, /isAdminLike\(actor\)/);
});

