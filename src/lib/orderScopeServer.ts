import { filterOrdersForActor } from "@/lib/staffOrderScope.js";
import { prisma } from "@/server/db/prisma";
import type { AuthActor } from "@/server/auth/session";

const ASSIGNMENT_CACHE_TTL_MS = 60_000;

type AssignmentCacheEntry = {
  expiresAt: number;
  value?: string[];
  request?: Promise<string[]>;
};

const scopeGlobal = globalThis as typeof globalThis & {
  __staffAssignmentCache?: Map<string, AssignmentCacheEntry>;
};
const assignmentCache = scopeGlobal.__staffAssignmentCache
  ?? (scopeGlobal.__staffAssignmentCache = new Map());

export type OrderActor = {
  role: "admin" | "accountant" | "staff" | "dealer";
  actorId: string;
  isRsm?: boolean;
  isAsm?: boolean;
  userId?: string;
  warehouse?: string;
};

function safeText(value: unknown, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

export function parseOrderActor(input: {
  role?: unknown;
  actorId?: unknown;
}): OrderActor | null {
  const role = safeText(input.role, 20).toLowerCase();
  const actorId = safeText(input.actorId);
  if (!["admin", "accountant", "staff", "dealer"].includes(role)) return null;
  if ((role === "staff" || role === "dealer") && !actorId) return null;
  return { role: role as OrderActor["role"], actorId };
}

export function orderActorFromAuth(actor: AuthActor): OrderActor | null {
  const rawRole = actor.role.toLowerCase();
  // NSM is an admin-profile role with full order scope — same normalisation the
  // client does in normalizeRoleFromProfile.
  const role = rawRole === "rsm" || rawRole === "asm" || rawRole === "sales_manager"
    ? "staff"
    : rawRole === "nsm" ? "admin" : rawRole;
  if (role !== "admin" && role !== "accountant" && role !== "staff" && role !== "dealer") return null;
  const actorId = role === "staff"
    ? actor.staffId?.toString() ?? ""
    : role === "dealer"
      ? actor.dealerId?.toString() ?? ""
      : actor.profileId.toString();
  if ((role === "staff" || role === "dealer") && !actorId) return null;
  return {
    role,
    actorId,
    ...(rawRole === "rsm" ? { isRsm: true, userId: actor.userId?.toString() } : {}),
    ...(rawRole === "asm" ? { isAsm: true } : {}),
    ...(actor.warehouse ? { warehouse: actor.warehouse } : {}),
  } as OrderActor;
}

export async function fetchStaffAssignedDealerIds(staffId: string): Promise<string[]> {
  if (!staffId) return [];
  const cached = assignmentCache.get(staffId);
  if (cached?.value && cached.expiresAt > Date.now()) return [...cached.value];
  if (cached?.request) return [...await cached.request];

  const request = (async () => {
    const postgresAssignments = /^\d+$/.test(staffId)
      ? await prisma.dealerStaffAssignment.findMany({
          where: { staffId: BigInt(staffId), active: true },
          select: { dealerId: true },
        }).catch(() => [])
      : [];
    const value = postgresAssignments.map((row) => row.dealerId.toString());
    assignmentCache.set(staffId, { value, expiresAt: Date.now() + ASSIGNMENT_CACHE_TTL_MS });
    return value;
  })();

  assignmentCache.set(staffId, { request, expiresAt: 0 });
  try {
    return [...await request];
  } catch (error) {
    if (assignmentCache.get(staffId)?.request === request) assignmentCache.delete(staffId);
    throw error;
  }
}
export function invalidateStaffAssignmentCache(staffId?: string) {
  if (staffId) assignmentCache.delete(staffId);
  else assignmentCache.clear();
}

export async function scopeOrdersForActor<T extends Record<string, unknown>>(
  orders: T[],
  actor: OrderActor
): Promise<T[]> {
  const assignedDealerIds = actor.role === "staff"
    ? await fetchStaffAssignedDealerIds(actor.actorId)
    : [];
  return filterOrdersForActor({ ...actor, orders, assignedDealerIds });
}
