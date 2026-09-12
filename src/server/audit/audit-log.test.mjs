// Exercises the row createAuditLog builds, with a fake transaction client
// standing in for Prisma so no database is needed.
import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, "../../..");
process.env.PROJ_ROOT ??= ROOT;
register(pathToFileURL(resolvePath(ROOT, "scripts/invoice-ts-loader.mjs")).href);

const { createAuditLog } = await import("./audit-log.ts");

function fakeTx() {
  const rows = [];
  return { rows, authAuditLog: { create: async ({ data }) => { rows.push(data); return data; } } };
}

const ACTOR = {
  userId: 42n,
  role: "ADMIN",
  sessionId: "session-abc",
  displayName: "Rahul",
  email: "rahul@example.com",
};

test("creates an audit record through the caller's transaction", async () => {
  const tx = fakeTx();
  await createAuditLog({ tx, actor: ACTOR, action: "APPROVE", entity: "ORDER", entityId: "ORD-1042" });

  assert.equal(tx.rows.length, 1);
});

test("stores actor information in its own columns", async () => {
  const tx = fakeTx();
  await createAuditLog({ tx, actor: ACTOR, action: "APPROVE", entity: "ORDER", entityId: "ORD-1042" });
  const [row] = tx.rows;

  assert.equal(row.actorId, 42n);
  assert.equal(row.actorName, "Rahul");
  assert.equal(row.actorEmail, "rahul@example.com");
  assert.equal(row.role, "ADMIN");
  assert.equal(row.sessionId, "session-abc");
  // Kept for the readers that predate the actor columns.
  assert.equal(row.metadata.userId, "42");
});

test("stores action, entity and record", async () => {
  const tx = fakeTx();
  await createAuditLog({ tx, actor: ACTOR, action: "STATUS_CHANGE", entity: "DEALER", entityId: 77 });
  const [row] = tx.rows;

  assert.equal(row.action, "STATUS_CHANGE");
  assert.equal(row.entity, "DEALER");
  assert.equal(row.entityId, "77", "numeric ids are normalised to strings");
  assert.equal(row.eventType, "DEALER_STATUS_CHANGE");
});

test("an explicit eventType is preserved for the legacy names", async () => {
  const tx = fakeTx();
  await createAuditLog({ tx, actor: ACTOR, action: "LOGIN", entity: "USER", eventType: "LOGIN_SUCCEEDED" });

  assert.equal(tx.rows[0].eventType, "LOGIN_SUCCEEDED");
});

test("stores old and new values", async () => {
  const tx = fakeTx();
  await createAuditLog({
    tx,
    actor: ACTOR,
    action: "STATUS_CHANGE",
    entity: "ORDER",
    entityId: "ORD-1042",
    oldValues: { status: "AWAITING_ACCEPTANCE" },
    newValues: { status: "ACCEPTED" },
  });
  const [row] = tx.rows;

  assert.deepEqual(row.oldValues, { status: "AWAITING_ACCEPTANCE" });
  assert.deepEqual(row.newValues, { status: "ACCEPTED" });
});

test("sanitizes values on the way in", async () => {
  const tx = fakeTx();
  await createAuditLog({
    tx,
    actor: ACTOR,
    action: "UPDATE",
    entity: "STAFF",
    entityId: "9",
    newValues: { passwordHash: "$2b$10$realhash", email: "staff@example.com" },
    metadata: { apiKey: "sk_live_123" },
  });
  const [row] = tx.rows;

  assert.equal(row.newValues.passwordHash, "[redacted]");
  assert.equal(row.newValues.email, "staff@example.com");
  assert.equal(row.metadata.apiKey, "[redacted]");

  // actorId is a BigInt column, so only the JSON-bound fields are serialized.
  const persistedJson = JSON.stringify({ old: row.oldValues, new: row.newValues, metadata: row.metadata });
  assert.equal(persistedJson.includes("$2b$10$realhash"), false);
  assert.equal(persistedJson.includes("sk_live_123"), false);
});

test("handles a missing actor, as a failed login has none", async () => {
  const tx = fakeTx();
  await createAuditLog({ tx, action: "LOGIN_FAILED", entity: "USER", metadata: { loginIdentifier: "nobody@example.com" } });
  const [row] = tx.rows;

  assert.equal(row.actorId, null);
  assert.equal(row.actorName, null);
  assert.equal(row.role, null);
  assert.equal(row.metadata.loginIdentifier, "nobody@example.com");
});

test("an unrecognised role is dropped rather than written to the enum column", async () => {
  const tx = fakeTx();
  await createAuditLog({ tx, actor: { ...ACTOR, role: "SUPERUSER" }, action: "UPDATE", entity: "DEALER", entityId: "1" });

  assert.equal(tx.rows[0].role, null);
});
