import type { FundRequestStatus, FundRequestType, Prisma } from "@prisma/client";

/**
 * State machine and scoping for the Advance Dealer Order / Fund Request flow.
 *
 * Dealer -> RSM -> Staff -> Accountant -> wallet credited -> order placed.
 *
 * Only the states that are actually written exist; the "*_PENDING" stages of
 * the business flow are the waiting side of the previous approval:
 *
 *   REQUESTED       awaiting RSM        (RSM_PENDING)
 *   RSM_APPROVED    awaiting Staff      (STAFF_PENDING)
 *   STAFF_APPROVED  awaiting Accountant (ACCOUNTANT_PENDING)
 *   FUNDED          wallet credited, order not yet placed
 *   COMPLETED       terminal
 *   REJECTED        terminal
 *
 * That collapse is what makes an illegal transition a single equality check:
 * an RSM can only act on REQUESTED, so REQUESTED -> ACCOUNTANT_PENDING has no
 * expressible path, and Staff can only act on RSM_APPROVED, so nothing reaches
 * the accountant without both approvals.
 */

export type FundRequestStage = "rsm" | "staff" | "accountant";

/** The one status each stage is allowed to act on. Everything else is a 409. */
export const STAGE_REQUIRES: Record<FundRequestStage, FundRequestStatus> = {
  rsm: "REQUESTED",
  staff: "RSM_APPROVED",
  accountant: "STAFF_APPROVED",
};

/** Where an approval at each stage moves the request to. */
export const STAGE_APPROVES_TO: Record<FundRequestStage, FundRequestStatus> = {
  rsm: "RSM_APPROVED",
  staff: "STAFF_APPROVED",
  accountant: "FUNDED",
};

export const TERMINAL_STATUSES: FundRequestStatus[] = ["COMPLETED", "REJECTED"];

/**
 * Guard every stage transition.
 *
 * Throws rather than returning a boolean so a caller cannot forget to check.
 * Called inside the funding transaction on a row read in that same
 * transaction, which is what makes double-approve and double-fund impossible
 * under concurrency rather than merely unlikely.
 */
export function assertStageTransition(stage: FundRequestStage, current: FundRequestStatus) {
  const required = STAGE_REQUIRES[stage];
  if (current === required) return;

  const alreadyDone: Partial<Record<FundRequestStage, FundRequestStatus[]>> = {
    rsm: ["RSM_APPROVED", "STAFF_APPROVED", "FUNDED", "COMPLETED"],
    staff: ["STAFF_APPROVED", "FUNDED", "COMPLETED"],
    accountant: ["FUNDED", "COMPLETED"],
  };

  if (current === "REJECTED") {
    throw Object.assign(new Error("This request was rejected and can no longer be actioned."), { status: 409, code: "request_rejected" });
  }
  if (alreadyDone[stage]?.includes(current)) {
    throw Object.assign(new Error("This request has already been actioned at this stage."), { status: 409, code: "already_actioned" });
  }
  throw Object.assign(new Error("This request is not yet at this approval stage."), { status: 409, code: "wrong_stage" });
}

/** Dealer-facing wording. Never leaks who is holding it up internally. */
export function dealerStatusLabel(status: FundRequestStatus, type: FundRequestType, rejectedBy?: string | null) {
  switch (status) {
    case "REQUESTED": return "Awaiting RSM Approval";
    case "RSM_APPROVED": return "Awaiting Staff Approval";
    case "STAFF_APPROVED": return "Awaiting Accountant";
    case "FUNDED": return type === "ADVANCE_ORDER" ? "Funds Added - Placing Order" : "Funds Added";
    case "COMPLETED": return type === "ADVANCE_ORDER" ? "Order Placed" : "Completed";
    case "REJECTED": return rejectedBy ? `Rejected by ${rejectedBy}` : "Rejected";
    default: return String(status);
  }
}

/**
 * Tab -> status filter, shared by the RSM and Staff pages so both read the
 * same way:
 *   mine      what this stage must action now
 *   pending   still moving through the workflow, not finished
 *   approved  cleared this stage
 *   rejected  stopped here
 */
export function tabWhere(stage: "rsm" | "staff", tab: string): Prisma.DealerFundRequestWhereInput {
  const clearedThisStage: FundRequestStatus[] = stage === "rsm"
    ? ["RSM_APPROVED", "STAFF_APPROVED", "FUNDED", "COMPLETED"]
    : ["STAFF_APPROVED", "FUNDED", "COMPLETED"];

  switch (tab) {
    case "mine": return { status: STAGE_REQUIRES[stage] };
    case "approved": return { status: { in: clearedThisStage } };
    // A rejection is recorded with the stage that made it, so each queue shows
    // only its own - not the other stage's.
    case "rejected": return { status: "REJECTED", rejectedBy: stage === "rsm" ? "RSM" : "STAFF" };
    case "pending":
    default: return { status: { notIn: TERMINAL_STATUSES } };
  }
}

/**
 * Which requests an actor may see.
 *
 * Server-side only - the pages never decide this. Admin/NSM keep their existing
 * blanket visibility; the accountant sees the queue from the point it becomes
 * theirs; a dealer sees only their own.
 */
export async function buildFundRequestScope(
  actor: { role: string; userId: bigint; staffId?: bigint | null; dealerId?: bigint | null },
  prisma: Pick<Prisma.TransactionClient, "staffProfile" | "dealerStaffAssignment">,
): Promise<Prisma.DealerFundRequestWhereInput> {
  if (actor.role === "ADMIN" || actor.role === "NSM") return {};

  if (actor.role === "ACCOUNTANT") {
    return { status: { in: ["STAFF_APPROVED", "FUNDED", "COMPLETED"] } };
  }

  if (actor.role === "DEALER") {
    if (!actor.dealerId) return { id: BigInt(-1) };
    return { dealerId: actor.dealerId };
  }

  if (actor.role === "RSM") {
    // Requests routed to them directly, plus anything raised against a dealer
    // held by staff reporting into them - mirrors resolveRsmTeamStaffIds so an
    // RSM's fund queue matches their discount queue.
    if (!actor.staffId) return { rsmUserId: actor.userId };
    const team = await prisma.staffProfile.findMany({ where: { parentRsmId: actor.staffId }, select: { id: true } });
    const teamStaffIds = [actor.staffId, ...team.map((member) => member.id)];
    return { OR: [{ rsmUserId: actor.userId }, { staffId: { in: teamStaffIds } }] };
  }

  // STAFF / ASM: only what was routed to them through the dealer assignment.
  if (!actor.staffId) return { id: BigInt(-1) };
  return { staffId: actor.staffId };
}

/**
 * Resolve the two reviewers at creation time.
 *
 * Pinned onto the row rather than re-derived on every read, so a later change
 * to the hierarchy cannot silently move a live request out of the queue of
 * whoever was already reviewing it.
 */
export async function resolveFundRequestRouting(
  tx: Prisma.TransactionClient,
  dealerId: bigint,
): Promise<{ rsmUserId: bigint | null; staffId: bigint | null }> {
  const dealer = await tx.dealerProfile.findUnique({
    where: { id: dealerId },
    select: {
      rsmUserId: true,
      region: true,
      staffAssignments: { where: { active: true }, take: 1, select: { staffId: true } },
    },
  });
  if (!dealer) return { rsmUserId: null, staffId: null };

  const staffId = dealer.staffAssignments[0]?.staffId ?? null;

  // Prefer the dealer's own RSM; fall back to the RSM the assigned staff
  // reports into, then to the region's RSM, so a request is never orphaned
  // just because one link is unset.
  let rsmUserId = dealer.rsmUserId ?? null;
  if (!rsmUserId && staffId) {
    const staff = await tx.staffProfile.findUnique({ where: { id: staffId }, select: { parentRsmId: true } });
    if (staff?.parentRsmId) {
      const parent = await tx.staffProfile.findUnique({ where: { id: staff.parentRsmId }, select: { userId: true } });
      rsmUserId = parent?.userId ?? null;
    }
  }
  if (!rsmUserId && dealer.region) {
    const regionRsm = await tx.staffProfile.findFirst({
      where: { salesRegion: dealer.region, user: { role: "RSM", status: "ACTIVE" } },
      select: { userId: true },
    });
    rsmUserId = regionRsm?.userId ?? null;
  }

  return { rsmUserId, staffId };
}

/** Serialize a request row for the API. BigInt/Decimal never reach JSON.stringify. */
export function mapFundRequest(row: any) {
  const paise = (value: bigint | null | undefined) => (value === null || value === undefined ? null : Number(value) / 100);
  return {
    id: row.id.toString(),
    dealerId: row.dealerId.toString(),
    dealerName: row.dealer?.businessName ?? null,
    dealerCode: row.dealer?.dealerCode ?? null,
    type: row.type,
    status: row.status,
    dealerStatusLabel: dealerStatusLabel(row.status, row.type, row.rejectedBy),
    amount: paise(row.amountPaise),
    walletBalance: paise(row.walletBalancePaise),
    orderAmount: paise(row.orderAmountPaise),
    orderId: row.orderId ? row.orderId.toString() : null,
    orderNumber: row.order?.orderNumber ?? null,
    dealerNote: row.dealerNote ?? null,
    items: fundRequestItems(row),
    rsmReviewedByName: row.rsmReviewedByName ?? null,
    rsmReviewedAt: row.rsmReviewedAt ?? null,
    rsmNote: row.rsmNote ?? null,
    staffReviewedByName: row.staffReviewedByName ?? null,
    staffReviewedAt: row.staffReviewedAt ?? null,
    staffNote: row.staffNote ?? null,
    accountantName: row.accountantName ?? null,
    accountantNote: row.accountantNote ?? null,
    fundedAt: row.fundedAt ?? null,
    walletTransactionId: row.walletTransactionId ? row.walletTransactionId.toString() : null,
    rejectedBy: row.rejectedBy ?? null,
    rejectedAt: row.rejectedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The order lines a reviewer needs to see, read back out of the stored
 * submission. Read-only: the snapshot itself is what gets replayed, so this
 * never becomes a second source of truth for the order.
 */
export function fundRequestItems(row: { orderFormSnapshot?: unknown }) {
  const snapshot = row.orderFormSnapshot as Record<string, string> | null | undefined;
  if (!snapshot || typeof snapshot !== "object") return [];
  let parsed: unknown;
  try { parsed = JSON.parse(String(snapshot.productorder ?? "[]")); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.slice(0, 500).map((row: any) => ({
    productName: String(row?.productName ?? row?.productname ?? ""),
    catNo: String(row?.catNo ?? row?.variantCode ?? ""),
    quantityPacks: Number(row?.quantityPacks ?? 0),
    packSize: Number(row?.packSize ?? 1),
    totalPieces: Number(row?.totalPieces ?? 0),
    unitPrice: Number(row?.unitPrice ?? row?.price ?? 0),
    discountPercent: Number(row?.discountPercent ?? 0),
    finalAmount: Number(row?.afterDiscountPrice ?? 0),
  }));
}
