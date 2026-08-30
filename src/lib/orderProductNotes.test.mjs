import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  buildInvoiceProductName,
  buildInvoiceDescriptionMeta,
  buildMatchedOrderRows,
  buildOrderRemarks,
  extractLegacyProductNote,
  mergeFallbackProductNotes,
  mergeProductNotesIntoInvoiceItems,
  normalizeProductNote,
  resolveDisplayRemark,
  verifyOrderProductNotesPersistence,
} from "./orderProductNotes.mjs";

const addOrderPagePath = new URL("../app/dashboard/dealer/AddOrderForm/page.tsx", import.meta.url);
const draftsPath = new URL("./drafts.ts", import.meta.url);
const orderDetailPagePath = new URL("../app/orders/[id]/page.tsx", import.meta.url);

test("General Order Note remains inside PHP remarks", () => {
  assert.equal(
    buildOrderRemarks("Cat. No: 50/8 | Priority delivery", "Urgent dispatch"),
    "Cat. No: 50/8 | Priority delivery | Order note: Urgent dispatch"
  );
});

test("Product Note is excluded from new PHP remarks", () => {
  assert.equal(
    buildOrderRemarks("Cat. No: 50/8 | Priority delivery", "Urgent dispatch"),
    "Cat. No: 50/8 | Priority delivery | Order note: Urgent dispatch"
  );
  assert.equal(
    buildOrderRemarks("Cat. No: 50/8 | Priority delivery", ""),
    "Cat. No: 50/8 | Priority delivery"
  );
});

test("Notes longer than 500 characters are truncated at the helper boundary", () => {
  const note = "x".repeat(700);
  assert.equal(normalizeProductNote(note).length, 500);
});

test("Product Note is saved through /api/order-product-notes after the actual order ID is known", async () => {
  const posts = [];
  const fetchImpl = async (url, init = {}) => {
    if (String(url).includes("/orderdatalist")) {
      return {
        ok: true,
        async json() {
          return {
            data: [
              {
                orderdata_id: "555",
                orderdata_orderid: "902",
                orderdata_cat_no: "50/8",
                remark: "Cat. No: 50/8 | Priority delivery",
              },
            ],
          };
        },
      };
    }

    posts.push(JSON.parse(String(init.body)));
    return { ok: true, async json() { return { success: true }; } };
  };

  const summary = await verifyOrderProductNotesPersistence({
    fetchImpl,
    backendUrl: "https://example.test/api",
    actualOrderId: "902",
    dealerId: "44",
    submittedRows: [{ variantCode: "50/8", productNote: "Pack separately" }],
  });

  assert.deepEqual(summary, { verifiedInPhp: 0, savedToFallback: 1, failed: 0 });
  assert.equal(posts[0].orderId, "902");
  assert.equal(posts[0].orderItemId, "555");
  assert.equal(posts[0].note, "Pack separately");
});

test("PHP remarks that already contain the product note do not trigger fallback writes", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });

    if (String(url).includes("/orderdatalist")) {
      return {
        ok: true,
        async json() {
          return {
            data: [
              {
                orderdata_id: "101",
                orderdata_orderid: "901",
                orderdata_cat_no: "50/8",
                remark: "Cat. No: 50/8 | Product note: Pack separately",
              },
            ],
          };
        },
      };
    }

    throw new Error("Fallback POST should not be called");
  };

  const summary = await verifyOrderProductNotesPersistence({
    fetchImpl,
    backendUrl: "https://example.test/api",
    actualOrderId: "901",
    dealerId: "44",
    submittedRows: [{ variantCode: "50/8", productNote: "Pack separately" }],
  });

  assert.deepEqual(summary, { verifiedInPhp: 1, savedToFallback: 0, failed: 0 });
  assert.equal(calls.length, 1);
});

test("Predicted order numbers are rejected as fallback storage keys", async () => {
  await assert.rejects(
    verifyOrderProductNotesPersistence({
      fetchImpl: async () => ({ ok: true, async json() { return { data: [] }; } }),
      backendUrl: "https://example.test/api",
      actualOrderId: "OM/2026/0009",
      dealerId: "44",
      submittedRows: [{ variantCode: "50/8", productNote: "Pack separately" }],
    }),
    /Actual PHP order ID is required/
  );
});

test("Duplicate SKUs are matched by occurrence and keep distinct fallback identities", () => {
  const matches = buildMatchedOrderRows(
    [
      { variantCode: "50/8", productNote: "First note" },
      { variantCode: "50/8", productNote: "Second note" },
    ],
    [
      { orderdata_id: "A1", orderdata_cat_no: "50/8" },
      { orderdata_id: "A2", orderdata_cat_no: "50/8" },
    ]
  );

  assert.deepEqual(
    matches.map((match) => ({
      occurrence: match.occurrence,
      orderItemId: match.phpRow?.orderdata_id,
    })),
    [
      { occurrence: 1, orderItemId: "A1" },
      { occurrence: 2, orderItemId: "A2" },
    ]
  );
});

test("One product receives its correct Product Note in the invoice merge", () => {
  const merged = mergeProductNotesIntoInvoiceItems(
    [
      {
        orderdata_id: "A1",
        orderdata_orderid: "910",
        orderdata_cat_no: "50/8",
        product_name: "Measuring Cylinder",
      },
    ],
    [
      {
        orderId: "910",
        orderItemId: "A1",
        normalizedSku: "50/8",
        occurrence: 1,
        note: "Pack separately",
      },
    ]
  );

  assert.equal(merged[0].productNote, "Pack separately");
});

test("Two different products receive different Product Notes", () => {
  const merged = mergeProductNotesIntoInvoiceItems(
    [
      {
        orderdata_id: "A1",
        orderdata_orderid: "910",
        orderdata_cat_no: "50/8",
        product_name: "Measuring Cylinder",
      },
      {
        orderdata_id: "A2",
        orderdata_orderid: "910",
        orderdata_cat_no: "8/1",
        product_name: "Laboratory Bottle",
      },
    ],
    [
      { orderId: "910", orderItemId: "A1", normalizedSku: "50/8", occurrence: 1, note: "Pack separately" },
      { orderId: "910", orderItemId: "A2", normalizedSku: "8/1", occurrence: 1, note: "Use blue caps only" },
    ]
  );

  assert.deepEqual(
    merged.map((item) => item.productNote),
    ["Pack separately", "Use blue caps only"]
  );
});

test("orderItemId matching takes precedence over SKU matching", () => {
  const merged = mergeProductNotesIntoInvoiceItems(
    [
      {
        orderdata_id: "A1",
        orderdata_orderid: "910",
        orderdata_cat_no: "50/8",
        product_name: "Measuring Cylinder",
      },
    ],
    [
      { orderId: "910", orderItemId: "A1", normalizedSku: "different-sku", occurrence: 1, note: "Item-id note" },
      { orderId: "910", normalizedSku: "50/8", occurrence: 1, note: "Sku note" },
    ]
  );

  assert.equal(merged[0].productNote, "Item-id note");
});

test("Invoice product name becomes Product Name newline Product Note", () => {
  assert.equal(
    buildInvoiceProductName("Borosilicate Measuring Cylinder", "Pack separately"),
    "Borosilicate Measuring Cylinder\n(Pack separately)"
  );
});

test("A product without a Product Note remains unchanged", () => {
  assert.equal(
    buildInvoiceProductName("Borosilicate Measuring Cylinder", ""),
    "Borosilicate Measuring Cylinder"
  );
});

test("Product Note does not appear in the invoice Remarks section helper", () => {
  assert.equal(
    resolveDisplayRemark({
      remark: "Cat. No: 50/8 | Priority delivery",
      fallbackNote: "Pack separately",
    }),
    "Cat. No: 50/8 | Priority delivery | Product note: Pack separately"
  );
});

test("Mongo Product Note is not duplicated when legacy PHP remarks also contain the same Product Note", () => {
  const merged = mergeProductNotesIntoInvoiceItems(
    [
      {
        orderdata_id: "A1",
        orderdata_orderid: "910",
        orderdata_cat_no: "50/8",
        product_name: "Measuring Cylinder",
        remark: "Cat. No: 50/8 | Product note: Pack separately | Order note: Deliver before Friday",
      },
    ],
    [
      { orderId: "910", orderItemId: "A1", normalizedSku: "50/8", occurrence: 1, note: "Pack separately" },
    ]
  );

  assert.equal(merged[0].productNote, "Pack separately");
  assert.equal(
    buildInvoiceProductName(merged[0].product_name, merged[0].productNote),
    "Measuring Cylinder\n(Pack separately)"
  );
});

test("Legacy Product note parsing does not consume Order note text", () => {
  assert.equal(
    extractLegacyProductNote("Cat. No: 50/8 | Product note: Pack separately | Order note: Deliver before Friday"),
    "Pack separately"
  );
  assert.equal(
    extractLegacyProductNote("Cat. No: 50/8 | Order note: Deliver before Friday"),
    ""
  );
});

test("Long notes wrap in the product-name cell format without changing note content", () => {
  const note = "Include calibration certificate and pack separately with foam support for transit safety.";
  const formatted = buildInvoiceProductName("Borosilicate Measuring Cylinder", note);

  assert.match(formatted, /^Borosilicate Measuring Cylinder\n\(.+\)$/);
  assert.match(formatted, /Include calibration certificate/);
});

test("Staff display prefers PHP remarks and does not duplicate the fallback note", () => {
  assert.equal(
    resolveDisplayRemark({
      remark: "Cat. No: 50/8 | Product note: Pack separately",
      fallbackNote: "Pack separately",
    }),
    "Cat. No: 50/8 | Product note: Pack separately"
  );

  const merged = mergeFallbackProductNotes(
    [
      {
        orderdata_id: "A1",
        orderdata_orderid: "910",
        orderdata_cat_no: "50/8",
        remark: "Cat. No: 50/8 | Priority delivery",
      },
    ],
    [
      {
        orderId: "910",
        orderItemId: "A1",
        normalizedSku: "50/8",
        occurrence: 1,
        note: "Pack separately",
      },
    ]
  );

  assert.equal(
    merged[0].displayRemark,
    "Cat. No: 50/8 | Priority delivery | Product note: Pack separately"
  );
});

test("Draft and reorder source paths still carry productNote fields", async () => {
  const [addOrderSource, draftsSource, orderDetailSource] = await Promise.all([
    readFile(addOrderPagePath, "utf8"),
    readFile(draftsPath, "utf8"),
    readFile(orderDetailPagePath, "utf8"),
  ]);

  assert.match(draftsSource, /productNote\?: string;/);
  assert.match(addOrderSource, /productNote:\s*String\(p\.productNote \?\? ""\)/);
  assert.match(addOrderSource, /productNote:\s*row\.productNote \?\? ""/);
  assert.match(addOrderSource, /maxLength=\{500\}/);
  assert.match(orderDetailSource, /api\/order-product-notes\?orderId=/);
  assert.doesNotMatch(orderDetailSource, /getremark\?id=/);
});

test("Invoice description puts Cat. No before the product name and keeps the note separate", () => {
  const meta = buildInvoiceDescriptionMeta({
    productName: "Borosilicate Measuring Cylinder",
    catalogueNumber: "50/8",
    productNote: "Pack separately",
    isPriority: true,
  });

  assert.equal(
    meta.mainText,
    "50/8 - Borosilicate Measuring Cylinder" + String.fromCharCode(10) + "[PRIORITY DELIVERY]"
  );
  assert.equal(meta.noteText, "Pack separately");

  const noNote = buildInvoiceDescriptionMeta({
    productName: "",
    catalogueNumber: "50/8",
    productNote: "",
  });

  assert.equal(noNote.mainText, "50/8");
  assert.equal(noNote.noteText, "");
});
