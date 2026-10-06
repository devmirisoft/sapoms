#!/usr/bin/env node
// Seeds staff, dealers, orders, order items, pending state and discount requests
// from the legacy JSON exports in docs/. Adapts to the schema; never alters it.
//
//   DATABASE_URL='postgres://…' node scripts/seed/seed-from-json.mjs [--dry-run|--commit|--verify] [--only=staff,dealers,orders,items,pending,discounts]
//
// --dry-run (default) reads the DB and reports what would change; --commit writes;
// --verify runs the post-seed checks. Re-runnable: every entity upserts on a legacy key.
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const ALLOWED_HOST = "dpg-dan6ad0ae00c73dlme1g-a";
const DOCS = "docs";
const STAMP = "2026-10-05";
const EXPORT_DIR = "export";
const ORDER_SEQUENCE_YEAR = 2026;

// ── args / target ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const mode = args.includes("--verify") ? "verify" : args.includes("--commit") ? "commit" : "dry-run";
const onlyArg = args.find((a) => a.startsWith("--only="))?.slice(7);
const only = new Set(onlyArg ? onlyArg.split(",") : ["staff", "dealers", "orders", "items", "pending", "discounts"]);

// Read before prisma.mjs runs dotenv, so .env can never pick the target.
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("Pass DATABASE_URL inline; .env is deliberately not used."); process.exit(1); }
const target = new URL(DATABASE_URL);
console.log(`TARGET host=${target.hostname} db=${target.pathname.slice(1)} mode=${mode} only=${[...only].join(",")}`);
if (mode === "commit" && !target.hostname.startsWith(ALLOWED_HOST)) {
  console.error(`Refusing --commit: host is not ${ALLOWED_HOST}.`); process.exit(1);
}

const { PrismaClient } = await import("../prisma.mjs");
const { Prisma } = await import("@prisma/client");
const prisma = new PrismaClient();
const TX = { timeout: 600_000, maxWait: 30_000 };

// ── pure helpers ────────────────────────────────────────────────────────────
const scrypt = promisify(scryptCallback);
const text = (v) => String(v ?? "").trim();
const lower = (v) => text(v).toLowerCase();
const orNull = (v) => text(v) || null;

/** "299564.82" → 29956482n. Exact string math; anything finer than a paisa throws. */
export function toPaise(value) {
  const raw = text(value).replace(/[₹,\s]/g, "");
  if (!raw) return null;
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!m) throw new Error(`Not an exact money value: ${JSON.stringify(value)}`);
  const paise = BigInt(m[2]) * 100n + BigInt((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -paise : paise;
}

/** Percent as a Decimal string, validated exact. */
export function percent(value) {
  const raw = text(value);
  if (!raw) return null;
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error(`Not a percent: ${JSON.stringify(value)}`);
  return raw;
}

/** part/whole as a percent with 4 decimals, half-up, via BigInt. */
export function ratioPercent(part, whole) {
  if (!whole) return "0";
  const units = (part * 2_000_000n / whole + 1n) / 2n; // 1e-4 percent units
  return `${units / 10_000n}.${String(units % 10_000n).padStart(4, "0")}`;
}

/** Legacy PHP stamps are IST wall-clock; ISO strings carry their own zone. */
export function legacyDate(value) {
  const raw = text(value);
  if (!raw) return null;
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw.replace(" ", "T")}+05:30`);
  if (Number.isNaN(d.getTime())) throw new Error(`Bad date: ${raw}`);
  return d;
}

/**
 * When the order was placed. The header's order_date is a last-edited stamp; orderDate is
 * the placed day (it matches every item row), orderdata_datetime the placed time when on that day.
 */
export function placedDate(datetime, day) {
  const d = text(day).slice(0, 10);
  const dt = text(datetime);
  if (dt && (!d || dt.slice(0, 10) === d)) return legacyDate(dt);
  return d ? legacyDate(`${d} 00:00:00`) : null;
}

/** Sum of 1e-4 percent units, so "50" + "22.5" = "72.5000" without floats. */
function addPercents(...values) {
  const units = values.reduce((s, v) => {
    const [w, f = ""] = (percent(v) ?? "0").split(".");
    return s + BigInt(w) * 10_000n + BigInt(f.slice(0, 4).padEnd(4, "0"));
  }, 0n);
  return `${units / 10_000n}.${String(units % 10_000n).padStart(4, "0")}`;
}

/** Legacy "0" meant "not set"; 0 here would block every order via the credit check. */
const zeroAsNull = (v) => (text(v) === "" || Number(text(v)) === 0 ? null : v);

// From scripts/import-legacy-dealers.mjs: a valid scrypt hash of a secret nobody keeps.
async function disabledPasswordHash() {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(randomBytes(32).toString("base64url"), salt, 64);
  return `scrypt:${salt}:${Buffer.from(derived).toString("hex")}`;
}

// Role from designation (legacy staff_roletype 1/2 means something else in this app).
const ROLE_RULES = [
  [/^nsm$/i, "NSM", null],
  [/^rsm$/i, "RSM", "RSM"],
  [/^(asm|area sales manager)$/i, "ASM", "ASM"],
  [/^sales man(a)?ger$/i, "STAFF", "1"],
];
export function staffRole(designation) {
  const d = text(designation).replace(/\s+/g, " ");
  for (const [re, role, staffRoleType] of ROLE_RULES) if (re.test(d)) return { role, staffRoleType, defaulted: false };
  return { role: "STAFF", staffRoleType: "1", defaulted: true }; // lowest-privilege role that needs no warehouse
}

const DISCOUNT_TYPE = { slab: "SLAB", custom: "CUSTOM" };

// ── load JSON ───────────────────────────────────────────────────────────────
const load = async (name) => JSON.parse(await readFile(`${DOCS}/${name}-${STAMP}.json`, "utf8"));
const staffRows = (await load("staff")).Staff;
const dealerRows = (await load("dealers")).Dealers;
const ordersJson = await load("orders");
const activeOrders = ordersJson.Orders;
const cancelledOrders = ordersJson.Cancelled_Orders;
const pendingRows = (await load("pending-orders")).Pending_Orders;
const discountRows = (await load("discount-requests")).Discount_Requests;
const allItemRows = JSON.parse(await readFile(`${DOCS}/allproductdata.json`, "utf8"));

// The item export repeats two orderdata_ids verbatim; keep the first of each.
const seenItemIds = new Set();
const duplicateItemIds = [];
const itemRows = allItemRows.filter((row) => {
  const id = text(row.orderdata_id);
  if (seenItemIds.has(id)) { duplicateItemIds.push(id); return false; }
  seenItemIds.add(id);
  return true;
});
const itemsByOrder = new Map();
for (const row of itemRows) {
  const id = text(row.order_id);
  if (!itemsByOrder.has(id)) itemsByOrder.set(id, []);
  itemsByOrder.get(id).push(row);
}
const knownOrderIds = new Set([...activeOrders.map((r) => text(r.order_id)), ...cancelledOrders.map((r) => text(r.orderId))]);
// Orders placed after orders.json was exported exist only as item rows.
const itemOnlyOrders = [...itemsByOrder].filter(([id]) => !knownOrderIds.has(id));

const report = {
  mode, target: `${target.hostname}/${target.pathname.slice(1)}`, at: new Date().toISOString(),
  counts: {}, skipped: [], warnings: [], defaultedRoles: [], derived: [], unmapped: {
    staff: ["staff_roletype (legacy meaning differs; role derived from designation)", "role_label", "staff_dealer (empty)", "staff_image (empty)"],
    dealers: ["Dealer_shipto (no column)", "Dealer_Image (empty)", "assignedstaff / staffname / dealerAddByStaff (left untagged by instruction)", "status (always '0'; dealer_status used)"],
    orders: ["staffid (assigned_staff_id left NULL; untagged)", "outstandingDate", "orderDate (date-only copy)", "readyquantity", "orderdata_item_quantity (no line items in source)", "priceSource", "has* flags", "customDiscountPercent", "gross/netPayable duplicates"],
    cancelledOrders: ["cancellation.cancelledBy (no column)", "source", "edits", "latestRevision", "originalOrderRef item row (single sample item, not seeded)"],
    items: ["product_price (current catalogue price, not the ordered price)", "product_unit (no item column)", "orderdata_productid / order_item_description / orderdata_capacity / orderdata_item_unit (empty)", "del_status (only on items of cancelled orders; kept so the order shows what was ordered)", "dispatch fields (all pending, nothing dispatched)", "readyquantity (all 0)", "notification", "occurrence", "order_discount (header copy)"],
    discountRequests: ["orderDraftId / rejectionDraftId (Mongo drafts not in DB → NULL)", "staffId / assignedStaffId (single FK; untagged)", "reviewedBy 'Admin' (not resolvable → NULL)", "products / draftProducts (duplicate of orderSnapshot)", "shipto", "refno", "discountBreakdown", "reorderCount / lastReordered*", "linkedOrderAt", "dealer contact copies"],
  },
  lineItems: "From docs/allproductdata.json (orderdata rows), plus approved discount-request snapshots for orders that have no item rows.",
};
const idMap = { staff: {}, dealers: {}, orders: {}, discountRequests: {} };
const count = (entity, action) => {
  report.counts[entity] ??= {};
  report.counts[entity][action] = (report.counts[entity][action] ?? 0) + 1;
};
const write = mode === "commit";

// ── users (shared by staff + dealers) ───────────────────────────────────────
async function upsertUser(tx, { email, username, role, status }, ctx) {
  const normalizedEmail = lower(email);
  const existing = await tx.user.findUnique({ where: { normalizedEmail } });
  if (existing && existing.role !== role) {
    report.skipped.push({ ...ctx, reason: `email ${normalizedEmail} already belongs to a ${existing.role} user` });
    return { skip: true };
  }
  const data = { email: text(email), username: orNull(username), normalizedUsername: lower(username) || null, role, status };
  if (!write) return { user: existing ?? { id: null }, created: !existing };
  const user = existing
    ? await tx.user.update({ where: { id: existing.id }, data })
    : await tx.user.create({ data: { ...data, normalizedEmail, passwordHash: await disabledPasswordHash() } });
  return { user, created: !existing };
}

async function runInTx(fn) {
  return write ? prisma.$transaction(fn, TX) : fn(prisma);
}

// ── staff ───────────────────────────────────────────────────────────────────
async function seedStaff() {
  await runInTx(async (tx) => {
    for (const row of staffRows) {
      const legacyId = text(row.staff_id);
      const ctx = { entity: "staff", legacyId };
      const { role, staffRoleType, defaulted } = staffRole(row.staff_designation);
      if (defaulted) report.defaultedRoles.push({ legacyId, name: text(row.staff_name), designation: text(row.staff_designation), role, staffRoleType });

      const id = BigInt(legacyId);
      const profile = await tx.staffProfile.findUnique({ where: { id } });
      const res = await upsertUser(tx, { email: row.staff_email, username: row.staff_username, role, status: "ACTIVE" }, ctx);
      if (res.skip) { count("staff", "skipped"); continue; }
      if (profile && res.user.id !== null && profile.userId !== res.user.id) {
        report.skipped.push({ ...ctx, reason: `staff_profiles.id ${id} already belongs to user ${profile.userId}` });
        count("staff", "skipped"); continue;
      }
      const data = {
        displayName: text(row.staff_name), designation: orNull(row.staff_designation), location: orNull(row.staff_location),
        staffRoleType, parentRsmId: null, parentAsmId: null, reportingManagerId: null,
      };
      if (write) {
        await tx.staffProfile.upsert({ where: { id }, update: data, create: { id, userId: res.user.id, ...data } });
        idMap.staff[legacyId] = { userId: res.user.id.toString(), staffProfileId: legacyId };
      }
      count("staff", profile ? "updated" : "inserted");
    }
    if (write) {
      // Never move the sequence backwards: ids above MAX may already have been handed out.
      await tx.$executeRawUnsafe(`SELECT setval('staff_profiles_id_seq', GREATEST((SELECT MAX(id) FROM staff_profiles), (SELECT last_value FROM staff_profiles_id_seq)))`);
    }
  });
}

// ── dealers ─────────────────────────────────────────────────────────────────
async function seedDealers() {
  // dealer_code is unique: the lowest legacy id keeps a duplicated code, the rest get NULL.
  const codeOwner = new Map();
  for (const row of [...dealerRows].sort((a, b) => Number(a.Dealer_Id) - Number(b.Dealer_Id))) {
    const code = text(row.Dealer_Dealercode);
    if (code && !codeOwner.has(code)) codeOwner.set(code, text(row.Dealer_Id));
  }
  await runInTx(async (tx) => {
    for (const row of dealerRows) {
      const legacyId = text(row.Dealer_Id);
      const ctx = { entity: "dealer", legacyId };
      const code = text(row.Dealer_Dealercode);
      const dealerCode = code && codeOwner.get(code) === legacyId ? code : null;
      if (code && !dealerCode) report.warnings.push({ ...ctx, warning: `dealer_code '${code}' also used by legacy dealer ${codeOwner.get(code)}; stored NULL` });
      if (text(row.gst) && !/^\d{2}[A-Z0-9]{13}$/.test(text(row.gst))) report.warnings.push({ ...ctx, warning: `gstin '${text(row.gst)}' is not a valid GSTIN; kept as-is` });
      for (const [field, column] of [["creditdays", "credit_days"], ["currentlimit", "credit_limit_paise"], ["annualtarget", "annual_target_paise"]]) {
        if (text(row[field]) !== "" && zeroAsNull(row[field]) === null) report.derived.push({ ...ctx, column, from: row[field], to: null, why: "legacy 0 = not set" });
      }

      const existing = await tx.dealerProfile.findUnique({ where: { legacyPhpId: legacyId } });
      const status = lower(row.dealer_status) === "active" ? "ACTIVE" : "INACTIVE";
      const res = await upsertUser(tx, { email: row.Dealer_Email, username: row.Dealer_Username, role: "DEALER", status }, ctx);
      if (res.skip) { count("dealers", "skipped"); continue; }
      const creditDays = zeroAsNull(row.creditdays);
      const data = {
        dealerCode, businessName: text(row.Dealer_Name), phone: orNull(row.Dealer_Number), city: orNull(row.Dealer_City),
        address: orNull(row.Dealer_Address), pincode: orNull(row.Dealer_Pincode), gstin: orNull(row.gst), notes: orNull(row.Dealer_Notes),
        discountPercent: percent(row.discount), creditDays: creditDays === null ? null : Number.parseInt(text(creditDays), 10),
        creditLimitPaise: toPaise(zeroAsNull(row.currentlimit)), annualTargetPaise: toPaise(zeroAsNull(row.annualtarget)),
        rsmUserId: null, createdByUserId: null, region: null,
      };
      if (write) {
        const dealer = await tx.dealerProfile.upsert({ where: { legacyPhpId: legacyId }, update: data, create: { legacyPhpId: legacyId, userId: res.user.id, ...data } });
        idMap.dealers[legacyId] = { userId: res.user.id.toString(), dealerProfileId: dealer.id.toString() };
      }
      count("dealers", existing ? "updated" : "inserted");
    }
  });
}

// ── orders ──────────────────────────────────────────────────────────────────
function activeOrderData(row) {
  const gross = toPaise(row.order_amount);
  const discount = toPaise(row.order_discount_amount);
  const net = toPaise(row.order_net_amount);
  if (gross - discount !== net) throw new Error(`order ${row.order_id}: gross − discount ≠ net`);
  const accepted = text(row.accept_order) === "1";
  const orderDate = placedDate(row.orderdata_datetime, row.orderDate) ?? legacyDate(row.order_date);
  return {
    orderNumber: `OM/${ORDER_SEQUENCE_YEAR}/${text(row.order_id)}`,
    orderDate, createdAt: orderDate,
    grossAmountPaise: gross,
    baseDiscountPercent: percent(row.baseDiscountPercent) ?? "0",
    baseDiscountAmountPaise: toPaise(row.baseDiscountAmount) ?? 0n,
    postBaseAmountPaise: toPaise(row.postBaseAmount) ?? gross,
    additionalDiscountType: DISCOUNT_TYPE[lower(row.additionalDiscountType)] ?? "NONE",
    additionalDiscountAmountPaise: toPaise(row.additionalDiscountAmount) ?? 0n,
    customDiscountAmountPaise: toPaise(row.customDiscountAmount) ?? 0n,
    slabDiscountPercent: percent(row.slabDiscountPercent) ?? "0",
    slabDiscountAmountPaise: toPaise(row.slabDiscountAmount) ?? 0n,
    totalDiscountAmountPaise: discount,
    totalDiscountPercent: ratioPercent(discount, gross),
    finalPayableAmountPaise: net,
    status: accepted ? "ACCEPTED" : "AWAITING_ACCEPTANCE",
    acceptanceStatus: accepted ? "ACCEPTED" : "AWAITING",
    rsmApprovalStatus: accepted ? "ACCEPTED" : "AWAITING",
    acceptedAt: accepted ? legacyDate(row.orderdata_datetime) ?? orderDate : null,
    fulfilmentStatus: lower(row.mtstatus) === "inprocess" ? "IN_PROCESS" : "PENDING",
    cancelledAt: null, cancellationReason: null,
  };
}

function cancelledOrderData(row) {
  const ref = row.originalOrderRef ?? {};
  const gross = toPaise(ref.order_amount);
  const discount = toPaise(ref.order_discount) ?? 0n;
  const net = gross - discount;
  report.derived.push({ entity: "order", legacyId: text(row.orderId), column: "final_payable_amount_paise / post_base_amount_paise", to: net.toString(), why: "cancelled export has gross + discount only; net = gross − discount" });
  const accepted = text(ref.accept_order) === "1";
  const orderDate = placedDate(ref.orderdata_datetime, ref.orderDate) ?? legacyDate(ref.order_date);
  return {
    orderNumber: text(row.formattedOrderNumber) || `OM/${ORDER_SEQUENCE_YEAR}/${text(row.orderId)}`,
    orderDate, createdAt: orderDate,
    grossAmountPaise: gross,
    baseDiscountPercent: percent(ref.discount) ?? "0",
    baseDiscountAmountPaise: discount,
    postBaseAmountPaise: net,
    additionalDiscountType: "NONE", additionalDiscountAmountPaise: 0n, customDiscountAmountPaise: 0n,
    slabDiscountPercent: "0", slabDiscountAmountPaise: 0n,
    totalDiscountAmountPaise: discount,
    totalDiscountPercent: ratioPercent(discount, gross),
    finalPayableAmountPaise: net,
    status: "CANCELLED",
    acceptanceStatus: accepted ? "ACCEPTED" : "AWAITING",
    rsmApprovalStatus: accepted ? "ACCEPTED" : "AWAITING",
    acceptedAt: accepted ? orderDate : null,
    fulfilmentStatus: "PENDING",
    cancelledAt: legacyDate(row.cancellation?.cancelledAt) ?? legacyDate(row.updatedAt),
    cancellationReason: text(row.cancellation?.reason) || "Cancelled in legacy system",
  };
}

// Header totals for an order known only from its item rows: everything from the lines.
// The rows' order_discount field is not used: on 235/236 it is 45% of gross while the
// lines and the dealer are at 55%, so it is reported, not trusted.
function itemOrderData(legacyId, rows) {
  const gross = rows.reduce((s, r) => s + toPaise(r.orderdata_totalprice), 0n);
  const discount = rows.reduce((s, r) => s + toPaise(r.orderdata_discount), 0n);
  const net = gross - discount;
  const percents = [...new Set(rows.map((r) => text(r.discount)))];
  report.derived.push({ entity: "order", legacyId, column: "all header amounts", to: `gross ${gross} discount ${discount} net ${net} (paise)`, why: `not in orders.json; summed from ${rows.length} item rows (rows' order_discount field says ${text(rows[0].order_discount)})` });
  const orderDate = placedDate(rows[0].orderdata_datetime, rows[0].order_date);
  return {
    orderNumber: `OM/${ORDER_SEQUENCE_YEAR}/${legacyId}`,
    orderDate, createdAt: orderDate,
    grossAmountPaise: gross,
    baseDiscountPercent: percents.length === 1 ? percent(percents[0]) ?? "0" : ratioPercent(discount, gross),
    baseDiscountAmountPaise: discount,
    postBaseAmountPaise: net,
    additionalDiscountType: "NONE", additionalDiscountAmountPaise: 0n, customDiscountAmountPaise: 0n,
    slabDiscountPercent: "0", slabDiscountAmountPaise: 0n,
    totalDiscountAmountPaise: discount,
    totalDiscountPercent: ratioPercent(discount, gross),
    finalPayableAmountPaise: net,
    status: "AWAITING_ACCEPTANCE", acceptanceStatus: "AWAITING", rsmApprovalStatus: "AWAITING", acceptedAt: null,
    fulfilmentStatus: "PENDING", cancelledAt: null, cancellationReason: null,
  };
}

async function dealerIdsByLegacy() {
  const dealers = await prisma.dealerProfile.findMany({ where: { legacyPhpId: { not: null } }, select: { id: true, legacyPhpId: true } });
  return new Map(dealers.map((d) => [d.legacyPhpId, d.id]));
}

async function seedOrders() {
  const dealerIds = await dealerIdsByLegacy();
  const jsonDealerIds = new Set(dealerRows.map((d) => text(d.Dealer_Id)));
  const sources = [
    ...activeOrders.map((row) => ({ legacyId: text(row.order_id), legacyDealer: text(row.order_dealer), build: () => activeOrderData(row) })),
    ...cancelledOrders.map((row) => ({ legacyId: text(row.orderId), legacyDealer: text(row.dealerId), build: () => cancelledOrderData(row) })),
    ...itemOnlyOrders.map(([id, rows]) => ({ legacyId: id, legacyDealer: text(rows[0].dealer_id), build: () => itemOrderData(id, rows) })),
  ];
  let maxLegacyId = 0n;
  await runInTx(async (tx) => {
    const existingOrders = new Map((await tx.order.findMany({ where: { legacyPhpId: { not: null } }, select: { legacyPhpId: true, dealerId: true } })).map((o) => [o.legacyPhpId, o]));
    for (const { legacyId, legacyDealer, build } of sources) {
      const ctx = { entity: "order", legacyId, legacyDealer };
      const dealerId = dealerIds.get(legacyDealer);
      // Isolation: an order only ever attaches to its own dealer; unresolved ⇒ skip, never a stand-in.
      if (!dealerId && !(mode === "dry-run" && jsonDealerIds.has(legacyDealer))) {
        report.skipped.push({ ...ctx, reason: "dealer not found" }); count("orders", "skipped"); continue;
      }
      const data = { ...build(), dealerId, assignedStaffId: null, salesManagerId: null };
      const existing = existingOrders.get(legacyId);
      if (existing && existing.dealerId !== dealerId) {
        report.skipped.push({ ...ctx, reason: `existing order belongs to dealer ${existing.dealerId}, not ${dealerId}` });
        count("orders", "skipped"); continue;
      }
      if (BigInt(legacyId) > maxLegacyId) maxLegacyId = BigInt(legacyId);
      if (write) {
        const order = await tx.order.upsert({
          where: { legacyPhpId: legacyId },
          update: data,
          create: { legacyPhpId: legacyId, idempotencyKey: `legacy-php-order:${legacyId}`, ...data },
        });
        idMap.orders[legacyId] = { orderId: order.id.toString(), orderNumber: order.orderNumber, dealerProfileId: dealerId.toString() };
      }
      count("orders", existing ? "updated" : "inserted");
      count("orders", data.status === "CANCELLED" ? "cancelled" : "active");
    }
    // Next app order must not reuse a legacy number (display: OM/26-27/DMS-<n>). Only ever raise it.
    const seq = await tx.orderSequence.findUnique({ where: { year: ORDER_SEQUENCE_YEAR } });
    const next = seq && seq.lastValue > maxLegacyId ? seq.lastValue : maxLegacyId;
    report.orderSequence = { year: ORDER_SEQUENCE_YEAR, from: seq?.lastValue.toString() ?? null, to: next.toString() };
    if (write) await tx.orderSequence.upsert({ where: { year: ORDER_SEQUENCE_YEAR }, update: { lastValue: next }, create: { year: ORDER_SEQUENCE_YEAR, lastValue: next } });
  });
}

// ── order items ─────────────────────────────────────────────────────────────
function legacyItemData(row) {
  const name = text(row.product_name);
  const description = text(row.product_discription);
  const unitPrice = toPaise(row.orderdata_price);
  const packSize = Number.parseInt(text(row.packSize), 10) || 1;
  return {
    legacyPhpOrderItemId: text(row.orderdata_id),
    productId: null, productVariantId: null,
    productNameSnapshot: (description ? `${name} - ${description}` : name) || text(row.orderdata_cat_no),
    catalogueNumberSnapshot: text(row.orderdata_cat_no),
    skuSnapshot: orNull(row.orderdata_cat_no),
    categorySnapshot: null,
    quantityPacks: Number.parseInt(text(row.packs), 10) || 0,
    packSize,
    totalPieces: Number.parseInt(text(row.orderdata_item_quantity), 10) || 0, // legacy prices per piece: qty × price = total on every row
    unitPricePaise: unitPrice,
    packPricePaise: unitPrice * BigInt(packSize),
    listPriceTotalPaise: toPaise(row.orderdata_totalprice),
    discountPercent: percent(row.discount) ?? "0",
    discountAmountPaise: toPaise(row.orderdata_discount) ?? 0n,
    finalAmountPaise: toPaise(row.orderdata_afterDisPrice) ?? 0n,
    isPriority: false,
    remarks: orNull(row.remarks),
    productNote: null,
    createdAt: legacyDate(row.orderdata_datetime),
  };
}

// Same mapping the app uses when it places an approved discount's order (src/lib/discountApprovalOrder.ts).
function snapshotItemData(orderLegacyId, product, index, createdAt) {
  const packSize = Number.parseInt(text(product.packSize), 10) || 1;
  const quantityPacks = Number.parseInt(text(product.quantity), 10) || 1;
  const unitPrice = toPaise(product.unitPrice) ?? 0n;
  const sku = text(product.sku ?? product.catalogueNumber ?? product.productName);
  return {
    legacyPhpOrderItemId: `discount-snapshot:${orderLegacyId}:${index + 1}`,
    productId: null, productVariantId: null,
    productNameSnapshot: text(product.productName) || sku,
    catalogueNumberSnapshot: text(product.catalogueNumber) || sku,
    skuSnapshot: sku || null,
    categorySnapshot: null,
    quantityPacks, packSize,
    totalPieces: Number.parseInt(text(product.totalPieces), 10) || quantityPacks * packSize,
    unitPricePaise: unitPrice,
    packPricePaise: unitPrice * BigInt(packSize),
    listPriceTotalPaise: toPaise(product.grossAmount) ?? 0n,
    discountPercent: addPercents(product.baseDiscountPercent, product.requestedCustomDiscountPercent),
    discountAmountPaise: (toPaise(product.baseDiscountAmount) ?? 0n) + (toPaise(product.requestedCustomDiscountAmount) ?? 0n),
    finalAmountPaise: toPaise(product.finalAmount) ?? 0n,
    isPriority: Boolean(product.isPriority),
    remarks: null,
    productNote: orNull(product.productNote),
    createdAt,
  };
}

async function seedItems() {
  const orders = await prisma.order.findMany({
    where: { legacyPhpId: { not: null } },
    select: { id: true, legacyPhpId: true, grossAmountPaise: true, orderDate: true, dealer: { select: { legacyPhpId: true } } },
  });
  const orderByLegacy = new Map(orders.map((o) => [o.legacyPhpId, o]));
  const dryOrderDealer = new Map([
    ...activeOrders.map((r) => [text(r.order_id), text(r.order_dealer)]),
    ...cancelledOrders.map((r) => [text(r.orderId), text(r.dealerId)]),
    ...itemOnlyOrders.map(([id, rows]) => [id, text(rows[0].dealer_id)]),
  ]);
  for (const id of duplicateItemIds) report.warnings.push({ entity: "item", legacyId: id, warning: "orderdata_id repeated in allproductdata.json; first copy kept" });

  // Rows to write: every legacy item row, plus the snapshot of an approved discount request
  // for an order that has no item rows and whose snapshot total equals the order's gross.
  const planned = [];
  for (const row of itemRows) planned.push({ legacyOrderId: text(row.order_id), legacyDealer: text(row.dealer_id), data: legacyItemData(row), source: "allproductdata" });
  for (const req of discountRows) {
    const legacyOrderId = text(req.orderId);
    if (!legacyOrderId || itemsByOrder.has(legacyOrderId) || lower(req.status) !== "approved") continue;
    const products = req.orderSnapshot?.products ?? [];
    const order = orderByLegacy.get(legacyOrderId);
    const snapshotGross = products.reduce((s, p) => s + (toPaise(p.grossAmount) ?? 0n), 0n);
    if (order && snapshotGross !== order.grossAmountPaise) {
      report.warnings.push({ entity: "item", legacyOrderId, warning: `discount snapshot gross ${snapshotGross} ≠ order gross ${order.grossAmountPaise}; not used` });
      continue;
    }
    products.forEach((p, i) => planned.push({ legacyOrderId, legacyDealer: text(req.dealerId), data: snapshotItemData(legacyOrderId, p, i, order?.orderDate ?? legacyDate(req.linkedOrderAt)), source: "discount-snapshot" }));
  }

  const existing = new Set((await prisma.orderItem.findMany({ where: { legacyPhpOrderItemId: { in: planned.map((p) => p.data.legacyPhpOrderItemId) } }, select: { legacyPhpOrderItemId: true } })).map((r) => r.legacyPhpOrderItemId));
  const toCreate = [];
  const toUpdate = [];
  for (const p of planned) {
    const ctx = { entity: "item", legacyId: p.data.legacyPhpOrderItemId, legacyOrderId: p.legacyOrderId };
    const order = orderByLegacy.get(p.legacyOrderId);
    const orderDealer = order?.dealer.legacyPhpId ?? (mode === "dry-run" ? dryOrderDealer.get(p.legacyOrderId) : undefined);
    if (!orderDealer) { report.skipped.push({ ...ctx, reason: "order not seeded" }); count("items", "skipped"); continue; }
    // Isolation: an item only joins an order of the same dealer.
    if (orderDealer !== p.legacyDealer) { report.skipped.push({ ...ctx, reason: `item dealer ${p.legacyDealer} ≠ order dealer ${orderDealer}` }); count("items", "skipped"); continue; }
    const row = { ...p.data, orderId: order?.id };
    (existing.has(p.data.legacyPhpOrderItemId) ? toUpdate : toCreate).push(row);
    count("items", existing.has(p.data.legacyPhpOrderItemId) ? "updated" : "inserted");
    count("items", p.source);
  }
  const withoutItems = [...knownOrderIds].filter((id) => !itemsByOrder.has(id) && !planned.some((p) => p.legacyOrderId === id));
  report.ordersWithoutItems = withoutItems;

  if (write) {
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < toCreate.length; i += 500) {
        await tx.orderItem.createMany({ data: toCreate.slice(i, i + 500), skipDuplicates: true });
      }
      for (const row of toUpdate) {
        const { legacyPhpOrderItemId, ...data } = row;
        await tx.orderItem.update({ where: { legacyPhpOrderItemId }, data });
      }
    }, TX);
  }
}

// ── pending orders: no table; confirm each one maps to an open seeded order ──
async function checkPending() {
  const orders = await prisma.order.findMany({ where: { legacyPhpId: { in: pendingRows.map((r) => text(r.order_id)) } }, include: { dealer: { select: { legacyPhpId: true } } } });
  const byLegacy = new Map(orders.map((o) => [o.legacyPhpId, o]));
  const activeIds = new Set(activeOrders.map((r) => text(r.order_id)));
  for (const row of pendingRows) {
    const legacyId = text(row.order_id);
    const order = byLegacy.get(legacyId);
    if (!order) {
      if (mode === "dry-run" && activeIds.has(legacyId)) { count("pending", "would-match"); continue; }
      report.skipped.push({ entity: "pending", legacyId, reason: "no seeded order with this legacy id" }); count("pending", "unmatched"); continue;
    }
    const problems = [];
    if (["CANCELLED", "COMPLETED"].includes(order.status)) problems.push(`status ${order.status}`);
    if (order.dealer.legacyPhpId !== text(row.order_dealer)) problems.push(`dealer ${order.dealer.legacyPhpId} ≠ ${row.order_dealer}`);
    if (order.finalPayableAmountPaise !== toPaise(row.order_net_amount)) problems.push("net amount differs");
    if (problems.length) { report.warnings.push({ entity: "pending", legacyId, warning: problems.join("; ") }); count("pending", "mismatch"); }
    else count("pending", "matched-open");
  }
}

// ── discount requests ───────────────────────────────────────────────────────
const LEGACY_SOURCE = "mongo-custom-discount-requests";
async function seedDiscounts() {
  const dealerIds = await dealerIdsByLegacy();
  const orders = await prisma.order.findMany({ where: { legacyPhpId: { not: null } }, select: { id: true, legacyPhpId: true, dealerId: true } });
  const orderByLegacy = new Map(orders.map((o) => [o.legacyPhpId, o]));
  const jsonDealerIds = new Set(dealerRows.map((d) => text(d.Dealer_Id)));
  const jsonOrderIds = new Set([...activeOrders.map((r) => text(r.order_id)), ...cancelledOrders.map((r) => text(r.orderId))]);
  await runInTx(async (tx) => {
    for (const row of discountRows) {
      const legacyId = text(row.id);
      const ctx = { entity: "discountRequest", legacyId, legacyDealer: text(row.dealerId) };
      const dealerId = dealerIds.get(text(row.dealerId));
      if (!dealerId && !(mode === "dry-run" && jsonDealerIds.has(text(row.dealerId)))) {
        report.skipped.push({ ...ctx, reason: "dealer not found" }); count("discounts", "skipped"); continue;
      }
      const legacyOrderId = text(row.orderId);
      const order = legacyOrderId ? orderByLegacy.get(legacyOrderId) : null;
      const orderInJson = legacyOrderId && jsonOrderIds.has(legacyOrderId);
      if (legacyOrderId && !order && !(mode === "dry-run" && orderInJson)) report.warnings.push({ ...ctx, warning: `order ${legacyOrderId} not seeded; order_id NULL` });
      if (order && dealerId && order.dealerId !== dealerId) throw new Error(`discount ${legacyId}: order ${legacyOrderId} belongs to another dealer`);

      const status = text(row.status).toUpperCase();
      if (!["PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(status)) throw new Error(`discount ${legacyId}: unknown status ${row.status}`);
      const data = {
        dealerId, staffId: null, orderId: order?.id ?? null, orderDraftId: null,
        scope: text(row.discountScope).toUpperCase(),
        status, rsmApprovalStatus: status, nsmApprovalStatus: null,
        requestedDiscountPercent: percent(row.requestedDiscountPercent) ?? "0",
        currentDiscountPercent: percent(row.currentDiscountPercent) ?? "0",
        requestedOrderDiscountPercent: percent(row.requestedOrderDiscountPercent),
        requestedProductDiscounts: row.requestedProductDiscounts ?? Prisma.DbNull,
        targetProductKey: orNull(row.targetProduct?.productKey),
        grossAmountPaise: toPaise(row.subtotal),
        requestedDiscountAmountPaise: toPaise(row.requestedDiscountAmount),
        requestedNetPayableAmountPaise: toPaise(row.requestedFinalPayable),
        orderSignature: orNull(row.orderSignature),
        orderSnapshot: { ...row.orderSnapshot, legacySource: LEGACY_SOURCE, legacyId },
        adminNote: orNull(row.adminNote),
        allowReorder: Boolean(row.allowReorder),
        reviewedByUserId: null,
        createdAt: legacyDate(row.createdAt), updatedAt: legacyDate(row.updatedAt), reviewedAt: legacyDate(row.reviewedAt),
      };
      if (!["ORDER", "PRODUCT"].includes(data.scope)) throw new Error(`discount ${legacyId}: unknown scope ${row.discountScope}`);
      const existing = await tx.customDiscountRequest.findFirst({ where: { orderSnapshot: { path: ["legacyId"], equals: legacyId } }, select: { id: true } });
      if (write) {
        const saved = existing
          ? await tx.customDiscountRequest.update({ where: { id: existing.id }, data })
          : await tx.customDiscountRequest.create({ data });
        idMap.discountRequests[legacyId] = { customDiscountRequestId: saved.id.toString(), orderId: saved.orderId?.toString() ?? null };
      }
      count("discounts", existing ? "updated" : "inserted");
      if (order || (mode === "dry-run" && orderInJson)) count("discounts", "linked-to-order");
    }
  });
}

// ── verify ──────────────────────────────────────────────────────────────────
async function verify() {
  const sum = (list, f) => list.reduce((s, r) => s + f(r), 0n);
  const q = (sql) => prisma.$queryRawUnsafe(sql);
  const n = async (sql) => Number((await q(sql))[0].n);
  const out = {};
  out.counts = {
    staffUsers: await n(`SELECT count(*) n FROM users WHERE role IN ('NSM','RSM','ASM','STAFF')`), staffJson: staffRows.length,
    dealerUsers: await n(`SELECT count(*) n FROM dealer_profiles WHERE legacy_php_id IS NOT NULL`), dealersJson: dealerRows.length,
    orders: await n(`SELECT count(*) n FROM orders WHERE legacy_php_id IS NOT NULL`), ordersJson: activeOrders.length + cancelledOrders.length + itemOnlyOrders.length,
    cancelled: await n(`SELECT count(*) n FROM orders WHERE status = 'CANCELLED'`), cancelledJson: cancelledOrders.length,
    orderItems: await n(`SELECT count(*) n FROM order_items`),
    legacyItems: await n(`SELECT count(*) n FROM order_items WHERE legacy_php_order_item_id !~ '^discount-snapshot:'`), legacyItemsJson: itemRows.length,
    snapshotItems: await n(`SELECT count(*) n FROM order_items WHERE legacy_php_order_item_id ~ '^discount-snapshot:'`),
    ordersWithoutItems: (await q(`SELECT o.legacy_php_id FROM orders o WHERE o.legacy_php_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id) ORDER BY o.legacy_php_id::int`)).map((r) => r.legacy_php_id),
    discountRequests: await n(`SELECT count(*) n FROM custom_discount_requests WHERE order_snapshot->>'legacyId' IS NOT NULL`), discountJson: discountRows.length,
  };
  out.isolation = {
    ordersWithMissingDealer: await n(`SELECT count(*) n FROM orders o LEFT JOIN dealer_profiles d ON d.id = o.dealer_id WHERE d.id IS NULL`),
    // Items carry no dealer column; they inherit it through order_id, so an orphan is the only way to leak.
    orphanItems: await n(`SELECT count(*) n FROM order_items i LEFT JOIN orders o ON o.id = i.order_id WHERE o.id IS NULL`),
    discountOrderDealerMismatch: await n(`SELECT count(*) n FROM custom_discount_requests c JOIN orders o ON o.id = c.order_id WHERE o.dealer_id <> c.dealer_id`),
    ordersWhoseDealerDiffersFromJson: 0,
  };
  const rows = await q(`SELECT o.legacy_php_id, d.legacy_php_id dealer, o.gross_amount_paise, o.total_discount_amount_paise, o.final_payable_amount_paise, o.status FROM orders o JOIN dealer_profiles d ON d.id = o.dealer_id WHERE o.legacy_php_id IS NOT NULL`);
  const dbOrders = new Map(rows.map((r) => [r.legacy_php_id, r]));
  for (const r of activeOrders) if (dbOrders.get(text(r.order_id))?.dealer !== text(r.order_dealer)) out.isolation.ordersWhoseDealerDiffersFromJson += 1;
  for (const r of cancelledOrders) if (dbOrders.get(text(r.orderId))?.dealer !== text(r.dealerId)) out.isolation.ordersWhoseDealerDiffersFromJson += 1;
  // Each legacy item must sit under an order of the dealer the item row names.
  const dbItems = await q(`SELECT i.legacy_php_order_item_id id, o.legacy_php_id order_id, d.legacy_php_id dealer FROM order_items i JOIN orders o ON o.id = i.order_id JOIN dealer_profiles d ON d.id = o.dealer_id`);
  const itemJson = new Map(itemRows.map((r) => [text(r.orderdata_id), r]));
  out.isolation.itemsUnderWrongOrderOrDealer = dbItems.filter((i) => itemJson.has(i.id) && (itemJson.get(i.id).order_id !== i.order_id || itemJson.get(i.id).dealer_id !== i.dealer)).length;
  out.isolation.legacyItemsMissingFromDb = itemRows.length - dbItems.filter((i) => itemJson.has(i.id)).length;
  const [itemSums] = await q(`SELECT COALESCE(SUM(list_price_total_paise),0)::bigint gross, COALESCE(SUM(discount_amount_paise),0)::bigint discount, COALESCE(SUM(final_amount_paise),0)::bigint final FROM order_items WHERE legacy_php_order_item_id !~ '^discount-snapshot:'`);
  const jsonItemSums = { gross: sum(itemRows, (r) => toPaise(r.orderdata_totalprice)), discount: sum(itemRows, (r) => toPaise(r.orderdata_discount)), final: sum(itemRows, (r) => toPaise(r.orderdata_afterDisPrice)) };
  out.itemMoney = Object.fromEntries(Object.keys(jsonItemSums).map((k) => [k, { json: jsonItemSums[k].toString(), db: itemSums[k].toString(), match: jsonItemSums[k] === itemSums[k] }]));
  out.ordersWhereItemsDifferFromHeader = (await q(`SELECT o.legacy_php_id id, o.gross_amount_paise::text header, SUM(i.list_price_total_paise)::text items FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.status <> 'CANCELLED' GROUP BY o.id HAVING SUM(i.list_price_total_paise) <> o.gross_amount_paise ORDER BY o.legacy_php_id::int`)).length;

  out.roles = {
    staffWithoutValidRole: await n(`SELECT count(*) n FROM staff_profiles s JOIN users u ON u.id = s.user_id WHERE u.role NOT IN ('NSM','RSM','ASM','STAFF')`),
    byRole: await q(`SELECT u.role::text role, s.staff_role_type, count(*)::int n FROM staff_profiles s JOIN users u ON u.id = s.user_id GROUP BY 1, 2 ORDER BY 1, 2`),
  };
  out.untagged = {
    dealerStaffAssignments: await n(`SELECT count(*) n FROM dealer_staff_assignments`),
    staffRsmLinks: await n(`SELECT count(*) n FROM staff_rsm_links`),
    staffWithParent: await n(`SELECT count(*) n FROM staff_profiles WHERE parent_rsm_id IS NOT NULL OR parent_asm_id IS NOT NULL OR reporting_manager_id IS NOT NULL`),
    dealersWithRsm: await n(`SELECT count(*) n FROM dealer_profiles WHERE rsm_user_id IS NOT NULL OR created_by_user_id IS NOT NULL`),
  };
  out.spotCheck = ["214", "219", "223", "217", "1"].map((id) => {
    const j = activeOrders.find((r) => text(r.order_id) === id);
    const d = dbOrders.get(id);
    const expect = { gross: toPaise(j.order_amount), discount: toPaise(j.order_discount_amount), net: toPaise(j.order_net_amount) };
    const got = { gross: d?.gross_amount_paise, discount: d?.total_discount_amount_paise, net: d?.final_payable_amount_paise };
    return { id, json: `${expect.gross}/${expect.discount}/${expect.net}`, db: `${got.gross}/${got.discount}/${got.net}`, ok: expect.gross === got.gross && expect.discount === got.discount && expect.net === got.net };
  });
  const jsonGross = sum(activeOrders, (r) => toPaise(r.order_amount)) + sum(cancelledOrders, (r) => toPaise(r.originalOrderRef.order_amount))
    + sum(itemOnlyOrders, ([, rows]) => sum(rows, (r) => toPaise(r.orderdata_totalprice)));
  const jsonNetActive = sum(activeOrders, (r) => toPaise(r.order_net_amount))
    + sum(itemOnlyOrders, ([, rows]) => sum(rows, (r) => toPaise(r.orderdata_totalprice) - toPaise(r.orderdata_discount)));
  const [dbSums] = await q(`SELECT COALESCE(SUM(gross_amount_paise),0)::bigint gross, COALESCE(SUM(final_payable_amount_paise) FILTER (WHERE status <> 'CANCELLED'),0)::bigint net_active FROM orders WHERE legacy_php_id IS NOT NULL`);
  out.totals = { jsonGrossPaise: jsonGross.toString(), dbGrossPaise: dbSums.gross.toString(), grossMatch: jsonGross === dbSums.gross, jsonNetActivePaise: jsonNetActive.toString(), dbNetActivePaise: dbSums.net_active.toString(), netMatch: jsonNetActive === dbSums.net_active };
  out.sequences = await q(`SELECT s.sequencename, s.last_value::text last_value, m.max_id::text max_id, (s.last_value >= COALESCE(m.max_id,0)) ok FROM pg_sequences s CROSS JOIN LATERAL (SELECT CASE s.sequencename
      WHEN 'users_id_seq' THEN (SELECT max(id) FROM users) WHEN 'staff_profiles_id_seq' THEN (SELECT max(id) FROM staff_profiles)
      WHEN 'dealer_profiles_id_seq' THEN (SELECT max(id) FROM dealer_profiles) WHEN 'orders_id_seq' THEN (SELECT max(id) FROM orders)
      WHEN 'custom_discount_requests_id_seq' THEN (SELECT max(id) FROM custom_discount_requests) END max_id) m
    WHERE s.schemaname = 'public' AND s.sequencename IN ('users_id_seq','staff_profiles_id_seq','dealer_profiles_id_seq','orders_id_seq','custom_discount_requests_id_seq')`);
  out.orderSequence = (await q(`SELECT year, last_value::text, (SELECT max(legacy_php_id::int) FROM orders WHERE legacy_php_id ~ '^[0-9]+$') max_legacy FROM order_sequences`));
  return out;
}

// ── main ────────────────────────────────────────────────────────────────────
// The link to Render drops connections now and then. Each step is one transaction and
// idempotent, so a dropped step is re-run from scratch (report state restored first).
const TRANSIENT = /Connection terminated|closed the connection|ECONNRESET|terminating connection|Can't reach database/i;
async function step(fn) {
  for (let attempt = 1; ; attempt += 1) {
    const saved = JSON.stringify(report);
    try { return await fn(); } catch (error) {
      if (attempt >= 4 || !TRANSIENT.test(String(error?.message))) throw error;
      Object.assign(report, JSON.parse(saved));
      console.error(`${fn.name}: connection dropped (${error.message}); retry ${attempt}/3 in 5s`);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

try {
  if (mode === "verify") {
    const result = await step(verify);
    await mkdir(EXPORT_DIR, { recursive: true });
    await writeFile(`${EXPORT_DIR}/seed-verify.json`, `${JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)}\n`);
    console.log(JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  } else {
    if (only.has("staff")) await step(seedStaff);
    if (only.has("dealers")) await step(seedDealers);
    if (only.has("orders")) await step(seedOrders);
    if (only.has("items")) await step(seedItems);
    if (only.has("pending")) await step(checkPending);
    if (only.has("discounts")) await step(seedDiscounts);
    await mkdir(EXPORT_DIR, { recursive: true });
    await writeFile(`${EXPORT_DIR}/seed-report.json`, `${JSON.stringify(report, null, 2)}\n`);
    if (write) await writeFile(`${EXPORT_DIR}/id-map.json`, `${JSON.stringify(idMap, null, 2)}\n`);
    console.log(JSON.stringify({ counts: report.counts, orderSequence: report.orderSequence, ordersWithoutItems: report.ordersWithoutItems, skipped: report.skipped, warnings: report.warnings, defaultedRoles: report.defaultedRoles, derivedCount: report.derived.length, lineItems: report.lineItems }, null, 2));
  }
} finally {
  await prisma.$disconnect();
}
