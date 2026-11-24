import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const source = await fs.readFile(path.resolve("src/lib/orderDisplay.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { displayOrderNumber, financialYearLabel, formatDisplayOrderNumber, orderNumberSearch, highlightOrderNumber } = await import(
  `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
);

test("financialYearLabel runs April to March in IST", () => {
  assert.equal(financialYearLabel(new Date("2026-11-18T10:00:00+05:30")), "26-27");
  assert.equal(financialYearLabel(new Date("2027-01-01T00:30:00+05:30")), "26-27", "1 January is still FY 26-27");
  assert.equal(financialYearLabel(new Date("2027-03-31T23:59:00+05:30")), "26-27");
  assert.equal(financialYearLabel(new Date("2027-04-01T00:10:00+05:30")), "27-28", "IST midnight, though UTC is still 31 March");
});

test("displayOrderNumber shows the saved number, which app orders build from their row id", () => {
  // After the renumber, row 2263 is OM/26-27/DMS-2263 everywhere.
  assert.equal(displayOrderNumber({ order_id: "2263", order_number: "OM/26-27/DMS-2263" }), "OM/26-27/DMS-2263");
  assert.equal(displayOrderNumber({ orderId: "2263", orderNumber: "OM/26-27/DMS-2263" }), "OM/26-27/DMS-2263");
  assert.equal(displayOrderNumber({ orderdata_orderid: "2263", order_number: "OM/26-27/DMS-2263" }), "OM/26-27/DMS-2263");
  // The saved year wins over the order date and over today.
  assert.equal(displayOrderNumber({ order_number: "OM/26-27/DMS-2263", order_date: "2027-05-01T00:00:00Z" }), "OM/26-27/DMS-2263");
});

test("an old PHP order keeps its look and takes its year from its own date, so it never flips", () => {
  const old = { order_id: "154", order_number: "OM/2026/154", order_date: "2026-09-17T10:27:29+00:00" };
  assert.equal(displayOrderNumber(old), "OM/26-27/DMS-154");
  assert.equal(displayOrderNumber({ ...old, order_date: "2027-02-01T10:00:00+00:00" }), "OM/26-27/DMS-154", "Feb 2027 is FY 26-27");
  assert.equal(displayOrderNumber({ order_id: "2263" }), formatDisplayOrderNumber("2263"));
  assert.equal(displayOrderNumber(null), "");
});

test("no screen builds an order's number from its row id", async () => {
  // The dashboards' Top Orders get the saved number in a field named order_id, so app orders show
  // right; old PHP orders there keep today's label by choice (not touched).
  const savedNumberInOrderId = new Set(["app/dashboard/staff/page.tsx", "app/dashboard/admin/page.tsx"]);
  const files = (await fs.readdir("src", { recursive: true })).filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith("orderDisplay.ts") && !savedNumberInOrderId.has(file));
  const offenders = [];
  for (const file of files) {
    const text = await fs.readFile(path.join("src", file), "utf8");
    for (const match of text.matchAll(/formatDisplayOrderNumber\(\s*[\w.?]*\.(order_id|orderId)\s*\)/g)) {
      const before = text.slice(Math.max(0, match.index - 40), match.index);
      // Allowed: a fallback when no number is saved, and the lookup of invoices saved under the old format.
      if (/(\|\||\?\?)\s*$/.test(before) || /existingNumbers\.has\($/.test(before)) continue;
      offenders.push(`${file}:${text.slice(0, match.index).split("\n").length}`);
    }
  }
  assert.deepEqual(offenders, [], "use displayOrderNumber(order): it shows the saved number, with the order's own year");
});

test("both order creators take the id and the number together, and the old per-year counter is gone", async () => {
  for (const file of ["src/lib/dealerOrderCreate.ts", "src/lib/discountApprovalOrder.ts"]) {
    const text = await fs.readFile(path.resolve(file), "utf8");
    assert.match(text, /const identity = await nextOrderIdentity\(tx\);/, file);
    assert.match(text, /id: identity\.id,\s*orderNumber,/, file);
  }
  const files = (await fs.readdir("src", { recursive: true })).filter((file) => /\.(ts|tsx)$/.test(file));
  for (const file of files) assert.doesNotMatch(await fs.readFile(path.join("src", file), "utf8"), /\borderSequence\b/, file);
});

test("a bare year keeps the old year-year label (account book passes one when it has no date)", () => {
  assert.equal(formatDisplayOrderNumber("154", 2026), "OM/26-27/DMS-154");
  assert.equal(formatDisplayOrderNumber("154", "2027"), "OM/27-28/DMS-154");
});

const MARK = (text) => `<mark class="bg-brand-600 text-white rounded-sm px-0.5">${text}</mark>`;
const sequence = (html) => html.slice(html.lastIndexOf("DMS-") + 4);

test("formatDisplayOrderNumber strips leading zeros and pads to 3 digits", () => {
  assert.equal(sequence(formatDisplayOrderNumber("1")), "001");
  assert.equal(sequence(formatDisplayOrderNumber("02269")), "2269");
  assert.equal(formatDisplayOrderNumber("OM/26-27/DMS-051"), "OM/26-27/DMS-051");
  assert.equal(formatDisplayOrderNumber(""), "");
});

test("orderNumberSearch: zeros-only input does not filter", () => {
  for (const typed of ["", "  ", "0", "00", "000"]) assert.equal(orderNumberSearch(typed), null, JSON.stringify(typed));
});

test("orderNumberSearch: bare numbers are prefixes, padded numbers are exact", () => {
  assert.deepEqual(orderNumberSearch("2269"), { value: "2269", pattern: "2269%" });
  assert.deepEqual(orderNumberSearch("02269"), { value: "2269", pattern: "2269" });
  assert.deepEqual(orderNumberSearch("002"), { value: "2", pattern: "2" });
  assert.deepEqual(orderNumberSearch(" 007 "), { value: "7", pattern: "7" });
  // shorter than the 3-digit display width, so still mid-typing
  assert.deepEqual(orderNumberSearch("02"), { value: "2", pattern: "2%" });
  assert.deepEqual(orderNumberSearch("01"), { value: "1", pattern: "1%" });
});

test("orderNumberSearch escapes LIKE wildcards", () => {
  assert.equal(orderNumberSearch("%").pattern, "\\%%");
  assert.equal(orderNumberSearch("_").pattern, "\\_%");
  assert.equal(orderNumberSearch("\\").pattern, "\\\\%");
});

test("highlightOrderNumber marks the sequence, never mangles the number", () => {
  const exact = highlightOrderNumber("2270", "2270");
  assert.equal(sequence(exact), MARK("2270"));
  assert.doesNotMatch(exact.replace(/<[^>]+>/g, ""), /mark>/, "the old bug rendered DMS-mark>");

  assert.equal(sequence(highlightOrderNumber("02269", "2269")), MARK("2269"));
  assert.equal(sequence(highlightOrderNumber("02269", "02269")), MARK("2269"));
  assert.equal(sequence(highlightOrderNumber("2", "002")), `00${MARK("2")}`);
});

test("highlightOrderNumber leaves the year alone", () => {
  const html = highlightOrderNumber("OM/26-27/DMS-230", "2");
  assert.equal(html, `OM/26-27/DMS-${MARK("2")}30`);
});

test("highlightOrderNumber without a match is the plain display number", () => {
  assert.equal(highlightOrderNumber("230", ""), formatDisplayOrderNumber("230"));
  assert.equal(highlightOrderNumber("230", "9"), formatDisplayOrderNumber("230"));
  assert.equal(highlightOrderNumber("230", "00"), formatDisplayOrderNumber("230"));
});
