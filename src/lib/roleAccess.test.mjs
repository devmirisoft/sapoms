import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const sourcePath = path.resolve("src/lib/roleAccess.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;

const moduleShim = { exports: {} };
vm.runInNewContext(compiled, {
  module: moduleShim,
  exports: moduleShim.exports,
  require,
  Buffer,
  atob,
}, { filename: sourcePath });

const {
  canAccessRoute,
  getAllowedRoles,
  getRoleHome,
  normalizeRoleFromProfile,
  clearAuthStorage,
  LEGACY_AUTH_KEYS,
} = moduleShim.exports;

assert.equal(getAllowedRoles("/Products"), null, "public product route stays public");

// The /api/auth/me profile decides the client role.
assert.equal(normalizeRoleFromProfile({ name: "No Role" }), null, "missing role is not admin");
assert.equal(normalizeRoleFromProfile({ name: "Mystery", role: "99" }), null, "unknown role is not admin");
assert.equal(normalizeRoleFromProfile({ admin_id: "n1", role: "nsm" }), "admin");
assert.equal(normalizeRoleFromProfile({ staff_id: "r1", staff_roletype: "RSM", role: "rsm" }), "staff");
assert.equal(normalizeRoleFromProfile({ staff_id: "s1", staff_roletype: "1" }), "staff");
assert.equal(normalizeRoleFromProfile({ staff_id: "s0", staff_roletype: "0" }), "admin");
assert.equal(normalizeRoleFromProfile({ Dealer_Id: "d1", Dealer_Name: "D" }), "dealer");
assert.equal(normalizeRoleFromProfile({ accountant_id: "a1", role: "accountant" }), "accountant");

// Logout wipes every profile copy older builds kept in localStorage, and the cart.
const keys = [...LEGACY_AUTH_KEYS, "cart"];
const values = new Map(keys.map((key) => [key, "x"]));
clearAuthStorage({ removeItem: (key) => values.delete(key) });
assert.deepEqual([...values.keys()], [], "no profile data or cart survives logout");
assert.ok(LEGACY_AUTH_KEYS.includes("UserData") && LEGACY_AUTH_KEYS.includes("accountant_token"));

assert.equal(canAccessRoute("admin", "/dashboard/admin/custom-discount-approvals"), true);
assert.equal(canAccessRoute("staff", "/dashboard/admin/custom-discount-approvals"), false);
assert.equal(canAccessRoute("dealer", "/dashboard/admin/custom-discount-approvals"), false);
assert.equal(canAccessRoute("staff", "/dashboard/staff"), true);
assert.equal(canAccessRoute("dealer", "/dashboard/staff"), false);
assert.equal(canAccessRoute("dealer", "/dashboard/dealer/AddOrderForm"), true);
assert.equal(canAccessRoute("admin", "/dashboard/dealer/AddOrderForm"), false);
assert.equal(canAccessRoute("staff", "/dashboard/admin/dealer/AddDealerForm"), true, "staff keeps intended add-dealer route");
assert.equal(canAccessRoute("staff", "/dashboard/admin/dealer/225"), true, "staff keeps intended dealer detail route");
assert.equal(canAccessRoute("staff", "/dashboard/admin/ledger"), true, "staff keeps intended ledger route");
assert.equal(canAccessRoute("accountant", "/dashboard/admin/ledger"), true, "accountant keeps intended ledger route");

for (const role of ["admin", "staff", "dealer", "accountant"]) {
  assert.equal(canAccessRoute(role, "/Pages/Ordermanagement"), true, `${role} can open shared order list`);
  assert.equal(canAccessRoute(role, "/orders/123"), true, `${role} can open guarded order detail`);
}

assert.equal(canAccessRoute("dealer", "/Pages/products/addproducts"), false);
assert.equal(canAccessRoute("admin", "/Pages/products/addproducts"), true);
assert.equal(canAccessRoute("staff", "/Pages/Cart"), false);
assert.equal(canAccessRoute("dealer", "/Pages/Cart"), true);
assert.equal(getRoleHome("admin"), "/dashboard/admin");
assert.equal(getRoleHome("staff"), "/dashboard/staff");
assert.equal(getRoleHome("dealer"), "/home");
assert.equal(getRoleHome("accountant"), "/dashboard/accountant");

console.log("roleAccess policy tests passed");
