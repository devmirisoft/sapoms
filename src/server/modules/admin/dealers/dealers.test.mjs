import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

test("admin dealer repository is PostgreSQL-only", () => {
  const source = readFileSync(new URL("./dealers.repository.ts", import.meta.url), "utf8");
  assert.equal(source.includes("php"), false);
  assert.equal(source.includes("mongodb"), false);
  assert.equal(source.includes("getDb"), false);
});
test("admin dealer repository can scope dealer lists to one assigned staff member", () => {
  const source = readFileSync(new URL("./dealers.repository.ts", import.meta.url), "utf8");
  assert.match(source, /staffAssignments:\s*\{\s*some:\s*\{\s*staffId:\s*BigInt\(input\.staffId\),\s*active:\s*true/);
  assert.match(source, /filters\.length === 1 \? base : \{ AND: filters \}/);
});

test("admin dealer repository applies dealer list column filters on the server", () => {
  const repo = readFileSync(new URL("./dealers.repository.ts", import.meta.url), "utf8");
  const schemas = readFileSync(new URL("./dealers.schemas.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../../../../app/dashboard/admin/dealer/DealerList/page.tsx", import.meta.url), "utf8");

  for (const param of ["city", "name", "email", "phone"]) {
    assert.match(page, new RegExp(`params\\.set\\("${param}"`));
    assert.match(schemas, new RegExp(`${param}: listText`));
  }

  assert.match(repo, /city: \{ equals: input\.city, mode: "insensitive" \}/);
  assert.match(repo, /businessName: \{ contains: input\.name, mode: "insensitive" \}/);
  assert.match(repo, /user: \{ email: \{ contains: input\.email, mode: "insensitive" \} \}/);
  assert.match(repo, /phone: \{ contains: input\.phone, mode: "insensitive" \}/);
});

test("dealers can sign in with either their username or their email", () => {
  const schemas = readFileSync(new URL("./dealers.schemas.ts", import.meta.url), "utf8");
  const repo = readFileSync(new URL("./dealers.repository.ts", import.meta.url), "utf8");
  const provider = readFileSync(new URL("../../../auth/providers/postgres-auth.provider.ts", import.meta.url), "utf8");

  // The admin form's Dealer_Username reaches the user row instead of being replaced by the email.
  assert.match(schemas, /username: body\.username \?\? body\.Dealer_Username/);
  assert.match(repo, /const username = input\.username \|\| normalizedEmail;/);
  assert.match(repo, /username, normalizedUsername: username/);
  // A custom username survives an email change.
  assert.match(repo, /if \(current\.user\.normalizedUsername === current\.user\.normalizedEmail\)/);
  // Both identifiers are accepted at login.
  assert.match(provider, /\{ normalizedEmail: normalized \}/);
  assert.match(provider, /\{ normalizedUsername: normalized \}/);
});
