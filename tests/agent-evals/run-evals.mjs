// Runs the eval cases against the model in the current AI_* env, with the assistant's tools
// swapped for fixed mock data (no DB). Run on Groq now and on Gemini before switching.
//   npm run agent:evals                          dealer suite (cases.json)
//   npm run agent:evals -- --suite internal      staff/admin suite (cases.internal.json)
//   npm run agent:evals -- [--suite internal] <id>   one case
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.PROJ_ROOT ??= resolvePath(HERE, '../..');
register(pathToFileURL(resolvePath(process.env.PROJ_ROOT, 'scripts/invoice-ts-loader.mjs')).href);

const { dealerTools } = await import('@/lib/agent/tools');
const { internalTools } = await import('@/lib/agent/internalTools');
const { buildSystemPrompt, buildInternalPrompt } = await import('@/lib/agent/prompt');
const { financialYearStart } = await import('@/lib/agent/internalScope');
const { runAgent } = await import('@/lib/agent/loop');
const { MODEL } = await import('@/lib/agent/llm');

// ── Dealer mocks: a tiny catalogue, three orders, one credit account ─────────
const CATALOGUE = {
  'ABC-123': { name: 'Glass Funnel 75 mm', packSize: 10, price: 450, inStock: true },
  'OM285-020': { name: 'PES Syringe Filters, Sterile 4 mm 0.20 µm', packSize: 100, price: 5200, inStock: true },
  'BK-100': { name: 'Beaker, Low Form 100 ml', packSize: 12, price: 600, inStock: true },
  'BK-250': { name: 'Beaker, Low Form 250 ml', packSize: 12, price: 720, inStock: true },
  'BK-500': { name: 'Beaker, Low Form 500 ml', packSize: 6, price: 540, inStock: false },
  'OUT-1': { name: 'Burette 50 ml', packSize: 1, price: 900, inStock: false },
};
const DISCOUNT = 10;
const net = (price) => Math.round(price * (1 - DISCOUNT / 100) * 100) / 100;
const ORDERS = [
  { orderId: 'OM/26-27/DMS-022', date: '2026-08-26', status: 'Dispatched', total: 1500.48, itemCount: 1 },
  { orderId: 'OM/26-27/DMS-019', date: '2026-08-12', status: 'Awaiting approval', total: 9880, itemCount: 2 },
  { orderId: 'OM/26-27/DMS-011', date: '2026-07-30', status: 'Completed', total: 3240, itemCount: 3 },
];

const productMocks = {
  search_products: ({ query, limit = 10 }) => {
    const words = query.toLowerCase().replace(/ml/g, ' ml').split(/\s+/).filter(Boolean);
    const results = Object.entries(CATALOGUE)
      .filter(([id, p]) => words.some((w) => `${id} ${p.name}`.toLowerCase().includes(w.replace(/s$/, ''))))
      .map(([productId, p]) => ({ productId, name: p.name, packSize: p.packSize, inStock: p.inStock }));
    return { results: results.slice(0, limit), hasMore: results.length > limit };
  },
  get_product_details: ({ productId }) => {
    const p = CATALOGUE[productId.toUpperCase()];
    if (!p) return { error: 'PRODUCT_NOT_FOUND', message: `No product with id ${productId}. Use search_products.` };
    return { productId, name: p.name, inStock: p.inStock, packSize: p.packSize, listPricePerPack: p.price, discountPercent: DISCOUNT, netPricePerPack: net(p.price) };
  },
};

const dealerMocks = {
  ...productMocks,
  get_orders: ({ status, fromDate, toDate, limit = 10 }) => {
    const wanted = status?.replace('_', ' ');
    const rows = ORDERS.filter((o) => (!wanted || o.status.toLowerCase() === wanted) && (!fromDate || o.date >= fromDate) && (!toDate || o.date <= toDate));
    return { orders: rows.slice(0, limit), hasMore: false };
  },
  get_order_status: ({ orderId }) => {
    if (!/0?22$/.test(orderId)) return { error: 'ORDER_NOT_FOUND', message: `No order ${orderId} on this account.` };
    return { orderId: 'OM/26-27/DMS-022', date: '2026-08-26', status: 'Dispatched', total: 1500.48, items: [{ productId: 'ABC-123', name: 'Glass Funnel 75 mm', packs: 3, packSize: 10, lineTotal: 1500.48 }], dispatchedOn: '2026-08-29', courier: 'DTDC', trackingNo: 'D12345678' };
  },
  get_ledger_summary: () => ({ accountType: 'credit', creditDays: 30, creditLimit: 100000, temporaryCredit: 0, creditUsed: 57500, creditAvailable: 42500, overdue: false, unpaidBills: 2, unpaidBillsAmount: 18200, lastPaymentDate: '2026-09-20', lastPaymentAmount: 12000 }),
  draft_order: ({ items, customDiscount }) => {
    const problems = items.filter((i) => !CATALOGUE[i.productId]?.inStock).map((i) => `${i.productId} is ${CATALOGUE[i.productId] ? 'out of stock' : 'not in the catalogue'}`);
    if (problems.length) return { error: 'INVALID_ITEMS', message: `${problems.join('; ')}. Use search_products to find valid productIds.` };
    const lines = items.map((i) => ({ productId: i.productId, name: CATALOGUE[i.productId].name, packs: i.packs, packSize: CATALOGUE[i.productId].packSize, packPrice: CATALOGUE[i.productId].price, lineTotal: CATALOGUE[i.productId].price * i.packs }));
    const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const total = net(subtotal);
    return {
      draftId: '00000000-0000-4000-8000-000000000000', expiresAt: new Date(Date.now() + 900_000).toISOString(),
      items: lines, subtotal, discountPercent: DISCOUNT, discount: subtotal - total, slabDiscountPercent: 0, slabDiscount: 0, total,
      ...(customDiscount ? { customDiscount: { asked: customDiscount.percent ? `${customDiscount.percent}% off after your discount` : `₹${customDiscount.amount} off`, totalPercent: 12.7, extraDiscount: 100, totalIfApproved: total - 100, approvers: 'RSM and Admin' } } : {}),
      warnings: [],
    };
  },
};

// ── Internal mocks: two personas, an admin (everything) and a staff member (own dealers) ──
const AMBIGUOUS = { error: 'AMBIGUOUS_DEALER', message: 'Several dealers match. Ask which one (dealer code or id).', matches: [{ dealerId: '17', name: 'Live Dealer', code: 'LD-17', city: 'Delhi' }, { dealerId: '18', name: 'Live Dealer', code: 'LD-18', city: 'Pune' }] };
const isAmbiguous = (ref) => /live dealer/i.test(ref ?? '');
const internalMocks = (persona) => {
  const admin = persona === 'admin';
  return {
    ...productMocks,
    get_product_details: ({ productId }) => {
      const p = CATALOGUE[productId.toUpperCase()];
      return p ? { productId, name: p.name, inStock: p.inStock, packSize: p.packSize, listPricePerPack: p.price } : { error: 'PRODUCT_NOT_FOUND' };
    },
    find_dealers: () => ({ dealers: [
      { dealerId: '47', name: 'Panji dealer 2', code: 'PD-2', city: 'Panji', region: 'West 1', account: 'advance (wallet)', discountPercent: 50, assignedTo: 'SM PANJI' },
      { dealerId: '46', name: 'Panji dealer 1', code: 'PD-1', city: 'Panji', region: 'West 1', account: 'credit, 30 days', discountPercent: 50, assignedTo: 'SM PANJI' },
    ], total: 2, hasMore: false }),
    get_dealer_summary: ({ dealer }) => isAmbiguous(dealer) ? AMBIGUOUS : {
      dealerId: '45', name: 'VKS enterprise', code: 'VKS-01', city: 'Ambala', region: 'North 1', assignedTo: 'SM AMBALA AREA', discountPercent: 50,
      salesThisFinancialYear: { since: '2026-04-01', acceptedOrders: 6, total: 184500, annualTarget: 1000000 },
      account: { accountType: 'credit', creditLimit: 100000, creditAvailable: 22000, overdue: false, unpaidBills: 1, unpaidBillsAmount: 78000 },
      recentOrders: [{ orderId: 'OM/26-27/DMS-040', date: '2026-09-28', status: 'Awaiting approval', total: 12400, itemCount: 2 }],
    },
    find_orders: ({ dealer }) => isAmbiguous(dealer) ? AMBIGUOUS : { orders: [{ orderId: 'OM/26-27/DMS-047', dealer: 'Panji dealer 2', date: '2026-10-04', status: 'Awaiting approval', total: 2600, itemCount: 1 }], hasMore: false },
    get_order: ({ orderId }) => (!admin || !/0?22$/.test(orderId))
      ? { error: 'ORDER_NOT_FOUND', message: `No order ${orderId} that you can access.` }
      : { orderId: 'OM/26-27/DMS-022', dealer: 'Panji dealer 2', date: '2026-08-26', status: 'Dispatched', total: 1500.48, rsmApproval: 'approved', staffAcceptance: 'approved', salesManager: 'SM PANJI', items: [{ productId: 'ABC-123', name: 'Glass Funnel 75 mm', packs: 3, packSize: 10, lineTotal: 1500.48 }], dispatchedOn: '2026-08-29', courier: 'DTDC', trackingNo: 'D12345678' },
    pending_approvals: () => ({
      pending: admin
        ? [{ item: 'Orders awaiting approval', count: 17 }, { item: 'Custom discount requests waiting for you', count: 2 }, { item: 'New dealer requests', count: 1 }]
        : [{ item: 'Orders awaiting approval', count: 3 }],
      oldestAwaitingOrders: [{ orderId: 'OM/26-27/DMS-019', dealer: 'VKS enterprise', date: '2026-08-12', status: 'Awaiting approval', total: 9880, itemCount: 2 }],
      note: 'Approve or decline these in the app; the assistant is read-only.',
    }),
    sales_report: ({ fromDate, toDate, dealer }) => isAmbiguous(dealer) ? AMBIGUOUS : dealer ? {
      from: fromDate ?? null, to: toDate ?? null, granularity: 'month', dealer: 'VKS enterprise', orderCount: 6, total: 184500,
      series: [{ period: '2026-08', total: 84500 }, { period: '2026-09', total: 100000 }],
      note: 'Accepted orders only (approved by RSM and accepted by staff); amounts in whole rupees.',
    } : {
      from: fromDate ?? null, to: toDate ?? null, granularity: 'month', orderCount: admin ? 42 : 7, total: admin ? 1234500 : 98000,
      ...(admin ? { billed: 900000, paid: 650000 } : {}),
      series: [{ period: '2026-08', total: admin ? 600000 : 40000 }, { period: '2026-09', total: admin ? 634500 : 58000 }],
      topDealers: admin
        ? [{ dealer: 'VKS enterprise', orders: 12, total: 450000 }, { dealer: 'Panji dealer 2', orders: 9, total: 310000 }, { dealer: 'test', orders: 8, total: 210000 }]
        : [{ dealer: 'VKS enterprise', orders: 4, total: 60000 }],
      ...(admin ? { byRegion: [{ region: 'North 1', total: 640000 }, { region: 'West 1', total: 420000 }, { region: 'No region', total: 174500 }] } : {}),
      note: 'Accepted orders only (approved by RSM and accepted by staff); amounts in whole rupees.',
      ...(admin && !dealer ? { download: { label: 'Sales report (CSV)', url: '/api/admin/sales-summary?format=csv' } } : {}),
    },
    outstanding_report: () => ({
      totalUnpaid: 305780, totalOverdue: 120500, unpaidBills: 6, overdueBills: 3, dealersWithOverdue: 2,
      dealers: [{ dealer: 'Panji dealer 2', unpaid: 150000, overdue: 90000, bills: 2, oldestBillAgeDays: 64 }, { dealer: 'test', unpaid: 30578, overdue: 30500, bills: 2, oldestBillAgeDays: 54 }],
      hasMore: false, note: "Overdue = unpaid balance past the bill's credit days.",
      ...(admin ? { download: { label: 'Bill ageing (CSV)', url: '/api/reports/bill-ageing?format=csv' } } : {}),
    }),
    product_sales_report: ({ by }) => by === 'category'
      ? { totalRevenue: 950000, categories: [{ category: 'Filters & Membrane', revenue: 420000, packs: 80, products: 6 }, { category: 'Glassware', revenue: 310000, packs: 210, products: 14 }], hasMore: false }
      : { totalRevenue: 950000, products: [{ productId: 'OM285-020', name: 'PES Syringe Filters, Sterile', category: 'Filters & Membrane', packs: 40, pieces: 4000, revenue: 208000 }, { productId: 'ABC-123', name: 'Glass Funnel 75 mm', category: 'Glassware', packs: 120, pieces: 1200, revenue: 54000 }], hasMore: false },
    sales_target: () => ({ target: 5000000, achieved: 1250000, pending: 3750000, dealers: 3, fyStart: '2026-04-01', achievedPercent: 25 }),
  };
};

function withMocks(tools, mocks) {
  return { schemas: tools.schemas, handlers: Object.fromEntries(Object.entries(tools.handlers).map(([name, tool]) => [name, { ...tool, handler: async (args) => mocks[name](args) }])) };
}

const PERSONAS = {
  admin: { actor: { role: 'ADMIN', userId: 1n, profileId: 1n, displayName: 'Eval Admin' }, roleLabel: 'Admin', description: 'You can see every dealer, order, sales and finance figure in the company.' },
  staff: { actor: { role: 'STAFF', userId: 2n, profileId: 2n, staffId: 2n, staffRoleType: '1', displayName: 'Eval Staff' }, roleLabel: 'Sales Manager', description: 'You can see the dealers assigned to you and their orders.' },
};

function setup(suite, testCase) {
  const currentPage = testCase.currentPage ?? '/dashboard';
  if (suite === 'dealer') {
    return { systemPrompt: buildSystemPrompt({ dealerName: 'Eval Dealer', currentPage }), tools: withMocks(dealerTools, dealerMocks), ctx: { dealerId: 0n } };
  }
  const persona = PERSONAS[testCase.persona ?? 'admin'];
  const tools = withMocks(internalTools({ actor: persona.actor }), internalMocks(testCase.persona ?? 'admin'));
  const systemPrompt = buildInternalPrompt({ name: persona.actor.displayName, roleLabel: persona.roleLabel, scopeDescription: persona.description, financialYearStart: financialYearStart(), currentPage, hasTarget: 'sales_target' in tools.handlers });
  return { systemPrompt, tools, ctx: {} };
}

// "Claims the order was placed" — the one thing the dealer assistant must never say.
const NOT_PLACED = String.raw`order (has been|was|is now|is) (successfully )?placed|placed (your|the) order|order placed|i('ve| have) placed`;
const pattern = (source) => new RegExp(source.replace('NOT_PLACED', NOT_PLACED), 'i');

const argv = process.argv.slice(2);
const suite = argv[0] === '--suite' ? argv[1] : 'dealer';
const only = argv[0] === '--suite' ? argv[2] : argv[0];
const file = suite === 'internal' ? 'cases.internal.json' : 'cases.json';
const cases = JSON.parse(readFileSync(resolvePath(HERE, file), 'utf8')).filter((c) => !only || c.id === only);
console.log(`model ${MODEL}, ${suite} suite, ${cases.length} cases\n`);

const failures = [];
for (const testCase of cases) {
  const log = { promptTokens: 0, completionTokens: 0, toolCalls: [] };
  const messages = testCase.messages ?? [{ role: 'user', content: testCase.prompt }];
  let reply = '';
  let downloads = [];
  const problems = [];
  try {
    ({ reply, downloads } = await runAgent({ messages, ...setup(suite, testCase), log }));
  } catch (error) {
    problems.push(`threw: ${error.message}`);
  }
  const called = log.toolCalls.map((t) => t.name);
  if (testCase.expectNone && called.length) problems.push(`expected no tools, called ${called.join(', ')}`);
  if (testCase.expectAny && !testCase.expectAny.some((name) => called.includes(name))) problems.push(`expected one of ${testCase.expectAny.join('/')}, called ${called.join(', ') || 'none'}`);
  for (const name of testCase.forbid ?? []) if (called.includes(name)) problems.push(`must not call ${name}`);
  for (const [name, source] of Object.entries(testCase.argsMustMatch ?? {})) {
    const args = log.toolCalls.filter((t) => t.name === name).map((t) => t.args);
    if (!args.some((a) => pattern(source).test(a))) problems.push(`${name} args ${JSON.stringify(args)} !~ /${source}/`);
  }
  if (testCase.replyMustMatch && !pattern(testCase.replyMustMatch).test(reply)) problems.push(`reply !~ /${testCase.replyMustMatch}/`);
  if (testCase.replyMustNotMatch && pattern(testCase.replyMustNotMatch).test(reply)) problems.push(`reply matched forbidden /${testCase.replyMustNotMatch}/`);
  if (testCase.expectDownload !== undefined && (downloads.length > 0) !== testCase.expectDownload) problems.push(`expected ${testCase.expectDownload ? 'a' : 'no'} download, got ${downloads.length}`);

  const ok = problems.length === 0;
  if (!ok) failures.push({ id: testCase.id, problems, reply });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${testCase.id.padEnd(30)} tools: ${called.join(', ') || '-'}  (${log.promptTokens + log.completionTokens} tok)`);
  if (!ok) console.log(`      ${problems.join('\n      ')}\n      reply: ${reply.replace(/\s+/g, ' ').slice(0, 300)}`);
}

console.log(`\n${cases.length - failures.length}/${cases.length} passed on ${MODEL} (${suite})`);
process.exit(failures.length ? 1 : 0);
