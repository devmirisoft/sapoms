import type { OrderAcceptanceStatus, OrderFulfilmentStatus, OrderStatus } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { AuthActor } from "@/server/auth/session";
import { buildOrderRegionWhere, isStaffLike } from "@/server/auth/sales-scope";

export class PostgresOrderStatusError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PostgresOrderStatusError";
    this.status = status;
    this.code = code;
  }
}

type StatusOrder = NonNullable<Awaited<ReturnType<typeof findPostgresStatusOrder>>>;

const fulfilmentFlow: OrderFulfilmentStatus[] = [
  "PENDING",
  "IN_PROCESS",
  "PARTIALLY_READY",
  "READY",
  "DISPATCHED",
  "COMPLETED",
];

function normalizeLookup(value: unknown) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/(?:^|\/)(\d+)$/);
  return match?.[1] ?? raw;
}

export function legacyAcceptOrderAlias(status: OrderAcceptanceStatus) {
  if (status === "ACCEPTED") return "1";
  if (status === "DECLINED") return "2";
  return "0";
}

export function legacyDelStatusAlias(status: OrderStatus) {
  return status === "CANCELLED" ? "1" : "0";
}

function orderStatusForFulfilment(status: OrderFulfilmentStatus): OrderStatus {
  if (status === "PENDING") return "ACCEPTED";
  if (status === "IN_PROCESS") return "PROCESSING";
  return status;
}

export function normalizeFulfilmentStatus(value: unknown): OrderFulfilmentStatus | null {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (normalized === "INPROCESS") return "IN_PROCESS";
  if (normalized === "PARTIAL" || normalized === "PARTIALLYREADY") return "PARTIALLY_READY";
  if (normalized === "SUCCESSFUL" || normalized === "SUCCESS") return "COMPLETED";
  if (fulfilmentFlow.includes(normalized as OrderFulfilmentStatus)) return normalized as OrderFulfilmentStatus;
  return null;
}

export async function findPostgresStatusOrder(orderId: unknown) {
  const lookup = normalizeLookup(orderId);
  if (!lookup) return null;
  const id = /^\d+$/.test(lookup) ? BigInt(lookup) : null;
  return prisma.order.findFirst({
    where: {
      OR: [
        ...(id ? [{ id }] : []),
        { orderNumber: lookup },
        { legacyPhpId: lookup },
      ],
    },
    include: {
      dealer: true,
      assignedStaff: true,
    },
  });
}

function isAssignedStaffRole(actor: AuthActor) {
  return isStaffLike(actor);
}

function requiresRsmApprovalBeforeAcceptance(actor: AuthActor) {
  return isAssignedStaffRole(actor);
}

async function assertCanAct(actor: AuthActor, order: StatusOrder, permission: "read" | "acceptance" | "fulfilment" | "cancel") {
  if (actor.role === "ADMIN") return;
  if (actor.role === "NSM") {
    if (permission === "read" || permission === "acceptance" || permission === "fulfilment") return;
    throw new PostgresOrderStatusError(403, "forbidden", "NSM cannot cancel Dealer orders.");
  }
  if (actor.role === "DEALER") {
    if (order.dealerId !== actor.dealerId) throw new PostgresOrderStatusError(403, "forbidden", "This order belongs to another Dealer.");
    if (permission !== "read" && permission !== "cancel") {
      throw new PostgresOrderStatusError(403, "forbidden", "Dealers cannot perform staff-only order transitions.");
    }
    return;
  }
  if (actor.role === "RSM") {
    const regionWhere = await buildOrderRegionWhere(actor, undefined, prisma);
    const scoped = await prisma.order.findFirst({ where: { id: order.id, ...regionWhere }, select: { id: true } });
    if (!scoped) {
      throw new PostgresOrderStatusError(403, "forbidden", "This order is outside your RSM scope.");
    }
    if (permission === "cancel") {
      throw new PostgresOrderStatusError(403, "forbidden", "Staff, RSM, and ASM cannot cancel Dealer orders.");
    }
    return;
  }
  if (isAssignedStaffRole(actor)) {
    const assignedDirectly = order.assignedStaffId === actor.staffId;
    const assignedDealer = !!actor.staffId && await prisma.dealerStaffAssignment.findFirst({
      where: { dealerId: order.dealerId, staffId: actor.staffId, active: true },
      select: { id: true },
    });
    if (!assignedDirectly && !assignedDealer) {
      throw new PostgresOrderStatusError(403, "forbidden", "This order is outside your assigned Dealer scope.");
    }
    if (permission === "cancel") {
      throw new PostgresOrderStatusError(403, "forbidden", "Staff and RSM cannot cancel Dealer orders.");
    }
    return;
  }
  throw new PostgresOrderStatusError(403, "forbidden", "This role cannot update order status.");
}

export function assertAcceptanceTransition(current: OrderAcceptanceStatus, next: OrderAcceptanceStatus) {
  if (current !== "AWAITING" || (next !== "ACCEPTED" && next !== "DECLINED")) {
    throw new PostgresOrderStatusError(409, "invalid_transition", "Order acceptance can move only from AWAITING to ACCEPTED or DECLINED.");
  }
}

export function assertFulfilmentTransition(current: OrderFulfilmentStatus, next: OrderFulfilmentStatus) {
  const currentIndex = fulfilmentFlow.indexOf(current);
  const nextIndex = fulfilmentFlow.indexOf(next);
  if (currentIndex < 0 || nextIndex !== currentIndex + 1) {
    throw new PostgresOrderStatusError(409, "invalid_transition", "Invalid order fulfilment transition.");
  }
}

export function assertDealerCancellationAllowed(order: Pick<StatusOrder, "status" | "acceptanceStatus" | "fulfilmentStatus">) {
  if (order.status === "CANCELLED") throw new PostgresOrderStatusError(409, "order_already_cancelled", "Order is already cancelled.");
  if (order.status === "COMPLETED" || order.fulfilmentStatus !== "PENDING") {
    throw new PostgresOrderStatusError(409, "dispatch_already_started", "This order can no longer be cancelled.");
  }
  if (order.acceptanceStatus !== "AWAITING") {
    throw new PostgresOrderStatusError(409, "order_already_accepted", "Accepted or declined orders cannot be cancelled by Dealer.");
  }
}

export function normalizeReviewNote(value: unknown) {
  return String(value ?? "").trim().slice(0, 1500);
}

export async function updatePostgresOrderAcceptance(
  orderId: unknown,
  actor: AuthActor,
  next: OrderAcceptanceStatus,
  note?: unknown,
) {
  const order = await findPostgresStatusOrder(orderId);
  if (!order) return null;
  await assertCanAct(actor, order, "acceptance");
  if (order.status === "CANCELLED") throw new PostgresOrderStatusError(409, "order_already_cancelled", "Cancelled orders cannot be accepted or declined.");
  const now = new Date();
  // A decline is the one outcome the Dealer sees without further context, so it
  // must carry a reason. Acceptance notes stay optional.
  const reviewNote = normalizeReviewNote(note);
  if (next === "DECLINED" && !reviewNote) {
    throw new PostgresOrderStatusError(400, "note_required", "A note is required when declining an order.");
  }

  if (actor.role === "RSM") {
    if (order.rsmApprovalStatus !== "AWAITING" || (next !== "ACCEPTED" && next !== "DECLINED")) {
      throw new PostgresOrderStatusError(409, "invalid_transition", "RSM approval can move only from awaiting to approved or declined.");
    }
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.order.update({
        where: { id: order.id },
        data: {
          rsmApprovalStatus: next,
          rsmReviewedByUserId: actor.userId,
          rsmReviewedByName: actor.displayName || actor.email,
          rsmReviewedAt: now,
          rsmNote: reviewNote || null,
          status: next === "DECLINED" ? "DECLINED" : order.status,
        },
      });
      await tx.orderOverlay.create({ data: { orderId: order.id, type: "rsm_acceptance", status: next.toLowerCase(), value: next, actorUserId: actor.userId, actorRole: actor.role, reason: reviewNote || null, metadata: { source: "postgres_status", stage: "rsm" } } });
      return row;
    });
    return { ...updated, accept_order: legacyAcceptOrderAlias(updated.acceptanceStatus), del_status: legacyDelStatusAlias(updated.status) };
  }

  if (requiresRsmApprovalBeforeAcceptance(actor) && order.rsmApprovalStatus !== "ACCEPTED") {
    throw new PostgresOrderStatusError(403, "rsm_approval_required", "Order is not available for staff acceptance until RSM approval is complete.");
  }
  assertAcceptanceTransition(order.acceptanceStatus, next);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.order.update({
      where: { id: order.id },
      data: {
        acceptanceStatus: next,
        status: next === "ACCEPTED" ? "ACCEPTED" : "DECLINED",
        acceptedAt: next === "ACCEPTED" ? now : order.acceptedAt,
        acceptanceNote: reviewNote || null,
        acceptanceReviewedByUserId: actor.userId,
        acceptanceReviewedByName: actor.displayName || actor.email,
        acceptanceReviewedAt: now,
      },
    });
    await tx.orderOverlay.create({ data: { orderId: order.id, type: "acceptance", status: next.toLowerCase(), value: next, actorUserId: actor.userId, actorRole: actor.role, reason: reviewNote || null, metadata: { source: "postgres_status", stage: "staff" } } });
    return row;
  });
  return { ...updated, accept_order: legacyAcceptOrderAlias(updated.acceptanceStatus), del_status: legacyDelStatusAlias(updated.status) };
}

/**
 * Put a declined order back in front of the reviewers.
 *
 * A staff decline is final for the staff tier — `assertAcceptanceTransition`
 * only moves AWAITING onwards, so nobody in the two-stage flow can reopen it.
 * Admin/NSM sit outside that flow and can revive the order, which resets both
 * stages so it runs the full RSM-then-staff path again rather than landing
 * back in an already-reviewed state. Prior notes are cleared with the statuses
 * they belong to; the overlay trail keeps the history.
 */
export async function revivePostgresOrderAcceptance(orderId: unknown, actor: AuthActor, note?: unknown) {
  if (actor.role !== "ADMIN" && actor.role !== "NSM") {
    throw new PostgresOrderStatusError(403, "forbidden", "Only Admin and NSM can revive a declined order.");
  }
  const order = await findPostgresStatusOrder(orderId);
  if (!order) return null;
  if (order.status === "CANCELLED") throw new PostgresOrderStatusError(409, "order_already_cancelled", "Cancelled orders cannot be revived.");
  if (order.acceptanceStatus !== "DECLINED" && order.rsmApprovalStatus !== "DECLINED") {
    throw new PostgresOrderStatusError(409, "not_declined", "Only a declined order can be revived.");
  }

  const reviewNote = normalizeReviewNote(note);
  return prisma.$transaction(async (tx) => {
    const row = await tx.order.update({
      where: { id: order.id },
      data: {
        acceptanceStatus: "AWAITING",
        rsmApprovalStatus: "AWAITING",
        status: "AWAITING_ACCEPTANCE",
        acceptedAt: null,
        rsmNote: null,
        rsmReviewedByUserId: null,
        rsmReviewedByName: null,
        rsmReviewedAt: null,
        acceptanceNote: null,
        acceptanceReviewedByUserId: null,
        acceptanceReviewedByName: null,
        acceptanceReviewedAt: null,
      },
    });
    await tx.orderOverlay.create({
      data: {
        orderId: order.id,
        type: "acceptance_revived",
        status: "awaiting",
        value: "AWAITING",
        actorUserId: actor.userId,
        actorRole: actor.role,
        reason: reviewNote || null,
        metadata: {
          source: "postgres_status",
          stage: "revive",
          previousAcceptanceStatus: order.acceptanceStatus,
          previousRsmApprovalStatus: order.rsmApprovalStatus,
        },
      },
    });
    return { ...row, accept_order: legacyAcceptOrderAlias(row.acceptanceStatus), del_status: legacyDelStatusAlias(row.status) };
  });
}

export async function updatePostgresOrderFulfilment(orderId: unknown, actor: AuthActor, next: OrderFulfilmentStatus) {
  const order = await findPostgresStatusOrder(orderId);
  if (!order) return null;
  await assertCanAct(actor, order, "fulfilment");
  if (order.acceptanceStatus !== "ACCEPTED") throw new PostgresOrderStatusError(409, "not_accepted", "Order must be accepted before fulfilment can change.");
  if (order.status === "CANCELLED" || order.status === "DECLINED") throw new PostgresOrderStatusError(409, "terminal_order", "Terminal orders cannot change fulfilment.");
  assertFulfilmentTransition(order.fulfilmentStatus, next);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.order.update({
      where: { id: order.id },
      data: {
        fulfilmentStatus: next,
        status: orderStatusForFulfilment(next),
        dispatchedAt: next === "DISPATCHED" ? new Date() : order.dispatchedAt,
        completedAt: next === "COMPLETED" ? new Date() : order.completedAt,
      },
    });
    await tx.orderOverlay.create({ data: { orderId: order.id, type: "status", status: next.toLowerCase(), value: next, actorUserId: actor.userId, actorRole: actor.role, metadata: { source: "postgres_status" } } });
    return row;
  });
  return { ...updated, accept_order: legacyAcceptOrderAlias(updated.acceptanceStatus), del_status: legacyDelStatusAlias(updated.status) };
}

export async function cancelPostgresOrder(orderId: unknown, actor: AuthActor, reason: unknown) {
  const order = await findPostgresStatusOrder(orderId);
  if (!order) return null;
  await assertCanAct(actor, order, "cancel");
  if (actor.role === "DEALER") assertDealerCancellationAllowed(order);
  if (order.status === "COMPLETED") throw new PostgresOrderStatusError(409, "order_already_completed", "Completed orders cannot be cancelled.");
  const reasonText = String(reason ?? "").trim().slice(0, 1000);
  if (!reasonText) throw new PostgresOrderStatusError(400, "blank_reason", "Cancellation reason is required.");
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.order.update({
      where: { id: order.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancellationReason: reasonText,
      },
    });
    await tx.orderOverlay.create({ data: { orderId: order.id, type: "cancel", status: "cancelled", reason: reasonText, actorUserId: actor.userId, actorRole: actor.role, metadata: { source: "postgres_status" } } });
    return row;
  });
  return { ...updated, accept_order: legacyAcceptOrderAlias(updated.acceptanceStatus), del_status: legacyDelStatusAlias(updated.status) };
}




