import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

async function read(file) {
  return fs.readFile(file, "utf8");
}

test("password change time is persisted on the user schema", async () => {
  const schema = await read("prisma/schema.prisma");
  assert.match(schema, /passwordUpdatedAt\s+DateTime\?/);
  assert.match(schema, /password_updated_at/);
});

test("dealer password route is dealer-only, verifies and invalidates sessions", async () => {
  const route = await read("src/app/api/dealer/password/route.ts");
  assert.match(route, /requireRole\("DEALER"\)/);
  assert.match(route, /verifyPassword\(currentPassword/);
  assert.match(route, /tokenVersion: \{ increment: 1 \}/);
  assert.match(route, /authSession\.updateMany/);
  assert.match(route, /eventType: "DEALER_PASSWORD_CHANGED"/);
});

test("dealer profile PATCH can no longer change a password", async () => {
  const route = await read("src/app/api/dealer/profile/route.ts");
  assert.doesNotMatch(route, /passwordHash/);
  assert.doesNotMatch(route, /hashPassword/);
});

test("root layout mounts the dealer password gate", async () => {
  const layout = await read("src/app/layout.tsx");
  assert.match(layout, /<DealerPasswordGate \/>/);
});

test("password gate waits for the terms gate", async () => {
  const gate = await read("src/components/password/DealerPasswordGate.tsx");
  assert.match(gate, /isSet\(dealer\?\.termsAcceptedAt\)/);
  assert.match(gate, /!isSet\(updatedAt \?\? dealer\?\.passwordUpdatedAt\)/);
});
