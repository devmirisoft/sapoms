import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

test("admin product mapper serializes price BigInts explicitly", () => {
  const source = readFileSync(new URL("./products.mapper.ts", import.meta.url), "utf8");
  assert.match(source, /unitPricePaise\.toString\(\)/);
  assert.match(source, /packPricePaise\.toString\(\)/);
});

test("product catalogue migration removes PHP product endpoints", () => {
  const productListPage = readFileSync("src/app/Pages/products/page.tsx", "utf8");
  const addProductPage = readFileSync("src/app/Pages/products/addproducts/page.tsx", "utf8");
  const addOrderForm = readFileSync("src/app/dashboard/dealer/AddOrderForm/page.tsx", "utf8");

  assert.ok(productListPage.includes("/api/admin/products"));
  assert.ok(addProductPage.includes("/api/admin/products"));
  assert.ok(addOrderForm.includes("/api/products"));
  assert.doesNotMatch(productListPage + addProductPage + addOrderForm, /php-compat|addproduct/);
});

test("catalogue read route is session authorized and hides inactive rows for dealer staff reads", () => {
  // The query lives in postgres-catalogue.ts (shared with the ordering assistant); the route keeps the gate.
  const catalogueRoute = readFileSync("src/app/api/products/route.ts", "utf8")
    + readFileSync("src/server/modules/products/postgres-catalogue.ts", "utf8");
  assert.ok(catalogueRoute.includes('requireRole(["ADMIN", "STAFF", "DEALER"])'));
  assert.ok(catalogueRoute.includes('includeInactive = actor.role === "ADMIN"'));
  // Inactive variants are dropped; a deleted product comes back with none so the merge hides its JSON twin.
  assert.ok(catalogueRoute.includes('variants: { where: includeInactive ? {} : { active: true }'));
  assert.match(catalogueRoute, /unitPricePaise/);
  assert.match(catalogueRoute, /packSize/);
  assert.doesNotMatch(catalogueRoute, /requireAdmin\(|php-compat|actorFromRequestHeaders|x-omsons-actor/i);
});

test("admin product routes keep mutations behind requireAdmin", () => {
  const listRoute = readFileSync("src/app/api/admin/products/route.ts", "utf8");
  const detailRoute = readFileSync("src/app/api/admin/products/[productId]/route.ts", "utf8");
  assert.match(listRoute, /export async function POST/);
  assert.match(detailRoute, /export async function PATCH/);
  assert.match(detailRoute, /export async function DELETE/);
  assert.match(listRoute + detailRoute, /requireAdmin\(\)/);
  assert.doesNotMatch(listRoute + detailRoute, /php-compat|actorFromRequestHeaders|x-omsons-actor/i);
});
