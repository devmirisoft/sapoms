import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

// postgresOrders.ts is server-only; stub the runtime imports it never needs here.
async function loadPostgresOrders() {
  const filePath = path.resolve("src/lib/postgresOrders.ts");
  const source = (await fs.readFile(filePath, "utf8"))
    .replace(/^import "server-only";$/m, "")
    .replace(/^import \{ Prisma.*$/m, "const Prisma = {};")
    .replace(/^import \{ prisma \}.*$/m, "const prisma = {};")
    .replace(/^import \{ buildOrderRegionWhere \}.*$/m, "const buildOrderRegionWhere = () => ({});")
    .replace(/^import type \{ OrdersActor \}.*$/m, "")
    .replace(/^import \{ summarizeOrderSettlement \}.*$/m, "const summarizeOrderSettlement = () => ({});")
    .replace(/^import \{ normalizeSku \}.*$/m, "const normalizeSku = (value) => String(value ?? '').toLowerCase();")
    .replace(/^import \{ normalizeDispatchStatus.*$/m, "const normalizeDispatchStatus = (value) => String(value ?? '').toLowerCase();");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled, "utf8").toString("base64")}`);
}

const { mapPostgresOrderDispatchRecords } = await loadPostgresOrders();

function item(id, quantityPacks, dispatches) {
  return {
    id: BigInt(id),
    legacyPhpOrderItemId: null,
    quantityPacks,
    catalogueNumberSnapshot: `CAT-${id}`,
    createdAt: new Date("2026-08-26T00:00:00.000Z"),
    updatedAt: new Date("2026-08-26T00:00:00.000Z"),
    dispatches,
  };
}

const order = {
  id: 41n,
  legacyPhpId: null,
  dealerId: 7n,
  assignedStaffId: 3n,
  items: [
    item(1, 20, []),
    item(2, 10, [{ id: 9n, quantity: 4, remark: "part", status: "DISPATCHED", actorUserId: 5n, actorRole: "ADMIN", createdAt: new Date("2026-08-27T00:00:00.000Z") }]),
    item(3, 6, [{ id: 10n, quantity: 6, remark: "", status: "DISPATCHED", actorUserId: 5n, actorRole: "STAFF", createdAt: new Date("2026-08-28T00:00:00.000Z") }]),
  ],
};

test("dispatch records aggregate each line's dispatched quantity and status", () => {
  const records = mapPostgresOrderDispatchRecords(order);
  assert.deepEqual(records.map((record) => record.dispatchedQuantity), [0, 4, 6]);
  assert.deepEqual(records.map((record) => record.currentStatus), ["pending", "dispatched", "successful"]);
  assert.deepEqual(records.map((record) => record.orderItemId), ["1", "2", "3"]);
  assert.equal(records[1].updates.length, 1);
  assert.equal(records[1].updates[0].actorRole, "admin");
});

test("list-shaped dispatch rows without ids still report quantities", () => {
  const [record] = mapPostgresOrderDispatchRecords({ ...order, items: [item(1, 20, [{ quantity: 5 }])] });
  assert.equal(record.dispatchedQuantity, 5);
  assert.deepEqual(record.updates, []);
});
