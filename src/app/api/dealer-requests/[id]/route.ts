import { Prisma, type DealerRequest } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { isAdminLike, isStaffLike } from "@/server/auth/sales-scope";
import { errorStatus } from "@/server/http/auth-error";

import { AdminRouteError } from "@/server/admin/admin-errors";
import { prisma } from "@/server/db/prisma";
import { parseCreateAdminDealerInput } from "@/server/modules/admin/dealers/dealers.schemas";
import { generatePostgresDealerCode } from "@/server/modules/dealers/dealer-code.service";
import { createAdminDealer } from "@/server/modules/admin/dealers/dealers.service";
import type { AuthActor } from "@/server/modules/admin/dealers/dealers.types";
import { getSelectedDealerContact, normalizeDealerFormSnapshot, validateDealerFormSnapshot } from "@/lib/dealerForm";
import { ensurePostgresDealerRequestIndexes, getPostgresDealerRequestCollection, isPostgresDealerRequestDependencyError } from "@/lib/postgresDealerRequests";
import { findDealerCodeReservationConflict } from "@/server/modules/dealers/dealer-code.service";
import { invalidateStaffAssignmentCache } from "@/lib/orderScopeServer";
import {
  appendAuditEntry,
  buildDealerRequestAccessQuery,
  buildDealerRequestIdentityKey,
  ensureStatusTransition,
  toDealerRequestDetail,
  type DealerRequestActor,
  type DealerRequestRecord,
} from "@/lib/dealerRequests";
export const runtime = "nodejs";

function actorFromAuth(authActor: Awaited<ReturnType<typeof requireAuth>>): DealerRequestActor | null {
  if (isAdminLike(authActor)) {
    return {
      role: "admin",
      actorId: authActor.userId.toString(),
      actorName: authActor.displayName || authActor.email || "Admin",
      roletype: authActor.role,
    };
  }

  if (isStaffLike(authActor) && authActor.staffId) {
    return {
      role: "staff",
      actorId: authActor.staffId.toString(),
      actorName: authActor.displayName || authActor.email || "Staff",
      roletype: authActor.role,
    };
  }

  return null;
}
function toRequestId(id: string) {
  const trimmed = id.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return { toString: () => trimmed };
}

function buildResponseError(message: string, status: number) {
  return NextResponse.json({ success: false, message }, { status });
}

function buildSnapshotSummary(snapshot: ReturnType<typeof normalizeDealerFormSnapshot>) {
  const contact = getSelectedDealerContact(snapshot);

  return {
    dealerName: snapshot.name,
    dealerCode: snapshot.dealerCode,
    city: snapshot.city,
    contactEmail: contact.email,
    contactPhone: contact.phone,
    assignedStaffIds: snapshot.assignedStaffIds,
    assignedStaffNames: snapshot.staffNames,
  };
}
function buildDealerInputFromSnapshot(snapshot: ReturnType<typeof normalizeDealerFormSnapshot>) {
  const contact = getSelectedDealerContact(snapshot);

  return parseCreateAdminDealerInput({
    businessName: snapshot.name,
    email: snapshot.email,
    password: snapshot.password,
    phone: contact.phone,
    dealerCode: snapshot.dealerCode,
    address: snapshot.address,
    city: snapshot.city,
    pincode: snapshot.pincode,
    gstin: snapshot.gstNo,
    discountPercent: snapshot.discount,
    creditDays: snapshot.creditDays,
    creditLimitPaise: snapshot.currentLimit,
    annualTargetPaise: snapshot.annualTarget,
    notes: snapshot.notes,
    priorityContact: snapshot.priorityPerson,
    secondaryContactName: snapshot.secondaryContactName,
    secondaryContactPhone: snapshot.secondaryContactPhone,
    secondaryContactEmail: snapshot.secondaryContactEmail,
    status: "ACTIVE",
    assignedStaffIds: snapshot.assignedStaffIds,
    walletActive: snapshot.paymentType === "advance",
  });
}

function toDealerRequestRecord(row: DealerRequest): DealerRequestRecord {
  return {
    ...row,
    _id: { toString: () => row.id.toString() },
    id: row.id.toString(),
    submittedAt: row.submittedAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? "",
    rejectedAt: row.rejectedAt?.toISOString() ?? "",
    reviewedAt: row.reviewedAt?.toISOString() ?? "",
    resubmittedAt: row.resubmittedAt?.toISOString() ?? "",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toApprovingAdminActor(actor: DealerRequestActor): AuthActor | null {
  if (!/^\d+$/.test(actor.actorId)) return null;
  return { userId: BigInt(actor.actorId), sessionId: "", role: "ADMIN" };
}

function isConflictRouteError(error: unknown): error is AdminRouteError {
  return error instanceof AdminRouteError && error.code === "CONFLICT";
}

function buildRequestQuery(actor: DealerRequestActor, oid: { toString(): string }) {
  const accessQuery = buildDealerRequestAccessQuery(actor);
  return Object.keys(accessQuery).length > 0
    ? { $and: [{ _id: oid }, accessQuery] }
    : { _id: oid };
}


function isDuplicateKeyError(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as { code?: number | string }).code;
  return code === 11000 || code === "P2002";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const oid = toRequestId(id);
    if (!oid) {
      return buildResponseError("Invalid dealer request id", 400);
    }

    const actor = actorFromAuth(await requireAuth());

    if (!actor || (actor.role !== "admin" && actor.role !== "staff")) {
      return buildResponseError("Dealer request access is restricted to admin and staff-like roles", 403);
    }

    await ensurePostgresDealerRequestIndexes();
    const collection = getPostgresDealerRequestCollection();
    const doc = await collection.findOne(buildRequestQuery(actor, oid));
    if (!doc) {
      return buildResponseError("Dealer request not found", 404);
    }

    return NextResponse.json({ success: true, data: toDealerRequestDetail(doc) });
  } catch (error) {
    console.error("[GET /api/dealer-requests/[id]]", error);
    const authStatus = errorStatus(error, 0);
    if (authStatus === 401 || authStatus === 403) {
      return buildResponseError((error as Error).message, authStatus);
    }
    const status = isPostgresDealerRequestDependencyError(error) ? 503 : 500;
    return buildResponseError(
      status === 503
        ? "Dealer request database is currently unavailable"
        : "Failed to load dealer request",
      status,
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const oid = toRequestId(id);
    if (!oid) {
      return buildResponseError("Invalid dealer request id", 400);
    }

    const body = await request.json();
    const actor = actorFromAuth(await requireAuth());

    if (!actor || (actor.role !== "admin" && actor.role !== "staff")) {
      return buildResponseError("Dealer request access is restricted to admin and staff-like roles", 403);
    }

    const action = String(body.action ?? "").trim().toLowerCase();
    if (action !== "accept" && action !== "reject" && action !== "resubmit") {
      return buildResponseError("Invalid dealer request action", 400);
    }

    await ensurePostgresDealerRequestIndexes();
    const collection = getPostgresDealerRequestCollection();
    const baseQuery = buildRequestQuery(actor, oid);
    const existing = await collection.findOne(baseQuery);
    if (!existing) {
      return buildResponseError("Dealer request not found", 404);
    }

    const current = toDealerRequestDetail(existing);
    const transitionError = ensureStatusTransition(current.status, action);
    if (transitionError) {
      return buildResponseError(transitionError, 409);
    }

    if (action === "accept") {
      if (actor.role !== "admin") {
        return buildResponseError("Only admin can accept dealer requests", 403);
      }

      const adminActor = toApprovingAdminActor(actor);
      if (!adminActor) {
        return buildResponseError("Approving admin user id is required", 400);
      }

      let snapshot = normalizeDealerFormSnapshot(body.formSnapshot ?? existing.formSnapshot);
      const dealerCode = await generatePostgresDealerCode(snapshot.dealerCode);
      if (!dealerCode) {
        return buildResponseError("All 4-digit dealer codes are already in use", 409);
      }
      snapshot = { ...snapshot, dealerCode };
      const validationError = validateDealerFormSnapshot(snapshot);
      if (validationError) {
        return buildResponseError(validationError, 400);
      }

      const dealerInput = buildDealerInputFromSnapshot(snapshot);
      const now = new Date();

      try {
        const accepted = await prisma.$transaction(async (tx) => {
          const pending = await tx.dealerRequest.findFirst({
            where: { id: BigInt(oid.toString()), status: "pending" },
          });

          if (!pending) {
            const latest = await tx.dealerRequest.findUnique({
              where: { id: BigInt(oid.toString()) },
              select: { status: true },
            });
            throw new AdminRouteError(
              "CONFLICT",
              latest?.status === "accepted"
                ? "This request has already been accepted"
                : latest?.status === "rejected"
                  ? "This request has already been rejected"
                  : "Only pending requests can be accepted",
              { code: "DEALER_REQUEST_PROCESSED" },
            );
          }

          const pendingDetail = toDealerRequestDetail(toDealerRequestRecord(pending));
          const createdDealer = await createAdminDealer(dealerInput, adminActor, tx);
          const auditTrail = appendAuditEntry(pendingDetail.auditTrail, {
            action: "accepted",
            at: now.toISOString(),
            actorId: actor.actorId,
            actorName: actor.actorName,
            actorRole: actor.role,
            note: `Dealer created with id ${createdDealer.id}`,
          });

          return tx.dealerRequest.update({
            where: { id: pending.id },
            data: {
              ...buildSnapshotSummary(snapshot),
              formSnapshot: snapshot as Prisma.InputJsonValue,
              requestIdentityKey: buildDealerRequestIdentityKey(snapshot, pending.submittedById),
              status: "accepted",
              reviewedById: actor.actorId,
              reviewedByName: actor.actorName,
              reviewedAt: now,
              acceptedAt: now,
              rejectedAt: null,
              rejectionReason: "",
              createdDealerId: createdDealer.id,
              openRequestKey: null,
              approvalLock: Prisma.JsonNull,
              updatedAt: now,
              auditTrail: auditTrail as Prisma.InputJsonValue,
            },
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        invalidateStaffAssignmentCache();
        return NextResponse.json({ success: true, data: toDealerRequestDetail(toDealerRequestRecord(accepted)) });
      } catch (error) {
        if (isConflictRouteError(error)) {
          return buildResponseError(error.message, 409);
        }
        throw error;
      }
    }
    if (action === "reject") {
      if (actor.role !== "admin") {
        return buildResponseError("Only admin can reject dealer requests", 403);
      }

      const rejectionReason = String(body.rejectionReason ?? "").trim().slice(0, 1500);
      if (!rejectionReason) {
        return buildResponseError("Rejection reason is required", 400);
      }

      const hasSnapshot = !!body.formSnapshot;
      const snapshot = hasSnapshot
        ? normalizeDealerFormSnapshot(body.formSnapshot)
        : normalizeDealerFormSnapshot(existing.formSnapshot);
      if (hasSnapshot) {
        const validationError = validateDealerFormSnapshot(snapshot);
        if (validationError) {
          return buildResponseError(validationError, 400);
        }
      }

      const now = new Date().toISOString();
      const rejected = await collection.findOneAndUpdate(
        { _id: oid, status: "pending" },
        {
          $set: {
            ...(hasSnapshot ? buildSnapshotSummary(snapshot) : {}),
            ...(hasSnapshot ? { formSnapshot: snapshot } : {}),
            ...(hasSnapshot ? { requestIdentityKey: buildDealerRequestIdentityKey(snapshot, current.submittedById) } : {}),
            status: "rejected",
            reviewedById: actor.actorId,
            reviewedByName: actor.actorName,
            reviewedAt: now,
            rejectedAt: now,
            acceptedAt: "",
            rejectionReason,
            lastRejectionReason: rejectionReason,
            openRequestKey: null,
            approvalLock: null,
            updatedAt: now,
            auditTrail: appendAuditEntry(current.auditTrail, {
              action: "rejected",
              at: now,
              actorId: actor.actorId,
              actorName: actor.actorName,
              actorRole: actor.role,
              note: rejectionReason,
            }),
          },
        },
        { returnDocument: "after" },
      );

      if (!rejected) {
        return buildResponseError("This request can no longer be rejected", 409);
      }

      return NextResponse.json({ success: true, data: toDealerRequestDetail(rejected) });
    }

    if (actor.role !== "staff" || current.submittedById !== actor.actorId) {
      return buildResponseError("Only the submitting staff-like user can resubmit this request", 403);
    }

    let snapshot = normalizeDealerFormSnapshot(body.formSnapshot ?? existing.formSnapshot);
    const dealerCode = await generatePostgresDealerCode(snapshot.dealerCode);
    if (!dealerCode) {
      return buildResponseError("All 4-digit dealer codes are already in use", 409);
    }
    snapshot = { ...snapshot, dealerCode };
    const validationError = validateDealerFormSnapshot(snapshot);
    if (validationError) {
      return buildResponseError(validationError, 400);
    }

    const codeConflict = await findDealerCodeReservationConflict(snapshot.dealerCode, { excludeRequestId: BigInt(oid.toString()) });
    if (codeConflict) {
      return buildResponseError(
        codeConflict === "dealer-profile"
          ? "Dealer code already exists"
          : "A pending dealer request already exists for this dealer code",
        409,
      );
    }


    const now = new Date().toISOString();
    try {
      const resubmitted = await collection.findOneAndUpdate(
        { _id: oid, status: "rejected", submittedById: actor.actorId },
        {
          $set: {
            ...buildSnapshotSummary(snapshot),
            formSnapshot: snapshot,
            requestIdentityKey: buildDealerRequestIdentityKey(snapshot, actor.actorId),
            status: "pending",
            reviewedById: "",
            reviewedByName: "",
            reviewedAt: "",
            rejectedAt: "",
            acceptedAt: "",
            rejectionReason: "",
            openRequestKey: buildDealerRequestIdentityKey(snapshot, actor.actorId),
            resubmittedAt: now,
            updatedAt: now,
            approvalLock: null,
            auditTrail: appendAuditEntry(current.auditTrail, {
              action: "resubmitted",
              at: now,
              actorId: actor.actorId,
              actorName: actor.actorName,
              actorRole: actor.role,
            }),
          },
        },
        { returnDocument: "after" },
      );

      if (!resubmitted) {
        return buildResponseError("This request can no longer be resubmitted", 409);
      }

      return NextResponse.json({ success: true, data: toDealerRequestDetail(resubmitted) });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return buildResponseError("A pending request already exists for this dealer details", 409);
      }
      throw error;
    }
  } catch (error) {
    console.error("[PATCH /api/dealer-requests/[id]]", error);
    const authStatus = errorStatus(error, 0);
    if (authStatus === 401 || authStatus === 403) {
      return buildResponseError((error as Error).message, authStatus);
    }
    const status = isPostgresDealerRequestDependencyError(error) ? 503 : 500;
    return buildResponseError(
      status === 503
        ? "Dealer request database is currently unavailable"
        : "Failed to update dealer request",
      status,
    );
  }
}
