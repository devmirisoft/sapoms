// node scripts/verify-date-input.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.PROJ_ROOT ??= resolvePath(HERE, '..');
register(pathToFileURL(resolvePath(HERE, 'invoice-ts-loader.mjs')).href);

const { toDisplay, toIso } = await import('@/components/ui/date-input');

assert.equal(toDisplay('2026-09-12'), '12/09/2026');
assert.equal(toDisplay(''), '');
assert.equal(toIso('12/09/2026'), '2026-09-12');
assert.equal(toIso('1/9/2026'), '2026-09-01');
assert.equal(toIso('29/02/2024'), '2024-02-29');
assert.equal(toIso('31/02/2026'), '');
assert.equal(toIso('09/12/2026'), '2026-12-09'); // dd/mm, never mm/dd
assert.equal(toIso('garbage'), '');
console.log('date-input ok');
