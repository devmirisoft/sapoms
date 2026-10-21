import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;

const stubs = {
  "next/server": "export function after(callback) { globalThis.__after.push(callback); }",
  "@/server/db/prisma": `export const prisma = {
    order: {
      findUnique: async () => globalThis.__order,
      count: async ({ where }) => (globalThis.__rsmHits ?? []).includes(where.rsm) ? 1 : 0,
    },
    dealerProfile: { findUnique: async () => globalThis.__order?.dealer ?? null },
    staffProfile: { findMany: async () => globalThis.__rsms ?? [] },
    user: { findMany: async ({ where }) => (globalThis.__users ?? []).filter((user) => where.role.in.includes(user.role)) },
  };`,
  "@/server/auth/email": "export async function sendEmail(to, subject, html) { globalThis.__sent.push({ to, subject, html }); }",
  "@/server/auth/sales-scope": "export const ACTIVE_RSM = {}; export const ACTIVE_USER = {}; export function rsmOrderScope(rsmId) { return { rsm: rsmId }; }",
};

async function load() {
  let source = await fs.readFile(path.resolve("src/server/notify/dealer-email.ts"), "utf8");
  for (const [specifier, code] of Object.entries(stubs)) {
    source = source.replace(new RegExp(`(from\\s+)["']${specifier.replace(/[/@.-]/g, "\\$&")}["']`), `$1"${dataUrl(code)}"`);
  }
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(dataUrl(js));
}

const { renderDealerEmail, notifyDealer, notifyApprover, notifyReviewers } = await load();
const ctx = { businessName: "Acme Labs", orderNumber: "OM/26-27/DMS-1017" };

function orderRow(overrides = {}) {
  return {
    id: 500n,
    legacyPhpId: null,
    orderNumber: ctx.orderNumber,
    status: "AWAITING_ACCEPTANCE",
    rsmApprovalStatus: "AWAITING",
    acceptanceStatus: "AWAITING",
    finalPayableAmountPaise: 1234550n,
    dealer: { businessName: "Acme Labs", user: { email: "dealer@example.com" } },
    assignedStaff: { user: { email: "staff@example.com", status: "ACTIVE", deletedAt: null } },
    ...overrides,
  };
}

function reset({ order = orderRow(), rsms = [], rsmHits = [], users = [] } = {}) {
  Object.assign(globalThis, { __after: [], __sent: [], __order: order, __rsms: rsms, __rsmHits: rsmHits, __users: users });
  process.env.ORDER_EMAILS_ENABLED = "true";
  delete process.env.ORDER_EMAILS_REDIRECT;
}

async function runScheduled() {
  for (const job of globalThis.__after) await job();
  return globalThis.__sent;
}

const rsm = (id, email) => ({ id, userId: id + 100n, user: { email } });
const NSM = { role: "NSM", email: "nsm@example.com" };
const ADMIN = { role: "ADMIN", email: "admin@example.com" };

test("every order event names the order in its subject", () => {
  for (const event of [{ kind: "placed" }, { kind: "accepted" }, { kind: "declined" }, { kind: "dispatched", full: true }, { kind: "cancelled" }]) {
    assert.match(renderDealerEmail(event, ctx).subject, /OM\/26-27\/DMS-1017/, event.kind);
  }
});

test("a full and a partial dispatch read differently, with the courier details", () => {
  const shipment = { dispatchPartner: "BlueDart", trackingNumber: "AWB123", trackingLink: "https://track.example/AWB123" };
  const full = renderDealerEmail({ kind: "dispatched", full: true, shipment }, ctx);
  const partial = renderDealerEmail({ kind: "dispatched", full: false, shipment }, ctx);
  assert.match(full.subject, /fully dispatched/);
  assert.match(partial.subject, /partially dispatched/);
  assert.match(full.html, /BlueDart/);
  assert.match(full.html, /href="https:\/\/track\.example\/AWB123"/);
});

test("typed-in text is escaped and a non-web tracking link is not clickable", () => {
  const declined = renderDealerEmail({ kind: "declined", note: "<script>alert(1)</script>" }, ctx);
  assert.doesNotMatch(declined.html, /<script>/);
  assert.match(declined.html, /&#60;script&#62;/);
  const dispatched = renderDealerEmail({ kind: "dispatched", full: false, shipment: { dispatchPartner: "X", trackingNumber: null, trackingLink: "javascript:alert(1)" } }, ctx);
  assert.doesNotMatch(dispatched.html, /href="javascript/);
});

test("nothing is scheduled unless ORDER_EMAILS_ENABLED is true", () => {
  reset();
  delete process.env.ORDER_EMAILS_ENABLED;
  notifyDealer({ orderNumber: ctx.orderNumber }, { kind: "placed" });
  notifyApprover(ctx.orderNumber);
  notifyReviewers(ctx.orderNumber, "cancel", "x");
  assert.equal(globalThis.__after.length, 0);
});

test("an enabled dealer notification emails the dealer's login address with an order link", async () => {
  reset({ order: orderRow({ legacyPhpId: "321" }) });
  process.env.NEXT_PUBLIC_SITE_URL = "https://oms.example/";
  notifyDealer({ orderNumber: ctx.orderNumber }, { kind: "accepted" });
  const [sent] = await runScheduled();
  assert.equal(sent.to, "dealer@example.com");
  assert.match(sent.html, /href="https:\/\/oms\.example\/orders\/321"/);

  reset();
  notifyDealer({ orderNumber: ctx.orderNumber }, { kind: "declined", note: "Out of stock" });
  assert.match((await runScheduled())[0].html, /href="https:\/\/oms\.example\/drafts"/);
});

test("a new order goes to the RSM whose scope holds it, with the amount", async () => {
  reset({ rsms: [rsm(1n, "rsm-north@example.com"), rsm(2n, "rsm-south@example.com")], rsmHits: [2n], users: [NSM, ADMIN] });
  notifyApprover(ctx.orderNumber);
  const sent = await runScheduled();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "rsm-south@example.com");
  assert.match(sent[0].subject, /New order OM\/26-27\/DMS-1017 from Acme Labs needs your approval/);
  assert.match(sent[0].html, /₹12,345\.50/);
});

test("with no RSM for the order it goes to the NSM, and with no NSM to Admin", async () => {
  reset({ rsms: [rsm(1n, "rsm@example.com")], rsmHits: [], users: [NSM, ADMIN] });
  notifyApprover(ctx.orderNumber);
  assert.equal((await runScheduled())[0].to, "nsm@example.com");

  reset({ rsms: [], users: [ADMIN] });
  notifyApprover(ctx.orderNumber);
  assert.equal((await runScheduled())[0].to, "admin@example.com");
});

test("an RSM-approved order goes to its Staff member; a reviewed or inactive one goes nowhere", async () => {
  reset({ order: orderRow({ rsmApprovalStatus: "ACCEPTED" }), users: [NSM, ADMIN] });
  notifyApprover(ctx.orderNumber);
  const [sent] = await runScheduled();
  assert.equal(sent.to, "staff@example.com");
  assert.match(sent.subject, /approved by RSM, ready to accept/);

  for (const order of [
    orderRow({ rsmApprovalStatus: "ACCEPTED", acceptanceStatus: "ACCEPTED", status: "ACCEPTED" }),
    orderRow({ rsmApprovalStatus: "DECLINED", status: "DECLINED" }),
    orderRow({ rsmApprovalStatus: "ACCEPTED", assignedStaff: { user: { email: "gone@example.com", status: "INACTIVE", deletedAt: null } } }),
  ]) {
    reset({ order, users: [NSM, ADMIN] });
    notifyApprover(ctx.orderNumber);
    assert.equal((await runScheduled()).length, 0);
  }
});

test("a dealer change request goes to Admin and NSM with the escaped note", async () => {
  reset({ users: [NSM, ADMIN, { role: "RSM", email: "rsm@example.com" }] });
  notifyReviewers(ctx.orderNumber, "cancel", "<b>wrong items</b>");
  const [sent] = await runScheduled();
  assert.equal(sent.to, "nsm@example.com, admin@example.com");
  assert.match(sent.subject, /Acme Labs asked to cancel order OM\/26-27\/DMS-1017/);
  assert.match(sent.html, /&#60;b&#62;wrong items/);
});

test("ORDER_EMAILS_REDIRECT sends to the test inbox and names the real recipient", async () => {
  reset({ rsms: [rsm(1n, "rsm@example.com")], rsmHits: [1n] });
  process.env.ORDER_EMAILS_REDIRECT = "tester@example.com";
  notifyApprover(ctx.orderNumber);
  const [sent] = await runScheduled();
  assert.equal(sent.to, "tester@example.com");
  assert.match(sent.subject, /^\[to rsm@example\.com\] New order/);
  delete process.env.ORDER_EMAILS_REDIRECT;
  delete process.env.ORDER_EMAILS_ENABLED;
});
