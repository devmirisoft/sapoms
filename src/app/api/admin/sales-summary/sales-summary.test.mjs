import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/admin/sales-summary/route.ts", "utf8");
const page = readFileSync("src/app/dashboard/admin/page.tsx", "utf8");
const staffRepo = readFileSync("src/server/modules/admin/staff/staff.repository.ts", "utf8");
const staffSchemas = readFileSync("src/server/modules/admin/staff/staff.schemas.ts", "utf8");
const segmented = readFileSync("src/components/SegmentedTabs.tsx", "utf8");

test("sales summary counts only orders both the RSM and the staff accepted", () => {
  assert.match(route, /rsmApprovalStatus: "ACCEPTED"/);
  assert.match(route, /acceptanceStatus: "ACCEPTED"/);
  assert.match(route, /status: \{ notIn: \["CANCELLED", "DECLINED"\] \}/);
  assert.match(route, /\.\.\.\(from \? \{ gte: from \} : \{\}\), \.\.\.\(to \? \{ lte: to \} : \{\}\)/);
});

test("sales summary scopes by region and by the selected ASM's own assigned states", () => {
  assert.match(route, /where: \{ id: asmId, user: \{ role: "ASM" \} \}/);
  assert.match(route, /select: \{ displayName: true, assignedStates: true \}/);
  // An ASM with no assigned states must scope to nothing, not to everything.
  assert.match(route, /state: \{ in: asm\?\.assignedStates \?\? \[\] \}/);
  assert.match(route, /\.\.\.\(region \? \{ region \} : \{\}\)/);
});

test("sales summary buckets by day for short ranges and by month for long ones", () => {
  assert.match(route, /spanTo\.getTime\(\) - spanFrom\.getTime\(\) <= 62 \* DAY_MS \? "day" : "month"/);
  assert.match(route, /periodKey\(order\.orderDate, granularity\)/);
});

test("staff list can be filtered down to ASMs so the dropdown can page them in", () => {
  assert.match(staffSchemas, /roleParam === "NSM" \|\| roleParam === "ASM"/);
  assert.match(staffRepo, /input\.role === "ASM"[\s\S]*\? \{ user: \{ role: "ASM" \}/);
  assert.match(page, /useInfiniteQuery/);
  assert.match(page, /\/api\/admin\/staff\?role=ASM/);
  assert.match(segmented, /onLoadMore/);
  assert.match(segmented, /scrollHeight - menu\.scrollTop - menu\.clientHeight < 48/);
});

test("the region, ASM and city filters cascade", () => {
  // An ASM holds no region of its own, so it is matched through its parent RSM.
  assert.match(staffRepo, /parentRsm: \{ salesRegion: input\.salesRegion \}/);
  assert.match(staffSchemas, /SALES_REGION_OPTIONS\.find\(\(option\) => option\.value === regionParam\)/);
  assert.match(page, /\/api\/admin\/staff\?role=ASM&region=\$\{saleRegion\}/);
  assert.match(page, /setSaleRegion\(next\); setSaleAsm\(""\); setSaleCity\(""\)/);
  assert.match(page, /setSaleAsm\(next\); setSaleCity\(""\)/);
});

test("the ASM dropdown names the states each ASM handles", () => {
  assert.match(segmented, /sublabel\?: string;/);
  assert.match(page, /sublabel: states \|\| "No states assigned"/);
});

test("sales can be narrowed to one city of the selected scope", () => {
  assert.match(route, /city: \{ equals: city, mode: "insensitive" as const \}/);
  assert.match(page, /const saleCityOptions = useMemo/);
  assert.match(page, /label="City"/);
});

test("the date fields reach back to the oldest record in scope", () => {
  assert.match(route, /_min: \{ orderDate: true \}/);
  assert.match(route, /earliest: oldest\._min\.orderDate/);
  assert.match(page, /min=\{saleEarliest\} max=\{saleTo\}/);
  assert.match(page, /min=\{saleFrom\} max=\{today\}/);
  assert.match(page, /All time/);
});

test("no picked range means all time", () => {
  assert.match(route, /if \(!raw\) return null;/);
  assert.match(route, /Object\.keys\(range\)\.length \? \{ orderDate: range \} : \{\}/);
  assert.match(page, /const \[saleFrom, setSaleFrom\] = useState\(""\)/);
  assert.match(page, /const \[saleTo, setSaleTo\] = useState\(""\)/);
  assert.match(page, /onClick=\{\(\) => \{ setSaleFrom\(""\); setSaleTo\(""\); \}\}/);
});

test("the report downloads the same scope the tile is showing", () => {
  assert.match(route, /params\.get\("format"\) === "csv"/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /"Order No", "Order Date", "Dealer", "Dealer Code", "City", "State", "Region",/);
  assert.match(route, /"RSM", "ASM", "Sales Manager", "Amount \(INR\)"/);
  // Region, ASM and city each fall back to their "all" label when nothing is picked.
  assert.match(route, /region \? formatSalesRegionLabel\(region\) : "All regions"/);
  assert.match(route, /asmId === null \? "All ASMs" : "Unknown ASM"/);
  assert.match(route, /city \|\| "All cities"/);
  assert.match(route, /: "All time"/);
  assert.match(page, /format=csv/);
  assert.match(page, /const saleQuery = /);
});

test("dashboard drops the sale, exposure and top-exposure tiles for the sale chart", () => {
  assert.doesNotMatch(page, /Today&apos;s Sale/);
  assert.doesNotMatch(page, /Credit Exposure/);
  assert.doesNotMatch(page, /exposure-list/);
  assert.match(page, /Sale Chart/);
  assert.match(page, /type="date"/);
  assert.match(page, /metrics-left/);
});
