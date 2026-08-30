"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  normalizeCustomDiscountRequestRecord,
  type NormalizedCustomDiscountRequest,
} from "@/lib/customDiscountRequests";
import { SegmentedTabs } from "@/components/SegmentedTabs";

type ApprovalStatus = "pending" | "approved" | "rejected";


function money(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function statusBadge(status: string) {
  if (status === "approved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "rejected") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function statusLabel(status: string) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending";
}

function resolveAdminName() {
  if (typeof window === "undefined") return "Admin";
  try {
    const raw = localStorage.getItem("AdminData") || localStorage.getItem("admin") || localStorage.getItem("UserData") || "{}";
    const parsed = JSON.parse(raw);
    return parsed.name || parsed.username || parsed.staff_name || parsed.email || "Admin";
  } catch {
    return "Admin";
  }
}

function totalPieces(request: NormalizedCustomDiscountRequest) {
  return request.orderSnapshot.products.reduce((sum, product) => sum + Number(product.totalPieces || 0), 0);
}

type ViewMode = "list" | "cards";

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <SegmentedTabs
      label="Result view"
      value={mode}
      onChange={(next) => onChange(next as ViewMode)}
      items={[
        {
          value: "list",
          label: "List",
          icon: (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" />
                    </svg>
                  ),
        },
        {
          value: "cards",
          label: "Cards",
          icon: (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                  ),
        },
      ]}
    />
  );
}

function DecisionPanel({
  request,
  note,
  onNoteChange,
  busy,
  awaitingRsm,
  onDecide,
  onToggleReorder,
}: {
  request: NormalizedCustomDiscountRequest;
  note: string;
  onNoteChange: (value: string) => void;
  busy: boolean;
  awaitingRsm: boolean;
  onDecide: (status: ApprovalStatus) => void;
  onToggleReorder: () => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Admin Note</label>
      <textarea
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        rows={4}
        disabled={awaitingRsm || request.normalizedStatus !== "pending" || busy}
        placeholder="Add approval note (optional) or disapproval note (required)..."
        className="mt-2 w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-100 disabled:text-gray-500"
      />

      {awaitingRsm ? (
        <p className="mt-3 text-[12px] font-medium text-amber-700">
          {request.rsmApprovalStatus === "rejected"
            ? "This request was rejected by the RSM and is not available for Admin review."
            : "Waiting for RSM approval. This request becomes actionable once the RSM approves it."}
        </p>
      ) : request.normalizedStatus === "pending" ? (
        <>
          <p className="mt-2 text-[11px] font-medium text-red-600">
            Rejecting this request will save the full order snapshot back to a dealer draft for correction.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => onDecide("approved")}
              disabled={busy}
              className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-[13px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? "Saving..." : "Approve"}
            </button>
            <button
              onClick={() => onDecide("rejected")}
              disabled={busy || !note.trim()}
              title={!note.trim() ? "Add an admin note to disapprove" : undefined}
              className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-[13px] font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 text-[12px] text-gray-500">
            Reviewed by {String(request.source?.reviewedBy || "Admin")} {request.reviewedAt ? `on ${new Date(request.reviewedAt).toLocaleString("en-IN")}` : ""}
          </p>
          {request.normalizedStatus === "approved" && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2">
              <span className="text-[11px] text-gray-500">
                {request.allowReorder ? "Approved order can be restored by the dealer." : "Dealer reorder is currently disabled."}
              </span>
              <label className="inline-flex items-center gap-2">
                <span className="text-[11px] font-medium text-gray-600">Allow Reorder</span>
                <button
                  type="button"
                  onClick={onToggleReorder}
                  disabled={busy}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                    request.allowReorder ? "bg-emerald-500" : "bg-gray-300"
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    request.allowReorder ? "translate-x-4" : "translate-x-0.5"
                  }`} />
                </button>
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// One card per individual request, mirroring the order detail page card view.
function RequestCard({
  request,
  note,
  onNoteChange,
  busy,
  onDecide,
  onToggleReorder,
}: {
  request: NormalizedCustomDiscountRequest;
  note: string;
  onNoteChange: (value: string) => void;
  busy: boolean;
  onDecide: (status: ApprovalStatus) => void;
  onToggleReorder: () => void;
}) {
  const awaitingRsm = request.rsmApprovalStatus !== "approved";
  return (
    <div className={`flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:border-gray-300 hover:shadow-md ${awaitingRsm ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-50 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-700">
              {request.requestReference || request.id}
            </span>
            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
              {request.discountScope === "product" ? "Product Discount" : "Order Discount"}
            </span>
            {request.isLegacySnapshot && (
              <span className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600">Legacy</span>
            )}
          </div>
          <h3 className="truncate text-[14px] font-bold text-gray-900">{request.dealerName || "Dealer"}</h3>
          <p className="mt-0.5 truncate text-[11px] text-gray-500">
            Dealer ID: {request.dealerId}
            {request.source?.dealerCode ? ` · Code: ${String(request.source.dealerCode)}` : ""}
            {` · Submitted ${request.createdAt ? new Date(request.createdAt).toLocaleString("en-IN") : "-"}`}
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusBadge(request.normalizedStatus)}`}>
          {statusLabel(request.normalizedStatus)}
        </span>
      </div>

      {request.rsmApprovalStatus === "approved" ? (
        <p className="text-[11px] font-semibold text-emerald-700">
          RSM Approved{request.rsmReviewedBy ? ` by ${request.rsmReviewedBy}` : ""}
        </p>
      ) : request.rsmApprovalStatus === "rejected" ? (
        <p className="text-[11px] font-semibold text-red-600">RSM Rejected</p>
      ) : (
        <p className="text-[11px] font-semibold text-amber-600">Awaiting RSM Approval</p>
      )}

      {request.discountScope === "product" && request.targetProduct && (
        <p className="text-[11px] font-semibold text-indigo-700">
          Target: {request.targetProduct.displayName || request.targetProduct.variantCode || request.targetProduct.productname || "Selected product"}
        </p>
      )}

      <div className="grid grid-cols-3 gap-3 border-t border-gray-100 pt-4">
        {[
          { label: "Products", val: String(request.orderSnapshot.products.length), cls: "text-gray-900" },
          { label: "Pieces", val: String(totalPieces(request)), cls: "text-gray-900" },
          { label: "Requested", val: `${request.requestedOrderDiscountPercent ?? request.requestedDiscountPercent}%`, cls: "text-indigo-700" },
          { label: "Gross", val: money(request.orderSnapshot.grossAmount), cls: "text-gray-500" },
          { label: "Discount", val: `-${money(request.orderSnapshot.totalDiscountAmount)}`, cls: "text-amber-700" },
          { label: "Net Payable", val: money(request.orderSnapshot.requestedNetPayableAmount), cls: "text-emerald-700" },
        ].map((f) => (
          <div key={f.label}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{f.label}</p>
            <p className={`mt-0.5 font-mono text-[13px] font-bold ${f.cls}`}>{f.val}</p>
          </div>
        ))}
      </div>

      <details className="overflow-hidden rounded-xl border border-gray-200">
        <summary className="cursor-pointer list-none bg-gray-50 px-3 py-2 text-[11px] font-bold text-gray-700">
          Products ({request.orderSnapshot.products.length})
        </summary>
        <div className="max-h-72 divide-y divide-gray-100 overflow-y-auto">
          {request.orderSnapshot.products.map((product, index) => (
            <div key={`${request.id}-${product.productKey || product.sku}-${index}`} className="px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] font-bold text-amber-700">{product.catalogueNumber || product.sku || "-"}</p>
                  <p className="truncate text-[12px] font-semibold text-gray-900">{product.productName || "-"}</p>
                </div>
                <p className="shrink-0 font-mono text-[12px] font-bold text-emerald-700">{money(product.finalAmount)}</p>
              </div>
              <p className="mt-1 font-mono text-[11px] text-gray-500">
                {product.quantity} x {product.packSize} = {product.totalPieces} pcs · {money(product.unitPrice)}
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-bold">
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">
                  Base {product.baseDiscountPercent}%
                </span>
                <span className={`rounded-full border px-2 py-0.5 ${product.usesCustomDiscount ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-gray-200 bg-gray-100 text-gray-600"}`}>
                  {product.usesCustomDiscount ? `Custom ${product.requestedCustomDiscountPercent ?? 0}%` : "Standard Discount"}
                </span>
                {product.isPriority && (
                  <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-red-700">Priority</span>
                )}
              </div>
              {product.productNote && <p className="mt-1 text-[11px] text-gray-500">Product Note: {product.productNote}</p>}
            </div>
          ))}
        </div>
      </details>

      <div className="grid gap-2 text-[11px] text-gray-600 sm:grid-cols-3">
        <p><span className="font-bold uppercase tracking-wider text-gray-400">Order Note</span><br />{request.orderSnapshot.orderNote || "-"}</p>
        <p><span className="font-bold uppercase tracking-wider text-gray-400">Ship To</span><br />{request.shipto || "-"}</p>
        <p><span className="font-bold uppercase tracking-wider text-gray-400">Customer Ref</span><br />{request.refno || "-"}</p>
      </div>

      <DecisionPanel
        request={request}
        note={note}
        onNoteChange={onNoteChange}
        busy={busy}
        awaitingRsm={awaitingRsm}
        onDecide={onDecide}
        onToggleReorder={onToggleReorder}
      />
    </div>
  );
}

export default function CustomDiscountApprovalsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<NormalizedCustomDiscountRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | ApprovalStatus>("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [updating, setUpdating] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | "order" | "product">("all");
  const [rsmFilter, setRsmFilter] = useState<"all" | "approved" | "pending" | "rejected">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/custom-discount-requests?limit=200");
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Failed to load approvals");
      const normalized: NormalizedCustomDiscountRequest[] = (json.data ?? []).map(
        (record: Record<string, unknown>) => normalizeCustomDiscountRequestRecord(record),
      );
      setRequests(normalized);
      setNotes(Object.fromEntries(normalized.map((request) => [request.id, request.adminNote || ""])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadRequests();
    });
  }, [loadRequests]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
    return requests.filter((request) => {
      if (filter !== "all" && request.normalizedStatus !== filter) return false;
      if (scopeFilter !== "all" && request.discountScope !== scopeFilter) return false;
      if (rsmFilter !== "all") {
        const rsm = request.rsmApprovalStatus === "approved" || request.rsmApprovalStatus === "rejected"
          ? request.rsmApprovalStatus
          : "pending";
        if (rsm !== rsmFilter) return false;
      }
      if (from !== null || to !== null) {
        const created = request.createdAt ? new Date(request.createdAt).getTime() : NaN;
        if (Number.isNaN(created)) return false;
        if (from !== null && created < from) return false;
        if (to !== null && created > to) return false;
      }
      if (term) {
        const haystack = [
          request.dealerName,
          request.dealerId,
          request.requestReference,
          request.id,
          request.source?.dealerCode,
          request.refno,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [dateFrom, dateTo, filter, requests, rsmFilter, scopeFilter, search]);

  const hasExtraFilters = Boolean(search || dateFrom || dateTo || scopeFilter !== "all" || rsmFilter !== "all");

  const stats = useMemo(() => ({
    all: requests.length,
    pending: requests.filter((request) => request.normalizedStatus === "pending").length,
    approved: requests.filter((request) => request.normalizedStatus === "approved").length,
    rejected: requests.filter((request) => request.normalizedStatus === "rejected").length,
  }), [requests]);

  const decide = async (request: NormalizedCustomDiscountRequest, status: ApprovalStatus) => {
    const adminNote = notes[request.id] ?? "";
    // A disapproval must always carry a reason the dealer can act on.
    if (status === "rejected" && !adminNote.trim()) {
      setError("Add an admin note explaining the disapproval before rejecting this request.");
      return;
    }
    setUpdating(request.id);
    setError("");
    try {
      const res = await fetch(`/api/custom-discount-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          adminNote,
          reviewedBy: resolveAdminName(),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Update failed");
      const normalized = normalizeCustomDiscountRequestRecord(json.data);
      setRequests((prev) => prev.map((row) => row.id === request.id ? normalized : row));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update approval");
    } finally {
      setUpdating(null);
    }
  };

  const toggleReorder = async (request: NormalizedCustomDiscountRequest) => {
    setUpdating(request.id);
    setError("");
    try {
      const res = await fetch(`/api/custom-discount-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowReorder: !request.allowReorder }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Could not update reorder permission");
      const normalized = normalizeCustomDiscountRequestRecord(json.data);
      setRequests((prev) => prev.map((row) => row.id === request.id ? normalized : row));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update reorder permission");
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-6" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>
      <div className="admin-page-shell space-y-5">
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <button
              onClick={() => router.back()}
              className="mb-3 inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-100"
            >
              Back
            </button>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Discount Approvals</h1>
            <p className="mt-1 text-sm text-gray-500">Review each complete order snapshot before approving or rejecting it.</p>
          </div>

          <div className="flex items-center gap-2">
            <ViewToggle mode={viewMode} onChange={setViewMode} />
            <button
              onClick={loadRequests}
              className="w-fit rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-100"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { key: "all", label: "All", value: stats.all },
            { key: "pending", label: "Pending", value: stats.pending },
            { key: "approved", label: "Approved", value: stats.approved },
            { key: "rejected", label: "Rejected", value: stats.rejected },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setFilter(item.key as "all" | ApprovalStatus)}
              className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                filter === item.key ? "border-indigo-300 bg-indigo-50" : "border-gray-200 bg-white hover:bg-gray-50"
              }`}
            >
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{item.label}</p>
              <p className="mt-1 font-mono text-xl font-bold text-gray-900">{item.value}</p>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3">
          <label className="min-w-[220px] flex-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Dealer, dealer ID, code, request ref..."
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px] text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          <label>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Discount Type</span>
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value as typeof scopeFilter)}
              className="mt-1 block rounded-xl border border-gray-200 px-3 py-2 text-[13px] text-gray-900 outline-none focus:border-indigo-500"
            >
              <option value="all">All</option>
              <option value="order">Order Discount</option>
              <option value="product">Product Discount</option>
            </select>
          </label>
          <label>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">RSM</span>
            <select
              value={rsmFilter}
              onChange={(e) => setRsmFilter(e.target.value as typeof rsmFilter)}
              className="mt-1 block rounded-xl border border-gray-200 px-3 py-2 text-[13px] text-gray-900 outline-none focus:border-indigo-500"
            >
              <option value="all">All</option>
              <option value="pending">Awaiting</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="mt-1 block rounded-xl border border-gray-200 px-3 py-2 text-[13px] text-gray-900 outline-none focus:border-indigo-500"
            />
          </label>
          <label>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">To</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="mt-1 block rounded-xl border border-gray-200 px-3 py-2 text-[13px] text-gray-900 outline-none focus:border-indigo-500"
            />
          </label>
          {hasExtraFilters && (
            <button
              onClick={() => { setSearch(""); setScopeFilter("all"); setRsmFilter("all"); setDateFrom(""); setDateTo(""); }}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-[12px] font-semibold text-gray-600 hover:bg-gray-100"
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-[12px] font-semibold text-gray-500">
            Showing {filtered.length} of {requests.length}
          </span>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">
            Loading approvals...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">
            No discount requests found.
          </div>
        ) : viewMode === "cards" ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            {filtered.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                note={notes[request.id] ?? ""}
                onNoteChange={(value) => setNotes((prev) => ({ ...prev, [request.id]: value }))}
                busy={updating === request.id}
                onDecide={(status) => decide(request, status)}
                onToggleReorder={() => toggleReorder(request)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((request) => {
              const awaitingRsm = request.rsmApprovalStatus !== "approved";
              return (
              <div
                key={request.id}
                className={`rounded-2xl border border-gray-200 bg-white shadow-sm ${awaitingRsm ? "opacity-60" : ""}`}
              >
                <div className="flex flex-col gap-4 border-b border-gray-100 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[16px] font-bold text-gray-900">{request.dealerName || "Dealer"}</h2>
                      <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusBadge(request.normalizedStatus)}`}>
                        {statusLabel(request.normalizedStatus)}
                      </span>
                      <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700">
                        {request.discountScope === "product" ? "Product Discount" : "Order Discount"}
                      </span>
                      {request.isLegacySnapshot && (
                        <span className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-0.5 text-[11px] font-bold text-gray-600">
                          Legacy Request
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-gray-500">
                      <span>Dealer ID: {request.dealerId}</span>
                      {request.source?.dealerCode ? <span>Code: {String(request.source.dealerCode)}</span> : null}
                      {request.assignedStaffId ? <span>Assigned Staff: {request.assignedStaffId}</span> : null}
                      <span>Request Ref.: {request.requestReference || request.id}</span>
                    </div>
                    <p className="text-[12px] text-gray-400">
                      Submitted {request.createdAt ? new Date(request.createdAt).toLocaleString("en-IN") : "-"}
                    </p>
                    {request.rsmApprovalStatus === "approved" ? (
                      <p className="text-[12px] font-semibold text-emerald-700">
                        RSM Approved{request.rsmReviewedBy ? ` by ${request.rsmReviewedBy}` : ""}
                      </p>
                    ) : request.rsmApprovalStatus === "rejected" ? (
                      <p className="text-[12px] font-semibold text-red-600">RSM Rejected</p>
                    ) : (
                      <p className="text-[12px] font-semibold text-amber-600">Awaiting RSM Approval</p>
                    )}
                    {request.discountScope === "product" && request.targetProduct && (
                      <p className="text-[12px] font-semibold text-indigo-700">
                        Custom discount target: {request.targetProduct.displayName || request.targetProduct.variantCode || request.targetProduct.productname || "Selected product"}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-xl border border-gray-200 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Products</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-gray-900">{request.orderSnapshot.products.length}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Pieces</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-gray-900">{totalPieces(request)}</p>
                    </div>
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Requested</p>
                      <p className="mt-1 font-mono text-[14px] font-bold text-indigo-700">
                        {request.requestedOrderDiscountPercent ?? request.requestedDiscountPercent}%
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-900 bg-gray-900 px-3 py-2 text-white">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Requested Net</p>
                      <p className="mt-1 font-mono text-[14px] font-bold">{money(request.orderSnapshot.requestedNetPayableAmount)}</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_340px]">
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Gross Amount</p>
                        <p className="mt-1 font-mono text-[13px] font-semibold text-gray-700">{money(request.orderSnapshot.grossAmount)}</p>
                      </div>
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Base Discount</p>
                        <p className="mt-1 font-mono text-[13px] font-semibold text-amber-700">{money(request.orderSnapshot.baseDiscountAmount)}</p>
                      </div>
                      <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Requested Custom</p>
                        <p className="mt-1 font-mono text-[13px] font-semibold text-indigo-700">{money(request.orderSnapshot.requestedAdditionalDiscountAmount)}</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total Discount</p>
                        <p className="mt-1 font-mono text-[13px] font-semibold text-gray-700">{money(request.orderSnapshot.totalDiscountAmount)}</p>
                      </div>
                      <div className="rounded-xl border border-gray-900 bg-gray-900 px-4 py-3 text-white">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Net Payable</p>
                        <p className="mt-1 font-mono text-[13px] font-semibold">{money(request.orderSnapshot.requestedNetPayableAmount)}</p>
                      </div>
                    </div>

                    <details className="overflow-hidden rounded-xl border border-gray-200" open>
                      <summary className="cursor-pointer list-none bg-gray-50 px-4 py-3 text-[12px] font-bold text-gray-700">
                        Complete Product List
                      </summary>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-white">
                            <tr className="border-b border-gray-100">
                              {["Cat. No.", "Product", "Qty", "Pack Size", "Pieces", "Unit Price", "Gross", "Base", "Requested Custom", "Final"].map((header) => (
                                <th key={header} className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400">
                                  {header}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {request.orderSnapshot.products.map((product, index) => (
                              <tr key={`${request.id}-${product.productKey || product.sku}-${index}`}>
                                <td className="px-3 py-3 font-mono text-[12px] font-bold text-amber-700">{product.catalogueNumber || product.sku || "-"}</td>
                                <td className="px-3 py-3">
                                  <p className="text-[12px] font-semibold text-gray-900">{product.productName || "-"}</p>
                                  <div className="mt-1 flex flex-wrap gap-1.5">
                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${product.usesCustomDiscount ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-gray-200 bg-gray-100 text-gray-600"}`}>
                                      {product.usesCustomDiscount ? "Custom Approval Requested" : "Standard Discount"}
                                    </span>
                                    {product.isPriority && (
                                      <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
                                        Priority
                                      </span>
                                    )}
                                  </div>
                                  {product.productNote && (
                                    <p className="mt-1 text-[11px] text-gray-500">Product Note: {product.productNote}</p>
                                  )}
                                </td>
                                <td className="px-3 py-3 font-mono text-[12px] text-gray-700">{product.quantity}</td>
                                <td className="px-3 py-3 font-mono text-[12px] text-gray-700">{product.packSize}</td>
                                <td className="px-3 py-3 font-mono text-[12px] text-gray-700">{product.totalPieces}</td>
                                <td className="px-3 py-3 font-mono text-[12px] text-gray-700">{money(product.unitPrice)}</td>
                                <td className="px-3 py-3 font-mono text-[12px] text-gray-900">{money(product.grossAmount)}</td>
                                <td className="px-3 py-3 font-mono text-[12px] text-amber-700">
                                  {product.baseDiscountPercent}% · -{money(product.baseDiscountAmount)}
                                </td>
                                <td className="px-3 py-3 font-mono text-[12px] text-indigo-700">
                                  {product.usesCustomDiscount
                                    ? `${product.requestedCustomDiscountPercent ?? 0}% · -${money(product.requestedCustomDiscountAmount ?? 0)}`
                                    : "Standard Discount"}
                                </td>
                                <td className="px-3 py-3 font-mono text-[12px] font-bold text-emerald-700">{money(product.finalAmount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Order Note</p>
                        <p className="mt-1 whitespace-pre-wrap text-[12px] text-gray-700">{request.orderSnapshot.orderNote || "-"}</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Ship To</p>
                        <p className="mt-1 whitespace-pre-wrap text-[12px] text-gray-700">{request.shipto || "-"}</p>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Customer Ref No.</p>
                        <p className="mt-1 whitespace-pre-wrap text-[12px] text-gray-700">{request.refno || "-"}</p>
                      </div>
                    </div>
                  </div>

                  <DecisionPanel
                    request={request}
                    note={notes[request.id] ?? ""}
                    onNoteChange={(value) => setNotes((prev) => ({ ...prev, [request.id]: value }))}
                    busy={updating === request.id}
                    awaitingRsm={awaitingRsm}
                    onDecide={(status) => decide(request, status)}
                    onToggleReorder={() => toggleReorder(request)}
                  />
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
