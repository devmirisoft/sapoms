import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve("src") } });
const { buildCatalogueIndex, findCatalogueEntry, rankCatalogueMatches } = await jiti.import(path.resolve("src/lib/catalogue.ts"));

test("a catalogue number wins over a Postgres DB id that happens to equal it", () => {
  // Real collision: DB product 116 is the hygrometer (code 3038), DB variant 116 is OM557-02-01,
  // and code "116" is the flask. The hygrometer comes first in catalogue order.
  const hygrometer = { id: "116", sku: "3038", name: "Whirling Hygrometers", variants: [{ id: "900", sku: "3038" }] };
  const thermometer = { id: "27", sku: "OM557", name: "Thermometer", variants: [{ id: "116", sku: "OM557-02-01" }] };
  const flask = { id: "107", sku: "116", name: "Boiling Flasks", variants: [{ id: "500", sku: "116/1" }] };
  const index = buildCatalogueIndex([hygrometer, thermometer, flask]);

  assert.equal(findCatalogueEntry(index, "116")?.product.name, "Boiling Flasks");
  assert.equal(findCatalogueEntry(index, "116")?.variant, undefined);
  // Ids still resolve when nothing else claims the key.
  assert.equal(findCatalogueEntry(index, "107")?.product.name, "Boiling Flasks");
  assert.equal(findCatalogueEntry(index, "500")?.variant?.sku, "116/1");
});

test("order-form search: a separator pins the base, exact codes beat substring hits", () => {
  // Real report: "4/4" showed 524/4, 664/4, ... and the 10-row cap hid the burette 4/4 itself.
  const option = (sku, name = "") => ({ searchSku: sku.toLowerCase(), searchText: `${sku} ${name}`.toLowerCase() });
  const options = [
    option("524/4"), option("664/4"), option("164/1"), option("44/1"),
    option("4/1", "Burettes"), option("4/4", "Burettes"),
    option("70/2", "Measuring Cylinders"), option("70/2A"), option("70/2B"),
    option("OM260-020"), option("OM260-045"), option("3225-01", "Hot-plate stirrer"),
  ];
  const skus = (query) => rankCatalogueMatches(options, query).matches.map((o) => o.searchSku);

  assert.deepEqual(skus("4/"), ["4/1", "4/4"]);
  assert.deepEqual(skus("4/4"), ["4/4"]);
  assert.deepEqual(skus("70/2"), ["70/2", "70/2a", "70/2b"]);
  assert.deepEqual(skus("OM260-"), ["om260-020", "om260-045"]);
  assert.equal(rankCatalogueMatches(options, "4/").showAll, true);
  // No separator: same base first, then code prefix, then code contains.
  assert.deepEqual(skus("4").slice(0, 3), ["4/1", "4/4", "44/1"]);
  assert.equal(rankCatalogueMatches(options, "4").showAll, false);
  // No code has the prefix: fall back to name text.
  assert.deepEqual(skus("hot-plate"), ["3225-01"]);
});
