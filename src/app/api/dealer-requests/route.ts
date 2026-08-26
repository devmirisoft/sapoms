import { NextRequest, NextResponse } from "next/server";
import { requireAuth, type AuthActor } from "@/server/auth/session";
import { isAdminLike, isStaffLike } from "@/server/auth/sales-scope";
import { errorStatus } from "@/server/http/auth-error";

import { ensurePostgresDealerRequestIndexes, getPostgresDealerRequestCollection, isPostgresDealerRequestDependencyError } from "@/lib/postgresDealerRequests";
import { findDealerCodeReservationConflict } from "@/server/modules/dealers/dealer-code.service";
import { generatePostgresDealerCode } from "@/server/modules/dealers/dealer-code.service";
import {
  buildDealerRequestAccessQuery,
  buildDealerRequestCreateDocument,
  buildDealerRequestListSearchQuery,
  buildDealerRequestReference,
  toDealerRequestDetail,
  toDealerRequestListItem,
} from "@/lib/dealerRequests";
import { normalizeDealerFormSnapshot, validateDealerFormSnapshot } from "@/lib/dealerForm";

export const runtime = "nodejs";

function actorFromAuth(authActor: AuthActor) {
  if (isAdminLike(authActor)) {
    return {
      role: "admin" as const,
      actorId: authActor.userId.toString(),
      actorName: authActor.displayName || authActor.email || "Admin",
      roletype: authActor.role,
    };
  }

  if (isStaffLike(authActor) && authActor.staffId) {
    return {
      role: "staff" as const,
      actorId: authActor.staffId.toString(),
      actorName: authActor.displayName || authActor.email || "Staff",
      roletype: authActor.role,
    };
  }

  return null;
}
function safeNumber(value: string | null, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildResponseError(message: string, status: number) {
  return NextResponse.json({ success: false, message }, { status });
}

function isDuplicateKeyError(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as { code?: number | string }).code;
  return code === 11000 || code === "P2002";
}

export async function GET(request: NextRequest) {
  try {
    const actor = actorFromAuth(await requireAuth());

    if (!actor || (actor.role !== "admin" && actor.role !== "staff")) {
      return buildResponseError("Dealer request access is restricted to admin and staff-like roles", 403);
    }

    const status = request.nextUrl.searchParams.get("status");
    const page = Math.max(1, safeNumber(request.nextUrl.searchParams.get("page"), 1));
    const limit = Math.min(50, Math.max(1, safeNumber(request.nextUrl.searchParams.get("limit"), 10)));
    const search = request.nextUrl.searchParams.get("search") ?? "";

    const filters: Record<string, unknown>[] = [buildDealerRequestAccessQuery(actor)];
    if (status === "pending" || status === "accepted" || status === "rejected") {
      filters.push({ status });
    }

    const searchQuery = buildDealerRequestListSearchQuery(search);
    if (searchQuery) {
      filters.push(searchQuery);
    }

    const query = filters.length === 1
      ? filters[0]
      : { $and: filters.filter((filter) => Object.keys(filter).length > 0) };

    await ensurePostgresDealerRequestIndexes();
    const collection = getPostgresDealerRequestCollection();

    const total = await collection.countDocuments(query);
    const rows = await collection
      .find(query)
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    return NextResponse.json({
      success: true,
      data: rows.map(toDealerRequestListItem),
      total,
      page,
      limit,
      lastPage: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("[GET /api/dealer-requests]", error);
    const authStatus = errorStatus(error, 0);
    if (authStatus === 401 || authStatus === 403) {
      return buildResponseError((error as Error).message, authStatus);
    }
    const status = isPostgresDealerRequestDependencyError(error) ? 503 : 500;
    return buildResponseError(
      status === 503
        ? "Dealer request database is currently unavailable"
        : "Failed to load dealer requests",
      status,
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const actor = actorFromAuth(await requireAuth());

    if (!actor || actor.role !== "staff") {
      return buildResponseError("Only staff-like roles can submit dealer approval requests", 403);
    }

    let snapshot = normalizeDealerFormSnapshot(body.formSnapshot ?? body);
    const dealerCode = await generatePostgresDealerCode(snapshot.dealerCode);
    if (!dealerCode) {
      return buildResponseError("All 4-digit dealer codes are already in use", 409);
    }
    snapshot = { ...snapshot, dealerCode };
    const validationError = validateDealerFormSnapshot(snapshot);
    if (validationError) {
      return buildResponseError(validationError, 400);
    }

    const codeConflict = await findDealerCodeReservationConflict(snapshot.dealerCode);
    if (codeConflict) {
      return buildResponseError(
        codeConflict === "dealer-profile"
          ? "Dealer code already exists"
          : "A pending dealer request already exists for this dealer code",
        409,
      );
    }

    const now = new Date().toISOString();
    await ensurePostgresDealerRequestIndexes();
    const collection = getPostgresDealerRequestCollection();

    const doc = buildDealerRequestCreateDocument({ actor, snapshot, now });
    const existing = await collection.findOne({ openRequestKey: doc.openRequestKey });
    if (existing) {
      return NextResponse.json({ success: true, data: toDealerRequestDetail(existing) });
    }

    const insertResult = await collection.insertOne(doc);
    const id = insertResult.insertedId.toString();
    const requestReference = buildDealerRequestReference(id);

    await collection.updateOne(
      { _id: insertResult.insertedId },
      { $set: { requestReference } },
    );

    const created = await collection.findOne({ _id: insertResult.insertedId });
    return NextResponse.json({ success: true, data: toDealerRequestDetail(created ?? { ...doc, _id: insertResult.insertedId, requestReference }) }, { status: 201 });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return buildResponseError("A pending dealer request already exists for these details", 409);
    }
    console.error("[POST /api/dealer-requests]", error);
    const authStatus = errorStatus(error, 0);
    if (authStatus === 401 || authStatus === 403) {
      return buildResponseError((error as Error).message, authStatus);
    }
    const status = isPostgresDealerRequestDependencyError(error) ? 503 : 500;
    return buildResponseError(
      status === 503
        ? "Dealer request database is currently unavailable"
        : "Failed to create dealer request",
      status,
    );
  }
}



