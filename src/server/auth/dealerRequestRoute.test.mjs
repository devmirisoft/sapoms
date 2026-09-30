import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const source = await fs.readFile(path.resolve("src/server/auth/sales-scope.ts"), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { resolveDealerRequestRoute } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

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

test("SM/ASM with no RSM above is refused", async () => {
  await assert.rejects(resolveDealerRequestRoute({ role: "ASM", staffId: 3n }, prismaWith(null)), { status: 403 });
});
