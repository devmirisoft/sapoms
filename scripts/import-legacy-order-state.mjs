#!/usr/bin/env node
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { MongoClient, ObjectId } from "mongodb";
import { WalletTransactionType } from "@prisma/client";
import { PrismaClient } from './prisma.mjs';

const LEGACY_SOURCE = "mongo-order-state";
const DEFAULT_LIMIT = 100;
const MONGO_TIMEOUT_MS = 10_000;

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function text(value, max = 1200) {
  return String(value ?? "").trim().slice(0, max);
}

function firstText(...values) {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return "";
}

function normalizeLookup(value) {
  const raw = text(value, 120);
  const match = raw.match(/(?:^|\/)(\d+)$/);
  return match?.[1] ?? raw;
}

function numberValue(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function intValue(value) {
  return Math.max(0, Math.trunc(numberValue(value)));
}

function paise(value) {
  return BigInt(Math.round(numberValue(value) * 100));
}

function parseDate(value, fallback = new Date()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (value instanceof ObjectId) return value.getTimestamp();
  const raw = text(value, 120);
  if (!raw) return fallback;
  const parsed = new Date(raw.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function legacyId(collection, doc, suffix = "") {
  const explicit = firstText(doc._id?.toString?.(), doc.id, doc.legacyId, doc.idempotencyKey, doc.source_request_id);
  const payload = explicit || JSON.stringify(doc);
  const hash = createHash("sha256").update(`${collection}:${payload}:${suffix}`).digest("hex").slice(0, 32);
  return `${collection}:${explicit || hash}${suffix ? `:${suffix}` : ""}`.slice(0, 240);
}

function noteText(doc) {
  return firstText(doc.note, doc.text, doc.message, doc.orderNote, doc.order_note, doc.remark, doc.remarks);
}

function orderIdFrom(doc) {
  return normalizeLookup(firstText(doc.orderId, doc.order_id, doc.orderdata_orderid, doc.legacyOrderId, doc.legacyPhpId, doc.relatedOrderId, doc.order?.id, doc.order?._id));
}

function actorFrom(doc) {
  const role = firstText(doc.actorRole, doc.actor_role, doc.role, doc.actor?.role, doc.createdBy?.role).toUpperCase();
  const validRole = ["ADMIN", "ACCOUNTANT", "STAFF", "DEALER"].includes(role) ? role : null;
  return {
    actorRole: validRole,
    actorLegacyId: firstText(doc.actorUserId, doc.actorId, doc.actor_id, doc.createdById, doc.actor?.id, doc.createdBy?.id),
    actorName: firstText(doc.actorName, doc.actor_name, doc.actor?.name, doc.createdBy?.name),
  };
}

async function resolveActorUserId(prisma, actor) {
  if (!actor.actorLegacyId) return null;
  if (actor.actorRole === "DEALER") {
    const row = await prisma.dealerProfile.findFirst({ where: { OR: [{ id: /^\d+$/.test(actor.actorLegacyId) ? BigInt(actor.actorLegacyId) : -1n }, { dealerCode: actor.actorLegacyId }] }, select: { userId: true } });
    return row?.userId ?? null;
  }
  if (actor.actorRole === "STAFF" && /^\d+$/.test(actor.actorLegacyId)) {
    const row = await prisma.staffProfile.findUnique({ where: { id: BigInt(actor.actorLegacyId) }, select: { userId: true } });
    return row?.userId ?? null;
  }
  if ((actor.actorRole === "ADMIN" || actor.actorRole === "ACCOUNTANT") && /^\d+$/.test(actor.actorLegacyId)) return BigInt(actor.actorLegacyId);
  return null;
}

async function resolveOrder(prisma, value) {
  const lookup = normalizeLookup(value);
  if (!lookup) return null;
  const id = /^\d+$/.test(lookup) ? BigInt(lookup) : null;
  return prisma.order.findFirst({
    where: { OR: [...(id ? [{ id }] : []), { legacyPhpId: lookup }, { orderNumber: lookup }] },
    include: { items: { orderBy: { id: "asc" } }, dealer: { include: { wallet: true } } },
  });
}

function normalizeSku(value) {
  return text(value, 200).toLowerCase().replace(/\s+/g, "");
}

function findOrderItem(order, doc, unresolved, legacyRowId) {
  const itemId = firstText(doc.orderItemId, doc.order_item_id, doc.orderdata_id, doc.itemId, doc.lineId);
  if (itemId) {
    const item = order.items.find((row) => row.legacyPhpOrderItemId === itemId || row.id.toString() === itemId);
    if (item) return item;
  }
  const sku = normalizeSku(firstText(doc.sku, doc.normalizedSku, doc.orderdata_cat_no, doc.catNo, doc.catalogueNumber, doc.productId));
  if (!sku) return null;
  const occurrence = Math.max(1, intValue(doc.occurrence) || 1);
  const matches = order.items.filter((row) => normalizeSku(row.skuSnapshot || row.catalogueNumberSnapshot || row.productNameSnapshot) === sku);
  if (matches.length === 1) return matches[0];
  if (matches.length >= occurrence) return matches[occurrence - 1];
  unresolved.push({ legacyId: legacyRowId, orderId: order.id.toString(), reason: matches.length ? "item_occurrence_out_of_range" : "item_not_found", sku, occurrence });
  return null;
}

function overlayEvents(doc) {
  const events = [];
  if (doc.cancellation || text(doc.status).toLowerCase() === "cancelled" || text(doc.type).toLowerCase() === "cancel") {
    const cancellation = doc.cancellation ?? doc;
    events.push({ type: "cancel", status: "cancelled", value: "CANCELLED", reason: firstText(cancellation.reason, doc.reason), metadata: doc, at: parseDate(firstText(cancellation.cancelledAt, doc.cancelledAt, doc.updatedAt, doc.createdAt), parseDate(doc._id)) });
  }
  if (doc.acceptance || ["accepted", "acceptance"].includes(text(doc.type).toLowerCase())) {
    const acceptance = doc.acceptance ?? doc;
    events.push({ type: "acceptance", status: "accepted", value: "ACCEPTED", reason: firstText(doc.reason), metadata: doc, at: parseDate(firstText(acceptance.acceptedAt, doc.acceptedAt, doc.updatedAt, doc.createdAt), parseDate(doc._id)) });
  }
  if (Array.isArray(doc.edits)) {
    for (const edit of doc.edits) events.push({ type: "edit", status: "edited", value: firstText(edit.revision, doc.latestRevision), reason: firstText(edit.reason), metadata: edit, at: parseDate(firstText(edit.editedAt, edit.createdAt, doc.updatedAt), parseDate(doc._id)) });
  }
  if (["status", "fulfilment", "fulfillment"].includes(text(doc.type).toLowerCase())) {
    events.push({ type: "status", status: text(doc.status, 80).toLowerCase() || null, value: firstText(doc.value, doc.status), reason: firstText(doc.reason), metadata: doc, at: parseDate(firstText(doc.updatedAt, doc.createdAt), parseDate(doc._id)) });
  }
  return events;
}

function reconcileOrderPatch(order, event) {
  const patch = {};
  if (event.type === "cancel") {
    const canApply = !order.cancelledAt || event.at >= order.cancelledAt;
    if (canApply) Object.assign(patch, { status: "CANCELLED", acceptanceStatus: order.acceptanceStatus === "ACCEPTED" ? "ACCEPTED" : order.acceptanceStatus, fulfilmentStatus: order.fulfilmentStatus, cancelledAt: event.at, cancellationReason: event.reason || order.cancellationReason || "Cancelled in legacy Mongo" });
  }
  if (event.type === "acceptance") {
    const canApply = order.status !== "CANCELLED" && (!order.acceptedAt || event.at >= order.acceptedAt);
    if (canApply) Object.assign(patch, { status: order.status === "AWAITING_ACCEPTANCE" ? "ACCEPTED" : order.status, acceptanceStatus: "ACCEPTED", acceptedAt: event.at });
  }
  if (event.type === "status") {
    const value = text(event.value).toUpperCase();
    const statusMap = { CANCELLED: "CANCELLED", ACCEPTED: "ACCEPTED", DISPATCHED: "DISPATCHED", COMPLETED: "COMPLETED", READY: "READY", PARTIALLY_READY: "PARTIALLY_READY", PROCESSING: "PROCESSING" };
    if (statusMap[value] && order.status !== "CANCELLED") patch.status = statusMap[value];
  }
  return patch;
}

async function importNotes({ prisma, db, limit, orderId, dryRun, stats, unresolved }) {
  const query = orderId ? { $or: [{ orderId }, { order_id: orderId }, { orderdata_orderid: orderId }] } : {};
  const docs = await db.collection("order_notes").find(query).limit(limit).toArray();
  stats.collections.order_notes = docs.length;
  for (const doc of docs) {
    const lid = legacyId("order_notes", doc);
    const order = await resolveOrder(prisma, orderIdFrom(doc));
    const note = noteText(doc);
    if (!order || !note) { stats.notes.unresolved++; unresolved.notes.push({ legacyId: lid, orderId: orderIdFrom(doc), reason: !order ? "order_not_found" : "blank_note" }); continue; }
    const existing = await prisma.orderNote.findUnique({ where: { legacySource_legacyId: { legacySource: LEGACY_SOURCE, legacyId: lid } } });
    if (existing) { stats.notes.skipped++; continue; }
    stats.notes.imported++;
    if (dryRun) continue;
    const actor = actorFrom(doc);
    const actorUserId = await resolveActorUserId(prisma, actor);
    const createdAt = parseDate(firstText(doc.createdAt, doc.created_at, doc._id), new Date());
    const updatedAt = parseDate(firstText(doc.updatedAt, doc.updated_at, doc.createdAt), createdAt);
    await prisma.$transaction(async (tx) => {
      await tx.orderNote.create({ data: { orderId: order.id, note, actorUserId, actorRole: actor.actorRole, legacySource: LEGACY_SOURCE, legacyId: lid, createdAt, updatedAt } });
      const latest = await tx.orderNote.findFirst({ where: { orderId: order.id }, orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }] });
      if (latest) await tx.order.update({ where: { id: order.id }, data: { note: latest.note } });
    });
  }
}

async function importOverlays({ prisma, db, limit, orderId, dryRun, stats, unresolved }) {
  const query = orderId ? { orderId } : {};
  const docs = await db.collection("order_overlays").find(query).limit(limit).toArray();
  stats.collections.order_overlays = docs.length;
  for (const doc of docs) {
    const order = await resolveOrder(prisma, orderIdFrom(doc));
    if (!order) { stats.overlays.unresolved++; unresolved.overlays.push({ legacyId: legacyId("order_overlays", doc), orderId: orderIdFrom(doc), reason: "order_not_found" }); continue; }
    for (const event of overlayEvents(doc)) {
      const lid = legacyId("order_overlays", doc, event.type === "edit" ? `rev-${event.value}` : event.type);
      const existing = await prisma.orderOverlay.findUnique({ where: { legacySource_legacyId: { legacySource: LEGACY_SOURCE, legacyId: lid } } });
      if (existing) { stats.overlays.skipped++; continue; }
      stats.overlays.imported++;
      const patch = reconcileOrderPatch(order, event);
      if (Object.keys(patch).length) stats.orderReconciliation.updated++;
      if (dryRun) continue;
      const actor = actorFrom(event.metadata);
      const actorUserId = await resolveActorUserId(prisma, actor);
      await prisma.$transaction(async (tx) => {
        await tx.orderOverlay.create({ data: { orderId: order.id, type: event.type, status: event.status, value: event.value ? String(event.value) : null, reason: event.reason || null, metadata: event.metadata, actorUserId, actorRole: actor.actorRole, legacySource: LEGACY_SOURCE, legacyId: lid, createdAt: event.at, updatedAt: event.at } });
        if (Object.keys(patch).length) await tx.order.update({ where: { id: order.id }, data: patch });
      });
    }
  }
}

function dispatchEvents(doc) {
  if (Array.isArray(doc.updates) && doc.updates.length) return doc.updates.map((update, index) => ({ ...doc, ...update, _dispatchIndex: index }));
  return [doc];
}

function dispatchStatus(value) {
  const raw = text(value).toLowerCase();
  if (["successful", "success", "4", "dispatched", "2"].includes(raw)) return "DISPATCHED";
  if (["ready", "partially_ready", "packing", "1", "not_in_stock", "3"].includes(raw)) return "IN_PROCESS";
  return "DISPATCHED";
}

async function importDispatch({ prisma, db, limit, orderId, dryRun, stats, unresolved }) {
  const query = orderId ? { orderId } : {};
  const docs = await db.collection("order_dispatch_records").find(query).limit(limit).toArray();
  stats.collections.order_dispatch_records = docs.length;
  for (const doc of docs) {
    const order = await resolveOrder(prisma, orderIdFrom(doc));
    if (!order) { stats.dispatch.unresolved++; unresolved.dispatch.push({ legacyId: legacyId("order_dispatch_records", doc), orderId: orderIdFrom(doc), reason: "order_not_found" }); continue; }
    for (const event of dispatchEvents(doc)) {
      const lid = legacyId("order_dispatch_records", doc, String(event._dispatchIndex ?? "base"));
      const existing = await prisma.orderItemDispatch.findUnique({ where: { legacySource_legacyId: { legacySource: LEGACY_SOURCE, legacyId: lid } } });
      if (existing) { stats.dispatch.skipped++; continue; }
      const item = findOrderItem(order, event, unresolved.dispatch, lid);
      const quantity = intValue(firstText(event.quantity, event.dispatchQuantity, event.dispatchedQuantity, event.readyquantity));
      if (!item || quantity <= 0) { stats.dispatch.unresolved++; if (quantity <= 0) unresolved.dispatch.push({ legacyId: lid, orderId: order.id.toString(), reason: "invalid_quantity" }); continue; }
      const already = await prisma.orderItemDispatch.aggregate({ where: { orderItemId: item.id }, _sum: { quantity: true } });
      if ((already._sum.quantity ?? 0) + quantity > item.quantityPacks) { stats.dispatch.unresolved++; unresolved.dispatch.push({ legacyId: lid, orderId: order.id.toString(), orderItemId: item.id.toString(), reason: "over_dispatch" }); continue; }
      stats.dispatch.imported++;
      if (dryRun) continue;
      const actor = actorFrom(event);
      const actorUserId = await resolveActorUserId(prisma, actor);
      const at = parseDate(firstText(event.createdAt, event.updatedAt, doc.createdAt, doc.updatedAt), parseDate(doc._id));
      await prisma.$transaction(async (tx) => {
        await tx.orderItemDispatch.create({ data: { orderId: order.id, orderItemId: item.id, quantity, status: dispatchStatus(event.status ?? event.currentStatus), remark: firstText(event.remark, event.remarks) || null, actorUserId, actorRole: actor.actorRole, legacySource: LEGACY_SOURCE, legacyId: lid, createdAt: at } });
        const sums = await tx.orderItemDispatch.groupBy({ by: ["orderItemId"], where: { orderId: order.id }, _sum: { quantity: true } });
        const totalDispatched = sums.reduce((sum, row) => sum + (row._sum.quantity ?? 0), 0);
        const totalOrdered = order.items.reduce((sum, row) => sum + row.quantityPacks, 0);
        const fulfilmentStatus = totalDispatched <= 0 ? "PENDING" : totalDispatched < totalOrdered ? "IN_PROCESS" : "DISPATCHED";
        await tx.order.update({ where: { id: order.id }, data: { fulfilmentStatus, status: fulfilmentStatus === "DISPATCHED" ? "DISPATCHED" : order.status === "AWAITING_ACCEPTANCE" ? "ACCEPTED" : order.status, dispatchedAt: fulfilmentStatus === "DISPATCHED" ? at : order.dispatchedAt } });
      });
    }
  }
}

function walletType(value) {
  const raw = text(value).toLowerCase();
  if (raw.includes("refund")) return WalletTransactionType.REFUND;
  if (raw.includes("order")) return WalletTransactionType.ORDER_DEBIT;
  if (raw.includes("credit")) return WalletTransactionType.CREDIT;
  if (raw.includes("debit")) return WalletTransactionType.DEBIT;
  return null;
}

async function importWallet({ prisma, db, limit, orderId, dryRun, stats, unresolved }) {
  const query = orderId ? { $or: [{ relatedOrderId: orderId }, { orderId }, { order_id: orderId }, { "metadata.orderId": orderId }] } : { $or: [{ relatedOrderId: { $exists: true } }, { orderId: { $exists: true } }, { order_id: { $exists: true } }, { "metadata.orderId": { $exists: true } }] };
  const docs = await db.collection("wallet_transactions").find(query).limit(limit).toArray();
  stats.collections.wallet_transactions = docs.length;
  for (const doc of docs) {
    const type = walletType(doc.type);
    const linkedOrderId = orderIdFrom(doc) || normalizeLookup(doc.metadata?.orderId);
    const order = linkedOrderId ? await resolveOrder(prisma, linkedOrderId) : null;
    if (!type || !order || (type !== WalletTransactionType.ORDER_DEBIT && type !== WalletTransactionType.REFUND)) { stats.wallet.unresolved++; unresolved.wallet.push({ legacyId: legacyId("wallet_transactions", doc), orderId: linkedOrderId, reason: !type ? "unsupported_type" : !order ? "order_not_found" : "not_order_visibility_accounting" }); continue; }
    const wallet = order.dealer.wallet ?? await prisma.dealerWallet.create({ data: { dealerId: order.dealerId, status: "ACTIVE" } });
    const lid = firstText(doc.idempotencyKey) || legacyId("wallet_transactions", doc);
    const idem = `legacy-mongo-wallet:${lid}`.slice(0, 240);
    const existing = await prisma.walletTransaction.findUnique({ where: { idempotencyKey: idem } });
    if (existing) { stats.wallet.skipped++; continue; }
    stats.wallet.imported++;
    if (dryRun) continue;
    await prisma.walletTransaction.create({ data: { dealerId: order.dealerId, walletId: wallet.id, orderId: order.id, type, amountPaise: paise(doc.amount ?? doc.amountPaise), balanceBeforePaise: paise(doc.balanceBefore ?? doc.balanceBeforePaise), balanceAfterPaise: paise(doc.balanceAfter ?? doc.balanceAfterPaise), idempotencyKey: idem, reference: firstText(doc.reference, doc.relatedOrderNumber) || null, note: firstText(doc.note, doc.reason) || "Imported legacy order wallet transaction", metadata: { source: LEGACY_SOURCE, legacyId: lid, rawType: doc.type }, createdAt: parseDate(firstText(doc.createdAt, doc.transactionDate), parseDate(doc._id)) } });
  }
}

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGODB_URI is required");
  const dbName = process.env.MONGODB_DB_NAME || "omsons";
  const limit = Math.max(1, Number(argValue("limit", String(DEFAULT_LIMIT))) || DEFAULT_LIMIT);
  const orderId = normalizeLookup(argValue("order-id", ""));
  const dryRun = hasFlag("dry-run") || !hasFlag("apply");
  const resume = hasFlag("resume");
  const prisma = new PrismaClient();
  const mongo = new MongoClient(mongoUri, { serverSelectionTimeoutMS: MONGO_TIMEOUT_MS, connectTimeoutMS: MONGO_TIMEOUT_MS });
  const stats = { dryRun, resume, collections: {}, notes: { imported: 0, skipped: 0, unresolved: 0 }, overlays: { imported: 0, skipped: 0, unresolved: 0 }, dispatch: { imported: 0, skipped: 0, unresolved: 0 }, wallet: { imported: 0, skipped: 0, unresolved: 0 }, orderReconciliation: { updated: 0 } };
  const unresolved = { notes: [], overlays: [], dispatch: [], wallet: [] };
  try {
    await mongo.connect();
    const db = mongo.db(dbName);
    await importNotes({ prisma, db, limit, orderId, dryRun, stats, unresolved });
    await importOverlays({ prisma, db, limit, orderId, dryRun, stats, unresolved });
    await importDispatch({ prisma, db, limit, orderId, dryRun, stats, unresolved });
    await importWallet({ prisma, db, limit, orderId, dryRun, stats, unresolved });
    if (!dryRun) await writeFile("legacy-order-state-unresolved.json", JSON.stringify(unresolved, null, 2));
    console.log(JSON.stringify({ ...stats, unresolved }, null, 2));
  } finally {
    await mongo.close().catch(() => {});
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});