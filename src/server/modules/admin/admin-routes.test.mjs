import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiAdminRoot = join(here, "../../../app/api/admin");
const serverAdminRoot = here;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

test("new admin API routes use the shared admin guard", () => {
  const routeFiles = walk(apiAdminRoot).filter((file) => file.endsWith("route.ts"));
  for (const file of routeFiles) {
    const source = readFileSync(file, "utf8");
    // requireAdminOnly is requireAdmin plus the ADMIN-only check, so either
    // one means the route is guarded.
    assert.match(source, /requireAdmin\(|requireAdminOnly\(/, file);
  }
});

test("new admin backend does not import legacy PHP or MongoDB clients", () => {
  const files = [...walk(apiAdminRoot), ...walk(serverAdminRoot)].filter((file) => /\.(ts|tsx)$/.test(file));
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("@/lib/mongodb"), false, file);
    assert.equal(source.includes("php-client"), false, file);
    assert.equal(source.includes("php-compat"), false, file);
  }
});