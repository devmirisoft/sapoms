/*
 * Renders a multi-page purchase order and asserts the printed layout holds:
 * nothing outside the page, nothing escaping its footer card, the page-total
 * bar on the item grid, a page counter on every sheet. Catches the drift that
 * is invisible in code review but obvious on paper.
 *
 *   npm run test:invoice-layout            # pass --pdf <path> to keep the file
 */
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, resolve as resolvePath } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.PROJ_ROOT ??= resolvePath(HERE, '..');
register(pathToFileURL(resolvePath(HERE, 'invoice-ts-loader.mjs')).href);

// The generator is browser code; give it just enough of a browser.
globalThis.window ??= globalThis;
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.fetch ??= async () => ({ ok: false, json: async () => ({}) });
globalThis.Image ??= class { set src(_v) { setTimeout(() => this.onerror?.(new Error('no image')), 0); } };

const { generateOrderInvoicePDF } = await import('../src/lib/invoicegenerator.tsx');

const items = Array.from({ length: 42 }, (_, i) => ({
  productId: `p${i}`, catNo: `${10 + i}/${i + 2}`,
  productName: `Beakers, Griffin, Low Form ${i + 1}`,
  quantityPacks: (i % 5) + 1, packSize: 10, totalPieces: ((i % 5) + 1) * 10,
  unitPrice: 75 + i, grossAmount: (75 + i) * ((i % 5) + 1) * 10,
  discountAmount: 0, finalAmount: (75 + i) * ((i % 5) + 1) * 10, unit: 'Pcs.',
}));
const gross = items.reduce((sum, item) => sum + item.grossAmount, 0);

const blob = await generateOrderInvoicePDF({
  __source: 'postgres', order_id: '54', order_date: '2026-08-26T17:35:00',
  order_amount: gross, order_discount: 0, netPayableAmount: gross, grossAmount: gross,
  Dealer_Name: 'LOTUS CORPORATION', orderdata_item_quantity: '176', mtstatus: '1',
  Dealer_Address: 'Plot No. 5, Mahalaxmi Industrial Estate-2 Nr. sikon circle, bamroli road udhna',
  Dealer_City: 'SURAT', gst: '24APLDP5530L1ZW', Dealer_Number: '9979933686',
  Dealer_Email: 'sales@lotus-corp.in', creditdays: '60', items,
});
const bytes = Buffer.from(await blob.arrayBuffer());

const pdfArg = process.argv.indexOf('--pdf');
if (pdfArg > -1 && process.argv[pdfArg + 1]) {
  writeFileSync(process.argv[pdfArg + 1], bytes);
  console.log(`wrote ${process.argv[pdfArg + 1]}`);
}

// ── read the drawn text back out, in mm ──────────────────────────────────────
const PT = 2.834645669, PH = 297, PW = 210;
const FOOT_TOP = PH - 82, CARD_H = 38, SIGN_Y = FOOT_TOP + CARD_H + 9;

const pages = [...bytes.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
  .map((m) => { try { return inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { return m[1]; } })
  .filter((s) => /\bTd\b/.test(s) && /\bTj\b|\bTJ\b/.test(s));

// Walks the operators keeping font + position, so draws that reuse the current
// font are not missed.
const textsOf = (stream) => {
  const out = [];
  let size = 0, x = 0, y = 0;
  const re = /\/F\d+\s+([\d.]+)\s+Tf|([\d.-]+)\s+([\d.-]+)\s+Td|((?:\((?:\\.|[^\\)])*\)\s*)+)\s*(TJ|Tj)/g;
  let m;
  while ((m = re.exec(stream))) {
    if (m[1] !== undefined) { size = Number(m[1]); continue; }
    if (m[2] !== undefined) { x = Number(m[2]) / PT; y = PH - Number(m[3]) / PT; continue; }
    const text = (m[4].match(/\((?:\\.|[^\\)])*\)/g) || [])
      .map((t) => t.slice(1, -1).replace(/\\([()\\])/g, '$1')).join('');
    if (text.trim()) out.push({ size, x, y, text: text.trim() });
  }
  return out;
};

let failures = 0;
const check = (ok, message) => { if (!ok) { failures += 1; console.log(`FAIL  ${message}`); } };

check(pages.length >= 2, `expected a multi-page order, got ${pages.length} page(s)`);

pages.forEach((stream, index) => {
  const page = index + 1;
  const texts = textsOf(stream);
  const isLast = page === pages.length;
  check(texts.length > 20, `page ${page}: only ${texts.length} strings drawn`);

  for (const t of texts) {
    check(t.x >= 8 && t.x <= PW - 6, `page ${page}: "${t.text.slice(0, 30)}" x=${t.x.toFixed(1)} outside the margins`);
    check(t.y >= 6 && t.y <= PH - 8, `page ${page}: "${t.text.slice(0, 30)}" y=${t.y.toFixed(1)} off the page`);
  }

  // The strip between the footer cards and the signature row belongs to
  // neither: anything landing there is a card that has overflowed.
  for (const t of texts.filter((t) => t.y > FOOT_TOP + CARD_H && t.y < SIGN_Y - 1)) {
    check(false, `page ${page}: "${t.text.slice(0, 30)}" escapes its footer card at y=${t.y.toFixed(1)}`);
  }
  check(texts.some((t) => t.text === 'Checked By'), `page ${page}: signature row missing`);

  const total = texts.find((t) => t.text.startsWith('TOTAL'));
  check(!!total, `page ${page}: page-total bar missing`);
  if (total && !isLast) {
    check(Math.abs(total.y - (FOOT_TOP - 11 + 5.2)) < 0.6,
      `page ${page}: total bar at y=${total.y.toFixed(1)} is not pinned to the foot`);
  }

  check(texts.some((t) => t.text === `Page ${page} of ${pages.length}`), `page ${page}: page counter missing`);
  check(texts.some((t) => t.text.startsWith(isLast ? 'ORDER SUMMARY' : 'AMOUNT IN WORDS')),
    `page ${page}: ${isLast ? 'summary' : 'amount in words'} card missing`);

  // Nothing may collide with the continuation pill in the bottom-right.
  if (!isLast) {
    const pill = texts.find((t) => t.text.startsWith('Continued on Page'));
    check(!!pill, `page ${page}: continuation pill missing`);
    if (pill) {
      const clash = texts.find((t) => t !== pill && Math.abs(t.y - pill.y) < 2 && t.x > pill.x - 24);
      check(!clash, `page ${page}: "${clash?.text}" overlaps the continuation pill`);
    }
  }
});

console.log(`pages=${pages.length} checks failed=${failures}`);
if (failures) process.exit(1);
console.log('invoice layout ok');
