// Behavioural tests, not source-text assertions: this module is the thing that
// keeps credentials out of a table admins can read, so it has to be exercised.
// Loaded through the repo's existing TS loader (see scripts/verify-invoice-layout.mjs).
import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, "../../..");
process.env.PROJ_ROOT ??= ROOT;
register(pathToFileURL(resolvePath(ROOT, "scripts/invoice-ts-loader.mjs")).href);

const { sanitizeAuditValues, diffValues, isSensitiveKey, REDACTED } = await import(
  "./audit-sanitize.ts"
);

const SECRET_FIELDS = [
  "password",
  "passwordHash",
  "accessToken",
  "refreshToken",
  "sessionToken",
  "secret",
  "apiKey",
];

test("every sensitive field name is recognised", () => {
  for (const field of SECRET_FIELDS) {
    assert.equal(isSensitiveKey(field), true, field);
  }
});

test("sensitive fields are redacted at the top level", () => {
  const input = Object.fromEntries(SECRET_FIELDS.map((f) => [f, "super-secret-value"]));
  const output = sanitizeAuditValues({ ...input, email: "dealer@example.com" });

  for (const field of SECRET_FIELDS) {
    assert.equal(output[field], REDACTED, field);
  }
  assert.equal(output.email, "dealer@example.com");
  assert.equal(JSON.stringify(output).includes("super-secret-value"), false);
});

test("sensitive fields are redacted when nested and inside arrays", () => {
  const output = sanitizeAuditValues({
    user: { profile: { passwordHash: "hunter2", name: "Rahul" } },
    sessions: [{ refreshToken: "rt_live_abc" }, { sessionToken: "st_live_def" }],
  });

  assert.equal(output.user.profile.passwordHash, REDACTED);
  assert.equal(output.user.profile.name, "Rahul");
  assert.equal(output.sessions[0].refreshToken, REDACTED);
  assert.equal(output.sessions[1].sessionToken, REDACTED);

  const serialized = JSON.stringify(output);
  for (const leaked of ["hunter2", "rt_live_abc", "st_live_def"]) {
    assert.equal(serialized.includes(leaked), false, leaked);
  }
});

test("case and separator variants are still caught", () => {
  const output = sanitizeAuditValues({
    PASSWORD: "x",
    Api_Key: "x",
    "api-key": "x",
    AccessToken: "x",
    dbCredential: "x",
  });
  for (const key of Object.keys(output)) {
    assert.equal(output[key], REDACTED, key);
  }
});

test("BigInt and Date become JSON-safe values", () => {
  const output = sanitizeAuditValues({
    id: 42n,
    createdAt: new Date("2026-09-11T10:42:00.000Z"),
  });
  assert.equal(output.id, "42");
  assert.equal(output.createdAt, "2026-09-11T10:42:00.000Z");
  assert.doesNotThrow(() => JSON.stringify(output));
});

test("cyclic structures do not blow the stack", () => {
  const node = { name: "order" };
  node.self = node;
  assert.doesNotThrow(() => sanitizeAuditValues(node));
  assert.equal(sanitizeAuditValues(node).self, "[circular]");
});

test("empty and nullish input collapses to null", () => {
  assert.equal(sanitizeAuditValues(null), null);
  assert.equal(sanitizeAuditValues(undefined), null);
  assert.equal(sanitizeAuditValues({}), null);
});

// ─── diffValues ──────────────────────────────────────────────────────────────

test("diffValues keeps only the fields that changed", () => {
  const { oldValues, newValues } = diffValues(
    { status: "PENDING", discount: 10, dealerId: 7 },
    { status: "APPROVED", discount: 15, dealerId: 7 },
  );

  assert.deepEqual(oldValues, { status: "PENDING", discount: 10 });
  assert.deepEqual(newValues, { status: "APPROVED", discount: 15 });
  assert.equal("dealerId" in oldValues, false);
});

test("diffValues returns null when nothing changed", () => {
  const { oldValues, newValues } = diffValues({ status: "ACCEPTED" }, { status: "ACCEPTED" });
  assert.equal(oldValues, null);
  assert.equal(newValues, null);
});

test("diffValues reports fields added or removed", () => {
  const { oldValues, newValues } = diffValues({ note: "old" }, { cancelReason: "stock" });
  assert.deepEqual(oldValues, { note: "old", cancelReason: null });
  assert.deepEqual(newValues, { note: null, cancelReason: "stock" });
});

test("diffValues never emits a secret even when it changed", () => {
  const { oldValues, newValues } = diffValues(
    { passwordHash: "old-hash", status: "ACTIVE" },
    { passwordHash: "new-hash", status: "SUSPENDED" },
  );

  assert.equal(oldValues.passwordHash, REDACTED);
  assert.equal(newValues.passwordHash, REDACTED);
  assert.equal(oldValues.status, "ACTIVE");
  assert.equal(newValues.status, "SUSPENDED");

  const serialized = JSON.stringify({ oldValues, newValues });
  assert.equal(serialized.includes("old-hash"), false);
  assert.equal(serialized.includes("new-hash"), false);
});

test("diffValues compares BigInt and Date by value, not identity", () => {
  const unchanged = diffValues(
    { id: 5n, at: new Date("2026-01-01T00:00:00.000Z") },
    { id: 5n, at: new Date("2026-01-01T00:00:00.000Z") },
  );
  assert.equal(unchanged.oldValues, null);

  const changed = diffValues({ id: 5n }, { id: 6n });
  assert.deepEqual(changed.oldValues, { id: "5" });
  assert.deepEqual(changed.newValues, { id: "6" });
});
