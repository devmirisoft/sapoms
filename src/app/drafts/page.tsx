"use client";

/**
 * app/drafts/page.tsx
 * Shows all saved order drafts for the logged-in dealer.
 * Laid out like /orders: sticky header, filterable table card, paginated footer.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast, ToastContainer } from "react-toastify";
import moment from "moment";
import { ArrowRight, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { type DraftProductRow, type OrderDraft } from "@/lib/drafts";
import {
  prefetchDraft,
  useDeleteDraft,
  useDrafts,
  useRenameDraft,
} from "@/lib/useDrafts";
import { SegmentedTabs } from "@/components/SegmentedTabs";

const EMPTY_DRAFTS: OrderDraft[] = [];
const DRAFT_PAGE_SIZE_OPTIONS = [10, 20, 30, 40] as const;
const DEFAULT_PAGE_SIZE = 10;

type DealerUser = {
  Dealer_Id: string;
  Dealer_Name?: string;
};

type DraftFilters = {
  dateFrom: string;
  dateTo: string;
  status: string;
};

const EMPTY_FILTERS: DraftFilters = { dateFrom: "", dateTo: "", status: "" };

async function fetchLatestOrderIdForDealer(dealerId: string | undefined) {
  if (!dealerId) return "";

  try {
    const res = await fetch(`/api/orders-data?page=1&limit=1&search=`);
    const json = await res.json();
    return String(json?.data?.[0]?.order_id ?? "").trim();
  } catch {
    return "";
  }
}

function deriveOrderNumberFrom(lastOrderId: string | undefined | null, increment = 1) {
  const year = new Date().getFullYear();
  const prefix = "OM";
  const defaultPadding = 4;

  if (!lastOrderId) return `${prefix}/${year}/${String(increment).padStart(defaultPadding, "0")}`;

  const parts = String(lastOrderId).trim().split("/");
  const lastPart = parts[parts.length - 1] ?? "";
  const digits = (lastPart.match(/\d+/g)?.join("") ?? "").trim();
  const num = Number.isFinite(Number(digits)) && digits ? parseInt(digits, 10) : 0;
  const padding = digits.length || defaultPadding;
  const next = (isNaN(num) ? 0 : num) + increment;

  return `${prefix}/${year}/${String(next).padStart(padding, "0")}`;
}

function formatMoney(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function filledRows(draft: OrderDraft): DraftProductRow[] {
  return draft.rows.filter((row) => row.productname);
}

function draftTotal(draft: OrderDraft): number {
  const disc = Number(draft.coupon_pct ?? 0);
  const subtotalRupees = filledRows(draft).reduce((acc, row) => {
    const qty = Number(row.producQuanity) || 0;
    const packSize = Number(row.packSize) || 1;
    const price = Number(row.price) || 0;
    return acc + qty * packSize * price;
  }, 0);
  const discountedRupees = Math.max(0, subtotalRupees - subtotalRupees * (disc / 100));
  return Math.round(discountedRupees * 100);
}

function draftSearchText(draft: OrderDraft, provisionalRef?: string) {
  return [
    draft.name,
    draft.shipto,
    draft.refno,
    provisionalRef,
    draft.coupon_code,
    ...draft.rows.flatMap((row) => [row.productname, row.displayName, row.variantCode]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function sameRecord(a: Record<string, string>, b: Record<string, string>) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);

  return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
}

/**
 * A disapproved order is its own status: it is not a discount review outcome,
 * and once resubmitted it sits in "resubmitted" until a reviewer accepts it -
 * at which point the draft is retired server-side and leaves this list.
 */
function draftStatus(draft: OrderDraft): "draft" | "pending" | "rejected" | "approved" | "rejected_order" | "resubmitted" {
  if (draft.source === "order_rejection") {
    return draft.approval_state?.status === "pending" ? "resubmitted" : "rejected_order";
  }
  if (draft.source === "custom_discount_rejection") return "rejected";
  const status = draft.approval_state?.status;
  if (status === "pending" || status === "rejected" || status === "approved") return status;
  return "draft";
}

const statusConf: Record<string, { label: string; dot: string; cls: string }> = {
  draft:    { label: "Draft",    dot: "bg-slate-400",   cls: "bg-slate-50 border-slate-200 text-slate-700" },
  pending:  { label: "Pending",  dot: "bg-amber-400",   cls: "bg-amber-50 border-amber-200 text-amber-800" },
  approved: { label: "Approved", dot: "bg-emerald-400", cls: "bg-emerald-50 border-emerald-200 text-emerald-800" },
  rejected: { label: "Rejected Discount", dot: "bg-red-400", cls: "bg-red-50 border-red-200 text-red-800" },
  rejected_order: { label: "Rejected Order", dot: "bg-rose-500", cls: "bg-rose-50 border-rose-300 text-rose-800" },
  resubmitted: { label: "Resubmitted", dot: "bg-sky-400", cls: "bg-sky-50 border-sky-200 text-sky-800" },
};

/** The three kinds of thing that live in this list, each on its own tab. */
const TABS = [
  { id: "all", label: "All", statuses: [] as string[] },
  { id: "draft", label: "My Drafts", statuses: ["draft"] },
  { id: "rejected_order", label: "Rejected Orders", statuses: ["rejected_order", "resubmitted"] },
  { id: "discount", label: "Discount Approvals", statuses: ["pending", "approved", "rejected"] },
] as const;

type DraftTab = (typeof TABS)[number]["id"];

function DraftStatusBadge({ status }: { status: string }) {
  const s = statusConf[status] ?? statusConf.draft;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {s.label}
    </span>
  );
}

/** Removable chip summarising one active filter. */
function FilterTag({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 text-[11px] font-semibold">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove filter ${label}`} className="opacity-70 hover:opacity-100">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}

const filterInputCls = (active: boolean) =>
  `mt-1.5 block px-2 py-1 text-[11px] font-medium normal-case tracking-normal rounded-md border outline-none transition-colors ${
    active ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-gray-200 bg-white text-gray-700"
  } focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100`;

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100">
      {[40, 200, 110, 120, 70, 90, 90, 80].map((w, i) => (
        <td key={i} className="px-4 py-4">
          <div className="h-3.5 bg-gray-100 rounded animate-pulse" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

export default function DraftsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<DealerUser | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<DraftFilters>(EMPTY_FILTERS);
  const [tab, setTab] = useState<DraftTab>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [provisionals, setProvisionals] = useState<Record<string, string>>({});
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem("UserData");
    const loggedIn = localStorage.getItem("status");

    if (!stored || JSON.parse(loggedIn ?? "false") !== true) {
      router.push("/login");
      return;
    }

    setUser(JSON.parse(stored));
  }, [router]);

  const { data: draftData, isLoading: loading, isFetching } = useDrafts(user?.Dealer_Id);
  const drafts = draftData ?? EMPTY_DRAFTS;
  const deleteMutation = useDeleteDraft();
  const renameMutation = useRenameDraft();

  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!user?.Dealer_Id || drafts.length === 0) {
        if (mounted) setProvisionals((prev) => (Object.keys(prev).length === 0 ? prev : {}));
        return;
      }

      try {
        const last = await fetchLatestOrderIdForDealer(user.Dealer_Id);
        const map: Record<string, string> = {};
        let inc = 1;

        for (const draft of drafts) {
          if (draft.refno) continue;
          map[draft.id] = deriveOrderNumberFrom(last, inc);
          inc += 1;
        }

        if (mounted) setProvisionals((prev) => (sameRecord(prev, map) ? prev : map));
      } catch {
        if (mounted) setProvisionals((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      }
    })();

    return () => {
      mounted = false;
    };
  }, [user?.Dealer_Id, drafts]);

  const visibleDrafts = useMemo(() => {
    const q = query.trim().toLowerCase();

    const filtered = drafts.filter((draft) => {
      if (q && !draftSearchText(draft, provisionals[draft.id]).includes(q)) return false;
      const status = draftStatus(draft);
      const tabStatuses: readonly string[] = TABS.find((entry) => entry.id === tab)?.statuses ?? [];
      if (tabStatuses.length > 0 && !tabStatuses.includes(status)) return false;
      if (filters.status && status !== filters.status) return false;
      const updated = moment(draft.updated_at);
      if (filters.dateFrom && updated.isBefore(moment(filters.dateFrom), "day")) return false;
      if (filters.dateTo && updated.isAfter(moment(filters.dateTo), "day")) return false;
      return true;
    });

    return [...filtered].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [drafts, provisionals, query, filters, tab]);

  const totalCount = visibleDrafts.length;
  const totalPages = Math.ceil(totalCount / pageSize);
  const pagedDrafts = visibleDrafts.slice((page - 1) * pageSize, page * pageSize);

  // A filter/search change can shrink the list past the current page.
  useEffect(() => {
    if (page > 1 && page > totalPages) setPage(1);
  }, [page, totalPages]);

  // Counts ignore the tab itself so every tab shows what it holds, not what is
  // left after the current selection.
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: drafts.length };
    for (const entry of TABS) {
      if (entry.id === "all") continue;
      counts[entry.id] = drafts.filter((draft) => (entry.statuses as readonly string[]).includes(draftStatus(draft))).length;
    }
    return counts;
  }, [drafts]);

  const filtersActive = Object.values(filters).some((v) => v !== "");
  const setFilter = (key: keyof DraftFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setPage(1); };

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setQuery(search); setPage(1); };

  const handleDelete = (id: string) => {
    if (!user) return;
    if (!confirm("Delete this draft? This cannot be undone.")) return;

    deleteMutation.mutate(
      { id, dealerId: user.Dealer_Id },
      {
        onSuccess: () => toast.success("Draft deleted."),
        onError: () => toast.error("Could not delete draft."),
      },
    );
  };

  const startRename = (draft: OrderDraft) => {
    setRenamingId(draft.id);
    setRenameValue(draft.name);
    setTimeout(() => renameRef.current?.focus(), 50);
  };

  const commitRename = (id: string) => {
    if (!user) return;

    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }

    renameMutation.mutate(
      { id, dealerId: user.Dealer_Id, name: trimmed },
      {
        onError: () => toast.error("Rename failed."),
        onSettled: () => setRenamingId(null),
      },
    );
  };

  const openDraft = (id: string) => {
    router.push(`/dashboard/dealer/AddOrderForm?draft=${id}`);
  };

  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce<(number | "…")[]>((acc, p, i, arr) => {
      if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("…");
      acc.push(p); return acc;
    }, []);

  if (!user) return null;

  return (
    <>
      <ToastContainer position="top-right" autoClose={4000} />

      <div className="min-h-screen bg-gray-50" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>

        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.back()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] text-[12.5px] font-medium text-[#374151] cursor-pointer transition-all hover:bg-[#f1f5f9] hover:-translate-x-px"
            >
              back
            </button>
            <h1 className="text-xl font-bold text-gray-900">Drafts</h1>
            <p className="text-sm text-gray-600 mt-0.5">
              {loading ? "Loading…" : `${totalCount} ${filtersActive || query ? "matching" : "saved"} draft${totalCount === 1 ? "" : "s"}${user.Dealer_Name ? ` · ${user.Dealer_Name}` : ""}`}
              {isFetching && !loading && (
                <span className="ml-2 inline-flex items-center gap-1 text-indigo-600 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping inline-block" />
                  refreshing
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <form onSubmit={handleSearch} className="flex items-center gap-2">
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                </svg>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search drafts…"
                  className="pl-9 pr-4 py-2 text-[13px] text-gray-900 border border-gray-200 rounded-xl bg-gray-50 outline-none focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all w-52 placeholder:text-gray-400" />
              </div>
              <button type="submit" className="px-4 py-2 bg-gray-900 text-white text-[13px] font-semibold rounded-xl hover:bg-gray-700 transition-colors">Search</button>
              {query && (
                <button type="button" onClick={() => { setSearch(""); setQuery(""); setPage(1); }}
                  className="px-3 py-2 text-[13px] text-gray-600 hover:text-gray-900 border border-gray-200 rounded-xl transition-colors">Clear</button>
              )}
            </form>

            <button
              type="button"
              onClick={() => router.push("/dashboard/dealer/AddOrderForm")}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-xl transition-colors"
            >
              <Plus size={14} />
              New Order
            </button>
          </div>
        </div>

        <div className="px-8 py-6 max-w-[1840px] mx-auto">
          <div className="mb-4">
            <SegmentedTabs
              label="Draft section"
              value={tab}
              onChange={(next) => { setTab(next as DraftTab); setFilter("status", ""); }}
              items={TABS.map((entry) => ({
                value: entry.id,
                label: entry.label,
                tone: entry.id === "rejected_order" ? "rose" : "neutral",
                count: tabCounts[entry.id] ?? 0,
              }))}
            />
          </div>

          {filtersActive && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Filters</span>
              {(filters.dateFrom || filters.dateTo) && (
                <FilterTag
                  label={`${filters.dateFrom || "start"} → ${filters.dateTo || "now"}`}
                  onRemove={() => { setFilters((prev) => ({ ...prev, dateFrom: "", dateTo: "" })); setPage(1); }}
                />
              )}
              {filters.status && (
                <FilterTag label={statusConf[filters.status]?.label ?? filters.status} onRemove={() => setFilter("status", "")} />
              )}
              <button type="button" onClick={clearFilters} className="text-[11px] text-gray-500 underline hover:text-gray-800">
                Clear all
              </button>
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 align-top">
                    {["#", "Draft", "Order No."].map((h) => (
                      <th key={h} className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 whitespace-nowrap">{h}</th>
                    ))}
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 whitespace-nowrap">
                      Last Edited
                      <div className="flex gap-1">
                        <input
                          type="date"
                          value={filters.dateFrom}
                          onChange={(e) => setFilter("dateFrom", e.target.value)}
                          aria-label="Filter drafts edited from date"
                          className={`w-[124px] ${filterInputCls(!!filters.dateFrom)}`}
                        />
                        <input
                          type="date"
                          value={filters.dateTo}
                          onChange={(e) => setFilter("dateTo", e.target.value)}
                          aria-label="Filter drafts edited up to date"
                          className={`w-[124px] ${filterInputCls(!!filters.dateTo)}`}
                        />
                      </div>
                    </th>
                    {["Products", "Discount", "Total"].map((h) => (
                      <th key={h} className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 whitespace-nowrap">{h}</th>
                    ))}
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 whitespace-nowrap">
                      Status
                      <select
                        value={filters.status}
                        onChange={(e) => setFilter("status", e.target.value)}
                        aria-label="Filter by draft status"
                        className={`w-[124px] ${filterInputCls(!!filters.status)}`}
                      >
                        <option value="">Any</option>
                        {Object.entries(statusConf)
                          .filter(([value]) => {
                            const tabStatuses: readonly string[] = TABS.find((entry) => entry.id === tab)?.statuses ?? [];
                            return tabStatuses.length === 0 || tabStatuses.includes(value);
                          })
                          .map(([value, conf]) => (
                            <option key={value} value={value}>{conf.label}</option>
                          ))}
                      </select>
                    </th>
                    <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading
                    ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                    : pagedDrafts.length === 0
                      ? (
                        <tr><td colSpan={9}>
                          <div className="flex flex-col items-center justify-center py-16 gap-3">
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.2" strokeLinecap="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                            <p className="text-sm text-gray-600">
                              {filtersActive || query || tab !== "all" ? "Nothing here yet" : "No drafts yet"}
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                if (!filtersActive && !query) { router.push("/dashboard/dealer/AddOrderForm"); return; }
                                clearFilters(); setSearch(""); setQuery("");
                              }}
                              className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-50"
                            >
                              {filtersActive || query ? "Clear filters" : "Start an order"}
                            </button>
                          </div>
                        </td></tr>
                      )
                      : pagedDrafts.map((draft, idx) => {
                        const rows = filledRows(draft);
                        const total = draftTotal(draft);
                        const isDeleting = deleteMutation.isPending && deleteMutation.variables?.id === draft.id;
                        const isRenaming = renamingId === draft.id;
                        const orderNumber = draft.refno || provisionals[draft.id] || String(draft.id).slice(0, 8);
                        // Older rejection drafts predate rejection_notes and carry the
                        // reason only inside order_note, so fall back to the badge alone.
                        const rejectionNote = draft.rejection_notes?.reason ? draft.rejection_notes : null;
                        const isOrderRejection = draft.source === "order_rejection";
                        const editLog = draft.edit_log ?? [];

                        return (
                          <tr key={draft.id} className="hover:bg-blue-50/30 transition-colors">
                            <td className="px-4 py-3.5 text-gray-700 font-medium">
                              {String((page - 1) * pageSize + idx + 1).padStart(2, "0")}
                            </td>

                            <td className="px-4 py-3.5">
                              <div className="flex items-center gap-2">
                                {isRenaming ? (
                                  <input
                                    ref={renameRef}
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onBlur={() => commitRename(draft.id)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") commitRename(draft.id);
                                      if (e.key === "Escape") setRenamingId(null);
                                    }}
                                    className="h-8 w-full max-w-[280px] rounded-lg border border-gray-300 px-2.5 text-[13px] font-semibold outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                                  />
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openDraft(draft.id)}
                                      onMouseEnter={() => prefetchDraft(queryClient, user.Dealer_Id, draft.id)}
                                      className="max-w-[280px] truncate text-left text-[13px] font-bold text-gray-900 transition-colors hover:text-indigo-700"
                                    >
                                      {draft.name}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => startRename(draft)}
                                      title="Rename draft"
                                      aria-label="Rename draft"
                                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
                                    >
                                      <Pencil size={12} />
                                    </button>
                                  </>
                                )}
                              </div>
                              {draft.shipto && (
                                <p className="mt-1 max-w-[320px] truncate text-[11px] text-gray-500" title={draft.shipto}>
                                  Ship to: {draft.shipto}
                                </p>
                              )}
                              {rejectionNote && (
                                <div className="mt-2 max-w-[420px] rounded-md border border-red-100 bg-red-50/70 px-3 py-2">
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-red-700">
                                    {isOrderRejection
                                      ? `Order ${draft.source_order_number ?? ""} rejected by ${rejectionNote.rejected_by_name || "reviewer"} (${rejectionNote.rejected_by || "STAFF"})`
                                      : rejectionNote.rejected_by === "RSM" ? "Rejected by RSM" : "Rejected by Admin"}
                                  </p>
                                  <p className="mt-0.5 whitespace-pre-line text-[11px] leading-relaxed text-red-900">
                                    {rejectionNote.reason}
                                  </p>
                                  {/* An Admin rejection can follow an RSM note; show both so the
                                      dealer sees the full review trail before resubmitting. */}
                                  {rejectionNote.rejected_by !== "RSM" && rejectionNote.rsm_note && (
                                    <p className="mt-1.5 whitespace-pre-line border-t border-red-100 pt-1.5 text-[11px] leading-relaxed text-red-800">
                                      <span className="font-semibold">RSM note: </span>
                                      {rejectionNote.rsm_note}
                                    </p>
                                  )}
                                  {editLog.length > 0 && (
                                    <div className="mt-2 border-t border-red-100 pt-1.5">
                                      <p className="text-[10px] font-bold uppercase tracking-wide text-red-700">Edits ({editLog.length})</p>
                                      {editLog.slice(-2).map((entry, i) => (
                                        <p key={i} className="mt-0.5 text-[11px] leading-relaxed text-red-800">
                                          {moment(entry.at).format("DD MMM, hh:mm A")} · {entry.changes.length ? entry.changes.join("; ") : "resubmitted unchanged"}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>

                            <td className="px-4 py-3.5">
                              {/* A rejected order already has a number - show that one, linked to
                                  the order it came from, instead of a provisional next number. */}
                              {isOrderRejection && draft.source_order_id ? (
                                <button
                                  type="button"
                                  onClick={() => router.push(`/orders/${draft.source_order_id}`)}
                                  className="font-mono text-[13px] font-bold text-rose-700 underline underline-offset-2 hover:text-rose-900"
                                  title="Open the rejected order"
                                >
                                  {draft.source_order_number || orderNumber}
                                </button>
                              ) : (
                                <span className="font-mono text-[13px] font-bold text-indigo-700">{orderNumber}</span>
                              )}
                            </td>

                            <td className="px-4 py-3.5">
                              <p className="text-[13px] text-gray-900 font-medium">{moment(draft.updated_at).format("DD MMM YYYY")}</p>
                              <p className="text-[11px] text-gray-600 font-mono mt-0.5">{moment(draft.updated_at).fromNow()}</p>
                            </td>

                            <td className="px-4 py-3.5">
                              <span className="px-2 py-0.5 bg-gray-100 text-gray-800 rounded-lg text-[12px] font-mono font-semibold">
                                {rows.length} item{rows.length === 1 ? "" : "s"}
                              </span>
                            </td>

                            <td className="px-4 py-3.5 font-mono text-[13px] text-amber-700">
                              {draft.coupon_pct ? `${draft.coupon_pct}%` : "—"}
                              {draft.coupon_code && (
                                <p className="mt-1 text-[11px] font-semibold text-indigo-600">{draft.coupon_code}</p>
                              )}
                            </td>

                            <td className="px-4 py-3.5 font-mono text-[14px] font-bold text-emerald-700">
                              {formatMoney(total)}
                            </td>

                            <td className="px-4 py-3.5">
                              <DraftStatusBadge status={draftStatus(draft)} />
                            </td>

                            <td className="px-4 py-3.5 w-px whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openDraft(draft.id)}
                                  onMouseEnter={() => prefetchDraft(queryClient, user.Dealer_Id, draft.id)}
                                  title="Continue draft"
                                  aria-label="Continue draft"
                                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900 text-white shadow-sm transition-colors hover:bg-gray-700"
                                >
                                  <ArrowRight size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(draft.id)}
                                  disabled={isDeleting}
                                  title="Delete draft"
                                  aria-label="Delete draft"
                                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow-sm transition-all hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                  }
                </tbody>
              </table>
            </div>

            {!loading && totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50">
                <div className="flex items-center gap-4 flex-wrap">
                  <p className="text-[13px] text-gray-700 font-medium">
                    Page {page} of {totalPages} · <span className="text-gray-600">{totalCount} drafts</span>
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold text-gray-500">Show</span>
                    {DRAFT_PAGE_SIZE_OPTIONS.map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => { setPageSize(size); setPage(1); }}
                        className={`h-8 min-w-9 px-2.5 rounded-lg border text-[12px] font-semibold transition-all ${pageSize === size ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"}`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all font-medium">‹</button>
                  {pageNums.map((p, i) => p === "…"
                    ? <span key={`d${i}`} className="w-8 h-8 flex items-center justify-center text-gray-500 text-[13px]">…</span>
                    : <button key={p} onClick={() => setPage(p as number)}
                      className={`w-8 h-8 flex items-center justify-center rounded-lg text-[13px] font-semibold border transition-all ${page === p ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 text-gray-700 hover:bg-white"}`}>{p}</button>
                  )}
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-700 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all font-medium">›</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
