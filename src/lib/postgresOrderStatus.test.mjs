import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./postgresOrderStatus.ts", import.meta.url), "utf8");
const overlayRoute = await readFile(new URL("../app/api/order-overlays/[id]/route.ts", import.meta.url), "utf8");
const dispatchRoute = await readFile(new URL("../app/api/order-dispatch/route.ts", import.meta.url), "utf8");
const postgresOrders = await readFile(new URL("./postgresOrders.ts", import.meta.url), "utf8");
const forbidden = /saveAcceptedState|saveCancellation|loadEffectiveContext|fetchPhpOrderPayload|getDb|MongoClient|php-compat|orderdatalist|orderhispegination|orderpegination|mirisoft|dealerapi/;

test("PostgreSQL order status service validates legal transitions and timestamps", () => {
  assert.match(source, /assertAcceptanceTransition/);
  assert.match(source, /current !== "AWAITING"/);
  assert.match(source, /next !== "ACCEPTED" && next !== "DECLINED"/);
  assert.match(source, /assertFulfilmentTransition/);
  assert.match(source, /nextIndex !== currentIndex \+ 1/);
  assert.match(source, /acceptedAt: next === "ACCEPTED" \? now/);
  assert.match(source, /cancelledAt: new Date\(\)/);
  assert.match(source, /cancellationReason: reasonText/);
  assert.match(source, /dispatchedAt: next === "DISPATCHED"/);
  assert.match(source, /completedAt: next === "COMPLETED"/);
});

test("dealer staff and admin permissions are enforced from JWT/profile identity", () => {
  assert.match(source, /actor\.role === "ADMIN"/);
  assert.match(source, /if \(actor\.role === "ADMIN"\) return/);
  assert.match(source, /actor\.role === "NSM"/);
  assert.match(source, /permission === "read" \|\| permission === "acceptance" \|\| permission === "fulfilment"/);
  assert.match(source, /isStaffLike\(actor\)/);
  assert.match(source, /order\.dealerId !== actor\.dealerId/);
  assert.match(source, /Dealers cannot perform staff-only order transitions/);
  assert.match(source, /dealerStaffAssignment\.findFirst/);
  assert.match(source, /requiresRsmApprovalBeforeAcceptance\(actor\) && order\.rsmApprovalStatus !== "ACCEPTED"/);
  assert.match(source, /Staff, RSM, and ASM cannot cancel Dealer orders/);
  assert.match(source, /NSM cannot cancel Dealer orders/);
  assert.match(overlayRoute, /requireAuth\(\)/);
  assert.match(dispatchRoute, /requireAuth\(\)/);
});

test("legacy accept_order and del_status remain response aliases only for PostgreSQL status", () => {
  assert.match(source, /legacyAcceptOrderAlias/);
  assert.match(source, /legacyDelStatusAlias/);
  assert.match(source, /accept_order: legacyAcceptOrderAlias\(updated\.acceptanceStatus\)/);
  assert.match(source, /del_status: legacyDelStatusAlias\(updated\.status\)/);
  assert.match(postgresOrders, /accept_order: legacyAcceptance\(order\.acceptanceStatus\)/);
  assert.match(postgresOrders, /del_status: legacyDeletion\(order\.status\)/);
});

test("RSM order headers include child staff hierarchy scope", () => {
  assert.match(postgresOrders, /if \(actor\.isRsm && actor\.userId\) return buildRsmOrderWhere\(actor\)/);
  assert.match(postgresOrders, /buildOrderRegionWhere\(\{ userId: BigInt\(actor\.userId!\), role: "RSM" \}/);
  assert.match(postgresOrders, /parentRsmId: rsm\.id/);
  assert.match(postgresOrders, /assignedStaffId: \{ in: childStaffIds \}/);
  assert.match(postgresOrders, /prisma\.dealerStaffAssignment\.findMany/);
  assert.match(postgresOrders, /staffId: \{ in: childStaffIds \}/);
  assert.match(postgresOrders, /dealerId: \{ in: childDealerIds \}/);
});

test("PostgreSQL order mutations bypass PHP and Mongo status writes", () => {
  assert.match(overlayRoute, /updatePostgresOrderAcceptance\(id, authActor, "ACCEPTED", body\.note/);
  assert.match(overlayRoute, /updatePostgresOrderFulfilment\(id, authActor, fulfilmentStatus\)/);
  assert.match(overlayRoute, /cancelPostgresOrder\(id, authActor, body\.reason\)/);
  assert.match(dispatchRoute, /applyPostgresOrderDispatch\(body\.orderId, actor, body\)/);
  assert.doesNotMatch(overlayRoute + dispatchRoute, forbidden);
});

 test("non-PostgreSQL status and dispatch mutations fail explicitly", () => {
  assert.match(overlayRoute, /Historical PHP orders are read-only for PostgreSQL status updates/);
  assert.match(overlayRoute, /Historical PHP orders are read-only for PostgreSQL cancellation/);
  assert.match(dispatchRoute, /Historical PHP orders are read-only for dispatch updates/);
});
test("stage-2 staff decline requires a note and records its reviewer", () => {
  // A decline reaches the Dealer with no other context, so the note is enforced
  // in the lib rather than the route: every caller inherits the rule.
  assert.match(source, /if \(next === "DECLINED" && !reviewNote\)/);
  assert.match(source, /note_required/);
  assert.match(source, /acceptanceNote: reviewNote \|\| null/);
  assert.match(source, /acceptanceReviewedByUserId: actor\.userId/);
  assert.match(source, /acceptanceReviewedAt: now/);
  // Stage 1 keeps its own column so neither reviewer overwrites the other.
  assert.match(source, /rsmNote: reviewNote \|\| null/);
});

test("only Admin and NSM can revive a declined order, resetting both stages", () => {
  assert.match(source, /export async function revivePostgresOrderAcceptance/);
  assert.match(source, /actor\.role !== "ADMIN" && actor\.role !== "NSM"/);
  assert.match(source, /not_declined/);
  // Revive must rewind stage 1 as well, or the order resumes mid-flow.
  assert.match(source, /acceptanceStatus: "AWAITING",\s*\n\s*rsmApprovalStatus: "AWAITING"/);
  assert.match(overlayRoute, /revivePostgresOrderAcceptance\(id, authActor, body\.note\)/);
});

test("staff order lists stay gated behind RSM approval", () => {
  assert.match(postgresOrders, /rsmApprovalStatus: "ACCEPTED", \.\.\.staffScope/);
  assert.match(postgresOrders, /acceptanceNote: order\.acceptanceNote \|\| ""/);
  assert.match(postgresOrders, /rsmNote: order\.rsmNote \|\| ""/);
});
