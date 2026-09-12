import { AdminRouteError } from "./admin-route-error";
import type { AdminListInput } from "./admin.types";

function parsePositiveInteger(value: string | null, fallback: number, maximum?: number) {
  if (value === null || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value.trim())) {
    throw new AdminRouteError("INVALID_REQUEST", "Invalid pagination parameter");
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new AdminRouteError("INVALID_REQUEST", "Invalid pagination parameter");
  }

  return maximum ? Math.min(parsed, maximum) : parsed;
}

export function parseAdminPagination(searchParams: URLSearchParams): AdminListInput {
  const page = parsePositiveInteger(searchParams.get("page"), 1);
  const pageSize = parsePositiveInteger(searchParams.get("limit"), 20, 100);
  const search = String(searchParams.get("search") ?? "").trim();

  if (search.length > 200) {
    throw new AdminRouteError("INVALID_REQUEST", "Search must not exceed 200 characters");
  }

  return { page, pageSize, search };
}

export function paginationToPrisma(input: AdminListInput) {
  return {
    skip: (input.page - 1) * input.pageSize,
    take: input.pageSize,
  };
}