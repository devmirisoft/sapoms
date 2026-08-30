import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireAuth } from "@/server/auth/session";
import {
  buildFundRequestScope,
  mapFundRequest,
  resolveFundRequestRouting,
  tabWhere,
} from "@/lib/dealerFundRequests";
import { priceDealerOrder, text } from "@/lib/dealerOrderCreate";

export const runtime = "nodejs";

export const fundRequestInclude = {
  dealer: { select: { businessName: true, dealerCode: true } },
  order: { select: { orderNumber: true } },
} as const;

function jsonError(error: any, fallback: string) {
  const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : error?.message === "Forbidden" ? 403 : 500);
  return NextResponse.json({ success: false, code: error?.code, message: status >= 500 ? fallback : error.message }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth();
    const scope = await buildFundRequestScope(actor, prisma);

    const url = new URL(req.url);
    const tab = text(url.searchParams.get("tab"), 20).toLowerCase();
    const typeFilter = text(url.searchParams.get("type"), 30).toUpperCase();

    const where: Record<string, unknown> = { ...scope };
    // The tab filters are the RSM/Staff queue semantics; other roles list flat.
    if (tab && (actor.role === "RSM" || actor.role === "STAFF" || actor.role === "ASM")) {
      Object.assign(where, tabWhere(actor.role === "RSM" ? "rsm" : "staff", tab));
    }
    if (typeFilter === "ADVANCE_ORDER" || typeFilter === "ADDITIONAL_FUNDS") where.type = typeFilter;

    const rows = await prisma.dealerFundRequest.findMany({
      where,
      include: fundRequestInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json({ success: true, data: rows.map(mapFundRequest) });
  } catch (error) {
    console.error("[GET /api/dealer-fund-requests]", error);
    return jsonError(error, "Failed to load fund requests");
  }
}

/**
 * Dealer raises a request.
 *
 * ADVANCE_ORDER carries the order submission the dealer just tried to place;
 * the amount is the shortfall, priced through the very same code the order
 * route uses so the figure approved is the figure that will be charged.
 * ADDITIONAL_FUNDS is a standalone top-up from the ledger and carries no order.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAuth();
    if (actor.role !== "DEALER" || !actor.dealerId) {
      return NextResponse.json({ success: false, message: "Only dealers can raise fund requests." }, { status: 403 });
    }
    const dealerId = actor.dealerId;

    const body = await req.json();
    const type = text(body.type, 30).toUpperCase() === "ADDITIONAL_FUNDS" ? "ADDITIONAL_FUNDS" as const : "ADVANCE_ORDER" as const;
    const dealerNote = text(body.note ?? body.dealerNote, 1500) || null;

    const created = await prisma.$transaction(async (tx) => {
      const dealer = await tx.dealerProfile.findUnique({
        where: { id: dealerId },
        include: { user: { select: { status: true } } },
      });
      if (!dealer || dealer.deletedAt || dealer.user.status !== "ACTIVE") {
        throw Object.assign(new Error("This dealer account is inactive."), { status: 403, code: "inactive_dealer" });
      }

      const wallet = await tx.dealerWallet.findUnique({ where: { dealerId } });
      // Only advance dealers run through this workflow at all - a credit dealer
      // has no wallet gate on ordering, so a fund request would be meaningless.
      if (wallet?.status !== "ACTIVE") {
        throw Object.assign(new Error("Fund requests are only available to advance dealers."), { status: 409, code: "not_advance_dealer" });
      }
      const availablePaise = wallet.balancePaise - wallet.reservedPaise;

      let amountPaise: bigint;
      let orderAmountPaise: bigint | null = null;
      let orderFormSnapshot: Record<string, string> | null = null;

      if (type === "ADVANCE_ORDER") {
        const fields = body.orderForm && typeof body.orderForm === "object" ? body.orderForm as Record<string, string> : null;
        if (!fields || !fields.productorder) {
          throw Object.assign(new Error("The order details are required to request funds for an order."), { status: 422, code: "missing_order" });
        }
        // Priced server-side: a client-sent total must never decide how much
        // money the approval chain is asked to release.
        const priced = await priceDealerOrder(tx, fields, dealer);
        orderAmountPaise = priced.finalPayableAmountPaise;
        if (availablePaise >= orderAmountPaise) {
          throw Object.assign(new Error("This order is already covered by the wallet balance - place it directly."), { status: 409, code: "balance_sufficient" });
        }
        amountPaise = orderAmountPaise - availablePaise;
        orderFormSnapshot = fields;
      } else {
        amountPaise = BigInt(Math.round(Number(body.amount ?? 0) * 100));
        if (amountPaise <= BigInt(0)) {
          throw Object.assign(new Error("A valid positive amount is required."), { status: 422, code: "invalid_amount" });
        }
      }

      // One live request at a time per type, so a double-click or an impatient
      // dealer cannot flood the approval queues with duplicates.
      const open = await tx.dealerFundRequest.findFirst({
        where: { dealerId, type, status: { notIn: ["COMPLETED", "REJECTED"] } },
        select: { id: true },
      });
      if (open) {
        throw Object.assign(new Error("You already have a fund request in progress. Please wait for it to be processed."), { status: 409, code: "request_in_progress" });
      }

      const routing = await resolveFundRequestRouting(tx, dealerId);

      return tx.dealerFundRequest.create({
        data: {
          dealerId,
          type,
          amountPaise,
          walletBalancePaise: availablePaise,
          orderAmountPaise,
          orderFormSnapshot: orderFormSnapshot ?? undefined,
          dealerNote,
          rsmUserId: routing.rsmUserId,
          staffId: routing.staffId,
        },
        include: fundRequestInclude,
      });
    });

    return NextResponse.json({ success: true, data: mapFundRequest(created) }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/dealer-fund-requests]", error);
    return jsonError(error, "Failed to raise fund request");
  }
}
