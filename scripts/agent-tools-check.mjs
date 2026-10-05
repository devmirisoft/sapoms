// Runs the agent's read tools against the real catalogue + DB (no LLM).
// Run: npm run agent:tools-check   (AGENT_CHECK_DEALER_ID picks the dealer, default 1)
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.PROJ_ROOT ??= resolvePath(HERE, '..');
register(pathToFileURL(resolvePath(HERE, 'invoice-ts-loader.mjs')).href);

const { toolSchemas, toolHandlers } = await import('@/lib/agent/tools');
const ctx = { dealerId: BigInt(process.env.AGENT_CHECK_DEALER_ID ?? 1) };

async function call(name, args) {
  const tool = toolHandlers[name];
  return tool.handler(tool.argsSchema.parse(args), ctx);
}

assert.deepEqual(toolSchemas.map((s) => s.function.name), ['search_products', 'get_product_details', 'get_orders', 'get_order_status', 'get_ledger_summary', 'draft_order']);
// dealerId is never a tool argument: it only ever comes from the session.
assert.ok(toolSchemas.every((s) => !/"dealer_?id"/i.test(JSON.stringify(s.function.parameters))));

const search = await call('search_products', { query: 'PES syringe filter sterile', limit: 5 });
console.log('search_products', search);
assert.ok(search.results.length > 0 && search.results.length <= 5);
assert.ok(search.results.every((r) => r.productId && r.name && r.packSize >= 1));
assert.ok(!('price' in search.results[0]), 'search must not leak prices');

const bySku = await call('search_products', { query: 'OM285-020' });
assert.equal(bySku.results[0].productId, 'OM285-020');

// Syringe filters are priced per pack in the catalogue: list price per pack = catalogue price.
const details = await call('get_product_details', { productId: 'OM285-020' });
console.log('get_product_details', details);
assert.equal(details.packSize, 100);
assert.equal(details.listPricePerPack, 5200);
assert.equal(details.netPricePerPack, Math.round(5200 * (1 - details.discountPercent / 100) * 100) / 100);

const parent = await call('get_product_details', { productId: 'OM285' });
assert.ok(parent.variants.length > 0 && parent.variants.every((v) => v.productId));

assert.equal((await call('get_product_details', { productId: 'NOPE-404' })).error, 'PRODUCT_NOT_FOUND');
assert.throws(() => toolHandlers.search_products.argsSchema.parse({ query: 'x', limit: 50 }));

console.log('agent tools check: OK');
process.exit(0);
