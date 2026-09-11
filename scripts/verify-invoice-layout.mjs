/*
 * Fills the purchase-order templates the way the browser does and asserts the
 * result: the right sheet for the item count, every token replaced, every line
 * item present exactly once, and the totals wired to the right slots.
 *
 * The rasterising step (html2canvas -> jsPDF) needs a real browser and is not
 * covered here; this checks everything that decides what lands on the page.
 *
 *   npm run test:invoice-layout        # pass --html <path> to keep the markup
 */
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, '..');
process.env.PROJ_ROOT ??= ROOT;
register(pathToFileURL(resolvePath(HERE, 'invoice-ts-loader.mjs')).href);

// The generator is browser code; give it just enough of a browser.
globalThis.window ??= globalThis;
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.fetch ??= async () => ({ ok: false, json: async () => ({}) });

const { buildInvoiceTemplateData, flattenUnpaintableCss } = await import('../src/lib/invoicegenerator.tsx');
const { fillInvoiceTemplate, ROWS_PER_ITEMS_SHEET } = await import('../src/lib/invoiceTemplate.ts');

const templates = {
  purchase1: readFileSync(resolvePath(ROOT, 'public/data/purchase1.html'), 'utf8'),
  purchase2: readFileSync(resolvePath(ROOT, 'public/data/purchase2.html'), 'utf8'),
};

const makeItems = (count) => Array.from({ length: count }, (_, i) => ({
  productId: `p${i}`, catNo: `${10 + i}/${i + 2}`,
  productName: `Beakers, Griffin, Low Form 100 mL ${i + 1}`,
  quantityPacks: (i % 5) + 1, packSize: 10, totalPieces: ((i % 5) + 1) * 10,
  unitPrice: 75 + i, grossAmount: (75 + i) * ((i % 5) + 1) * 10,
  discountAmount: 0, finalAmount: (75 + i) * ((i % 5) + 1) * 10, unit: 'Pcs.',
  // Only some items carry a note, so both branches of the cell get exercised.
  productNote: i % 3 === 0 ? `Ship in the ${i + 1}st week` : '',
}));

const render = async (items, overrides = {}) => {
  const gross = items.reduce((sum, item) => sum + item.grossAmount, 0);
  const { data, sheet } = await buildInvoiceTemplateData({
    __source: 'postgres', order_id: '54', order_date: '2026-08-26T17:35:00',
    order_amount: gross, order_discount: 0, netPayableAmount: gross, grossAmount: gross,
    Dealer_Name: 'LOTUS CORPORATION', orderdata_item_quantity: '176', mtstatus: '1',
    Dealer_Address: 'Plot No. 5, Mahalaxmi Industrial Estate-2 Nr. sikon circle, bamroli road udhna',
    Dealer_City: 'SURAT', gst: '24APLDP5530L1ZW', Dealer_Number: '9979933686',
    Dealer_Email: 'sales@lotus-corp.in', creditdays: '60', items, ...overrides,
  });
  return { data, sheet, html: fillInvoiceTemplate(templates[sheet], data) };
};

let failures = 0;
const check = (ok, message) => { if (!ok) { failures += 1; console.log(`FAIL  ${message}`); } };

const count = (html, needle) => html.split(needle).length - 1;

const inspect = (name, { data, sheet, html }, expectedSheet, expectedPages) => {
  check(sheet === expectedSheet, `${name}: expected the ${expectedSheet} sheet, got ${sheet}`);

  // Nothing may reach the page as an unresolved slot or a repeat marker.
  const leftovers = html.match(/\{\{[A-Z0-9_]+\}\}/g);
  check(!leftovers, `${name}: unfilled tokens ${leftovers?.join(', ')}`);
  check(!/<!--\/?(ROW|TOTAL_ROW|ITEMS_PAGE)-->/.test(html), `${name}: repeat markers left in the markup`);

  const pages = count(html, '<div class="page">');
  check(pages === expectedPages, `${name}: expected ${expectedPages} sheet(s), got ${pages}`);
  // purchase2 is a single sheet and carries no page counter, by design.
  if (templates[sheet].includes('class="page-number"')) {
    check(count(html, 'class="page-number"') === pages, `${name}: a sheet is missing its page number`);
    check(count(html, `of ${pages}</div>`) === pages, `${name}: page counter does not read "of ${pages}"`);
  }

  // Every line item, once, in order, with its own values.
  // A note rides under its own product, bold and italic; a blank one adds nothing.
  data.rows.forEach((row) => {
    const note = row.productNote
      ? `<br><span style="font-style: italic; font-weight: 700;">${row.productNote}</span>`
      : '';
    const cell = `<td>${row.description}${note}</td>`;
    check(count(html, cell) === 1,
      `${name}: cell for "${row.description}" appears ${count(html, cell)} times (note: ${row.productNote || 'none'})`);
  });
  const noted = data.rows.filter((row) => row.productNote).length;
  check(count(html, 'font-style: italic; font-weight: 700;') === noted,
    `${name}: expected ${noted} bold-italic product notes`);
  check(count(html, '<td>100mL</td>') === data.rows.length, `${name}: capacity column not filled on every row`);
  check(count(html, 'TOTAL</td>') === 1, `${name}: expected exactly one grid total row`);

  // Field wiring.
  check(html.includes('LOTUS CORPORATION'), `${name}: customer name missing`);
  check(html.includes('24APLDP5530L1ZW'), `${name}: GST missing`);
  check(html.includes('sales@lotus-corp.in'), `${name}: email missing`);
  check(html.includes('Net 60 days from the date of invoice.'), `${name}: payment terms missing`);
  check(html.includes(data.docNo), `${name}: document number missing`);
  check(html.includes(data.netAmount), `${name}: net amount missing`);
  check(html.includes('Rupees Only'), `${name}: amount in words missing`);

  // The design's own CSS must survive untouched.
  check(html.includes('<style>') && html.includes('.line-items-table'),
    `${name}: template stylesheet missing`);
  return html;
};

// ── Long order: cover sheet plus one items sheet per chunk ──────────────────
const long = await render(makeItems(42));
const longHtml = inspect('purchase1', long, 'purchase1', 1 + Math.ceil(42 / ROWS_PER_ITEMS_SHEET));
check(longHtml.includes('Order Remarks'), 'purchase1: cover-sheet remarks cell missing');
check(longHtml.includes('Items Details on next Page'), 'purchase1: continuation divider missing');
check(longHtml.includes('Continued from Page 1'), 'purchase1: continuation note missing');
check(count(longHtml, 'class="line-items-table"') === Math.ceil(42 / ROWS_PER_ITEMS_SHEET),
  'purchase1: one item grid per items sheet expected');
check(longHtml.indexOf('Order Summary') < longHtml.indexOf('class="line-items-table"'),
  'purchase1: the summary belongs on the cover sheet, before the grid');
// Signatures sit on the cover sheet only. They used to be hidden from the items
// sheet by an nth-child rule, which html2canvas cannot honour once it clones a
// sheet on its own, so the block must be absent from the markup instead.
check(count(longHtml, 'class="signature-section"') === 1,
  `purchase1: expected signatures on the cover sheet only, found ${count(longHtml, 'class="signature-section"')}`);
check(!/\.page:(nth-child|first-child|not)/.test(templates.purchase1),
  'purchase1: positional .page rules do not survive html2canvas cloning');

// ── Short order: everything on one sheet ────────────────────────────────────
const short = await render(makeItems(6));
const shortHtml = inspect('purchase2', short, 'purchase2', 1);
check(shortHtml.includes('class="remarks-input"'), 'purchase2: remarks panel missing');
check(shortHtml.includes('class="summary-box"'), 'purchase2: summary panel missing');
check(!shortHtml.includes('Continued from Page 1'), 'purchase2: unexpected continuation note');

// The switch itself: 8 items stay on one sheet, 9 split.
check((await render(makeItems(8))).sheet === 'purchase2', 'switch: 8 items should use purchase2');
check((await render(makeItems(9))).sheet === 'purchase1', 'switch: 9 items should use purchase1');

// Dealer data is user input and must not be able to inject markup.
const injected = await render(makeItems(3), { Dealer_Name: '<script>alert(1)</script>' });
check(!injected.html.includes('<script>alert(1)</script>'), 'escaping: dealer name reached the page as markup');
check(injected.html.includes('&lt;script&gt;'), 'escaping: dealer name was not escaped');

// ── html2canvas cannot paint `background-clip: text` ────────────────────────
// Without the flattening pass the gradient fills the whole heading box and the
// text lands on top of it in the same green, so the PDF shows an unreadable
// bar where the template shows lettering.
{
  const el = (computed) => {
    const applied = {};
    return {
      computed,
      applied,
      style: {
        set background(v) { applied.background = v; },
        set color(v) { applied.color = v; },
        setProperty: (k, v) => { applied[k] = v; },
      },
    };
  };
  const gradient = 'linear-gradient(90deg, rgb(2, 214, 97) 0%, rgb(24, 217, 216) 100%)';
  const titled = el({ webkitBackgroundClip: 'text', backgroundImage: gradient, color: 'rgb(4, 212, 105)' });
  const bare = el({ webkitBackgroundClip: 'text', backgroundImage: gradient, color: 'rgba(0, 0, 0, 0)' });
  const plain = el({ webkitBackgroundClip: 'border-box', backgroundImage: gradient, color: 'rgb(0, 0, 0)' });
  const nodes = [titled, bare, plain];
  flattenUnpaintableCss({ querySelectorAll: () => nodes }, { getComputedStyle: (node) => node.computed });

  check(titled.applied.background === 'none', 'flatten: gradient background not cleared off the heading');
  check(titled.applied['-webkit-text-fill-color'] === 'rgb(4, 212, 105)',
    `flatten: heading kept transparent fill (${titled.applied['-webkit-text-fill-color']})`);
  check(bare.applied['-webkit-text-fill-color'] === 'rgb(2, 214, 97)',
    `flatten: a colourless heading should borrow the gradient's first stop, got ${bare.applied['-webkit-text-fill-color']}`);
  check(Object.keys(plain.applied).length === 0, 'flatten: touched an element html2canvas can paint');
}

const htmlArg = process.argv.indexOf('--html');
if (htmlArg > -1 && process.argv[htmlArg + 1]) {
  const base = process.argv[htmlArg + 1].replace(/\.html$/i, '');
  writeFileSync(`${base}-purchase1.html`, longHtml);
  writeFileSync(`${base}-purchase2.html`, shortHtml);
  console.log(`wrote ${base}-purchase1.html and ${base}-purchase2.html`);
}

console.log(`purchase1=${long.sheet} purchase2=${short.sheet} checks failed=${failures}`);
if (failures) process.exit(1);
console.log('invoice templates ok');
