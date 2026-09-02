import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";
import { requireAuth, writeAuthAuditLog, type AuthActor } from "@/server/auth/session";
import type { AuthRole } from "@/server/auth/providers/types";
import { isAdminLike } from "@/server/auth/sales-scope";
import { AdminRouteError } from "./admin-errors";
import type { AdminActor } from "./admin.types";

export async function requireAdmin(): Promise<AdminActor> {
  const actor = await requireAuth();
  if (!isAdminLike(actor)) throw new Error("Forbidden");
  return actor as AdminActor;
}

// The NSM reads everything an admin reads, but only the ADMIN acts: staff (the
// NSM included) may be created, edited, deactivated or deleted by the admin
// alone, so mutating routes gate on this instead of requireAdmin.
export async function requireAdminOnly(): Promise<AdminActor> {
  const actor = await requireAdmin();
  if (actor.role !== "ADMIN") throw new Error("Forbidden");
  return actor;
}

export function requireRole(actor: AuthActor, roles: AuthRole[]) {
  if (!roles.includes(actor.role)) {
    throw new Error("Forbidden");
  }
}

export function requestIdFrom(request: NextRequest) {
  return request.headers.get("x-request-id")?.trim() || randomUUID();
}

export async function auditAdminAction(input: {
  actor: AdminActor;
  request: NextRequest;
  eventType: string;
  route: string;
  requestId: string;
  targetId?: string;
}) {
  await writeAuthAuditLog({
    sessionId: input.actor.sessionId,
    userId: input.actor.userId,
    role: input.actor.role,
    eventType: input.eventType,
    request: input.request,
    metadata: {
      route: input.route,
      requestId: input.requestId,
      ...(input.targetId ? { targetId: input.targetId } : {}),
    },
  });
}

export function parseBigIntRouteParam(value: string, label: string) {
  if (!/^\d+$/.test(value)) {
    throw new AdminRouteError("INVALID_REQUEST", `Invalid ${label}`);
  }
  return BigInt(value);
}

/**
 * staff_profiles and admin_profiles (where the NSM lives) are separate id
 * sequences, so a bare id is ambiguous across the two. The NSM is addressed as
 * "nsm:<id>"; a bare id always means a staff profile.
 */
export function parseStaffTarget(value: string): { kind: "staff" | "nsm"; id: bigint } {
  const nsm = value.startsWith("nsm:");
  return { kind: nsm ? "nsm" : "staff", id: parseBigIntRouteParam(nsm ? value.slice(4) : value, "staff id") };
}

