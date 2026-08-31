import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const orderDateUrl = pathToFileURL(path.resolve("src/lib/orderDate.js")).href;
const staffScopeUrl = pathToFileURL(path.resolve("src/lib/staffOrderScope.js")).href;
const source = (await fs.readFile(path.resolve("src/lib/orderPagination.ts"), "utf8"))
  .replace(/from\s+["']@\/lib\/orderDate\.js["']/g, `from "${orderDateUrl}"`)
  .replace(/from\s+["']@\/lib\/staffOrderScope\.js["']/g, `from "${staffScopeUrl}"`);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const pagination = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);

function order(id, date, dealer = "101", extra = {}) {
  return Object.freeze({ order_id: id, order_date: date, order_dealer: dealer, ...extra });
}

async function scan(rows, actor = { role: "admin", actorId: "1" }, assignedDealerIds = []) {
  return pagination.scanScopedOrders({
    actor,
    assignedDealerIds,
    upstreamActorIds: [actor.actorId],
    upstreamPageSize: 20,
    maxUpstreamPages: 5,
    fetchPage: async (_id, page) => ({ rows: page === 1 ? rows : [], lastPage: 1, total: rows.length }),
  });
}

test("pagination includes old, missing, malformed, and later order dates", async () => {
  const rows = [
    order("old", "2026-07-12"),
    order("missing", undefined),
    order("malformed", "not-a-date"),
    order("later", "2026-07-14"),
  ];
  const result = await scan(rows);
  assert.deepEqual(result.rows.map((row) => row.order_id), ["old", "missing", "malformed", "later"]);
});

test("Staff and Dealer pagination retain ownership scope", async () => {
  const rows = [order("A", "2026-07-12", "101"), order("B", "2026-07-14", "202")];
  assert.deepEqual((await scan(rows, { role: "staff", actorId: "29" }, ["101"])).rows.map((row) => row.order_id), ["A"]);
  assert.deepEqual((await scan(rows, { role: "dealer", actorId: "202" })).rows.map((row) => row.order_id), ["B"]);
});

test("role-scoped totals and pages are exact", async () => {
  const rows = Array.from({ length: 28 }, (_, index) => order(String(index + 1), "2026-07-01", "101"));
  const result = await scan(rows, { role: "staff", actorId: "29" }, ["101"]);
  const pages = [1, 2, 3].map((page) => pagination.buildOrdersPage({ rows: result.rows, page, pageSize: 10 }));
  assert.deepEqual(pages.map((entry) => entry.items.length), [10, 10, 8]);
  assert.deepEqual({ total: pages[0].total, totalPages: pages[0].totalPages }, { total: 28, totalPages: 3 });
});

test("normal filters remain available without an implicit date filter", () => {
  const rows = [
    order("1", "2026-07-01", "101", { order_status: "pending", marker: "Flask" }),
    order("2", "2026-07-14", "101", { order_status: "accepted", marker: "Beaker" }),
  ];
  assert.equal(pagination.buildOrdersPage({ rows, page: 1, pageSize: 10, filters: { search: "Flask" } }).total, 1);
  assert.equal(pagination.buildOrdersPage({ rows, page: 1, pageSize: 10, filters: { orderStatus: "pending" } }).total, 1);
  assert.equal(pagination.buildOrdersPage({ rows, page: 1, pageSize: 10 }).total, 2);
});

test("status filters treat legacy numeric and text values as the same statuses", () => {
  const rows = [
    order("1", "2026-07-01", "101", { order_status: "0" }),
    order("2", "2026-07-14", "101", { order_status: "1" }),
    order("3", "2026-07-15", "101", { order_status: "pending" }),
  ];
  assert.deepEqual(
    pagination.buildOrdersPage({ rows, page: 1, pageSize: 10, filters: { orderStatus: "pending" } }).items.map((row) => row.order_id),
    ["1", "3"],
  );
  assert.deepEqual(
    pagination.buildOrdersPage({ rows, page: 1, pageSize: 10, filters: { orderStatus: "1" } }).items.map((row) => row.order_id),
    ["2"],
  );
});

test("warehouse filter keeps only orders dispatched from that warehouse", () => {
  const rows = [
    order("a", "2026-08-01", "101", { staffwarehouse: "AHMEDABAD" }),
    order("b", "2026-08-02", "102", { staffwarehouse: "AMBALA" }),
    order("c", "2026-08-03", "103", { staffwarehouse: "" }),
  ];
  const ids = (warehouse) =>
    pagination.buildOrdersPage({ rows, page: 1, pageSize: 10, filters: { warehouse } }).items.map((row) => row.order_id);
  assert.deepEqual(ids("AHMEDABAD"), ["a"]);
  assert.deepEqual(ids("AMBALA"), ["b"]);
  // "" is the All tab — unpinned orders must stay visible.
  assert.deepEqual(ids(""), ["a", "b", "c"]);
});
