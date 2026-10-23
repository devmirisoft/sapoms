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

test("password route is dealer/staff-only, verifies and invalidates sessions", async () => {
  const route = await read("src/app/api/dealer/password/route.ts");
  assert.match(route, /requireRole\(\["DEALER", "STAFF", "RSM", "ASM"\]\)/);
  assert.match(route, /verifyPassword\(currentPassword/);
  assert.match(route, /tokenVersion: \{ increment: 1 \}/);
  assert.match(route, /authSession\.updateMany/);
  assert.match(route, /"DEALER_PASSWORD_CHANGED" : "STAFF_PASSWORD_CHANGED"/);
});

test("staff profile carries the password change time", async () => {
  const mapper = await read("src/server/auth/legacy-auth.mapper.ts");
  const staff = mapper.slice(mapper.indexOf("export function mapStaffProfile"), mapper.indexOf("export function mapDealerProfile"));
  assert.match(staff, /passwordUpdatedAt: user\.passwordUpdatedAt\?\.toISOString\(\) \?\? ""/);
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

test("password gate covers staff and waits for the dealer terms gate", async () => {
  const gate = await read("src/components/password/DealerPasswordGate.tsx");
  assert.match(gate, /auth\.session\.role !== "dealer" && auth\.session\.role !== "staff"/);
  assert.match(gate, /user\?\.role !== "dealer" \|\| isSet\(user\?\.termsAcceptedAt\)/);
  assert.match(gate, /!isSet\(updatedAt \?\? user\?\.passwordUpdatedAt\)/);
});
