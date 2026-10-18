import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve("src") } });
const { buildCatalogueIndex, findCatalogueEntry } = await jiti.import(path.resolve("src/lib/catalogue.ts"));

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
