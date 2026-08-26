import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const service = await readFile(new URL("./discountApprovalOrder.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/custom-discount-requests/[id]/route.ts", import.meta.url), "utf8");
const drafts = await readFile(new URL("./postgresDiscountDrafts.ts", import.meta.url), "utf8");
const draftsPage = await readFile(new URL("../app/drafts/page.tsx", import.meta.url), "utf8");

test("approval places the order under the dealer, not the approving admin", () => {
  assert.match(service, /createByUserId|createdByUserId: dealer\.userId/);
  assert.match(service, /dealerId: dealer\.id/);
  // Order must enter the normal two-stage flow, not skip to accepted.
  assert.match(service, /status: "AWAITING_ACCEPTANCE"/);
  assert.match(service, /acceptanceStatus: "AWAITING"/);
  assert.match(service, /rsmApprovalStatus: "AWAITING"/);
});

test("auto-placement is idempotent and retires the draft", () => {
  assert.match(service, /if \(request\.orderId\) return null/);
  assert.match(service, /status: "CONVERTED", orderId: order\.id/);
  assert.match(service, /ORDER_AUTO_PLACED_ON_DISCOUNT_APPROVAL/);
});

test("only an Admin APPROVED review triggers placement", () => {
  assert.match(route, /if \(reviewUpdate && nextStatus === "APPROVED"\)/);
  assert.match(route, /placeOrderForApprovedDiscount\(tx, row, \{ userId: actor\.userId \}\)/);
  // reviewUpdate is already Admin-gated upstream; keep that guard intact.
  assert.match(route, /if \(reviewUpdate && actor\?\.role !== "ADMIN"\)/);
  // A converted draft must not be reset to an editable approval state.
  assert.match(route, /if \(row\.orderDraftId && !placedOrder\)/);
});

test("rejection drafts carry the reviewer's note from either stage", () => {
  assert.match(route, /rejected_by: rejectedByRsm \? "RSM" : "ADMIN"/);
  assert.match(route, /rejection_notes: rejectionNotes/);
  assert.match(route, /rsmReviewUpdate && nextRsmStatus === "REJECTED"/);
  // The note must survive dealer edits to the draft.
  assert.match(drafts, /rejection_notes: input\.rejection_notes \?\? null/);
  assert.match(drafts, /rejection_notes: snap\.rejection_notes \?\? null/);
});

test("drafts page renders the rejection reason", () => {
  assert.match(draftsPage, /draft\.rejection_notes\?\.reason \? draft\.rejection_notes : null/);
  assert.match(draftsPage, /rejectionNote\.rejected_by === "RSM" \? "Rejected by RSM" : "Rejected by Admin"/);
  assert.match(draftsPage, /rejectionNote\.rsm_note/);
});
