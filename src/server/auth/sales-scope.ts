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
 * Where a new dealer request lands. An RSM's goes straight to admin; an ASM's or
 * Sales Manager's goes to its parent RSM first. Plain Staff ("2") cannot raise one.
 * A STAFF user with no subtype counts as a Sales Manager, as in legacy-auth.mapper.
 * With no RSM above the requester it still waits at the RSM stage, unrouted, and
 * the NSM (or Admin) covers it - see orphanRsmDealerRequestWhere.
 */
export async function resolveDealerRequestRoute(
  actor: Pick<AuthActor, "role" | "staffId" | "staffRoleType">,
  prisma: Pick<Prisma.TransactionClient, "staffProfile">,
): Promise<{ status: "pending" | "rsm_pending"; rsmUserId: bigint | null }> {
  if (actor.role === "RSM") return { status: "pending", rsmUserId: null };
  const isSalesManager = actor.role === "STAFF" && actor.staffRoleType !== "2";
  if (actor.role !== "ASM" && !isSalesManager) {
    throw Object.assign(new Error("Only Sales Managers, ASMs and RSMs can raise dealer requests"), { status: 403 });
  }
  const profile = actor.staffId
    ? await prisma.staffProfile.findUnique({ where: { id: actor.staffId }, select: { parentRsm: { select: { userId: true } } } })
    : null;
  return { status: "rsm_pending", rsmUserId: profile?.parentRsm?.userId ?? null };
}

/* ---- RSM -> NSM -> Admin fallback ----
   An RSM-stage item whose RSM is missing or inactive is an "orphan": the NSM
   approves it instead, or Admin when there is no active NSM. Admin also takes the
   NSM's own discount stage when there is no active NSM. Decided on read, never
   stored, so pending and future items both follow it and go back to an RSM as
   soon as one is active again. */

const ACTIVE_USER = { status: "ACTIVE", deletedAt: null } satisfies Prisma.UserWhereInput;
const ACTIVE_RSM_USER = { role: "RSM", ...ACTIVE_USER } satisfies Prisma.UserWhereInput;
const ACTIVE_RSM = { user: ACTIVE_RSM_USER } satisfies Prisma.StaffProfileWhereInput;

/**
 * Orders an RSM handles. The order climbs through the lowest sales person the
 * dealer has: its Sales Manager (stamped on the order), else the dealer's ASM,
 * else straight to the dealer's RSM. Adding an SM later restamps pending orders
 * (restampPendingOrders), which puts them back on the SM -> RSM path.
 */
export function rsmOrderScope(rsmStaffId: bigint, rsmUserId: bigint): Prisma.OrderWhereInput {
  return {
    OR: [
      { salesManager: { parentRsmId: rsmStaffId } },
      { salesManagerId: null, dealer: { staffAssignments: { some: { active: true, staff: { staffRoleType: "ASM", parentRsmId: rsmStaffId } } } } },
      { salesManagerId: null, dealer: { rsmUserId } },
    ],
  };
}

// Same three paths as rsmOrderScope, with an active RSM at the end of the path.
export const orphanRsmOrderWhere: Prisma.OrderWhereInput = {
  rsmApprovalStatus: "AWAITING",
  status: { notIn: ["CANCELLED", "DECLINED"] },
  NOT: {
    OR: [
      { salesManager: { parentRsm: ACTIVE_RSM } },
      { salesManagerId: null, dealer: { staffAssignments: { some: { active: true, staff: { staffRoleType: "ASM", parentRsm: ACTIVE_RSM } } } } },
      { salesManagerId: null, dealer: { regionalManager: ACTIVE_RSM_USER } },
    ],
  },
};

// Mirrors buildRsmDiscountRequestWhere: the dealer's region RSM or the raiser's RSM.
export const orphanRsmDiscountWhere: Prisma.CustomDiscountRequestWhereInput = {
  status: "PENDING",
  rsmApprovalStatus: "PENDING",
  NOT: {
    OR: [
      { dealer: { regionalManager: ACTIVE_RSM_USER } },
      { staff: ACTIVE_RSM },
      { staff: { parentRsm: ACTIVE_RSM } },
      { staff: { rsmLinks: { some: { rsm: ACTIVE_RSM } } } },
    ],
  },
};

// Mirrors buildFundRequestScope's RSM branch.
export const orphanRsmFundWhere: Prisma.DealerFundRequestWhereInput = {
  status: "REQUESTED",
  NOT: {
    OR: [
      { regionalManager: ACTIVE_RSM_USER },
      { staff: { parentRsm: ACTIVE_RSM } },
      { staff: { rsmLinks: { some: { rsm: ACTIVE_RSM } } } },
    ],
  },
};

// Dealer requests carry a bare rsmUserId (no relation), so resolve active RSMs first.
export async function orphanRsmDealerRequestWhere(prisma: Pick<Prisma.TransactionClient, "user">): Promise<Prisma.DealerRequestWhereInput> {
  const active = await prisma.user.findMany({ where: ACTIVE_RSM_USER, select: { id: true } });
  return { status: "rsm_pending", OR: [{ rsmUserId: null }, { rsmUserId: { notIn: active.map((user) => user.id) } }] };
}

/** Ids of RSM-stage dealer requests this NSM/Admin reviews for an unavailable RSM. */
export async function dealerRequestCoverIds(
  actor: Pick<AuthActor, "role">,
  prisma: Pick<Prisma.TransactionClient, "user" | "dealerRequest">,
): Promise<Set<string>> {
  if (!isAdminLike(actor) || !(await coversRsmStage(actor, prisma))) return new Set();
  const rows = await prisma.dealerRequest.findMany({ where: await orphanRsmDealerRequestWhere(prisma), select: { id: true } });
  return new Set(rows.map((row) => row.id.toString()));
}

export async function activeNsmExists(prisma: Pick<Prisma.TransactionClient, "user">) {
  return (await prisma.user.count({ where: { role: "NSM", ...ACTIVE_USER } })) > 0;
}

/** Whether this actor approves RSM-stage orphans: the NSM, or Admin when there is no active NSM. */
export async function coversRsmStage(actor: Pick<AuthActor, "role">, prisma: Pick<Prisma.TransactionClient, "user">) {
  if (actor.role === "NSM") return true;
  return actor.role === "ADMIN" && !(await activeNsmExists(prisma));
}

/** Whether this actor approves the NSM discount stage on the NSM's behalf: Admin with no active NSM. */
export async function coversNsmStage(actor: Pick<AuthActor, "role">, prisma: Pick<Prisma.TransactionClient, "user">) {
  return actor.role === "ADMIN" && !(await activeNsmExists(prisma));
}

/**
 * Which discount stage this NSM/Admin covers, by request id: "rsm" for an orphan
 * at the RSM stage, "nsm" for the NSM stage when there is no active NSM.
 * Pass `id` to check one request.
 */
export async function discountCovers(
  actor: Pick<AuthActor, "role">,
  prisma: Pick<Prisma.TransactionClient, "user" | "customDiscountRequest">,
  id?: bigint,
): Promise<Map<string, "rsm" | "nsm">> {
  const covers = new Map<string, "rsm" | "nsm">();
  if (!isAdminLike(actor)) return covers;
  const scope = id === undefined ? {} : { id };
  const [rsm, nsm] = await Promise.all([coversRsmStage(actor, prisma), coversNsmStage(actor, prisma)]);
  const [rsmRows, nsmRows] = await Promise.all([
    rsm ? prisma.customDiscountRequest.findMany({ where: { ...scope, ...orphanRsmDiscountWhere }, select: { id: true } }) : [],
    nsm ? prisma.customDiscountRequest.findMany({ where: { ...scope, status: "PENDING", rsmApprovalStatus: "APPROVED", nsmApprovalStatus: "PENDING" }, select: { id: true } }) : [],
  ]);
  nsmRows.forEach((row) => covers.set(row.id.toString(), "nsm"));
  rsmRows.forEach((row) => covers.set(row.id.toString(), "rsm"));
  return covers;
}

/**
 * Reviewer name recorded when someone approves on another role's behalf, so every
 * screen that shows "approved by" also says who was unavailable.
 * ponytail: lives in the existing *ReviewedByName columns; add a column if reports must filter on it.
 */
export function onBehalfName(actor: Pick<AuthActor, "role" | "displayName" | "email">, stages: "RSM" | "NSM" | "RSM and NSM") {
  return `${actor.displayName || actor.email} (${actor.role}, on behalf of unavailable ${stages})`;
}

/**
 * Staff on an RSM's team: ASMs and Sales Managers through `parentRsmId`, plain
 * Staff through their (zero or more) RSM links.
 */
export function rsmTeamWhere(rsmId: bigint): Prisma.StaffProfileWhereInput {
  return { OR: [{ parentRsmId: rsmId }, { rsmLinks: { some: { rsmId } } }] };
}

/**
 * The staff whose dealers count as "mine" on the staff dashboard (sales target) and in
 * the assistant: RSM the whole team, ASM self + their executives, Staff only themselves.
 */
export function staffTeamWhere(actor: Pick<AuthActor, "role">, staffId: bigint): Prisma.StaffProfileWhereInput {
  return actor.role === "RSM"
    ? { OR: [{ id: staffId }, { parentRsmId: staffId }, { parentAsm: { parentRsmId: staffId } }] }
    : actor.role === "ASM" ? { OR: [{ id: staffId }, { parentAsmId: staffId }] }
    : { id: staffId };
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
    where: rsmTeamWhere(actor.staffId),
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
