import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const postgresOrdersStub = `data:text/javascript;base64,${Buffer.from("export async function listPostgresOrderPage(){ return { rows: [], total: 0 }; }").toString("base64")}`;
const source = (await fs.readFile(path.resolve("src/lib/orderHeaders.ts"), "utf8"))
  .replace(/from\s+["']@\/lib\/postgresOrders["']/g, `from "${postgresOrdersStub}"`);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const orderHeaders = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);

test("order header sources are PostgreSQL-only app modes", () => {
  assert.equal(orderHeaders.ORDER_HEADER_SOURCES.has("current"), true);
  assert.equal(orderHeaders.ORDER_HEADER_SOURCES.has("pending"), true);
  assert.equal(orderHeaders.ORDER_HEADER_SOURCES.has("staff-status"), true);
  assert.equal(orderHeaders.ORDER_HEADER_SOURCES.has("orderpegination"), false);
  assert.equal(orderHeaders.ORDER_HEADER_SOURCES.has("orderhispegination"), false);
  assert.equal(orderHeaders.ORDER_HEADER_SOURCES.has("staffOrderrPagination"), false);
});

test("pending source semantics accept numeric and text pending statuses only", () => {
  assert.equal(orderHeaders.isPendingOrderHeader({ order_status: "0" }), true);
  assert.equal(orderHeaders.isPendingOrderHeader({ status: "pending" }), true);
  assert.equal(orderHeaders.isPendingOrderHeader({ order_status: "Pending" }), true);
  assert.equal(orderHeaders.isPendingOrderHeader({ order_status: "1" }), false);
  assert.equal(orderHeaders.isPendingOrderHeader({ status: "completed" }), false);
});
