import type { Prisma, SalesRegion } from "@prisma/client";
import type { AuthActor } from "@/server/auth/session";

export const SALES_REGIONS = ["NORTH_1", "NORTH_2", "SOUTH_1", "SOUTH_2", "WEST_1", "WEST_2", "EAST", "ROM", "CENTRAL"] as const;
export type SalesRegionCode = typeof SALES_REGIONS[number];

export function isSalesRegion(value: unknown): value is SalesRegionCode {
  return typeof value === "string" && (SALES_REGIONS as readonly string[]).includes(value.toUpperCase());
}

export function normalizeSalesRegion(value: unknown): SalesRegionCode | undefined {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  const upper = String(value).trim().toUpperCase();
  return isSalesRegion(upper) ? upper : undefined;
}

export function isAdminLike<T extends Pick<AuthActor, "role">>(actor: T): actor is T & { role: "ADMIN" | "NSM" } {
  return actor.role === "ADMIN" || actor.role === "NSM";
}

export function isStaffLike<T extends Pick<AuthActor, "role">>(actor: T): actor is T & { role: "STAFF" | "RSM" | "ASM" } {
  return actor.role === "STAFF" || actor.role === "RSM" || actor.role === "ASM";
}

export function isRsm(actor: Pick<AuthActor, "role">) {
  return actor.role === "RSM";
}

export async function resolveActorSalesRegion(actor: Pick<AuthActor, "userId" | "role">, prisma: Pick<Prisma.TransactionClient, "staffProfile">): Promise<SalesRegion | null> {
  if (actor.role !== "RSM") return null;
  const profile = await prisma.staffProfile.findUnique({ where: { userId: actor.userId }, select: { salesRegion: true } });
  if (!profile?.salesRegion) throw Object.assign(new Error("RSM region is not configured"), { status: 403 });
  return profile.salesRegion;
}

export async function resolveSalesScope(actor: Pick<AuthActor, "userId" | "role">, requestedRegion: unknown, prisma: Pick<Prisma.TransactionClient, "staffProfile">) {
  const normalized = normalizeSalesRegion(requestedRegion);
  if (actor.role === "RSM") {
    const region = await resolveActorSalesRegion(actor, prisma);
    if (normalized && normalized !== region) throw Object.assign(new Error("RSM cannot access another region"), { status: 403 });
    return { scope: "REGION" as const, region };
  }
  if (isAdminLike(actor) || actor.role === "ACCOUNTANT") {
    return normalized ? { scope: "REGION" as const, region: normalized } : { scope: "ALL" as const, region: null };
  }
  return { scope: "OWN" as const, region: null };
}

export async function buildDealerRegionWhere(actor: Pick<AuthActor, "userId" | "role">, requestedRegion: unknown, prisma: Pick<Prisma.TransactionClient, "staffProfile">): Promise<Prisma.DealerProfileWhereInput> {
  const scope = await resolveSalesScope(actor, requestedRegion, prisma);
  return scope.scope === "REGION" && scope.region ? { region: scope.region } : {};
}

export async function buildOrderRegionWhere(actor: Pick<AuthActor, "userId" | "role">, requestedRegion: unknown, prisma: Pick<Prisma.TransactionClient, "staffProfile">): Promise<Prisma.OrderWhereInput> {
  const scope = await resolveSalesScope(actor, requestedRegion, prisma);
  return scope.scope === "REGION" && scope.region ? { dealer: { region: scope.region } } : {};
}

/**
 * Every staff profile reporting into an RSM, at any depth.
 *
 * `parentRsmId` is denormalized on write: an ASM gets it from the RSM it is
 * created under, and an Executive inherits its ASM's `parentRsmId` (see
 * staff.repository.ts). So the whole subtree is one flat query rather than a
 * recursive walk, and the RSM's own profile is included so requests raised
 * against dealers they hold directly stay in scope.
 */
export async function resolveRsmTeamStaffIds(
  actor: Pick<AuthActor, "role" | "staffId">,
  prisma: Pick<Prisma.TransactionClient, "staffProfile">,
): Promise<bigint[]> {
  if (actor.role !== "RSM" || !actor.staffId) return [];
  const team = await prisma.staffProfile.findMany({
    where: { parentRsmId: actor.staffId },
    select: { id: true },
  });
  return [actor.staffId, ...team.map((member) => member.id)];
}

/**
 * Discount-request scope for an RSM: anything in their sales region, plus
 * anything raised by a staff member reporting into them. The region alone is
 * not enough — a child ASM/Executive can hold a dealer whose region is unset or
 * set to another region, and those requests still need RSM review.
 */
export async function buildRsmDiscountRequestWhere(
  actor: Pick<AuthActor, "userId" | "role" | "staffId">,
  prisma: Pick<Prisma.TransactionClient, "staffProfile">,
): Promise<Prisma.CustomDiscountRequestWhereInput> {
  const [dealerWhere, teamStaffIds] = await Promise.all([
    buildDealerRegionWhere(actor, undefined, prisma),
    resolveRsmTeamStaffIds(actor, prisma),
  ]);

  const clauses: Prisma.CustomDiscountRequestWhereInput[] = [];
  // An empty dealerWhere means unscoped, which must not widen an RSM to all
  // dealers — only add the region clause when it actually constrains.
  if (Object.keys(dealerWhere).length > 0) clauses.push({ dealer: dealerWhere });
  if (teamStaffIds.length > 0) clauses.push({ staffId: { in: teamStaffIds } });

  if (clauses.length === 0) return { id: BigInt(-1) };
  return clauses.length === 1 ? clauses[0] : { OR: clauses };
}
