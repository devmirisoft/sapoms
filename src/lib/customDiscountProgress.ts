export type CustomDiscountProgress = "accepted" | "rejected" | "awaiting" | null;

export const CUSTOM_DISCOUNT_PROGRESS_LABELS = {
  accepted: "Accepted",
  rejected: "Rejected",
  awaiting: "Awaiting",
} as const;

export type CustomDiscountRequestLike = {
  id?: string | number | null;
  status?: string | null;
  orderId?: string | number | null;
  order_id?: string | number | null;
  orderNumber?: string | number | null;
  order_number?: string | number | null;
  lastReorderedOrderId?: string | number | null;
  dealerId?: string | number | null;
  refno?: string | null;
};

export type CustomDiscountProgressSummary = {
  customDiscountStatus: CustomDiscountProgress;
  customDiscountRequestCount: number;
  customDiscountApprovedCount: number;
};

function cleanText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeTrailingNumber(value: unknown) {
  const text = cleanText(value);
  if (!text) return "";

  const digitsOnly = text.match(/^\d+$/)?.[0];
  if (digitsOnly) {
    const normalized = String(Number(digitsOnly));
    return normalized === "NaN" ? digitsOnly : normalized;
  }

  const trailingDigits = text.match(/(\d+)(?!.*\d)/)?.[1];
  if (!trailingDigits) return "";

  const normalized = String(Number(trailingDigits));
  return normalized === "NaN" ? trailingDigits : normalized;
}

function dedupe(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function normalizeCustomDiscountRequestStatus(value: unknown) {
  const normalized = cleanText(value).toLowerCase();
  if (normalized === "approved") return "approved";
  if (normalized === "pending" || normalized === "under_review" || normalized === "under review") return "pending";
  if (normalized === "rejected" || normalized === "disapproved") return "rejected";
  return normalized;
}

export function resolveCustomDiscountProgress(
  requestsForOrder: CustomDiscountRequestLike[]
): CustomDiscountProgress {
  if (requestsForOrder.length === 0) return null;

  const statuses = requestsForOrder.map((request) => normalizeCustomDiscountRequestStatus(request.status));
  if (statuses.every((status) => status === "approved")) return "accepted";
  if (statuses.includes("rejected")) return "rejected";
  return "awaiting";
}

export function summarizeCustomDiscountProgress(
  requestsForOrder: CustomDiscountRequestLike[]
): CustomDiscountProgressSummary {
  const uniqueRequests = dedupeCustomDiscountRequests(requestsForOrder);
  const customDiscountApprovedCount = uniqueRequests.filter(
    (request) => normalizeCustomDiscountRequestStatus(request.status) === "approved"
  ).length;

  return {
    customDiscountStatus: resolveCustomDiscountProgress(uniqueRequests),
    customDiscountRequestCount: uniqueRequests.length,
    customDiscountApprovedCount,
  };
}

export function extractCustomDiscountRequestOrderKeys(request: CustomDiscountRequestLike) {
  return dedupe([
    normalizeTrailingNumber(request.orderId),
    normalizeTrailingNumber(request.order_id),
    normalizeTrailingNumber(request.lastReorderedOrderId),
    normalizeTrailingNumber(request.orderNumber),
    normalizeTrailingNumber(request.order_number),
  ]);
}

export function dedupeCustomDiscountRequests<T extends CustomDiscountRequestLike>(requests: T[]) {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const request of requests) {
    const id = cleanText(request.id);
    const dedupeKey = id || JSON.stringify([
      cleanText(request.status),
      cleanText(request.orderId ?? request.order_id ?? request.lastReorderedOrderId),
      cleanText(request.orderNumber ?? request.order_number),
      cleanText(request.dealerId),
      cleanText(request.refno),
    ]);

    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(request);
  }

  return result;
}

export function buildCustomDiscountProgressMap<T extends CustomDiscountRequestLike>(requests: T[]) {
  const grouped = new Map<string, T[]>();

  for (const request of dedupeCustomDiscountRequests(requests)) {
    for (const key of extractCustomDiscountRequestOrderKeys(request)) {
      const existing = grouped.get(key) ?? [];
      existing.push(request);
      grouped.set(key, existing);
    }
  }

  const result: Record<string, CustomDiscountProgressSummary> = {};
  for (const [key, groupedRequests] of grouped.entries()) {
    result[key] = summarizeCustomDiscountProgress(groupedRequests);
  }

  return result;
}

export function getCustomDiscountProgressKeyForOrder(orderId: unknown) {
  return normalizeTrailingNumber(orderId);
}
