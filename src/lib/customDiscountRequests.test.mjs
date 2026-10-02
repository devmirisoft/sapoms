import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

async function loadCustomDiscountRequestsModule() {
  const filePath = path.resolve("src/lib/customDiscountRequests.ts");
  const source = await fs.readFile(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;

  const dataUrl = `data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`;
  return import(dataUrl);
}

const helpers = await loadCustomDiscountRequestsModule();

test("buildOrderApprovalSnapshot keeps the full order and flags only custom rows", () => {
  const snapshot = helpers.buildOrderApprovalSnapshot({
    products: [
      {
        rowKey: "1",
        productKey: "cat-1",
        sku: "CAT-1",
        catalogueNumber: "CAT-1",
        productName: "Standard Product",
        quantity: 2,
        packSize: 5,
        unitPrice: 100,
      },
      {
        rowKey: "2",
        productKey: "cat-2",
        sku: "CAT-2",
        catalogueNumber: "CAT-2",
        productName: "Custom Product",
        quantity: 1,
        packSize: 10,
        unitPrice: 200,
        productNote: "Pack separately",
      },
    ],
    orderNote: "Handle with care",
    baseDiscountPercent: 10,
    requestedProductDiscounts: {
      "cat-2": 18,
    },
  });

  assert.equal(snapshot.products.length, 2);
  assert.equal(snapshot.orderNote, "Handle with care");
  assert.equal(snapshot.products[0].usesCustomDiscount, false);
  assert.equal(snapshot.products[1].usesCustomDiscount, true);
  assert.equal(snapshot.products[1].requestedCustomDiscountPercent, 8);
  assert.equal(snapshot.products[1].productNote, "Pack separately");
  assert.equal(snapshot.grossAmount, 3000);
  assert.equal(snapshot.baseDiscountAmount, 300);
  assert.equal(snapshot.requestedAdditionalDiscountAmount, 160);
  assert.equal(snapshot.totalDiscountAmount, 460);
  assert.equal(snapshot.requestedNetPayableAmount, 2540);
});

test("normalizeCustomDiscountRequestRecord supports legacy partial-product requests", () => {
  const normalized = helpers.normalizeCustomDiscountRequestRecord({
    id: "legacy-1",
    dealerId: "44",
    status: "approved",
    discountScope: "product",
    requestedDiscountPercent: 18,
    currentDiscountPercent: 10,
    targetProduct: { productKey: "cat-2", variantCode: "CAT-2" },
    products: [
      {
        key: 1,
        productname: "CAT-2",
        displayName: "Legacy Product",
        variantCode: "CAT-2",
        quantity: 2,
        packSize: 4,
        price: 150,
      },
    ],
  });

  assert.equal(normalized.isLegacySnapshot, true);
  assert.equal(normalized.orderSnapshot.products.length, 1);
  assert.equal(normalized.orderSnapshot.products[0].usesCustomDiscount, true);
  assert.equal(normalized.requestedProductDiscounts["cat-2"], 18);
});

test("resolveApprovalAggregateStatus keeps partial approvals pending and rejects on any rejected line", () => {
  assert.equal(helpers.resolveApprovalAggregateStatus({
    status: "pending",
    lineStatuses: ["approved", "pending"],
  }), "pending");

  assert.equal(helpers.resolveApprovalAggregateStatus({
    status: "approved",
    lineStatuses: ["approved", "approved"],
  }), "approved");

  assert.equal(helpers.resolveApprovalAggregateStatus({
    status: "approved",
    lineStatuses: ["approved", "rejected"],
  }), "rejected");
});

test("findLatestRequestForDraft resolves by request id first and then newest draft request", () => {
  const requests = [
    { id: "older", orderDraftId: "draft-1", status: "pending", createdAt: "2026-07-13T10:00:00.000Z" },
    { id: "newer", orderDraftId: "draft-1", status: "approved", createdAt: "2026-07-13T12:00:00.000Z" },
  ];

  assert.equal(
    helpers.findLatestRequestForDraft(requests, "draft-1", "older")?.id,
    "older",
  );
  assert.equal(
    helpers.findLatestRequestForDraft(requests, "draft-1")?.id,
    "newer",
  );
});

test("source files keep the pending complete-order flow wired to orderDraftId", async () => {
  const [addOrderSource, dealerPageSource, adminPageSource, apiSource] = await Promise.all([
    fs.readFile(path.resolve("src/app/dashboard/dealer/AddOrderForm/page.tsx"), "utf8"),
    fs.readFile(path.resolve("src/app/dashboard/dealer/approved-discounts/page.tsx"), "utf8"),
    fs.readFile(path.resolve("src/app/dashboard/admin/custom-discount-approvals/page.tsx"), "utf8"),
    fs.readFile(path.resolve("src/app/api/custom-discount-requests/route.ts"), "utf8"),
  ]);

  assert.match(addOrderSource, /Wait for Approval/);
  assert.match(addOrderSource, /View Approval Status/);
  assert.match(addOrderSource, /orderDraftId/);
  assert.match(addOrderSource, /orderSnapshot/);
  assert.doesNotMatch(addOrderSource, /expectedOrderNumber:\s*expectedOrderNumber/);

  assert.match(dealerPageSource, /Pending Approval/);
  assert.match(dealerPageSource, /Use Approved Order/);
  assert.match(dealerPageSource, /Custom Approval Requested/);

  assert.match(adminPageSource, /Complete Product List/);
  assert.match(adminPageSource, /Requested Custom/);

  assert.match(apiSource, /buildPendingRequestLookup/);
  assert.match(apiSource, /orderDraftId is required/);
});

test("custom discount asked on the net after base stacks onto base", () => {
  // 50% base, then 10% off the remaining net = 55% of gross: 62,400 -> 31,200 -> 28,080.
  assert.equal(helpers.stackDiscountOnNet(50, 10), 55);
  assert.equal(Math.round(62400 * (1 - helpers.stackDiscountOnNet(50, 10) / 100)), 28080);
  assert.equal(helpers.discountOnNet(50, 55), 10);
  assert.equal(helpers.stackDiscountOnNet(50, 0), 50);
  assert.equal(helpers.discountOnNet(100, 100), 0);
});

test("NSM review only for custom asks above 5% on the net after base", () => {
  // 50% base: 5% on net = 52.5% total stays RSM -> Admin, anything above adds the NSM.
  assert.equal(helpers.requiresNsmReview(50, [52.5]), false);
  assert.equal(helpers.requiresNsmReview(50, [53]), true);
  assert.equal(helpers.requiresNsmReview(50, [50, 51, 55]), true);
  assert.equal(helpers.requiresNsmReview(50, []), false);
});
