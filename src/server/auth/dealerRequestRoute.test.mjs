import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const source = await fs.readFile(path.resolve("src/server/auth/sales-scope.ts"), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { resolveDealerRequestRoute, coversRsmStage, coversNsmStage, onBehalfName } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const prismaWith = (parentRsm) => ({ staffProfile: { findUnique: async () => ({ parentRsm }) } });
const rsm = prismaWith({ userId: 7n });

test("RSM goes straight to admin", async () => {
  assert.deepEqual(await resolveDealerRequestRoute({ role: "RSM", staffId: 1n }, rsm), { status: "pending", rsmUserId: null });
});

test("Sales Manager and ASM go to their RSM first", async () => {
  for (const actor of [{ role: "STAFF", staffRoleType: "1", staffId: 2n }, { role: "STAFF", staffId: 2n }, { role: "ASM", staffId: 3n }]) {
    assert.deepEqual(await resolveDealerRequestRoute(actor, rsm), { status: "rsm_pending", rsmUserId: 7n });
  }
});

test("plain Staff and non-sales roles cannot raise", async () => {
  for (const role of [{ role: "STAFF", staffRoleType: "2", staffId: 4n }, { role: "ACCOUNTANT" }, { role: "DEALER" }]) {
    await assert.rejects(resolveDealerRequestRoute(role, rsm), { status: 403 });
  }
});

test("SM/ASM with no RSM above waits unrouted at the RSM stage (NSM/Admin covers it)", async () => {
  assert.deepEqual(await resolveDealerRequestRoute({ role: "ASM", staffId: 3n }, prismaWith(null)), { status: "rsm_pending", rsmUserId: null });
});

test("NSM covers a missing RSM; Admin covers only when there is no active NSM", async () => {
  const nsms = (count) => ({ user: { count: async () => count } });
  assert.equal(await coversRsmStage({ role: "NSM" }, nsms(1)), true);
  assert.equal(await coversRsmStage({ role: "ADMIN" }, nsms(1)), false);
  assert.equal(await coversRsmStage({ role: "ADMIN" }, nsms(0)), true);
  assert.equal(await coversRsmStage({ role: "RSM" }, nsms(0)), false);
  assert.equal(await coversNsmStage({ role: "ADMIN" }, nsms(0)), true);
  assert.equal(await coversNsmStage({ role: "ADMIN" }, nsms(1)), false);
  assert.equal(await coversNsmStage({ role: "NSM" }, nsms(0)), false);
  assert.equal(onBehalfName({ role: "NSM", displayName: "Susheel", email: "s@x" }, "RSM"), "Susheel (NSM, on behalf of unavailable RSM)");
});
