import { resolveOrderDealerId, splitScopeIds } from "@/lib/staffOrderScope.js";
import { requireAuth } from "@/server/auth/session";
import { fetchStaffAssignedDealerIds, orderActorFromAuth } from "@/lib/orderScopeServer";

type OrderAccessReason = "available" | "not_found" | "forbidden";

type OrderActor = {
  role: "admin" | "accountant" | "staff" | "dealer";
  actorId: string;
  isRsm?: boolean;
  isAsm?: boolean;
  userId?: string;
};

type OrderAccessOptions = {
  actor: OrderActor;
  assignedDealerIds?: Array<string | number>;
};

export type OrderAccess = {
  visible: boolean;
  order: Record<string, unknown> | null;
  reason: OrderAccessReason;
  message: string;
};

function safeText(value: unknown, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeLookupOrderId(value: unknown) {
  const raw = safeText(value);
  const displayIdMatch = raw.match(/(?:^|\/)(\d+)$/);
  return displayIdMatch?.[1] ?? raw;
}

export function messageForReason(reason: OrderAccessReason) {
  switch (reason) {
    case "forbidden": return "This order is outside your assigned order scope.";
    case "not_found": return "Order not found.";
    default: return "";
  }
}

function result(order: Record<string, unknown> | null): OrderAccess {
  const reason: OrderAccessReason = order ? "available" : "not_found";
  return { visible: !!order, order, reason, message: messageForReason(reason) };
}

function forbiddenResult(): OrderAccess {
  const reason = "forbidden";
  return { visible: false, order: null, reason, message: messageForReason(reason) };
}

function isAccessOptions(value: unknown): value is OrderAccessOptions {
  return !!value && typeof value === "object" && "actor" in value;
}

async function defaultAccessOptions(): Promise<OrderAccessOptions | null> {
  const authActor = await requireAuth();
  const actor = orderActorFromAuth(authActor);
  if (!actor) return null;
  const assignedDealerIds = actor.role === "staff" ? await fetchStaffAssignedDealerIds(actor.actorId) : [];
  return { actor, assignedDealerIds };
}

async function findPostgresAccessOrder(id: string): Promise<Record<string, unknown> | null> {
  const postgresOrders = await import("@/lib/postgresOrders");
  const order = await postgresOrders.findPostgresOrderByLookupId(id);
  return order ? postgresOrders.mapPostgresOrderToLegacy(order) : null;
}

async function canStaffAccessOrder(order: Record<string, unknown>, options: OrderAccessOptions, lookupId: string) {
  if (splitScopeIds([order.assignedstaff, order.staffid]).includes(safeText(options.actor.actorId))) return true;
  const dealerId = resolveOrderDealerId(order);
  if (!!dealerId && new Set(splitScopeIds(options.assignedDealerIds)).has(dealerId)) return true;
  // An RSM also owns every order under its region and its ASM/executive
  // subtree, which direct assignment alone does not cover.
  if (options.actor.isRsm) {
    const { isOrderInRsmScope } = await import("@/lib/postgresOrders");
    return isOrderInRsmScope(options.actor, lookupId);
  }
  return false;
}

async function applyActorAccess(order: Record<string, unknown> | null, options: OrderAccessOptions | null, lookupId: string): Promise<OrderAccess> {
  if (!order) return result(null);
  if (!options) return forbiddenResult();

  if (options.actor.role === "admin" || options.actor.role === "accountant") return result(order);

  const dealerId = resolveOrderDealerId(order);
  if (options.actor.role === "dealer") {
    return dealerId && dealerId === safeText(options.actor.actorId) ? result(order) : forbiddenResult();
  }

  if (options.actor.role === "staff") {
    return await canStaffAccessOrder(order, options, lookupId) ? result(order) : forbiddenResult();
  }

  return forbiddenResult();
}

export async function resolveOrderAccess(orderId: unknown, accessOptions?: unknown): Promise<OrderAccess> {
  const id = normalizeLookupOrderId(orderId);
  if (!id) return result(null);
  const options = isAccessOptions(accessOptions) ? accessOptions : await defaultAccessOptions();
  const postgresOrder = await findPostgresAccessOrder(id);
  return applyActorAccess(postgresOrder, options, id);
}

export async function filterExistingOrderIds(orderIds: unknown[], accessOptions?: unknown): Promise<Set<string>> {
  const ids = Array.from(new Set(orderIds.map((id) => safeText(id)).filter(Boolean))).slice(0, 200);
  const options = isAccessOptions(accessOptions) ? accessOptions : await defaultAccessOptions();
  const results = await Promise.all(ids.map((id) => resolveOrderAccess(id, options)));
  return new Set(ids.filter((_, index) => results[index].visible));
}