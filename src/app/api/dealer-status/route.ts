import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { requireAuth, type AuthActor } from "@/server/auth/session";
import { isAdminLike, isStaffLike } from "@/server/auth/sales-scope";
import { normalizeDealerStatus, type DealerStatus, type DealerStatusDocument } from "@/lib/dealerStatus";

export const runtime = "nodejs";

type DealerStatusResponseDocument = {
  dealerId: string;
  status: DealerStatus;
  updatedAt?: string;
  updatedBy?: string;
};

type DealerRow = Awaited<ReturnType<typeof loadDealerById>>;

function safeErrorResponse(message: string, status = 500) {
  return NextResponse.json({ success: false, message }, { status, headers: { "Cache-Control": "no-store" } });
}

function userStatusToDealerStatus(status: string | null | undefined): DealerStatus {
  return status === "ACTIVE" ? "active" : "inactive";
}

function dealerStatusToUserStatus(status: DealerStatus) {
  return status === "active" ? "ACTIVE" : "INACTIVE";
}

function parseDealerId(value: string) {
  if (!/^\d+$/.test(value)) return null;
  return BigInt(value);
}

function toResponseDocument(row: NonNullable<DealerRow>, updatedBy?: string): DealerStatusResponseDocument {
  return {
    dealerId: row.id.toString(),
    status: userStatusToDealerStatus(row.user.status),
    updatedAt: row.user.updatedAt.toISOString(),
    ...(updatedBy ? { updatedBy } : {}),
  };
}

async function loadDealerById(dealerId: bigint) {
  return prisma.dealerProfile.findFirst({
    where: { id: dealerId, deletedAt: null, user: { deletedAt: null } },
    select: { id: true, userId: true, user: { select: { status: true, updatedAt: true } } },
  });
}

async function canReadDealer(actor: AuthActor, dealerId: bigint) {
  if (isAdminLike(actor) || actor.role === "ACCOUNTANT") return true;
  if (actor.role === "DEALER") return actor.dealerId === dealerId;
  if (isStaffLike(actor) && actor.staffId) {
    const assignment = await prisma.dealerStaffAssignment.findFirst({
      where: { dealerId, staffId: actor.staffId, active: true },
      select: { id: true },
    });
    return !!assignment;
  }
  return false;
}

async function listReadableDealers(actor: AuthActor) {
  if (isAdminLike(actor) || actor.role === "ACCOUNTANT") {
    return prisma.dealerProfile.findMany({
      where: { deletedAt: null, user: { deletedAt: null } },
      select: { id: true, userId: true, user: { select: { status: true, updatedAt: true } } },
      orderBy: { updatedAt: "desc" },
    });
  }

  if (actor.role === "DEALER" && actor.dealerId) {
    const row = await loadDealerById(actor.dealerId);
    return row ? [row] : [];
  }

  if (isStaffLike(actor) && actor.staffId) {
    const assignments = await prisma.dealerStaffAssignment.findMany({
      where: { staffId: actor.staffId, active: true, dealer: { deletedAt: null, user: { deletedAt: null } } },
      select: { dealer: { select: { id: true, userId: true, user: { select: { status: true, updatedAt: true } } } } },
      orderBy: { updatedAt: "desc" },
    });
    return assignments.map((row) => row.dealer);
  }

  return [];
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuth();
    const rawDealerId = request.nextUrl.searchParams.get("dealer_id")?.trim() ?? "";

    if (rawDealerId) {
      const dealerId = parseDealerId(rawDealerId);
      if (!dealerId) return safeErrorResponse("Invalid dealer_id", 400);
      if (!(await canReadDealer(actor, dealerId))) return safeErrorResponse("Forbidden", 403);

      const row = await loadDealerById(dealerId);
      if (!row) return safeErrorResponse("Dealer not found", 404);
      return NextResponse.json({ success: true, data: toResponseDocument(row) }, { headers: { "Cache-Control": "no-store" } });
    }

    const rows = await listReadableDealers(actor);
    return NextResponse.json({ success: true, data: rows.map((row) => toResponseDocument(row)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("dealer-status GET failed", error);
    if (error instanceof Error && error.message === "Unauthenticated") return safeErrorResponse("Unauthenticated", 401);
    return safeErrorResponse("Unable to load dealer status");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireAuth();
    if (actor.role !== "ADMIN") return safeErrorResponse("Forbidden", 403);

    const body = (await request.json().catch(() => null)) as
      | Partial<DealerStatusDocument & { dealerIds?: unknown[]; updatedBy?: string }>
      | null;
    const dealerId = String(body?.dealerId ?? "").trim();
    const dealerIds = Array.isArray(body?.dealerIds)
      ? [...new Set(body.dealerIds.map((id) => String(id ?? "").trim()).filter(Boolean))]
      : [];
    const rawStatus = normalizeDealerStatus(String(body?.status ?? "").trim().toLowerCase(), "active");

    if (!dealerId && dealerIds.length === 0) {
      return safeErrorResponse("dealerId or dealerIds and a valid status are required", 400);
    }

    const ids = (dealerIds.length > 0 ? dealerIds : [dealerId]).map(parseDealerId);
    if (ids.some((id) => id === null)) return safeErrorResponse("Invalid dealerId", 400);
    const uniqueIds = Array.from(new Set((ids as bigint[]).map((id) => id.toString()))).map(BigInt);
    const userStatus = dealerStatusToUserStatus(rawStatus);
    const now = new Date();

    const rows = await prisma.$transaction(async (tx) => {
      const dealers = await tx.dealerProfile.findMany({
        where: { id: { in: uniqueIds }, deletedAt: null, user: { deletedAt: null } },
        select: { id: true, userId: true, user: { select: { status: true } } },
      });
      if (dealers.length !== uniqueIds.length) throw new Error("Dealer not found");

      const disable = userStatus !== "ACTIVE";
      await tx.user.updateMany({
        where: { id: { in: dealers.map((dealer) => dealer.userId) } },
        data: { status: userStatus, ...(disable ? { tokenVersion: { increment: 1 } } : {}) },
      });
      if (disable) {
        await tx.authSession.updateMany({ where: { userId: { in: dealers.map((dealer) => dealer.userId) }, revokedAt: null }, data: { revokedAt: now } });
      }
      await tx.authAuditLog.createMany({
        data: dealers.map((dealer) => ({
          sessionId: actor.sessionId,
          role: actor.role,
          eventType: "DEALER_STATUS_COMPAT_CHANGED",
          metadata: { dealerId: dealer.id.toString(), oldStatus: dealer.user.status, newStatus: userStatus, userId: actor.userId.toString() },
        })),
      });
      return tx.dealerProfile.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true, userId: true, user: { select: { status: true, updatedAt: true } } },
        orderBy: { id: "asc" },
      });
    });

    const data = rows.map((row) => toResponseDocument(row, actor.displayName));
    return NextResponse.json({ success: true, data: dealerIds.length > 0 ? data : data[0] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("dealer-status PATCH failed", error);
    if (error instanceof Error && error.message === "Unauthenticated") return safeErrorResponse("Unauthenticated", 401);
    if (error instanceof Error && error.message === "Dealer not found") return safeErrorResponse("Dealer not found", 404);
    return safeErrorResponse("Unable to save dealer status");
  }
}