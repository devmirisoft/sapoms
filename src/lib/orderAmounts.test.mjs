import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

async function loadOrderAmountsModule() {
  const filePath = path.resolve("src/lib/orderAmounts.ts");
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

const orderAmounts = await loadOrderAmountsModule();

test("base plus slab uses normalized slab-only additional discount", () => {
  const breakdown = orderAmounts.resolveOrderDiscountBreakdown({
    grossAmount: 641448,
    discountAmount: 327138.48,
    netPayableAmount: 314309.52,
    baseDiscountPercent: 50,
    baseDiscountAmount: 320724,
    postBaseAmount: 320724,
    additionalDiscountType: "slab",
    slabDiscountPercent: 2,
    slabDiscountAmount: 6414.48,
    additionalDiscountAmount: 6414.48,
    customDiscountAmount: 0,
  });

  assert.equal(breakdown.grossAmount, 641448);
  assert.equal(breakdown.baseDiscountPercent, 50);
  assert.equal(breakdown.baseDiscountAmount, 320724);
  assert.equal(breakdown.postBaseAmount, 320724);
  assert.equal(breakdown.additionalDiscountType, "slab");
  assert.equal(breakdown.slabDiscountPercent, 2);
  assert.equal(breakdown.slabDiscountAmount, 6414.48);
  assert.equal(breakdown.customDiscountAmount, 0);
  assert.equal(breakdown.additionalDiscountAmount, 6414.48);
  assert.equal(breakdown.discountAmount, 327138.48);
  assert.equal(breakdown.netPayableAmount, 314309.52);
});

test("base plus custom zeroes slab fields", () => {
  const breakdown = orderAmounts.resolveOrderDiscountBreakdown({
    grossAmount: 100000,
    discountAmount: 55000,
    netPayableAmount: 45000,
    baseDiscountAmount: 50000,
    postBaseAmount: 50000,
    additionalDiscountType: "custom",
    customDiscountAmount: 5000,
    additionalDiscountAmount: 5000,
    slabDiscountPercent: 2,
    slabDiscountAmount: 1000,
  });

  assert.equal(breakdown.additionalDiscountType, "custom");
  assert.equal(breakdown.customDiscountAmount, 5000);
  assert.equal(breakdown.additionalDiscountAmount, 5000);
  assert.equal(breakdown.slabDiscountAmount, 0);
  assert.equal(breakdown.hasCustomDiscount, true);
  assert.equal(breakdown.hasSlabDiscount, false);
});

test("mutual exclusivity prefers explicit additional discount type", () => {
  const breakdown = orderAmounts.resolveOrderDiscountBreakdown({
    grossAmount: 100000,
    discountAmount: 55000,
    netPayableAmount: 45000,
    baseDiscountAmount: 50000,
    additionalDiscountType: "slab",
    slabDiscountAmount: 5000,
    customDiscountAmount: 5000,
  });

  assert.equal(breakdown.additionalDiscountType, "slab");
  assert.equal(breakdown.slabDiscountAmount, 5000);
  assert.equal(breakdown.customDiscountAmount, 0);
});

test("slab discount is not double-counted in summary rows", () => {
  const breakdown = orderAmounts.resolveOrderDiscountBreakdown({
    grossAmount: 641448,
    discountAmount: 327138.48,
    netPayableAmount: 314309.52,
    baseDiscountAmount: 320724,
    postBaseAmount: 320724,
    additionalDiscountType: "slab",
    slabDiscountPercent: 2,
    slabDiscountAmount: 6414.48,
  });

  const rows = orderAmounts.getOrderDiscountSummaryRows(breakdown);
  assert.deepEqual(rows.map((row) => row.label), [
    "Gross Amount",
    "Base Discount (50%)",
    "Slab Discount (2%)",
    "Total Discount",
    "Net Payable",
  ]);
  assert.equal(rows.find((row) => row.key === "total")?.amount, 327138.48);
});

test("explicit base discount wins over row item discount total", () => {
  const breakdown = orderAmounts.resolveOrderDiscountBreakdown({
    grossAmount: 100000,
    discountAmount: 55000,
    netPayableAmount: 45000,
    baseDiscountPercent: 50,
    additionalDiscountType: "slab",
    slabDiscountPercent: 10,
    slabDiscountAmount: 5000,
    additionalDiscountAmount: 5000,
  }, undefined, { itemDiscountTotal: 55000 });

  const rows = orderAmounts.getOrderDiscountSummaryRows(breakdown);
  assert.equal(breakdown.baseDiscountAmount, 50000);
  assert.equal(breakdown.additionalDiscountType, "slab");
  assert.equal(breakdown.slabDiscountAmount, 5000);
  assert.deepEqual(rows.map((row) => row.key), ["gross", "base", "slab", "total", "net"]);
});

test("OM/2026/3856 slab fixture preserves total discount and net payable", () => {
  const breakdown = orderAmounts.resolveOrderDiscountBreakdown({
    order_id: "3856",
    grossAmount: 1098300,
    baseDiscountPercent: 50,
    baseDiscountAmount: 549150,
    postBaseAmount: 549150,
    additionalDiscountType: "slab",
    slabDiscountPercent: 5,
    slabDiscountAmount: 27457.50,
    discountAmount: 576607.50,
    netPayableAmount: 521692.50,
  });

  assert.equal(breakdown.grossAmount, 1098300);
  assert.equal(breakdown.baseDiscountAmount, 549150);
  assert.equal(breakdown.additionalDiscountType, "slab");
  assert.equal(breakdown.slabDiscountPercent, 5);
  assert.equal(breakdown.slabDiscountAmount, 27457.50);
  assert.equal(breakdown.discountAmount, 576607.50);
  assert.equal(breakdown.netPayableAmount, 521692.50);
  assert.equal(breakdown.discountAmount, breakdown.baseDiscountAmount + breakdown.slabDiscountAmount);

  const compactRows = orderAmounts.getCompactOrderDiscountRows(breakdown);
  assert.deepEqual(compactRows.map((row) => [row.label, row.amount]), [
    ["Base 50%", 549150],
    ["Slab 5%", 27457.50],
    ["Total", 576607.50],
  ]);
});

test("custom discount is not double-counted in summary rows", () => {
  const breakdown = orderAmounts.resolveOrderDiscountBreakdown({
    grossAmount: 100000,
    discountAmount: 56000,
    netPayableAmount: 44000,
    baseDiscountAmount: 50000,
    postBaseAmount: 50000,
    additionalDiscountType: "custom",
    customDiscountAmount: 6000,
  });

  const rows = orderAmounts.getOrderDiscountSummaryRows(breakdown, { net: "Net Amount" });
  assert.deepEqual(rows.map((row) => row.label), [
    "Gross Amount",
    "Base Discount (50%)",
    "Approved Custom Discount",
    "Total Discount",
    "Net Amount",
  ]);
  assert.equal(rows.find((row) => row.key === "total")?.amount, 56000);
});

test("badge text shows only the active additional discount", () => {
  const slabBadge = orderAmounts.formatAdditionalDiscountBadge(orderAmounts.resolveOrderDiscountBreakdown({
    grossAmount: 641448,
    discountAmount: 327138.48,
    netPayableAmount: 314309.52,
    baseDiscountAmount: 320724,
    postBaseAmount: 320724,
    additionalDiscountType: "slab",
    slabDiscountPercent: 2,
    slabDiscountAmount: 6414.48,
  }));
  const customBadge = orderAmounts.formatAdditionalDiscountBadge(orderAmounts.resolveOrderDiscountBreakdown({
    grossAmount: 100000,
    discountAmount: 56000,
    netPayableAmount: 44000,
    baseDiscountAmount: 50000,
    additionalDiscountType: "custom",
    customDiscountAmount: 6000,
  }));

  assert.equal(slabBadge, "slab 2% · ₹6,414.48");
  assert.equal(customBadge, "Custom · ₹6,000.00");
});

test("historical ambiguous orders preserve totals and hide unknown additional rows", () => {
  const breakdown = orderAmounts.resolveOrderDiscountBreakdown({
    grossAmount: 100000,
    discountAmount: 52000,
    netPayableAmount: 48000,
    baseDiscountAmount: 50000,
    slabDiscountAmount: 1000,
    customDiscountAmount: 1000,
  });

  const rows = orderAmounts.getOrderDiscountSummaryRows(breakdown);
  assert.equal(breakdown.additionalDiscountType, null);
  assert.equal(breakdown.discountAmount, 52000);
  assert.equal(breakdown.netPayableAmount, 48000);
  assert.deepEqual(rows.map((row) => row.key), ["gross", "base", "total", "net"]);
});
