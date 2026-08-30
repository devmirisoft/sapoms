import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

const flowFiles = [
  "src/app/api/custom-discount-requests/route.ts",
  "src/app/api/custom-discount-requests/[id]/route.ts",
  "src/app/api/custom-discount-requests/[id]/reorder-log/route.ts",
  "src/app/api/drafts/route.ts",
  "src/app/api/drafts/[id]/route.ts",
  "src/app/api/draft-cart/route.ts",
  "src/app/api/dealer-order/route.ts",
  "src/lib/dealerOrderCreate.ts",
  "src/lib/postgresDiscountDrafts.ts",
  "src/lib/customDiscountRequests.ts",
  "src/lib/drafts.ts",
  "src/lib/useDrafts.ts",
];

async function read(file) {
  return fs.readFile(path.resolve(file), "utf8");
}

test("custom discount and draft flow has no Mongo imports or calls", async () => {
  for (const file of flowFiles) {
    const source = await read(file);
    assert.equal(source.includes("@/lib/mongodb"), false, file);
    assert.equal(source.includes("getDb"), false, file);
    assert.equal(source.includes("ObjectId"), false, file);
    assert.equal(/mongodb/i.test(source), false, file);
  }
});

test("custom discount routes enforce dealer scope, admin review, order linking, and reorder persistence", async () => {
  const [listRoute, detailRoute, reorderRoute, helperRoute, orderRoute] = await Promise.all([
    read("src/app/api/custom-discount-requests/route.ts"),
    read("src/app/api/custom-discount-requests/[id]/route.ts"),
    read("src/app/api/custom-discount-requests/[id]/reorder-log/route.ts"),
    read("src/lib/postgresDiscountDrafts.ts"),
    // Discount linking and draft conversion moved into the shared order
    // creation service when the fund-request flow began reusing it.
    read("src/lib/dealerOrderCreate.ts"),
  ]);

  assert.doesNotMatch(listRoute + detailRoute + reorderRoute + helperRoute, /actorFromRequestHeaders|x-omsons-actor|header-fallback/);
  assert.match(listRoute, /requireAuth/);
  assert.match(detailRoute, /requireAuth/);
  assert.match(reorderRoute, /requireAuth/);
  assert.match(listRoute, /assertDealerScope/);
  assert.match(listRoute, /assertDraftBelongsToDealer\(data\.orderDraftId, dealerId\)/);
  assert.match(detailRoute, /Only Admin can review custom discounts/);
  assert.match(detailRoute, /reviewedByUserId/);
  assert.match(detailRoute, /reviewedAt/);
  assert.match(detailRoute, /buildCustomDiscountCreate/);
  assert.match(detailRoute, /assertOrderBelongsToDealer\(linkedOrderId, existing\.dealerId\)/);
  assert.match(reorderRoute, /customDiscountReorderLog\.create/);
  assert.match(reorderRoute, /assertOrderBelongsToDealer\(BigInt\(orderId\), dealerId\)/);
  assert.match(helperRoute, /At least one product discount must be greater than current discount/);
  assert.match(orderRoute, /customDiscountRequest\.updateMany/);
  assert.match(orderRoute, /status: "CONVERTED", orderId: order\.id/);
});

test("draft routes use OrderDraft and DraftCart with compatibility aliases", async () => {
  const [draftsRoute, draftDetailRoute, cartRoute, helperRoute] = await Promise.all([
    read("src/app/api/drafts/route.ts"),
    read("src/app/api/drafts/[id]/route.ts"),
    read("src/app/api/draft-cart/route.ts"),
    read("src/lib/postgresDiscountDrafts.ts"),
  ]);

  assert.match(draftsRoute, /prisma\.orderDraft/);
  assert.match(draftDetailRoute, /status: "CANCELLED"/);
  assert.match(cartRoute, /prisma\.draftCart\.upsert/);
  assert.match(cartRoute, /prisma\.draftCart\.deleteMany/);
  assert.match(helperRoute, /dealer_id/);
  assert.match(helperRoute, /approval_state/);
  assert.match(helperRoute, /convertedOrderId/);
  assert.match(helperRoute, /order_draft_id/);
  assert.match(helperRoute, /order_number/);
});
