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
  resolveStoredAuth,
  persistAuthenticatedSession,
} = moduleShim.exports;

function storage(values = {}) {
  const map = new Map(Object.entries(values));
  return {
    removed: [],
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    removeItem(key) {
      this.removed.push(key);
      map.delete(key);
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
}

function json(value) {
  return JSON.stringify(value);
}

assert.equal(getAllowedRoles("/Products"), null, "public product route stays public");
assert.equal(resolveStoredAuth(storage()).status, "unauthenticated", "missing auth is not admin");
assert.equal(resolveStoredAuth(storage({ UserData: "{" })).reason, "invalid", "invalid JSON redirects safely");
assert.equal(resolveStoredAuth(storage({ UserData: json({ name: "No Role" }) })).reason, "unsupported-role", "missing role is not admin");
assert.equal(resolveStoredAuth(storage({ UserData: json({ name: "Mystery" }), roletype: "99" })).reason, "unsupported-role", "unknown role is not admin");

assert.equal(resolveStoredAuth(storage({ UserData: json({ name: "A" }), roletype: "3" })).role, "admin");
assert.equal(resolveStoredAuth(storage({ UserData: json({ admin_id: "n1", role: "nsm" }) })).role, "admin");
assert.equal(resolveStoredAuth(storage({ UserData: json({ staff_id: "r1", staff_roletype: "RSM", role: "rsm" }) })).role, "staff");
assert.equal(resolveStoredAuth(storage({ UserData: json({ staff_id: "s1", staff_roletype: "1" }) })).role, "staff");
assert.equal(resolveStoredAuth(storage({ UserData: json({ staff_id: "s2", staff_roletype: "2" }), roletype: "1" })).role, "staff");
assert.equal(resolveStoredAuth(storage({ staffData: json({ staff_id: "s3", staff_roletype: "2" }) })).role, "staff");
assert.equal(resolveStoredAuth(storage({ UserData: json({ Dealer_Id: "d1", Dealer_Name: "D" }) })).role, "dealer");

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

const persistedStorage = storage();
const persisted = persistAuthenticatedSession(persistedStorage, { admin_id: "1", name: "Admin", email: "admin@admin", role: "nsm" });
assert.equal(persisted.role, "admin");
assert.equal(persistedStorage.getItem("status"), "true");
assert.equal(persistedStorage.getItem("roletype"), "3");
assert.equal(JSON.parse(persistedStorage.getItem("UserData")).role, "admin");
assert.equal(JSON.parse(persistedStorage.getItem("AdminData")).email, "admin@admin");
assert.equal(persistedStorage.getItem("accountant_token"), null, "frontend auth sync does not store JWTs");

// Re-persisting an unchanged session must not write: each write fires a
// cross-tab "storage" event that makes other tabs re-fetch /api/auth/me.
const writes = [];
const originalSetItem = persistedStorage.setItem;
persistedStorage.setItem = function (key, value) { writes.push(key); return originalSetItem.call(this, key, value); };
persistedStorage.removed.length = 0;
persistAuthenticatedSession(persistedStorage, { admin_id: "1", name: "Admin", email: "admin@admin", role: "nsm" });
assert.deepEqual(writes, [], "unchanged session writes nothing");
assert.deepEqual(persistedStorage.removed, [], "unchanged session removes nothing");

// A stale key from another role is still cleared.
const staleStorage = storage({ accountant_token: "x", staffData: "{}" });
persistAuthenticatedSession(staleStorage, { admin_id: "1", name: "Admin", email: "admin@admin", role: "nsm" });
assert.equal(staleStorage.getItem("accountant_token"), null);
assert.equal(staleStorage.getItem("staffData"), null);
console.log("roleAccess policy tests passed");
