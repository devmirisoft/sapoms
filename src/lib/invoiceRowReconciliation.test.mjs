import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

async function loadHelperModule() {
  const filePath = path.resolve("src/lib/invoiceRowReconciliation.ts");
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

const helper = await loadHelperModule();

function buildRow({
  grossAmount,
  stagedDiscountAmount,
  quantity,
  packSize = 1,
  pieces = quantity,
  description = "Item",
  productUnit = "Pcs",
}) {
  return {
    grossAmount,
    stagedDiscountAmount,
    stagedNetAmount: grossAmount - stagedDiscountAmount,
    quantity,
    packSize,
    pieces,
    description,
    productUnit,
  };
}

test("single item reconciles base plus slab to the authoritative total", () => {
  const result = helper.reconcileInvoiceRowAmounts({
    rows: [
      buildRow({
        grossAmount: 525600,
        stagedDiscountAmount: 262800,
        quantity: 1,
      }),
    ],
    amounts: {
      gross: 525600,
      discountAmount: 268056,
      netPayable: 257544,
    },
    discountBreakdown: {
      gross: 525600,
      discountAmount: 268056,
      netPayable: 257544,
      grossAmount: 525600,
      netPayableAmount: 257544,
      baseDiscountAmount: 262800,
      baseDiscountPercent: 50,
      postBaseAmount: 262800,
      additionalDiscountType: "slab",
      slabDiscountPercent: 2,
      slabDiscountAmount: 5256,
      customDiscountAmount: 0,
      additionalDiscountAmount: 5256,
      hasSlabDiscount: true,
      hasCustomDiscount: false,
      hasKnownBaseDiscount: true,
      hasKnownAdditionalDiscount: true,
    },
    useAuthoritativeTotals: true,
  });

  assert.equal(result.rows[0].discountAmount, 268056);
  assert.equal(result.rows[0].netAmount, 257544);
  assert.equal(result.rows[0].discountAdjustmentAmount, 5256);
  assert.equal(result.totals.discountAmount, 268056);
  assert.equal(result.totals.netAmount, 257544);
});

test("multiple rows distribute the additional discount proportionally across post-base amounts", () => {
  const result = helper.reconcileInvoiceRowAmounts({
    rows: [
      buildRow({ grossAmount: 60000, stagedDiscountAmount: 30000, quantity: 1 }),
      buildRow({ grossAmount: 40000, stagedDiscountAmount: 20000, quantity: 1 }),
    ],
    amounts: {
      gross: 100000,
      discountAmount: 55000,
      netPayable: 45000,
    },
    discountBreakdown: {
      gross: 100000,
      discountAmount: 55000,
      netPayable: 45000,
      grossAmount: 100000,
      netPayableAmount: 45000,
      baseDiscountAmount: 50000,
      baseDiscountPercent: 50,
      postBaseAmount: 50000,
      additionalDiscountType: "slab",
      slabDiscountPercent: 10,
      slabDiscountAmount: 5000,
      customDiscountAmount: 0,
      additionalDiscountAmount: 5000,
      hasSlabDiscount: true,
      hasCustomDiscount: false,
      hasKnownBaseDiscount: true,
      hasKnownAdditionalDiscount: true,
    },
    useAuthoritativeTotals: true,
  });

  assert.deepEqual(
    result.rows.map((row) => row.discountAmount),
    [33000, 22000]
  );
  assert.deepEqual(
    result.rows.map((row) => row.netAmount),
    [27000, 18000]
  );
  assert.equal(result.totals.discountAmount, 55000);
  assert.equal(result.totals.netAmount, 45000);
});

test("when staged item discounts already match the authoritative total nothing is added again", () => {
  const result = helper.reconcileInvoiceRowAmounts({
    rows: [
      buildRow({ grossAmount: 60000, stagedDiscountAmount: 33000, quantity: 1 }),
      buildRow({ grossAmount: 40000, stagedDiscountAmount: 22000, quantity: 1 }),
    ],
    amounts: {
      gross: 100000,
      discountAmount: 55000,
      netPayable: 45000,
    },
    discountBreakdown: {
      gross: 100000,
      discountAmount: 55000,
      netPayable: 45000,
      grossAmount: 100000,
      netPayableAmount: 45000,
      baseDiscountAmount: 50000,
      baseDiscountPercent: 50,
      postBaseAmount: 50000,
      additionalDiscountType: "slab",
      slabDiscountPercent: 10,
      slabDiscountAmount: 5000,
      customDiscountAmount: 0,
      additionalDiscountAmount: 5000,
      hasSlabDiscount: true,
      hasCustomDiscount: false,
      hasKnownBaseDiscount: true,
      hasKnownAdditionalDiscount: true,
    },
    useAuthoritativeTotals: true,
  });

  assert.deepEqual(
    result.rows.map((row) => row.discountAdjustmentAmount),
    [0, 0]
  );
  assert.deepEqual(
    result.rows.map((row) => row.discountAmount),
    [33000, 22000]
  );
  assert.equal(result.totals.discountAmount, 55000);
});

test("legacy orders without a summary override keep the staged item calculations", () => {
  const result = helper.reconcileInvoiceRowAmounts({
    rows: [
      buildRow({ grossAmount: 525600, stagedDiscountAmount: 262800, quantity: 1 }),
    ],
    amounts: {
      gross: 525600,
      discountAmount: 268056,
      netPayable: 257544,
    },
    discountBreakdown: {
      gross: 525600,
      discountAmount: 268056,
      netPayable: 257544,
      grossAmount: 525600,
      netPayableAmount: 257544,
      baseDiscountAmount: 262800,
      baseDiscountPercent: 50,
      postBaseAmount: 262800,
      additionalDiscountType: "slab",
      slabDiscountPercent: 2,
      slabDiscountAmount: 5256,
      customDiscountAmount: 0,
      additionalDiscountAmount: 5256,
      hasSlabDiscount: true,
      hasCustomDiscount: false,
      hasKnownBaseDiscount: true,
      hasKnownAdditionalDiscount: true,
    },
    useAuthoritativeTotals: false,
  });

  assert.equal(result.rows[0].discountAmount, 262800);
  assert.equal(result.rows[0].netAmount, 262800);
  assert.equal(result.totals.discountAmount, 262800);
  assert.equal(result.totals.netAmount, 262800);
});

test("the final row absorbs the rounding remainder so row totals match exactly", () => {
  const result = helper.reconcileInvoiceRowAmounts({
    rows: [
      buildRow({ grossAmount: 40, stagedDiscountAmount: 20, quantity: 1 }),
      buildRow({ grossAmount: 30, stagedDiscountAmount: 20, quantity: 1 }),
      buildRow({ grossAmount: 30, stagedDiscountAmount: 20, quantity: 1 }),
    ],
    amounts: {
      gross: 100,
      discountAmount: 60.01,
      netPayable: 39.99,
    },
    discountBreakdown: {
      gross: 100,
      discountAmount: 60.01,
      netPayable: 39.99,
      grossAmount: 100,
      netPayableAmount: 39.99,
      baseDiscountAmount: 60,
      baseDiscountPercent: 60,
      postBaseAmount: 40,
      additionalDiscountType: "slab",
      slabDiscountPercent: 0,
      slabDiscountAmount: 0.01,
      customDiscountAmount: 0,
      additionalDiscountAmount: 0.01,
      hasSlabDiscount: true,
      hasCustomDiscount: false,
      hasKnownBaseDiscount: true,
      hasKnownAdditionalDiscount: true,
    },
    useAuthoritativeTotals: true,
  });

  assert.equal(result.rows[0].discountAmount, 20);
  assert.equal(result.rows[1].discountAmount, 20);
  assert.equal(result.rows[2].discountAmount, 20.01);
  assert.equal(result.rows[2].discountAdjustmentAmount, 0.01);
  assert.equal(Math.round(result.rows.reduce((sum, row) => sum + row.discountAmount, 0) * 100) / 100, 60.01);
  assert.equal(Math.round(result.rows.reduce((sum, row) => sum + row.netAmount, 0) * 100) / 100, 39.99);
  assert.equal(result.totals.discountAmount, 60.01);
  assert.equal(result.totals.netAmount, 39.99);
});

// OM/26-27/DMS-2211: 15 lines at the dealer's 50%, gross 1,17,358.
const dms2211Amounts = { gross: 117358, discountAmount: 58679, netPayable: 58679 };
const dms2211Breakdown = {
  ...dms2211Amounts,
  grossAmount: 117358,
  netPayableAmount: 58679,
  baseDiscountAmount: 58679,
  baseDiscountPercent: 50,
  postBaseAmount: 58679,
  additionalDiscountType: null,
  slabDiscountPercent: 0,
  slabDiscountAmount: 0,
  customDiscountAmount: 0,
  additionalDiscountAmount: 0,
  hasSlabDiscount: false,
  hasCustomDiscount: false,
  hasKnownBaseDiscount: true,
  hasKnownAdditionalDiscount: false,
};

test("lines whose gross does not add up to the order gross are refused, not printed", () => {
  // The order page's old copy: gross rebuilt per pack (292/1 = 154, not 1,540),
  // so the 50% discount was capped at the line and printed as 100%.
  const perPackGross = [[154, 154], [618, 618], [499, 499], [1734, 867], [60, 60], [14360, 7180], [8922, 4461],
    [11060, 5530], [3390, 1695], [32800, 16400], [60, 60], [3142, 3142], [158, 158], [1710, 1710], [3812, 1906]];
  assert.throws(() => helper.reconcileInvoiceRowAmounts({
    rows: perPackGross.map(([grossAmount, stagedDiscountAmount]) => buildRow({ grossAmount, stagedDiscountAmount, quantity: 1 })),
    amounts: dms2211Amounts,
    discountBreakdown: dms2211Breakdown,
    useAuthoritativeTotals: false,
  }), /gross total/);
});

test("lines carrying the stored gross print the order's own discount", () => {
  const storedGross = [1540, 6180, 3992, 1734, 6000, 14360, 8922, 11060, 3390, 32800, 6000, 12568, 1580, 3420, 3812];
  const result = helper.reconcileInvoiceRowAmounts({
    rows: storedGross.map((grossAmount) => buildRow({ grossAmount, stagedDiscountAmount: grossAmount / 2, quantity: 1 })),
    amounts: dms2211Amounts,
    discountBreakdown: dms2211Breakdown,
    useAuthoritativeTotals: false,
  });

  assert.ok(result.rows.every((row) => row.discountAmount === row.grossAmount / 2));
  assert.equal(result.totals.grossAmount, 117358);
  assert.equal(result.totals.netAmount, 58679);
});
