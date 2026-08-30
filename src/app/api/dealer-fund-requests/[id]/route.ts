import { NextRequest, NextResponse } from "next/server";
import { WalletTransactionType } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { requireAuth, type AuthActor } from "@/server/auth/session";
import { applyWalletChange, fromPaise } from "@/lib/postgresWallet";
import { createDealerOrder, text, type OrderFormFields } from "@/lib/dealerOrderCreate";
import {
  assertStageTransition,
  buildFundRequestScope,
  mapFundRequest,
  type FundRequestStage,
} from "@/lib/dealerFundRequests";
import { fundRequestInclude } from "../route";

export const runtime = "nodejs";

function jsonError(error: any, fallback: string) {
  const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : error?.message === "Forbidden" ? 403 : 500);
  return NextResponse.json({ success: false, code: error?.code, message: status >= 500 ? fallback : error.message }, { status });
}

/** The stage an actor is allowed to act at. Roles map 1:1 onto the chain. */
function stageForRole(role: string): FundRequestStage | null {
  if (role === "RSM") return "rsm";
  if (role === "STAFF" || role === "ASM") return "staff";
  if (role === "ACCOUNTANT") return "accountant";
  return null;
}

/**
 * Re-check scope for the specific row.
 *
 * The list scope is a where-clause; a mutation must prove this one row is in
 * it, so a guessed id cannot be actioned by someone it was never routed to.
 */
async function assertInScope(actor: AuthActor, id: bigint) {
  const scope = await buildFundRequestScope(actor, prisma);
  const found = await prisma.dealerFundRequest.findFirst({ where: { id, ...scope }, select: { id: true } });
  if (!found) throw Object.assign(new Error("This request is outside your scope."), { status: 403, code: "out_of_scope" });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ success: false, message: "Request not found" }, { status: 404 });
    const actor = await requireAuth();
    const scope = await buildFundRequestScope(actor, prisma);
    const row = await prisma.dealerFundRequest.findFirst({ where: { id: BigInt(id), ...scope }, include: fundRequestInclude });
    if (!row) return NextResponse.json({ success: false, message: "Request not found" }, { status: 404 });
    return NextResponse.json({ success: true, data: mapFundRequest(row) });
  } catch (error) {
    console.error("[GET /api/dealer-fund-requests/[id]]", error);
    return jsonError(error, "Failed to load fund request");
  }
}

/**
 * Act on a request.
 *
 * action=approve|reject at the RSM and Staff stages; action=fund at the
 * Accountant stage, which credits the wallet and - for an ADVANCE_ORDER -
 * places the dealer's original order in the same transaction.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ success: false, message: "Request not found" }, { status: 404 });
    const requestId = BigInt(id);

    const actor = await requireAuth();
    const stage = stageForRole(actor.role);
    if (!stage) {
      return NextResponse.json({ success: false, message: "Your role cannot action fund requests." }, { status: 403 });
    }
    await assertInScope(actor, requestId);

    const body = await req.json();
    const action = text(body.action, 20).toLowerCase();
    const note = text(body.note, 1500) || null;
    const reviewerName = actor.displayName || actor.email || null;

    if (action === "reject") {
      if (stage === "accountant") {
        return NextResponse.json({ success: false, message: "The accountant funds approved requests; rejection is an RSM or Staff decision." }, { status: 403 });
      }
      // A rejection must always carry a reason the dealer can act on, matching
      // the custom-discount rule.
      if (!note) return NextResponse.json({ success: false, message: "A rejection note is required." }, { status: 400 });
    } else if (action === "approve") {
      if (stage === "accountant") {
        return NextResponse.json({ success: false, message: "Use the fund action to release money for an approved request." }, { status: 400 });
      }
    } else if (action !== "fund") {
      return NextResponse.json({ success: false, message: "Unsupported action." }, { status: 400 });
    }
    if (action === "fund" && stage !== "accountant") {
      return NextResponse.json({ success: false, message: "Only the accountant can add funds." }, { status: 403 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.dealerFundRequest.findUnique({ where: { id: requestId } });
      if (!existing) throw Object.assign(new Error("Request not found"), { status: 404 });

      // Read inside the transaction, then guard: this is what makes a second
      // concurrent approval or funding fail rather than double-apply.
      assertStageTransition(stage, existing.status);

      if (action === "reject") {
        const row = await tx.dealerFundRequest.update({
          where: { id: requestId },
          data: {
            status: "REJECTED",
            rejectedAt: new Date(),
            rejectedBy: stage === "rsm" ? "RSM" : "STAFF",
            ...(stage === "rsm"
              ? { rsmReviewedByUserId: actor.userId, rsmReviewedByName: reviewerName, rsmReviewedAt: new Date(), rsmNote: note }
              : { staffReviewedByUserId: actor.userId, staffReviewedByName: reviewerName, staffReviewedAt: new Date(), staffNote: note }),
          },
          include: fundRequestInclude,
        });
        return { row, placedOrder: null as null | { id: bigint; orderNumber: string } };
      }

      if (action === "approve") {
        const row = await tx.dealerFundRequest.update({
          where: { id: requestId },
          data: stage === "rsm"
            ? { status: "RSM_APPROVED", rsmReviewedByUserId: actor.userId, rsmReviewedByName: reviewerName, rsmReviewedAt: new Date(), rsmNote: note }
            : { status: "STAFF_APPROVED", staffReviewedByUserId: actor.userId, staffReviewedByName: reviewerName, staffReviewedAt: new Date(), staffNote: note },
          include: fundRequestInclude,
        });
        return { row, placedOrder: null as null | { id: bigint; orderNumber: string } };
      }

      // ---- Accountant: credit the wallet, then place the order ----

      // Keyed on the request id, so a retry or a double-click reuses the same
      // transaction instead of crediting twice.
      const credit = await applyWalletChange(tx, existing.dealerId, WalletTransactionType.CREDIT, fromPaise(existing.amountPaise), {
        idempotencyKey: `fund-request:${existing.id}`,
        reference: `FUND-REQ-${existing.id}`,
        note: note || `Funds added for ${existing.type === "ADVANCE_ORDER" ? "advance order" : "additional funds"} request #${existing.id}`,
        metadata: { fundRequestId: existing.id.toString(), fundRequestType: existing.type },
        actor: { userId: actor.userId, role: actor.role, displayName: actor.displayName },
        allowCreate: true,
      });

      let row = await tx.dealerFundRequest.update({
        where: { id: requestId },
        data: {
          status: "FUNDED",
          accountantUserId: actor.userId,
          accountantName: reviewerName,
          accountantNote: note,
          fundedAt: new Date(),
          walletTransactionId: BigInt(credit.transaction.id),
        },
        include: fundRequestInclude,
      });

      let placedOrder: { id: bigint; orderNumber: string } | null = null;

      if (existing.type === "ADVANCE_ORDER" && existing.orderFormSnapshot && !existing.orderId) {
        const fields = existing.orderFormSnapshot as OrderFormFields;
        const created = await createDealerOrder(tx, fields, existing.dealerId, {
          // The dealer owns the order - the accountant is recorded on the fund
          // request and in the audit log, exactly as the discount flow does it.
          userId: actor.userId,
          role: actor.role,
          displayName: actor.displayName,
          sessionId: actor.sessionId,
        }, {
          // The unique order.idempotencyKey is the hard guarantee that one
          // request can never place two orders, even if two funds calls raced
          // past everything else.
          idempotencyKey: `fund-request-order:${existing.id}`,
          // The credit above landed in this same transaction; the ORDER_DEBIT
          // inside createDealerOrder still enforces sufficiency for real.
          skipBalanceCheck: true,
          auditEventType: "ORDER_AUTO_PLACED_ON_FUND_REQUEST",
          auditMetadata: { fundRequestId: existing.id.toString(), fundedByUserId: actor.userId.toString() },
        });
        placedOrder = { id: created.order.id, orderNumber: created.order.orderNumber };
        row = await tx.dealerFundRequest.update({
          where: { id: requestId },
          data: { status: "COMPLETED", orderId: created.order.id },
          include: fundRequestInclude,
        });
      } else if (existing.type === "ADDITIONAL_FUNDS") {
        // Nothing to place - the money landing in the wallet is the whole job.
        row = await tx.dealerFundRequest.update({
          where: { id: requestId },
          data: { status: "COMPLETED" },
          include: fundRequestInclude,
        });
      }

      return { row, placedOrder };
    });

    const dto = mapFundRequest(result.row) as any;
    if (result.placedOrder) {
      dto.placedOrderId = result.placedOrder.id.toString();
      dto.placedOrderNumber = result.placedOrder.orderNumber;
    }
    return NextResponse.json({ success: true, data: dto });
  } catch (error) {
    console.error("[PATCH /api/dealer-fund-requests/[id]]", error);
    return jsonError(error, "Failed to update fund request");
  }
}
