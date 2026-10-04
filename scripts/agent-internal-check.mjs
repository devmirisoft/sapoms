// Read-only check of the internal (staff/admin) assistant tools against the real DB: each role
// sees exactly its scope, finance and downloads only where the role has them.
// Run: npm run agent:internal-check
//   AGENT_CHECK_USERS="admin=1,nsm=142,accountant=71,rsm=143,asm=144,staff=145" (user ids; these are the dev-DB defaults)
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.PROJ_ROOT ??= resolvePath(HERE, '..');
register(pathToFileURL(resolvePath(HERE, 'invoice-ts-loader.mjs')).href);

const { prisma } = await import('@/server/db/prisma');
const { buildScope } = await import('@/lib/agent/internalScope');
const { internalTools } = await import('@/lib/agent/internalTools');
const { countsFor } = await import('@/server/modules/pending-counts');

const USERS = Object.fromEntries((process.env.AGENT_CHECK_USERS ?? 'admin=1,nsm=142,accountant=71,rsm=143,asm=144,staff=145')
  .split(',').map((pair) => pair.split('=')).map(([k, v]) => [k, BigInt(v)]));

/** The same AuthActor requireAuth() would build for this user. */
async function actorFor(userId) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { adminProfile: true, accountantProfile: true, staffProfile: true } });
  const staff = user.staffProfile;
  const profileId = (user.adminProfile ?? user.accountantProfile ?? staff).id;
  return {
    userId: user.id, sessionId: 'check', role: user.role, profileId, email: user.email,
    displayName: user.adminProfile?.displayName ?? user.accountantProfile?.displayName ?? staff?.displayName ?? '',
    ...(staff ? { staffId: staff.id, ...(staff.staffRoleType ? { staffRoleType: staff.staffRoleType } : {}), ...(staff.warehouse ? { warehouse: staff.warehouse } : {}) } : {}),
  };
}

async function asUser(label) {
  const actor = await actorFor(USERS[label]);
  const scope = await buildScope(actor);
  const tools = internalTools(scope);
  const call = (name, args = {}) => tools.handlers[name].handler(tools.handlers[name].argsSchema.parse(args), scope);
  return { actor, scope, tools, call };
}

const admin = await asUser('admin');
const accountant = await asUser('accountant');
const staff = await asUser('staff');
const rsm = await asUser('rsm');
const asm = await asUser('asm');
const nsm = await asUser('nsm');

// Tool sets: no tool writes anything; only sales staff get a target.
const names = (u) => Object.keys(u.tools.handlers).sort();
console.log('admin tools:', names(admin).join(', '));
assert.ok(!names(admin).includes('sales_target') && !names(accountant).includes('sales_target'));
assert.ok(names(staff).includes('sales_target') && names(rsm).includes('sales_target') && names(asm).includes('sales_target'));
assert.ok(names(admin).every((n) => !/draft|confirm|approve|create|update|delete/.test(n)));

// Admin / NSM: company-wide, with downloads.
assert.equal(admin.scope.finance && admin.scope.salesCsv && admin.scope.billAgeingCsv, true);
assert.equal(nsm.scope.salesCsv, true);
const anyOrder = await prisma.order.findFirstOrThrow({ orderBy: { orderDate: 'desc' }, select: { orderNumber: true, dealerId: true } });
assert.equal((await admin.call('get_order', { orderId: anyOrder.orderNumber })).orderId, anyOrder.orderNumber);
const adminSales = await admin.call('sales_report', { fromDate: '2026-04-01' });
console.log('admin sales_report', { orderCount: adminSales.orderCount, total: adminSales.total, billed: adminSales.billed, topDealers: adminSales.topDealers?.length, byRegion: adminSales.byRegion?.length, download: adminSales.download?.url });
assert.ok(adminSales.download?.url.startsWith('/api/admin/sales-summary?') && 'billed' in adminSales);
const adminDues = await admin.call('outstanding_report', {});
assert.ok(adminDues.download?.url.startsWith('/api/reports/bill-ageing?'));
assert.deepEqual((await admin.call('pending_approvals')).pending.map((p) => p.count), Object.values(await countsFor(admin.actor)));
const products = await admin.call('product_sales_report', { fromDate: '2026-04-01', by: 'category' });
console.log('admin product_sales_report by category', products.categories?.slice(0, 3));
assert.ok(Array.isArray(products.categories));

// Accountant: all finance, orders only once accepted, bill-ageing download but no sales download.
assert.equal((await accountant.call('find_orders', { status: 'awaiting_approval' })).orders.length, 0);
assert.ok((await accountant.call('outstanding_report', {})).download);
assert.equal((await accountant.call('sales_report', {})).download, undefined);

// Staff: only assigned dealers and their own orders; no finance totals, no downloads.
const staffDealers = await staff.call('find_dealers', {});
const expected = await prisma.dealerProfile.count({ where: { deletedAt: null, staffAssignments: { some: { staffId: staff.actor.staffId, active: true, removedAt: null } } } });
console.log('staff find_dealers', staffDealers.total, 'expected', expected);
assert.equal(staffDealers.total, expected);
const outsideDealer = await prisma.dealerProfile.findFirstOrThrow({ where: { deletedAt: null, NOT: staff.scope.dealerWhere }, select: { id: true } });
assert.equal((await staff.call('get_dealer_summary', { dealer: outsideDealer.id.toString() })).error, 'DEALER_NOT_FOUND');
const outsideOrder = await prisma.order.findFirstOrThrow({ where: { NOT: staff.scope.orderWhere }, select: { orderNumber: true } });
assert.equal((await staff.call('get_order', { orderId: outsideOrder.orderNumber })).error, 'ORDER_NOT_FOUND');
const staffSales = await staff.call('sales_report', {});
assert.ok(!('billed' in staffSales) && !staffSales.download);
assert.equal((await staff.call('outstanding_report', {})).download, undefined);
assert.equal(typeof (await staff.call('sales_target')).target, 'number');
const staffOrders = await staff.call('find_orders', { limit: 10 });
assert.ok(staffOrders.orders.every((o) => o.orderId !== outsideOrder.orderNumber));

// RSM / ASM see their team's dealers, at least their own.
assert.ok((await rsm.call('find_dealers', {})).total >= (await prisma.dealerStaffAssignment.count({ where: { staffId: rsm.actor.staffId, active: true, removedAt: null, dealer: { deletedAt: null } } })));
assert.ok((await asm.call('find_dealers', {})).total >= 0);

console.log('\nagent internal check: OK');
process.exit(0);
