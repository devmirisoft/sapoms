import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { AdminRouteError } from "@/server/admin/admin-errors";
import { hashPassword } from "@/server/auth/password";
import type { AuthActor } from "@/server/auth/session";

const MIN_PASSWORD_LENGTH = 5;
const MAX_PASSWORD_LENGTH = 200;
const MIN_EXPIRY_HOURS = 1;
const MAX_EXPIRY_HOURS = 24 * 90;

// Exactly one owner column is set; the CHECK constraint enforces it in the DB.
export type DiagnosticPasswordOwner = { dealerId: bigint } | { staffId: bigint };

const createdByInclude = {
  createdBy: { select: { email: true, adminProfile: { select: { displayName: true } } } },
} as const;

type DiagnosticPasswordRecord = {
  id: bigint;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  createdBy: { email: string; adminProfile: { displayName: string } | null };
};

function invalid(message: string, code = "INVALID_REQUEST") {
  return new AdminRouteError("INVALID_REQUEST", message, { code });
}

function notFound(message: string, code = "NOT_FOUND") {
  return new AdminRouteError("NOT_FOUND", message, { code });
}

function isDealer(owner: DiagnosticPasswordOwner): owner is { dealerId: bigint } {
  return "dealerId" in owner;
}

// Spelled out rather than built from parts so the audit trail stays greppable.
function auditEvent(owner: DiagnosticPasswordOwner, action: "CREATED" | "REVOKED") {
  if (isDealer(owner)) return action === "CREATED" ? "ADMIN_DEALER_DIAGNOSTIC_PASSWORD_CREATED" : "ADMIN_DEALER_DIAGNOSTIC_PASSWORD_REVOKED";
  return action === "CREATED" ? "ADMIN_STAFF_DIAGNOSTIC_PASSWORD_CREATED" : "ADMIN_STAFF_DIAGNOSTIC_PASSWORD_REVOKED";
}

function parsePassword(value: unknown) {
  const password = String(value ?? "");
  if (password.length < MIN_PASSWORD_LENGTH) throw invalid(`Temporary password must be at least ${MIN_PASSWORD_LENGTH} characters`, "PASSWORD_TOO_SHORT");
  if (password.length > MAX_PASSWORD_LENGTH) throw invalid("Temporary password is too long", "PASSWORD_TOO_LONG");
  return password;
}

function parseExpiryHours(value: unknown) {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isInteger(parsed) || parsed < MIN_EXPIRY_HOURS || parsed > MAX_EXPIRY_HOURS) {
    throw invalid(`Expiry must be between ${MIN_EXPIRY_HOURS} and ${MAX_EXPIRY_HOURS} hours`, "INVALID_EXPIRY");
  }
  return parsed;
}

function mapRecord(record: DiagnosticPasswordRecord) {
  return {
    id: record.id.toString(),
    expiresAt: record.expiresAt.toISOString(),
    revokedAt: record.revokedAt?.toISOString() ?? null,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    createdBy: record.createdBy.adminProfile?.displayName || record.createdBy.email,
  };
}

async function assertOwnerExists(tx: Prisma.TransactionClient, owner: DiagnosticPasswordOwner) {
  if (isDealer(owner)) {
    const dealer = await tx.dealerProfile.findFirst({ where: { id: owner.dealerId, deletedAt: null, user: { deletedAt: null } }, select: { id: true } });
    if (!dealer) throw notFound("Dealer not found", "DEALER_NOT_FOUND");
    return;
  }
  const staff = await tx.staffProfile.findFirst({ where: { id: owner.staffId, user: { deletedAt: null } }, select: { id: true } });
  if (!staff) throw notFound("Staff member not found", "STAFF_NOT_FOUND");
}

export async function getActiveDiagnosticPassword(owner: DiagnosticPasswordOwner) {
  const record = await prisma.diagnosticPassword.findFirst({
    where: { ...owner, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    include: createdByInclude,
  });
  return record ? mapRecord(record) : null;
}

export async function createDiagnosticPassword(owner: DiagnosticPasswordOwner, body: unknown, actor: AuthActor) {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const password = parsePassword(input.password ?? input.temporaryPassword);
  const expiryHours = parseExpiryHours(input.expiryHours ?? input.expiresInHours);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryHours * 60 * 60 * 1000);
  const passwordHash = await hashPassword(password);

  return prisma.$transaction(async (tx) => {
    await assertOwnerExists(tx, owner);
    // Only one temporary password may be live per owner at a time.
    await tx.diagnosticPassword.updateMany({
      where: { ...owner, revokedAt: null },
      data: { revokedAt: now, revokedByUserId: actor.userId },
    });
    const created = await tx.diagnosticPassword.create({
      data: { ...owner, passwordHash, expiresAt, createdByUserId: actor.userId },
      include: createdByInclude,
    });
    await tx.authAuditLog.create({
      data: {
        sessionId: actor.sessionId,
        role: actor.role as never,
        eventType: auditEvent(owner, "CREATED"),
        metadata: { userId: actor.userId.toString(), ...serializeOwner(owner), diagnosticPasswordId: created.id.toString(), expiresAt: expiresAt.toISOString() },
      },
    });
    return mapRecord(created);
  });
}

export async function revokeDiagnosticPassword(owner: DiagnosticPasswordOwner, actor: AuthActor) {
  const now = new Date();
  const revoked = await prisma.$transaction(async (tx) => {
    const { count } = await tx.diagnosticPassword.updateMany({
      where: { ...owner, revokedAt: null },
      data: { revokedAt: now, revokedByUserId: actor.userId },
    });
    await tx.authAuditLog.create({
      data: {
        sessionId: actor.sessionId,
        role: actor.role as never,
        eventType: auditEvent(owner, "REVOKED"),
        metadata: { userId: actor.userId.toString(), ...serializeOwner(owner), count },
      },
    });
    return count;
  });
  return { revoked };
}

function serializeOwner(owner: DiagnosticPasswordOwner) {
  return isDealer(owner) ? { dealerId: owner.dealerId.toString() } : { staffId: owner.staffId.toString() };
}
