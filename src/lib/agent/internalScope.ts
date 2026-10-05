import "server-only";

import type { Prisma } from "@prisma/client";
import type { AuthActor } from "@/server/auth/session";
import { isAdminLike, isStaffLike, staffTeamWhere } from "@/server/auth/sales-scope";
import { actorWhere } from "@/lib/postgresOrders";
import { fetchStaffAssignedDealerIds, orderActorFromAuth } from "@/lib/orderScopeServer";
import { staffRoleLabel } from "@/lib/staffRoleLabel";

const NOTHING = { id: BigInt(-1) };

/**
 * What one internal user may see, built from the session and the app's existing rules,
 * never from the model. Every internal tool ANDs its query with these.
 */
export type InternalScope = {
  actor: AuthActor;
  roleLabel: string;
  /** One sentence for the prompt: what this user can see. */
  description: string;
  /** Same rule as the Orders list (actorWhere). */
  orderWhere: Prisma.OrderWhereInput;
  /** Admin/NSM/Accountant: every dealer. Staff/ASM/RSM: dealers assigned to their team (the sales-target rule). */
  dealerWhere: Prisma.DealerProfileWhereInput;
  /** Company-wide finance: billed/paid figures, all dealers' bills. */
  finance: boolean;
  /** Which CSV exports this user's role can open. */
  salesCsv: boolean;
  billAgeingCsv: boolean;
};

export async function buildScope(actor: AuthActor): Promise<InternalScope> {
  const orderActor = orderActorFromAuth(actor);
  const orderWhere = orderActor
    ? await actorWhere(orderActor, orderActor.role === "staff" ? await fetchStaffAssignedDealerIds(orderActor.actorId) : [])
    : NOTHING;

  const staffLike = isStaffLike(actor);
  const dealerWhere: Prisma.DealerProfileWhereInput = !staffLike
    ? { deletedAt: null }
    : actor.staffId
      ? { deletedAt: null, staffAssignments: { some: { active: true, removedAt: null, staff: staffTeamWhere(actor, actor.staffId) } } }
      : NOTHING;

  const adminLike = isAdminLike(actor);
  const finance = adminLike || actor.role === "ACCOUNTANT";
  const roleLabel = actor.role === "ADMIN" ? "Admin"
    : actor.role === "ACCOUNTANT" ? "Accountant"
    : staffRoleLabel({ role: actor.role, staffRoleType: actor.staffRoleType });

  const description = adminLike
    ? "You can see every dealer, order, sales and finance figure in the company."
    : actor.role === "ACCOUNTANT"
      ? "You can see every dealer and all finance (bills, payments, outstanding); orders only once accepted or in dispatch."
      : actor.role === "RSM"
        ? "You can see dealers assigned to your team (you, your ASMs and their executives) and the orders raised by your Sales Managers."
        : actor.role === "ASM"
          ? "You can see dealers assigned to you and your executives, and their orders."
          : `You can see the dealers assigned to you and their orders${actor.warehouse ? ` (orders handled from the ${actor.warehouse} warehouse)` : ""}.`;

  return {
    actor,
    roleLabel,
    description,
    orderWhere,
    dealerWhere,
    finance,
    salesCsv: adminLike,
    billAgeingCsv: finance,
  };
}

/** India financial year start (1 April) as YYYY-MM-DD, for "this FY". */
export function financialYearStart(now = new Date()) {
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now).split("-").map(Number);
  return `${month >= 4 ? year : year - 1}-04-01`;
}
