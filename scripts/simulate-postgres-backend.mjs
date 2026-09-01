import { PrismaClient } from './prisma.mjs';
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);
const tag = `SIM-${Date.now()}`;
const password = `${tag}-Password123!`;
const port = Number(process.env.SIM_PORT || 3107);
const baseUrl = process.env.SIM_BASE_URL || `http://127.0.0.1:${port}`;
const useExistingServer = !!process.env.SIM_BASE_URL;
const isProductionUrl = /prod|production|vercel\.app|omsons/i.test(process.env.DATABASE_URL || "") && !process.env.SIM_ALLOW_PRODUCTION;

const results = [];
const state = { cookies: new Map(), server: null, ids: {}, details: [] };

function bigintJson(_key, value) { return typeof value === "bigint" ? value.toString() : value; }
function moneyPaise(rupees) { return BigInt(Math.round(Number(rupees) * 100)); }
function addResult(name, pass, detail = {}) { results.push({ name, pass: !!pass, detail }); }
function failDetail(step, expected, actual, extra = {}) { return { step, expected, actual, ...extra }; }
function cookieHeader() { return Array.from(state.cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; "); }
function captureCookies(response) {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) return;
  for (const part of setCookie.split(/,(?=\s*[^;,]+=)/)) {
    const [pair] = part.trim().split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) state.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}
async function api(method, url, { json, form, headers = {}, auth = true } = {}) {
  const init = { method, headers: { ...headers } };
  if (auth && cookieHeader()) init.headers.cookie = cookieHeader();
  if (json !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(json, bigintJson);
  }
  if (form) init.body = form;
  const response = await fetch(`${baseUrl}${url}`, init);
  captureCookies(response);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, ok: response.ok, body };
}
async function hashPassword(raw) {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(raw, salt, 64);
  return `scrypt:${salt}:${derived.toString("hex")}`;
}
function normalizeEmail(email) { return String(email).trim().toLowerCase(); }
async function seedUser(role, email, displayName, profile = {}) {
  const user = await prisma.user.create({
    data: { email, normalizedEmail: normalizeEmail(email), passwordHash: await hashPassword(password), role, status: "ACTIVE" },
  });
  if (role === "ADMIN") await prisma.adminProfile.create({ data: { userId: user.id, displayName, phone: profile.phone || null } });
  if (role === "STAFF") await prisma.staffProfile.create({ data: { userId: user.id, displayName, designation: profile.designation || null, staffRoleType: profile.staffRoleType || "1" } });
  return user;
}
async function login(email) {
  state.cookies.clear();
  return api("POST", "/api/auth/login", { json: { email, password }, auth: false });
}
async function waitForServer() {
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/auth/me`, { signal: AbortSignal.timeout(1500) });
      if (res.status === 401 || res.ok) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error(`Next server did not become ready at ${baseUrl}`);
}
async function startServer() {
  if (useExistingServer) return;
  state.server = spawn(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(port)], {
    cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "development" }, windowsHide: true,
  });
  state.server.stdout.on("data", (chunk) => process.env.SIM_VERBOSE && process.stdout.write(chunk));
  state.server.stderr.on("data", (chunk) => process.env.SIM_VERBOSE && process.stderr.write(chunk));
  await waitForServer();
}
async function cleanup() {
  const emails = [`admin-${tag}@example.test`, `staff-${tag}@example.test`, `unassigned-${tag}@example.test`, `dealer-${tag}@example.test`, `other-${tag}@example.test`, `inactive-${tag}@example.test`].map(normalizeEmail);
  const users = await prisma.user.findMany({ where: { normalizedEmail: { in: emails } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const dealers = await prisma.dealerProfile.findMany({ where: { OR: [{ businessName: { startsWith: tag } }, { dealerCode: { startsWith: tag.slice(0, 12) } }, { userId: { in: userIds } }] }, select: { id: true, userId: true } });
  const dealerIds = dealers.map((d) => d.id);
  const staff = await prisma.staffProfile.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const staffIds = staff.map((s) => s.id);
  const orders = await prisma.order.findMany({ where: { OR: [{ refNo: { contains: tag } }, { note: { contains: tag } }, { dealerId: { in: dealerIds } }] }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  const drafts = await prisma.orderDraft.findMany({ where: { OR: [{ name: { contains: tag } }, { dealerId: { in: dealerIds } }] }, select: { id: true } });
  const draftIds = drafts.map((d) => d.id);
  const productVariants = await prisma.productVariant.findMany({ where: { OR: [{ sku: { contains: tag } }, { catalogueNumber: { contains: tag } }] }, select: { id: true, productId: true } });
  const productIds = Array.from(new Set(productVariants.map((v) => v.productId)));
  await prisma.authAuditLog.deleteMany({ where: { metadata: { path: ["userId"], in: userIds.map(String) } } }).catch(() => undefined);
  const cleanupOps = [
    prisma.walletTransaction.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { dealerId: { in: dealerIds } }] } }),
    prisma.customDiscountReorderLog.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { dealerId: { in: dealerIds } }] } }),
    prisma.customDiscountRequest.deleteMany({ where: { OR: [{ dealerId: { in: dealerIds } }, { orderDraftId: { in: draftIds } }, { orderId: { in: orderIds } }] } }),
    prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }),
    prisma.order.deleteMany({ where: { id: { in: orderIds } } }),
    prisma.draftCart.deleteMany({ where: { dealerId: { in: dealerIds } } }),
    prisma.orderDraft.deleteMany({ where: { OR: [{ id: { in: draftIds } }, { dealerId: { in: dealerIds } }] } }),
    prisma.dealerStaffAssignment.deleteMany({ where: { OR: [{ dealerId: { in: dealerIds } }, { staffId: { in: staffIds } }] } }),
    prisma.dealerRequest.deleteMany({ where: { OR: [{ dealerName: { startsWith: tag } }, { contactEmail: { in: emails } }, { dealerCode: { contains: tag.slice(-6) } }] } }),
    prisma.dealerWallet.deleteMany({ where: { dealerId: { in: dealerIds } } }),
    prisma.dealerProfile.deleteMany({ where: { id: { in: dealerIds } } }),
    prisma.staffProfile.deleteMany({ where: { id: { in: staffIds } } }),
    prisma.adminProfile.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.authSession.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    prisma.productVariant.deleteMany({ where: { id: { in: productVariants.map((v) => v.id) } } }),
    prisma.product.deleteMany({ where: { id: { in: productIds } } }),
    prisma.productCategory.deleteMany({ where: { name: { startsWith: tag } } }),
  ];
  for (const op of cleanupOps) {
    await op.catch((error) => {
      if (error?.code !== 'P2021') throw error;
    });
  }
}
async function staticIsolationScan() {
  const migrated = [
    "src/app/api/auth/login/route.ts", "src/app/api/auth/me/route.ts", "src/app/api/dealer-code/route.ts",
    "src/app/api/dealer-requests/route.ts", "src/app/api/dealer-requests/[id]/route.ts",
    "src/app/api/drafts/route.ts", "src/app/api/drafts/[id]/route.ts", "src/app/api/draft-cart/route.ts",
    "src/app/api/custom-discount-requests/route.ts", "src/app/api/custom-discount-requests/[id]/route.ts", "src/app/api/custom-discount-requests/[id]/reorder-log/route.ts",
    "src/app/api/dealer-order/route.ts", "src/app/api/orders-data/route.ts", "src/app/api/order-access/[id]/route.ts",
    "src/app/api/admin/orders/route.ts", "src/app/api/admin/orders/[orderId]/route.ts", "src/lib/orderHeaders.ts", "src/lib/orderAccess.ts",
    "src/lib/postgresDiscountDrafts.ts", "src/lib/postgresDealerRequests.ts", "src/lib/postgresOrders.ts",
  ];
  const mongoTokens = [/mongodb/i, /MongoClient/, /getDb\b/, /MONGODB_URI/];
  const mongoHits = [];
  for (const file of migrated) {
    let source = "";
    try { source = await fs.readFile(path.resolve(file), "utf8"); } catch { continue; }
    for (const token of mongoTokens) if (token.test(source)) mongoHits.push(`${file}:${token}`);
  }
  return { mongoHits };
}
async function main() {
  if (isProductionUrl) throw new Error("Refusing to run simulation against production-like DATABASE_URL. Set SIM_ALLOW_PRODUCTION=1 only if this is intentional.");
  await cleanup().catch(() => undefined);
  await startServer();

  const adminEmail = `admin-${tag}@example.test`;
  const staffEmail = `staff-${tag}@example.test`;
  const unassignedStaffEmail = `unassigned-${tag}@example.test`;
  const dealerEmail = `dealer-${tag}@example.test`;
  const otherDealerEmail = `other-${tag}@example.test`;
  const admin = await seedUser("ADMIN", adminEmail, `${tag} Admin`);
  const staffUser = await seedUser("STAFF", staffEmail, `${tag} Staff`);
  const unassignedUser = await seedUser("STAFF", unassignedStaffEmail, `${tag} Unassigned Staff`);
  const staffProfile = await prisma.staffProfile.findUniqueOrThrow({ where: { userId: staffUser.id } });
  const unassignedProfile = await prisma.staffProfile.findUniqueOrThrow({ where: { userId: unassignedUser.id } });

  let adminOk = false;
  try {
    const loginRes = await login(adminEmail);
    const me = await api("GET", "/api/auth/me");
    const dash = await api("GET", "/api/admin/dashboard");
    const staffList = await api("GET", `/api/admin/staff?search=${encodeURIComponent(tag)}`);
    adminOk = loginRes.ok && me.ok && dash.ok && staffList.ok;
    addResult("Auth", loginRes.ok && me.ok, failDetail("admin login + me", "200", `${loginRes.status}/${me.status}`, { response: me.body }));
    addResult("Admin", adminOk, failDetail("admin dashboard/staff", "200", `${dash.status}/${staffList.status}`, { response: dash.body }));
  } catch (error) { addResult("Auth", false, failDetail("admin auth", "success", error.message)); addResult("Admin", false, failDetail("admin dashboard", "success", error.message)); }

  const category = await prisma.productCategory.create({ data: { name: `${tag} Category`, slug: `${tag.toLowerCase()}-category` } });
  const product = await prisma.product.create({ data: { name: `${tag} Product`, productCode: `${tag}-PROD`, categoryId: category.id } });
  const variant = await prisma.productVariant.create({ data: { productId: product.id, sku: `${tag}-SKU`, catalogueNumber: `${tag}-CAT`, unitName: "Pack", packSize: 5, unitPricePaise: moneyPaise(10), packPricePaise: moneyPaise(50) } });
  const productVerify = await api("GET", `/api/admin/products?search=${encodeURIComponent(tag)}`);
  addResult("Products", productVerify.ok, failDetail("admin product list", "created product visible", productVerify.status, { response: productVerify.body }));

  const codeRes = await api("GET", "/api/dealer-code", { headers: { "x-omsons-actor-role": "STAFF", "x-omsons-actor-id": String(staffProfile.id) } });
  const dealerCode = String(codeRes.body?.data?.dealerCode || codeRes.body?.dealerCode || "0001").padStart(4, "0").slice(-4);
  const dealerSnapshot = { name: `${tag} Dealer`, dealerCode, email: dealerEmail, username: `dealer-${tag}`, password, whatsapp: "9999999999", address: `${tag} Address`, city: "Sim City", pincode: "110001", gstNo: "SIMGSTIN", discount: "10", creditDays: "30", annualTarget: "100000", currentLimit: "0", assignedStaffIds: [String(staffProfile.id)], staffNames: staffProfile.displayName };
  const createReq = await api("POST", "/api/dealer-requests", { json: { role: "staff", actorId: String(staffProfile.id), actorName: staffProfile.displayName, formSnapshot: dealerSnapshot }, auth: false });
  const requestId = String(createReq.body?.data?.id || createReq.body?.data?._id || "");
  const readReq = await api("GET", `/api/dealer-requests/${requestId}?role=admin&actorId=${admin.id}&actorName=${encodeURIComponent(tag)}`, { auth: false });
  const acceptReq = await api("PATCH", `/api/dealer-requests/${requestId}`, { json: { role: "admin", actorId: String(admin.id), actorName: `${tag} Admin`, action: "accept" }, auth: false });
  const accepted = await prisma.dealerRequest.findUnique({ where: { id: BigInt(requestId || 0) } }).catch(() => null);
  const dealer = accepted?.createdDealerId ? await prisma.dealerProfile.findUnique({ where: { id: BigInt(accepted.createdDealerId) }, include: { user: true, staffAssignments: true } }) : null;
  state.ids.dealerId = dealer?.id;
  addResult("Dealer onboarding", !!(createReq.ok && readReq.ok && acceptReq.ok && dealer && accepted?.status === "accepted"), failDetail("dealer request accept", "accepted request + User + DealerProfile", `${createReq.status}/${readReq.status}/${acceptReq.status}`, { create: createReq.body, read: readReq.body, accept: acceptReq.body }));
  addResult("Dealer assignment", !!dealer?.staffAssignments?.some((a) => a.staffId === staffProfile.id), failDetail("assignment", "assigned staff profile", dealer?.staffAssignments || null));

  const otherUser = await prisma.user.create({ data: { email: otherDealerEmail, normalizedEmail: normalizeEmail(otherDealerEmail), passwordHash: await hashPassword(password), role: "DEALER", status: "ACTIVE", dealerProfile: { create: { businessName: `${tag} Other Dealer`, dealerCode: `${dealerCode}X`.slice(0, 50) } } } });
  const otherDealer = await prisma.dealerProfile.findUniqueOrThrow({ where: { userId: otherUser.id } });

  const dealerLogin = await login(dealerEmail);
  const dealerMe = await api("GET", "/api/auth/me");
  addResult("Dealer login", dealerLogin.ok && dealerMe.ok && String(dealerMe.body?.data?.Dealer_Id || dealerMe.body?.data?.id) === String(dealer?.id), failDetail("dealer login/me", "dealer profile identity", `${dealerLogin.status}/${dealerMe.status}`, { response: dealerMe.body }));

  const rows = [{ key: 1, productname: variant.catalogueNumber, displayName: product.name, variantCode: variant.catalogueNumber, producQuanity: 10, quantityPacks: 2, packSize: 5, price: 999, productNote: `${tag} product note` }];
  const draftCreate = await api("POST", "/api/drafts", { json: { dealer_id: String(dealer.id), name: `${tag} Draft`, rows, shipto: `${tag} ship`, refno: `${tag} ref`, order_note: `${tag} order note` }, headers: { "x-omsons-actor-role": "DEALER", "x-omsons-actor-id": String(dealer.id) } });
  const draftId = String(draftCreate.body?.data?.id || "");
  const draftRead = await api("GET", `/api/drafts/${draftId}?dealer_id=${dealer.id}`, { headers: { "x-omsons-actor-role": "DEALER", "x-omsons-actor-id": String(dealer.id) } });
  const draftUpdate = await api("PUT", `/api/drafts/${draftId}`, { json: { dealer_id: String(dealer.id), name: `${tag} Draft Updated`, rows }, headers: { "x-omsons-actor-role": "DEALER", "x-omsons-actor-id": String(dealer.id) } });
  const wrongDraft = await api("GET", `/api/drafts/${draftId}?dealer_id=${otherDealer.id}`, { auth: false, headers: { "x-omsons-actor-role": "DEALER", "x-omsons-actor-id": String(otherDealer.id) } });
  addResult("Draft", draftCreate.ok && draftRead.ok && draftUpdate.ok && wrongDraft.status === 404, failDetail("draft CRUD + ownership", "201/200/200/404", `${draftCreate.status}/${draftRead.status}/${draftUpdate.status}/${wrongDraft.status}`, { response: wrongDraft.body }));

  const cart1 = await api("POST", "/api/draft-cart", { auth: false, json: { dealer_id: String(dealer.id), items: rows }, headers: { "x-omsons-actor-role": "DEALER", "x-omsons-actor-id": String(dealer.id) } });
  const cartRead = await api("GET", `/api/draft-cart?dealer_id=${dealer.id}`, { auth: false, headers: { "x-omsons-actor-role": "DEALER", "x-omsons-actor-id": String(dealer.id) } });
  const cart2 = await api("POST", "/api/draft-cart", { auth: false, json: { dealer_id: String(dealer.id), items: [{ ...rows[0], producQuanity: 15 }] }, headers: { "x-omsons-actor-role": "DEALER", "x-omsons-actor-id": String(dealer.id) } });
  const draftCartOk = cart1.ok && cartRead.ok && cart2.ok;
  addResult("Draft cart", draftCartOk, failDetail("draft cart CRUD", "success", `${cart1.status}/${cartRead.status}/${cart2.status}`, { response: cart2.body }));

  const discountPayload = { dealer_id: String(dealer.id), orderDraftId: draftId, discountScope: "order", requestedDiscountPercent: 20, currentDiscountPercent: 10, shipto: `${tag} ship`, refno: `${tag} ref`, orderSnapshot: { orderNote: `${tag} order note`, products: [{ productKey: variant.catalogueNumber.toLowerCase(), sku: variant.sku, catalogueNumber: variant.catalogueNumber, productName: product.name, quantity: 2, packSize: 5, unitPrice: 10, productNote: `${tag} product note` }] } };
  const discCreate = await api("POST", "/api/custom-discount-requests", { auth: false, json: discountPayload, headers: { "x-omsons-actor-role": "DEALER", "x-omsons-actor-id": String(dealer.id) } });
  const discountId = String(discCreate.body?.data?.id || "");
  addResult("Custom discount request", discCreate.ok && discCreate.body?.data?.status === "pending", failDetail("discount create", "pending", discCreate.status, { response: discCreate.body }));
  const ownApprove = await api("PATCH", `/api/custom-discount-requests/${discountId}`, { auth: false, json: { status: "APPROVED" }, headers: { "x-omsons-actor-role": "DEALER", "x-omsons-actor-id": String(dealer.id) } });
  await login(adminEmail);
  const discReadAdmin = await api("GET", `/api/custom-discount-requests/${discountId}`);
  const approve = await api("PATCH", `/api/custom-discount-requests/${discountId}`, { json: { status: "APPROVED", adminNote: `${tag} approved` } });
  const approvedRow = await prisma.customDiscountRequest.findUnique({ where: { id: BigInt(discountId || 0) } }).catch(() => null);
  const discDealerReload = await api("GET", `/api/custom-discount-requests/${discountId}`, { auth: false, headers: { "x-omsons-actor-role": "DEALER", "x-omsons-actor-id": String(dealer.id) } });
  addResult("Discount approval", discReadAdmin.ok && approve.ok && ownApprove.status === 403 && !!approvedRow?.reviewedAt && approvedRow?.reviewedByUserId === admin.id && approvedRow?.allowReorder === true && discDealerReload.body?.data?.status === "approved", failDetail("admin approve", "reviewed fields + own approve rejected", `${discReadAdmin.status}/${approve.status}/${ownApprove.status}`, { row: approvedRow, response: approve.body }));

  const form = new FormData();
  form.set("productorder", JSON.stringify([{ productname: variant.catalogueNumber, productName: "FAKE NAME", variantCode: variant.catalogueNumber, quantityPacks: 2, packSize: 99, price: 9999, grossAmount: 999999, discountPercent: 0, productNote: `${tag} product note`, isPriority: true }]));
  form.set("orderDraftId", draftId);
  form.set("fromCart", draftCartOk ? "true" : "false");
  form.set("additionalDiscountType", "custom");
  form.set("customDiscountRequestId", discountId);
  form.set("customDiscountAmount", "9999");
  form.set("baseDiscountPercent", "10");
  form.set("Dealer_shipto", `${tag} ship`);
  form.set("refno", `${tag} ref`);
  form.set("note", `${tag} order note`);
  form.set("dealer_id", String(otherDealer.id));
  await login(dealerEmail);
  const idem = `${tag}-idem`;
  const orderRes = await api("POST", "/api/dealer-order", { form, headers: { "idempotency-key": idem } });
  const orderId = String(orderRes.body?.orderId || "");
  const order = orderId ? await prisma.order.findUnique({ where: { id: BigInt(orderId) }, include: { items: true, discountRequests: true, sourceDraft: true } }) : null;
  const expectedGross = moneyPaise(100);
  const expectedBase = moneyPaise(10);
  const expectedCustom = moneyPaise(10);
  const expectedFinal = moneyPaise(80);
  const pricingOk = !!order && order.dealerId === dealer.id && order.grossAmountPaise === expectedGross && order.baseDiscountAmountPaise === expectedBase && order.customDiscountAmountPaise === expectedCustom && order.finalPayableAmountPaise === expectedFinal;
  addResult("Order creation", orderRes.ok && !!order && order.items.length === 1, failDetail("dealer-order POST", "order and item created", orderRes.status, { response: orderRes.body }));
  addResult("Pricing authority", pricingOk, failDetail("server recalculation", { gross: String(expectedGross), custom: String(expectedCustom), final: String(expectedFinal) }, order ? { gross: String(order.grossAmountPaise), custom: String(order.customDiscountAmountPaise), final: String(order.finalPayableAmountPaise) } : null));
  addResult("Discount authority", pricingOk && order?.discountRequests?.some((r) => r.id === BigInt(discountId)), failDetail("approved discount applied", "approved amount and linked request", order ? { custom: String(order.customDiscountAmountPaise), linked: order.discountRequests.length } : null));
  const draftAfter = await prisma.orderDraft.findUnique({ where: { id: BigInt(draftId) } });
  const cartAfter = draftCartOk ? await prisma.draftCart.findUnique({ where: { dealerId: dealer.id } }).catch(() => "unavailable") : "unavailable";
  addResult("Draft conversion", draftAfter?.status === "CONVERTED" && draftAfter?.orderId === order?.id && (!draftCartOk || !cartAfter), failDetail("draft converted and cart cleared", "CONVERTED + orderId + no cart", { draftAfter, cartAfter }));

  const orderCountBefore = await prisma.order.count({ where: { idempotencyKey: idem } });
  const duplicate = await api("POST", "/api/dealer-order", { form, headers: { "idempotency-key": idem } });
  const orderCountAfter = await prisma.order.count({ where: { idempotencyKey: idem } });
  const itemCount = order ? await prisma.orderItem.count({ where: { orderId: order.id } }) : 0;
  addResult("Idempotency", duplicate.ok && orderCountBefore === 1 && orderCountAfter === 1 && String(duplicate.body?.orderId) === orderId && itemCount === 1, failDetail("same idempotency-key", "same order no new items", { status: duplicate.status, before: orderCountBefore, after: orderCountAfter, duplicate: duplicate.body, itemCount }));

  const dealerOrders = await api("GET", `/api/orders-data?source=orderhispegination&role=dealer&id=${dealer.id}&limit=50&search=${encodeURIComponent(orderId)}`, { auth: false });
  const dealerAccess = await api("GET", `/api/order-access/${orderId}?role=dealer&actor_id=${dealer.id}`, { auth: false });
  const otherAccess = await api("GET", `/api/order-access/${orderId}?role=dealer&actor_id=${otherDealer.id}`, { auth: false });
  addResult("Dealer order access", dealerOrders.ok && dealerAccess.ok && otherAccess.status === 403, failDetail("dealer order reads", "owner 200 other 403", `${dealerOrders.status}/${dealerAccess.status}/${otherAccess.status}`, { response: otherAccess.body }));

  await login(staffEmail);
  const staffOrders = await api("GET", `/api/orders-data?source=staffOrderrPagination&role=staff&id=${staffProfile.id}&limit=50&search=${encodeURIComponent(orderId)}`);
  const staffAccess = await api("GET", `/api/order-access/${orderId}?role=staff&actor_id=${staffProfile.id}`);
  await login(unassignedStaffEmail);
  const unassignedAccess = await api("GET", `/api/order-access/${orderId}?role=staff&actor_id=${unassignedProfile.id}`);
  addResult("Staff", staffOrders.ok && staffAccess.ok, failDetail("assigned staff reads", "200", `${staffOrders.status}/${staffAccess.status}`, { response: staffAccess.body }));
  addResult("Staff order access", staffOrders.ok && staffAccess.ok && unassignedAccess.status === 403, failDetail("staff access boundary", "assigned 200 unassigned 403", `${staffAccess.status}/${unassignedAccess.status}`, { response: unassignedAccess.body }));

  await login(adminEmail);
  const adminOrders = await api("GET", `/api/admin/orders?search=${encodeURIComponent(orderId)}`);
  const adminDetail = await api("GET", `/api/admin/orders/${orderId}`);
  const adminDash2 = await api("GET", "/api/admin/dashboard");
  addResult("Admin order access", adminOrders.ok && adminDetail.ok && adminDash2.ok, failDetail("admin order list/detail/dashboard", "200", `${adminOrders.status}/${adminDetail.status}/${adminDash2.status}`, { response: adminDetail.body }));

  const inactiveUser = await prisma.user.create({ data: { email: `inactive-${tag}@example.test`, normalizedEmail: normalizeEmail(`inactive-${tag}@example.test`), passwordHash: await hashPassword(password), role: "DEALER", status: "INACTIVE", dealerProfile: { create: { businessName: `${tag} Inactive`, dealerCode: `${dealerCode}I`.slice(0, 50) } } } });
  const invalidForm = new FormData();
  invalidForm.set("productorder", JSON.stringify([{ productname: `${tag}-NOPE`, productName: "Nope", variantCode: `${tag}-NOPE`, quantityPacks: 1, packSize: 1 }]));
  const invalidProduct = await api("POST", "/api/dealer-order", { form: invalidForm, headers: { "idempotency-key": `${tag}-invalid` } });
  const duplicateReq = await api("POST", "/api/dealer-requests", { json: { role: "staff", actorId: String(staffProfile.id), actorName: staffProfile.displayName, formSnapshot: dealerSnapshot }, auth: false });
  const invalidDiscount = await api("POST", "/api/custom-discount-requests", { auth: false, json: { ...discountPayload, orderDraftId: draftId, requestedDiscountPercent: 5, currentDiscountPercent: 10 }, headers: { "x-omsons-actor-role": "DEALER", "x-omsons-actor-id": String(dealer.id) } });
  const wrongHeaderDraft = await api("POST", "/api/drafts", { auth: false, json: { dealer_id: String(dealer.id), name: `${tag} Bad Draft`, rows }, headers: { "x-omsons-actor-role": "DEALER", "x-omsons-actor-id": String(otherDealer.id) } });
  addResult("Negative tests", invalidProduct.status >= 400 && duplicateReq.status === 409 && invalidDiscount.status >= 400 && wrongHeaderDraft.status === 403 && otherAccess.status === 403 && unassignedAccess.status === 403 && ownApprove.status === 403, failDetail("negative cases", "all rejected", { invalidProduct: invalidProduct.status, duplicateReq: duplicateReq.status, invalidDiscount: invalidDiscount.status, wrongHeaderDraft: wrongHeaderDraft.status, otherAccess: otherAccess.status, unassignedAccess: unassignedAccess.status, ownApprove: ownApprove.status }));
  await prisma.user.delete({ where: { id: inactiveUser.id } }).catch(() => undefined);

  const isolation = await staticIsolationScan();
  const postgresOrderPhpCalls = [dealerOrders, staffOrders]
    .map((result) => Number(result.body?.diagnostics?.upstreamCalls || 0))
    .filter((count) => Number.isFinite(count));
  const postgresOrderInvokedPhp = postgresOrderPhpCalls.some((count) => count > 0);
  addResult("PHP isolation", !postgresOrderInvokedPhp, failDetail("runtime PHP scan", "PostgreSQL-created order reads use 0 PHP calls", { dealer: dealerOrders.body?.diagnostics, staff: staffOrders.body?.diagnostics }));
  addResult("Mongo isolation", isolation.mongoHits.length === 0, failDetail("static Mongo scan", "no Mongo deps", isolation.mongoHits));
}
async function printAndExit(cleanupResult) {
  const order = ["Auth", "Admin", "Staff", "Dealer onboarding", "Dealer login", "Dealer assignment", "Draft", "Draft cart", "Custom discount request", "Discount approval", "Order creation", "Pricing authority", "Discount authority", "Draft conversion", "Idempotency", "Dealer order access", "Staff order access", "Admin order access", "PHP isolation", "Mongo isolation"];
  const byName = new Map(results.map((r) => [r.name, r]));
  console.log("POSTGRES MIGRATION SIMULATION\n");
  for (const name of order) {
    const result = byName.get(name) || { pass: false, detail: { step: name, expected: "executed", actual: "not run" } };
    console.log(`${name.padEnd(24)} ${result.pass ? "PASS" : "FAIL"}`);
  }
  const passed = order.filter((name) => byName.get(name)?.pass).length;
  const failed = order.length - passed;
  console.log(`\nPassed: ${passed}/${order.length}`);
  console.log(`Failed: ${failed}/${order.length}`);
  const failures = order.map((name) => byName.get(name) || { name, pass: false, detail: { step: name, expected: "executed", actual: "not run" } }).filter((r) => !r.pass);
  if (failures.length) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(JSON.stringify({ name: failure.name, ...failure.detail }, bigintJson, 2));
  }
  console.log(`\nCleanup: ${cleanupResult.pass ? "PASS" : "FAIL"}`);
  if (!cleanupResult.pass) console.log(JSON.stringify(cleanupResult.error, bigintJson, 2));
}
try {
  await main();
} catch (error) {
  addResult("Simulation setup", false, failDetail("top-level", "simulation completes", error?.stack || error?.message || String(error)));
} finally {
  let cleanupResult = { pass: true };
  try { await cleanup(); } catch (error) { cleanupResult = { pass: false, error: error?.stack || error?.message || String(error) }; }
  if (state.server) state.server.kill();
  await prisma.$disconnect();
  await printAndExit(cleanupResult);
}







