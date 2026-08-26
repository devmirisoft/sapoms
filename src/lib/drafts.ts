/**
 * lib/drafts.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Named-draft CRUD helpers backed by PostgreSQL via /api/drafts.
 * Dealer isolation is enforced server-side from the authenticated session; dealer_id is kept as a compatibility hint.
 * Function signatures are identical to the former Supabase version so that
 * AddOrderForm needs no changes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { DraftApprovalState } from "@/lib/customDiscountRequests";

const BASE = "/api/drafts";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DraftProductRow = {
  key: number;
  productname: string;
  displayName: string;
  variantCode: string;
  producQuanity: number;
  price: number;
  packSize: number;
  isPriority?: boolean;
  productNote?: string;
};

/** Written by the discount review when either reviewer rejects a request. */
export type DraftRejectionNotes = {
  rejected_by?: "ADMIN" | "RSM" | null;
  rejected_at?: string | null;
  admin_note?: string | null;
  rsm_note?: string | null;
  reason?: string | null;
};

export type OrderDraft = {
  id: string;
  dealer_id: string;
  name: string;
  shipto: string | null;
  refno: string | null;
  order_note: string | null;
  coupon_code: string | null;
  coupon_pct: number | null;
  approval_state?: DraftApprovalState | null;
  source?: string;
  source_request_id?: string;
  rejection_notes?: DraftRejectionNotes | null;
  rows: DraftProductRow[];
  created_at: string;
  updated_at: string;
};

export type DraftPayload = {
  dealer_id: string;
  name: string;
  shipto?: string;
  refno?: string;
  order_note?: string | null;
  coupon_code?: string | null;
  coupon_pct?: number | null;
  approval_state?: DraftApprovalState | null;
  rows: DraftProductRow[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch(path: string, init?: RequestInit) {
  const res  = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  const json = await res.json();
  if (!json.success) throw new Error(json.message ?? "API error");
  return json;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getDrafts(dealerId: string): Promise<OrderDraft[]> {
  const json = await apiFetch(`${BASE}?dealer_id=${encodeURIComponent(dealerId)}`);
  return json.data ?? [];
}

export async function getDraftById(id: string, dealerId: string): Promise<OrderDraft | null> {
  try {
    const json = await apiFetch(`${BASE}/${id}?dealer_id=${encodeURIComponent(dealerId)}`);
    return json.data ?? null;
  } catch {
    return null;
  }
}

export async function saveDraft(payload: DraftPayload): Promise<OrderDraft> {
  const json = await apiFetch(BASE, { method: "POST", body: JSON.stringify(payload) });
  return json.data as OrderDraft;
}

export async function updateDraft(
  id: string,
  dealerId: string,
  payload: Partial<Omit<DraftPayload, "dealer_id">>
): Promise<OrderDraft> {
  const json = await apiFetch(`${BASE}/${id}`, {
    method: "PUT",
    body: JSON.stringify({ dealer_id: dealerId, ...payload }),
  });
  return json.data as OrderDraft;
}

export async function renameDraft(id: string, dealerId: string, name: string): Promise<void> {
  await apiFetch(`${BASE}/${id}`, {
    method: "PUT",
    body: JSON.stringify({ dealer_id: dealerId, name }),
  });
}

export async function deleteDraft(id: string, dealerId: string): Promise<void> {
  await apiFetch(`${BASE}/${id}?dealer_id=${encodeURIComponent(dealerId)}`, { method: "DELETE" });
}

export async function getDraftCount(dealerId: string): Promise<number> {
  const json = await apiFetch(`${BASE}?dealer_id=${encodeURIComponent(dealerId)}&count=1`);
  return json.count ?? 0;
}
