// Filtering, pagination and authorization for the admin audit-log API.
// The schema parser is exercised for real; the route and repository are checked
// structurally, matching how the rest of this repo tests route wiring.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, "../../../../..");
process.env.PROJ_ROOT ??= ROOT;
register(pathToFileURL(resolvePath(ROOT, "scripts/invoice-ts-loader.mjs")).href);

const route = readFileSync(resolvePath(ROOT, "src/app/api/admin/audit-logs/route.ts"), "utf8");
const repository = readFileSync(resolvePath(HERE, "audit-logs.repository.ts"), "utf8");

const { parseAdminAuditLogListInput } = await import("./audit-logs.schemas.ts");

const parse = (query) => parseAdminAuditLogListInput(new URLSearchParams(query));

// ─── Security ────────────────────────────────────────────────────────────────

test("admin audit logs are gated on ADMIN, not the wider admin-like set", () => {
  assert.match(route, /requireAdminOnly\(\)/);
  assert.equal(/requireAdmin\(\)/.test(route), false, "requireAdmin would also admit the NSM");
});

test("the audit log is read-only through the API", () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    assert.equal(
      new RegExp(`export async function ${method}\\b`).test(route),
      false,
      `${method} would make audit rows mutable from the app`,
    );
  }
});

test("unauthorized callers are answered through the shared error mapper", () => {
  // adminErrorResponse maps Unauthenticated -> 401 and Forbidden -> 403, and
  // withholds the underlying error in production.
  assert.match(route, /adminErrorResponse\(error/);
});

// ─── Filtering ───────────────────────────────────────────────────────────────

test("filters by action and entity, upper-cased", () => {
  const input = parse({ action: "approve", entity: "order" });
  assert.equal(input.action, "APPROVE");
  assert.equal(input.entity, "ORDER");
});

test("filters by actor role and rejects an unknown one", () => {
  assert.equal(parse({ actorRole: "rsm" }).actorRole, "RSM");
  assert.throws(() => parse({ actorRole: "SUPERUSER" }), /Invalid actorRole/);
});

test("filters by a specific record", () => {
  assert.equal(parse({ entityId: "ORD-1042" }).entityId, "ORD-1042");
});

test("date range is parsed and the upper bound covers the whole day", () => {
  const input = parse({ dateFrom: "2026-09-01", dateTo: "2026-09-11" });
  assert.equal(input.dateFrom.toISOString(), "2026-09-01T00:00:00.000Z");
  // A bare date would otherwise land at midnight and hide that day's entries.
  assert.equal(input.dateTo.toISOString(), "2026-09-11T23:59:59.999Z");
});

test("an inverted or invalid date range is rejected", () => {
  assert.throws(() => parse({ dateFrom: "2026-09-11", dateTo: "2026-09-01" }), /dateFrom must not be after dateTo/);
  assert.throws(() => parse({ dateFrom: "not-a-date" }), /Invalid dateFrom/);
});

test("search is carried through and length-capped", () => {
  assert.equal(parse({ search: "  Rahul  " }).search, "Rahul");
  assert.throws(() => parse({ search: "x".repeat(201) }), /Search must not exceed 200 characters/);
});

test("search covers actor, record and action across both naming schemes", () => {
  for (const field of ["actorName", "actorEmail", "entityId", "action", "entity", "eventType"]) {
    assert.match(repository, new RegExp(`${field}: \\{ contains: search, mode: "insensitive" \\}`), field);
  }
});

test("every filter reaches the Prisma where clause", () => {
  assert.match(repository, /if \(input\.action\) and\.push\(\{ action: input\.action \}\)/);
  assert.match(repository, /if \(input\.entity\) and\.push\(\{ entity: input\.entity \}\)/);
  assert.match(repository, /if \(input\.actorRole\) and\.push\(\{ role: input\.actorRole \}\)/);
  assert.match(repository, /if \(input\.entityId\) and\.push\(\{ entityId: input\.entityId \}\)/);
  assert.match(repository, /createdAt: \{[\s\S]*?gte: input\.dateFrom[\s\S]*?lte: input\.dateTo/);
});

// ─── Pagination ──────────────────────────────────────────────────────────────

test("pagination defaults, and the page size is capped", () => {
  const fallback = parse({});
  assert.equal(fallback.page, 1);
  assert.equal(fallback.pageSize, 20);

  assert.equal(parse({ page: "3", limit: "50" }).pageSize, 50);
  assert.equal(parse({ page: "3", limit: "50" }).page, 3);
  // The cap keeps one request from pulling the whole table.
  assert.equal(parse({ limit: "5000" }).pageSize, 100);
});

test("a malformed page is rejected rather than silently defaulted", () => {
  assert.throws(() => parse({ page: "-1" }), /Invalid pagination parameter/);
  assert.throws(() => parse({ page: "abc" }), /Invalid pagination parameter/);
});

test("results are paged in SQL and ordered newest first", () => {
  assert.match(repository, /orderBy: \{ createdAt: "desc" \}/);
  assert.match(repository, /skip,\s*take/);
  assert.match(repository, /paginationToPrisma\(input\)/);
  // findMany + count in one round trip, never a full read into memory.
  assert.match(repository, /prisma\.\$transaction\(\[/);
  assert.match(repository, /authAuditLog\.count\(\{ where \}\)/);
});
