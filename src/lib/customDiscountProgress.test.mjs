import test from "node:test";
import assert from "node:assert/strict";

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeTrailingNumber(value) {
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

function normalizeStatus(value) {
  const normalized = cleanText(value).toLowerCase();
  if (normalized === "approved") return "approved";
  if (normalized === "pending" || normalized === "under_review" || normalized === "under review") return "pending";
  if (normalized === "rejected" || normalized === "disapproved") return "rejected";
  return normalized;
}

function dedupeRequests(requests) {
  const seen = new Set();
  const result = [];
  for (const request of requests) {
    const id = cleanText(request.id);
    const key = id || JSON.stringify([
      cleanText(request.status),
      cleanText(request.orderId ?? request.order_id ?? request.lastReorderedOrderId),
      cleanText(request.orderNumber ?? request.order_number),
      cleanText(request.dealerId),
      cleanText(request.refno),
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(request);
  }
  return result;
}

function extractOrderKeys(request) {
  return Array.from(new Set([
    normalizeTrailingNumber(request.orderId),
    normalizeTrailingNumber(request.order_id),
    normalizeTrailingNumber(request.lastReorderedOrderId),
    normalizeTrailingNumber(request.orderNumber),
    normalizeTrailingNumber(request.order_number),
  ].filter(Boolean)));
}

function resolveCustomDiscountProgress(requestsForOrder) {
  if (requestsForOrder.length === 0) return null;
  const statuses = requestsForOrder.map((request) => normalizeStatus(request.status));
  if (statuses.every((status) => status === "approved")) return "accepted";
  if (statuses.includes("rejected")) return "rejected";
  return "awaiting";
}

function buildProgressMap(requests) {
  const grouped = new Map();
  for (const request of dedupeRequests(requests)) {
    for (const key of extractOrderKeys(request)) {
      const current = grouped.get(key) ?? [];
      current.push(request);
      grouped.set(key, current);
    }
  }

  const out = {};
  for (const [key, value] of grouped.entries()) {
    out[key] = {
      customDiscountStatus: resolveCustomDiscountProgress(value),
      customDiscountRequestCount: value.length,
      customDiscountApprovedCount: value.filter((request) => normalizeStatus(request.status) === "approved").length,
    };
  }
  return out;
}

test("no request returns null", () => {
  assert.equal(resolveCustomDiscountProgress([]), null);
});

test("pending request returns awaiting", () => {
  assert.equal(resolveCustomDiscountProgress([{ status: "pending" }]), "awaiting");
});

test("mixed pending and approved returns awaiting", () => {
  assert.equal(resolveCustomDiscountProgress([{ status: "approved" }, { status: "pending" }]), "awaiting");
});

test("all approved returns accepted", () => {
  assert.equal(resolveCustomDiscountProgress([{ status: "Approved" }, { status: "APPROVED" }]), "accepted");
});

test("rejected request returns rejected", () => {
  assert.equal(resolveCustomDiscountProgress([{ status: "approved" }, { status: "rejected" }]), "rejected");
});

test("duplicate request ids are ignored and order keys group records", () => {
  const progressMap = buildProgressMap([
    { id: "a", orderId: "OM/2026/3838", status: "approved" },
    { id: "a", orderId: "OM/2026/3838", status: "approved" },
    { id: "b", orderNumber: "3838", status: "pending" },
  ]);

  assert.equal(progressMap["3838"].customDiscountStatus, "awaiting");
  assert.equal(progressMap["3838"].customDiscountRequestCount, 2);
  assert.equal(progressMap["3838"].customDiscountApprovedCount, 1);
});
