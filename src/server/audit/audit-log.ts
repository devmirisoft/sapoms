import "server-only";

import type { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import type { AuditAction, AuditEntity } from "@/lib/auditActions";
import type { AuthActor } from "@/server/auth/session";
import { requestIp, userAgent } from "@/server/http/request-meta";
import { prisma } from "@/server/db/prisma";
import { sanitizeAuditValues } from "./audit-sanitize";

const AUTH_ROLES = new Set(["ADMIN", "NSM", "ACCOUNTANT", "RSM", "ASM", "STAFF", "DEALER"]);

/**
 * `role` is a plain string because several modules carry their own structurally
 * compatible AuthActor whose role is typed `string`. It is validated against the
 * enum before it reaches the column rather than cast blindly.
 */
export type AuditActorInput = {
  userId: bigint;
  role: string;
  sessionId?: string;
  displayName?: string;
  email?: string;
};

function auditRole(role: string | undefined): AuthActor["role"] | null {
  return role && AUTH_ROLES.has(role) ? (role as AuthActor["role"]) : null;
}

export type CreateAuditLogInput = {
  /** Omitted for events with no established identity yet, e.g. a failed login. */
  actor?: AuditActorInput | null;
  action: AuditAction | string;
  entity: AuditEntity | string;
  entityId?: string | number | bigint | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  request?: NextRequest;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  /**
   * Keeps the audit row in the caller's transaction, so the record and the change
   * it describes commit or roll back together. Without it the write is
   * best-effort and its failure is swallowed (see below).
   */
  tx?: Prisma.TransactionClient;
  /** Overrides the derived `<ENTITY>_<ACTION>` event type for legacy names. */
  eventType?: string;
};

function idToString(value: string | number | bigint | null | undefined) {
  return value === null || value === undefined ? null : String(value);
}

function buildData(input: CreateAuditLogInput): Prisma.AuthAuditLogUncheckedCreateInput {
  const actor = input.actor ?? null;
  const metadata = sanitizeAuditValues(input.metadata) ?? {};

  return {
    // Kept so the pre-existing consumers of eventType keep working.
    eventType: input.eventType ?? `${input.entity}_${input.action}`,
    action: String(input.action),
    entity: String(input.entity),
    entityId: idToString(input.entityId),

    actorId: actor?.userId ?? null,
    actorName: actor?.displayName ?? null,
    actorEmail: actor?.email ?? null,
    role: auditRole(actor?.role),
    sessionId: actor?.sessionId ?? null,

    oldValues: (sanitizeAuditValues(input.oldValues) ?? undefined) as Prisma.InputJsonValue | undefined,
    newValues: (sanitizeAuditValues(input.newValues) ?? undefined) as Prisma.InputJsonValue | undefined,

    ipAddress: input.ipAddress ?? (input.request ? requestIp(input.request) : null),
    userAgent: input.userAgent ?? (input.request ? userAgent(input.request) : null),
    requestId: input.requestId ?? null,

    metadata: {
      ...metadata,
      ...(actor?.userId ? { userId: actor.userId.toString() } : {}),
    } as Prisma.InputJsonValue,
  };
}

/**
 * Writes one row of the admin audit trail.
 *
 * Pass `tx` for anything where losing the record would matter — the write then
 * shares the caller's transaction and a failure rolls the business change back
 * with it. Without `tx` the write is best-effort and errors are swallowed, which
 * is the behaviour `writeAuthAuditLog` has always had here: an audit write must
 * never be the reason a user's action fails.
 */
export async function createAuditLog(input: CreateAuditLogInput) {
  const data = buildData(input);

  if (input.tx) {
    await input.tx.authAuditLog.create({ data });
    return;
  }

  await prisma.authAuditLog.create({ data }).catch((error) => {
    console.error("[audit] failed to write audit log", {
      action: data.action,
      entity: data.entity,
      entityId: data.entityId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}
