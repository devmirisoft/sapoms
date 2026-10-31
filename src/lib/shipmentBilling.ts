import "server-only";

import { prisma } from "@/server/db/prisma";
import type { AuthActor } from "@/server/auth/session";
import { AUDIT_ACTION, AUDIT_ENTITY } from "@/lib/auditActions";
import { createAuditLog } from "@/server/audit/audit-log";

// Linking a shipment to a ledger bill is what moves it to Dispatch Tracking's
// Billed Shipments tab. New bills link through recordLedgerBill; these cover an
// existing bill and undoing a wrong link (ledger bills cannot be deleted).

type ShipmentOrder = { id: bigint; dealerId: bigint; legacyPhpId: string | null; orderNumber: string };

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

function parseId(raw: unknown, label: string) {
  const text = String(raw ?? "").trim();
  if (!/^\d{1,18}$/.test(text)) fail(400, `Invalid ${label}.`);
  return BigInt(text);
}

// recordLedgerBill stores each order as its legacyPhpId, else the number the accountant picked.
function orderKeys(order: ShipmentOrder) {
  return [order.legacyPhpId, order.orderNumber, order.id.toString()].filter((key): key is string => !!key);
}

function billCoversOrder(bill: { orderId: bigint | null; orderNumber: string }, order: ShipmentOrder) {
  if (bill.orderId === order.id) return true;
  const keys = orderKeys(order);
  return bill.orderNumber.split(",").some((value) => keys.includes(value.trim()));
}

async function loadShipment(actor: AuthActor, rawShipmentId: unknown) {
  if (actor.role !== "ACCOUNTANT") fail(403, "Only Accountant can bill shipments.");
  const shipment = await prisma.orderShipment.findUnique({
    where: { id: parseId(rawShipmentId, "shipment id") },
    select: {
      id: true,
      ledgerBillId: true,
      order: { select: { id: true, dealerId: true, legacyPhpId: true, orderNumber: true } },
    },
  });
  if (!shipment) fail(404, "Shipment not found.");
  return shipment;
}

/** The dealer's ledger bills raised against this shipment's order. */
export async function listLinkableBills(actor: AuthActor, rawShipmentId: unknown) {
  const { order } = await loadShipment(actor, rawShipmentId);
  const bills = await prisma.ledgerBill.findMany({
    where: {
      dealerId: order.dealerId,
      OR: [{ orderId: order.id }, ...orderKeys(order).map((key) => ({ orderNumber: { contains: key } }))],
    },
    orderBy: { billDate: "desc" },
    take: 50,
    select: {
      id: true,
      orderId: true,
      orderNumber: true,
      billNumber: true,
      billDate: true,
      billAmountPaise: true,
      _count: { select: { shipments: true } },
    },
  });

  return bills
    .filter((bill) => billCoversOrder(bill, order))
    .map((bill) => ({
      id: bill.id.toString(),
      billNumber: bill.billNumber ?? "",
      billDate: bill.billDate.toISOString().slice(0, 10),
      billAmount: Number(bill.billAmountPaise) / 100,
      orderNumber: bill.orderNumber,
      shipmentCount: bill._count.shipments,
    }));
}

export async function linkShipmentBill(actor: AuthActor, rawShipmentId: unknown, rawBillId: unknown) {
  const shipment = await loadShipment(actor, rawShipmentId);
  const bill = await prisma.ledgerBill.findFirst({
    where: { id: parseId(rawBillId, "bill id"), dealerId: shipment.order.dealerId },
    select: { id: true, orderId: true, orderNumber: true },
  });
  if (!bill || !billCoversOrder(bill, shipment.order)) fail(400, "That bill isn't for this order.");

  await prisma.$transaction(async (tx) => {
    const linked = await tx.orderShipment.updateMany({
      where: { id: shipment.id, ledgerBillId: null },
      data: { ledgerBillId: bill.id },
    });
    if (linked.count === 0) fail(409, "This shipment is already billed.");
    await createAuditLog({
      tx, actor, action: AUDIT_ACTION.UPDATE, entity: AUDIT_ENTITY.INVOICE, entityId: bill.id,
      newValues: { shipmentId: shipment.id.toString() },
      metadata: { change: "shipment_billed", orderNumber: shipment.order.orderNumber },
    });
  });
}

export async function unlinkShipmentBill(actor: AuthActor, rawShipmentId: unknown) {
  const shipment = await loadShipment(actor, rawShipmentId);
  const billId = shipment.ledgerBillId;
  if (!billId) fail(409, "This shipment isn't billed.");

  await prisma.$transaction(async (tx) => {
    const unlinked = await tx.orderShipment.updateMany({
      where: { id: shipment.id, ledgerBillId: billId },
      data: { ledgerBillId: null },
    });
    if (unlinked.count === 0) fail(409, "This shipment changed meanwhile. Reload and try again.");
    await createAuditLog({
      tx, actor, action: AUDIT_ACTION.UPDATE, entity: AUDIT_ENTITY.INVOICE, entityId: billId,
      oldValues: { shipmentId: shipment.id.toString() },
      metadata: { change: "shipment_unbilled", orderNumber: shipment.order.orderNumber },
    });
  });
}
