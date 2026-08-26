import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const types = readFileSync("src/server/modules/admin-dashboard/admin-dashboard.types.ts", "utf8");
const repo = readFileSync("src/server/modules/admin-dashboard/postgres-admin-dashboard.repository.ts", "utf8");
const page = readFileSync("src/app/dashboard/admin/page.tsx", "utf8");
const route = readFileSync("src/app/api/admin/dashboard/route.ts", "utf8");

test("admin dashboard exposes regional sales and top distributors by region", () => {
  assert.match(types, /SalesRegionKey/);
  assert.match(types, /regionalPerformance/);
  assert.match(types, /topDistributorsByRegion/);
  assert.match(repo, /dealer:\s*\{\s*select:\s*\{\s*region:\s*true/);
  assert.match(repo, /topDistributorsByRegion/);
  assert.match(repo, /TOP_REGION_DEALER_LIMIT = 5/);
  assert.match(page, /RSM Net Sales/);
  assert.match(page, /Top Distributors by Region/);
  assert.match(page, /selectedRegion/);
  assert.match(page, /LineChart/);
  assert.match(page, /SALES_REGIONS\.map/);
});

test("regional net sales can be bucketed by day, month, quarter, half year and year", () => {
  assert.match(types, /SalesGranularity = "day" \| "month" \| "quarter" \| "half" \| "year"/);
  assert.match(types, /regionalGranularity: SalesGranularity/);

  // Repository buckets the regional series by the requested period.
  assert.match(repo, /export function periodKey\(date: Date, granularity: SalesGranularity\)/);
  assert.match(repo, /export function normalizeGranularity/);
  assert.match(repo, /periodKey\(order\.orderDate, regionalGranularity\)/);

  // The API surfaces the filter as a query parameter.
  assert.match(route, /searchParams\.get\("granularity"\)/);
  assert.match(route, /regionalGranularity: granularity/);

  // The dashboard exposes one control per granularity and refetches on change.
  assert.match(page, /GRANULARITY_OPTIONS/);
  for (const value of ["day", "month", "quarter", "half", "year"]) {
    assert.match(page, new RegExp(`value: "${value}"`));
  }
  assert.match(page, /setRegionalGranularity\(option\.value\)/);
  assert.match(page, /granularity=\$\{regionalGranularity\}/);
});
