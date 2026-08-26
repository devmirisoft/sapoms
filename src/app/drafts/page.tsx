"use client";

/**
 * app/drafts/page.tsx
 * Shows all saved order drafts for the logged-in dealer.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast, ToastContainer } from "react-toastify";
import moment from "moment";
import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { type DraftProductRow, type OrderDraft } from "@/lib/drafts";
import {
  prefetchDraft,
  useDeleteDraft,
  useDrafts,
  useRenameDraft,
} from "@/lib/useDrafts";

const EMPTY_DRAFTS: OrderDraft[] = [];

type DealerUser = {
  Dealer_Id: string;
  Dealer_Name?: string;
};

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

function fmt(paise: number): string {
  return `Rs. ${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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

function DraftSkeleton() {
  return (
    <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
      {[1, 2, 3, 4].map((item) => (
        <div key={item} className="flex animate-pulse items-center gap-4 px-4 py-4">
          <div className="h-4 w-44 rounded bg-gray-100" />
          <div className="h-3 flex-1 rounded bg-gray-100" />
          <div className="h-4 w-24 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

function DraftStatCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub: string;
  tone: "blue" | "amber" | "red";
}) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-600 ring-blue-100",
    amber: "bg-amber-50 text-amber-600 ring-amber-100",
    red: "bg-red-50 text-red-600 ring-red-100",
  }[tone];

  return (
    <div className="flex min-h-[92px] items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-4 shadow-sm">
      <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md ring-1 ${toneClass}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-gray-500">{label}</p>
        <p className="mt-1 text-xl font-bold leading-none text-gray-950">{value}</p>
        <p className="mt-2 text-[12px] text-gray-500">{sub}</p>
      </div>
    </div>
  );
}

export default function DraftsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<DealerUser | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [query, setQuery] = useState("");
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

  const { data: draftData, isLoading: loading } = useDrafts(user?.Dealer_Id);
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
    const filtered = q
      ? drafts.filter((draft) => draftSearchText(draft, provisionals[draft.id]).includes(q))
      : drafts;

    return [...filtered].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [drafts, provisionals, query]);

  const draftStats = useMemo(() => {
    const pending = drafts.filter((draft) => draft.approval_state?.status === "pending").length;
    const rejected = drafts.filter((draft) =>
      draft.source === "custom_discount_rejection" || draft.approval_state?.status === "rejected"
    ).length;

    return {
      total: drafts.length,
      pending,
      rejected,
    };
  }, [drafts]);

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

  if (!user) return null;

  return (
    <>
      <ToastContainer position="top-right" autoClose={4000} />

      <main className="min-h-screen bg-gray-50 text-gray-950" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>
        <div className="mx-auto flex w-full max-w-[1840px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => router.back()}
                className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-500 transition hover:text-gray-900"
              >
                <ArrowLeft size={14} />
                Back
              </button>
              <h1 className="text-xl font-semibold tracking-tight">Drafts</h1>
              <p className="mt-1 text-sm text-gray-500">
                {drafts.length} saved order{drafts.length !== 1 ? "s" : ""}{user.Dealer_Name ? ` for ${user.Dealer_Name}` : ""}
              </p>
            </div>

            <button
              type="button"
              onClick={() => router.push("/dashboard/dealer/AddOrderForm")}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-gray-950 px-3.5 text-[13px] font-semibold text-white transition hover:bg-gray-800"
            >
              <Plus size={15} />
              New Order
            </button>
          </header>

          <section className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search drafts"
              className="h-10 w-full rounded-md border border-gray-200 bg-white pl-9 pr-3 text-[13px] text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-400"
            />
          </section>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-start">
            <div className="order-2 lg:order-1">
              {loading && <DraftSkeleton />}

              {!loading && drafts.length === 0 && (
            <section className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-14 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-gray-50 text-gray-400">
                <FileText size={20} />
              </div>
              <p className="mt-4 text-sm font-semibold text-gray-900">No drafts yet</p>
              <button
                type="button"
                onClick={() => router.push("/dashboard/dealer/AddOrderForm")}
                className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-gray-950 px-3.5 text-[13px] font-semibold text-white transition hover:bg-gray-800"
              >
                Start Order
              </button>
            </section>
          )}

              {!loading && drafts.length > 0 && visibleDrafts.length === 0 && (
            <section className="rounded-lg border border-gray-200 bg-white px-6 py-12 text-center">
              <p className="text-sm font-semibold text-gray-900">No matching drafts</p>
              <button
                type="button"
                onClick={() => setQuery("")}
                className="mt-3 text-[13px] font-semibold text-gray-500 transition hover:text-gray-900"
              >
                Clear search
              </button>
            </section>
          )}

              {!loading && visibleDrafts.length > 0 && (
                <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                  <div className="divide-y divide-gray-100">
                    {visibleDrafts.map((draft) => {
                  const rows = filledRows(draft);
                  const total = draftTotal(draft);
                  const isDeleting = deleteMutation.isPending && deleteMutation.variables?.id === draft.id;
                  const isRenaming = renamingId === draft.id;
                  const orderNumber = draft.refno || provisionals[draft.id] || String(draft.id).slice(0, 8);
                  const isDiscountRejectionDraft = draft.source === "custom_discount_rejection";
                  // Older rejection drafts predate rejection_notes and carry the
                  // reason only inside order_note, so fall back to the badge alone.
                  const rejectionNote = draft.rejection_notes?.reason ? draft.rejection_notes : null;

                  return (
                    <article key={draft.id} className="group px-4 py-4 transition hover:bg-gray-50/70">
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            {isRenaming ? (
                              <input
                                ref={renameRef}
                                value={renameValue}
                                onChange={(event) => setRenameValue(event.target.value)}
                                onBlur={() => commitRename(draft.id)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") commitRename(draft.id);
                                  if (event.key === "Escape") setRenamingId(null);
                                }}
                                className="h-8 w-full max-w-sm rounded-md border border-gray-300 px-2.5 text-sm font-semibold outline-none focus:border-gray-500"
                              />
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openDraft(draft.id)}
                                  onMouseEnter={() => prefetchDraft(queryClient, user.Dealer_Id, draft.id)}
                                  className="truncate text-left text-sm font-semibold text-gray-950 transition hover:text-indigo-700"
                                >
                                  {draft.name}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => startRename(draft)}
                                  title="Rename draft"
                                  aria-label="Rename draft"
                                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition hover:bg-white hover:text-gray-900 sm:opacity-0 sm:group-hover:opacity-100"
                                >
                                  <Pencil size={13} />
                                </button>
                              </>
                            )}

                            {isDiscountRejectionDraft && (
                              <span className="flex-shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                                rejected
                              </span>
                            )}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-500">
                            <span>{moment(draft.updated_at).fromNow()}</span>
                            <span>{rows.length} product{rows.length !== 1 ? "s" : ""}</span>
                            <span className="font-mono">{orderNumber}</span>
                            {draft.shipto && <span className="max-w-full truncate sm:max-w-[260px]">{draft.shipto}</span>}
                            {draft.coupon_code && (
                              <span className="font-mono text-violet-600">
                                {draft.coupon_code} / {draft.coupon_pct}%
                              </span>
                            )}
                          </div>

                          {rejectionNote && (
                            <div className="mt-2 rounded-md border border-red-100 bg-red-50/70 px-3 py-2">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700">
                                {rejectionNote.rejected_by === "RSM" ? "Rejected by RSM" : "Rejected by Admin"}
                              </p>
                              <p className="mt-0.5 whitespace-pre-line text-[12px] leading-relaxed text-red-900">
                                {rejectionNote.reason}
                              </p>
                              {/* An Admin rejection can follow an RSM note; show both so the
                                  dealer sees the full review trail before resubmitting. */}
                              {rejectionNote.rejected_by !== "RSM" && rejectionNote.rsm_note && (
                                <p className="mt-1.5 whitespace-pre-line border-t border-red-100 pt-1.5 text-[12px] leading-relaxed text-red-800">
                                  <span className="font-semibold">RSM note: </span>
                                  {rejectionNote.rsm_note}
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-3 sm:justify-end">
                          <p className="font-mono text-sm font-semibold text-gray-950">
                            {total > 0 ? fmt(total) : "Rs. 0.00"}
                          </p>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openDraft(draft.id)}
                              onMouseEnter={() => prefetchDraft(queryClient, user.Dealer_Id, draft.id)}
                              title="Continue draft"
                              aria-label="Continue draft"
                              className="flex h-8 w-8 items-center justify-center rounded-md bg-gray-950 text-white transition hover:bg-gray-800"
                            >
                              <ArrowRight size={14} />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDelete(draft.id)}
                              disabled={isDeleting}
                              title="Delete draft"
                              aria-label="Delete draft"
                              className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                    })}
                  </div>
                </section>
              )}
            </div>

            <aside className="order-1 grid gap-3 sm:grid-cols-3 lg:order-2 lg:grid-cols-1">
              <DraftStatCard
                icon={<FileText size={19} />}
                label="Total Drafts"
                value={draftStats.total}
                sub="All saved drafts"
                tone="blue"
              />
              <DraftStatCard
                icon={<Clock3 size={19} />}
                label="Pending Drafts"
                value={draftStats.pending}
                sub="Waiting for action"
                tone="amber"
              />
              <DraftStatCard
                icon={<XCircle size={19} />}
                label="Rejected Drafts"
                value={draftStats.rejected}
                sub="Needs review"
                tone="red"
              />
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}
