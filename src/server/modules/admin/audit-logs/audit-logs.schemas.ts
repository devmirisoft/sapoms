import { AdminRouteError } from "@/server/admin/admin-errors";
import { parseAdminPagination } from "@/server/admin/admin-pagination";
import type { AuthRole } from "@/server/auth/providers/types";
import type { AdminAuditLogListInput } from "./audit-logs.types";

const AUTH_ROLES: AuthRole[] = ["ADMIN", "NSM", "ACCOUNTANT", "RSM", "ASM", "STAFF", "DEALER"];

function optionalText(value: string | null, label: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  if (text.length > max) throw new AdminRouteError("INVALID_REQUEST", `${label} is too long`);
  return text;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function optionalDate(value: string | null, label: string, endOfDay = false) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AdminRouteError("INVALID_REQUEST", `Invalid ${label}`);
  // <input type="date"> sends a bare day, which parses to midnight. Used as-is on
  // the upper bound it would exclude everything logged during that day.
  if (endOfDay && DATE_ONLY.test(value.trim())) date.setUTCHours(23, 59, 59, 999);
  return date;
}

export function parseAdminAuditLogListInput(searchParams: URLSearchParams): AdminAuditLogListInput {
  const base = parseAdminPagination(searchParams);

  const roleParam = optionalText(searchParams.get("actorRole"), "actorRole", 20)?.toUpperCase();
  if (roleParam && !AUTH_ROLES.includes(roleParam as AuthRole)) {
    throw new AdminRouteError("INVALID_REQUEST", "Invalid actorRole");
  }

  const dateFrom = optionalDate(searchParams.get("dateFrom"), "dateFrom");
  const dateTo = optionalDate(searchParams.get("dateTo"), "dateTo", true);
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new AdminRouteError("INVALID_REQUEST", "dateFrom must not be after dateTo");
  }

  return {
    ...base,
    action: optionalText(searchParams.get("action"), "action", 80)?.toUpperCase(),
    entity: optionalText(searchParams.get("entity"), "entity", 80)?.toUpperCase(),
    actorRole: roleParam as AuthRole | undefined,
    entityId: optionalText(searchParams.get("entityId"), "entityId", 80),
    dateFrom,
    dateTo,
  };
}
