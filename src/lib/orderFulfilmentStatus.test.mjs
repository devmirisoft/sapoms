import test from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";

const read = (rel) => fs.readFile(path.resolve(rel), "utf8");

// Mirrors legacyFulfilment in src/lib/postgresOrders.ts.
function fulfilment(items) {
  const ordered = items.reduce((sum, item) => sum + item.quantityPacks, 0);
  const dispatched = items.reduce(
    (sum, item) => sum + (item.dispatches ?? []).reduce((packs, d) => packs + d.quantity, 0),
    0,
  );
  if (dispatched <= 0) return "Pending";
  return dispatched >= ordered ? "Completed" : "Partial";
}

test("an order is Pending until something is dispatched", () => {
  assert.equal(fulfilment([{ quantityPacks: 4 }, { quantityPacks: 6 }]), "Pending");
  assert.equal(fulfilment([{ quantityPacks: 4, dispatches: [] }]), "Pending");
  assert.equal(fulfilment([]), "Pending");
});

test("one dispatched pack makes the whole order Partial", () => {
  assert.equal(fulfilment([{ quantityPacks: 4, dispatches: [{ quantity: 1 }] }, { quantityPacks: 6 }]), "Partial");
  // Every pack of one line, none of the other, is still Partial.
  assert.equal(fulfilment([{ quantityPacks: 4, dispatches: [{ quantity: 4 }] }, { quantityPacks: 6 }]), "Partial");
  // Several part-dispatches on one line add up.
  assert.equal(fulfilment([{ quantityPacks: 9, dispatches: [{ quantity: 2 }, { quantity: 3 }] }]), "Partial");
});

test("Completed only once every ordered pack has gone", () => {
  assert.equal(fulfilment([{ quantityPacks: 4, dispatches: [{ quantity: 4 }] }]), "Completed");
  assert.equal(
    fulfilment([
      { quantityPacks: 4, dispatches: [{ quantity: 1 }, { quantity: 3 }] },
      { quantityPacks: 6, dispatches: [{ quantity: 6 }] },
    ]),
    "Completed",
  );
});

test("dispatch quantities are queried wherever the mappers run", async () => {
  for (const file of ["src/lib/postgresOrders.ts", "src/lib/postgresOrderAnnotations.ts", "src/lib/ledgerSystem.ts"]) {
    assert.match(await read(file), /items: \{ orderBy: \{ id: "asc" as const \}, include: \{ dispatches:/, file);
  }
});

test("Pending, Partial and Completed are the only order statuses shown", async () => {
  const [orders, pagination, outstanding] = await Promise.all([
    read("src/app/orders/page.tsx"),
    read("src/lib/orderPagination.ts"),
    read("src/lib/outstandingBalance.ts"),
  ]);

  for (const source of [orders, pagination, outstanding]) {
    assert.doesNotMatch(source, /"NoActionTaken"/);
    assert.doesNotMatch(source, /return "InProcess"/);
  }
  // The badge config and the filter dropdown offer exactly the three states.
  assert.match(orders, /Partial:\s+\{ label: "Partial"/);
  assert.doesNotMatch(orders, /InProcess:\s+\{ label:/);
  assert.match(orders, /<option value="Partial">Partial<\/option>/);
  assert.doesNotMatch(orders, /<option value="InProcess">/);
});

test("a custom discount request is only pending, approved or rejected", async () => {
  const [lib, itemRoute, listRoute, staffPage] = await Promise.all([
    read("src/lib/customDiscountRequests.ts"),
    read("src/app/api/custom-discount-requests/[id]/route.ts"),
    read("src/app/api/custom-discount-requests/route.ts"),
    read("src/app/dashboard/staff/discount-requests/page.tsx"),
  ]);

  assert.match(lib, /export type CustomDiscountStatus = "pending" \| "approved" \| "rejected";/);
  // A row already carrying CANCELLED reads back as rejected rather than as a
  // fourth status the order form cannot branch on.
  assert.match(lib, /status === "cancelled" \|\| status === "canceled"\) return "rejected"/);
  // CANCELLED is refused at the write and filter boundaries.
  assert.doesNotMatch(itemRoute, /"CANCELLED"/);
  assert.doesNotMatch(listRoute, /"CANCELLED"/);
  // "Disapproved" was a fourth label for the same rejected status.
  assert.doesNotMatch(staffPage, /Disapproved/);
});
