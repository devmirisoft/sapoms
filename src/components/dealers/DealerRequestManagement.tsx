"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { readDashboardActor, type DashboardActor } from "@/lib/dealerRequestClient";
import { buildDealerRequestHeaders, type DealerRequestStatus, type PublicDealerRequest } from "@/lib/dealerRequests";
import { SegmentedTabs } from "@/components/SegmentedTabs";

type DealerRequestManagementProps = {
  scope: "admin" | "staff";
};

type DealerRequestListResponse = {
  success: boolean;
  data?: PublicDealerRequest[];
  total?: number;
  page?: number;
  lastPage?: number;
  message?: string;
};

const PAGE_SIZE = 10;

function badgeStyles(status: DealerRequestStatus) {
  if (status === "accepted") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "rejected") return "bg-red-50 text-red-700 border-red-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
}

function badgeLabel(status: DealerRequestStatus) {
  if (status === "accepted") return "Accepted";
  if (status === "rejected") return "Rejected";
  return "Pending Approval";
}

function tabLabel(status: DealerRequestStatus) {
  if (status === "accepted") return "Accepted Dealers";
  if (status === "rejected") return "Rejected Dealers";
  return "Pending Approval";
}

function requestActionHref(scope: "admin" | "staff", request: PublicDealerRequest) {
  if (scope === "admin" && request.status === "pending") {
    return `/dashboard/admin/dealer/AddDealerForm?requestId=${encodeURIComponent(request.id)}`;
  }

  if (scope === "staff" && request.status === "rejected") {
    return `/dashboard/admin/dealer/AddDealerForm?requestId=${encodeURIComponent(request.id)}`;
  }

  return "";
}

function dealerViewHref(scope: "admin" | "staff", dealerId: string) {
  return scope === "admin"
    ? `/dashboard/admin/dealer/${encodeURIComponent(dealerId)}/view`
    : `/dashboard/staff/dealer/${encodeURIComponent(dealerId)}`;
}

export default function DealerRequestManagement({ scope }: DealerRequestManagementProps) {
  const router = useRouter();

  const [actor] = useState<DashboardActor | null>(() => readDashboardActor());
  const [tab, setTab] = useState<DealerRequestStatus>("pending");
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<PublicDealerRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [lastPage, setLastPage] = useState(1);

  useEffect(() => {
    if (!actor) {
      router.replace("/auth/login");
    }
  }, [actor, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchInput);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!actor || actor.role !== scope) return;

    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setLoading(true);
      setError("");

      const params = new URLSearchParams({
        status: tab,
        page: String(page),
        limit: String(PAGE_SIZE),
      });

      if (search.trim()) {
        params.set("search", search.trim());
      }

      fetch(`/api/dealer-requests?${params.toString()}`, {
        headers: buildDealerRequestHeaders(actor),
        cache: "no-store",
      })
        .then(async (response) => {
          const json = await response.json() as DealerRequestListResponse;
          if (!response.ok || !json.success) {
            throw new Error(json.message ?? "Failed to load dealer requests");
          }
          return json;
        })
        .then((payload) => {
          if (!active) return;
          setRows(payload.data ?? []);
          setTotal(payload.total ?? 0);
          setLastPage(payload.lastPage ?? 1);
        })
        .catch((fetchError) => {
          if (!active) return;
          setRows([]);
          setTotal(0);
          setLastPage(1);
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load dealer requests");
        })
        .finally(() => {
          if (active) {
            setLoading(false);
          }
        });
    });

    return () => {
      active = false;
    };
  }, [actor, page, scope, search, tab]);

  const title = scope === "admin" ? "Dealer Requests" : "My Dealer Requests";
  const subtitle = scope === "admin"
    ? "Review staff-submitted dealer requests and track accepted or rejected outcomes."
    : "Track the dealer requests you submitted and correct any rejected requests.";
  const accessDenied = !!actor && actor.role !== scope;
  const isTableLoading = loading && !accessDenied;

  const startIndex = total > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
  const endIndex = total > 0 ? Math.min(page * PAGE_SIZE, total) : 0;

  const topActions = useMemo(() => (
    scope === "admin"
      ? [
          { label: "Dealer List", href: "/dashboard/admin/dealer/DealerList" },
          { label: "Add Dealer", href: "/dashboard/admin/dealer/AddDealerForm" },
        ]
      : [
          { label: "Dealer List", href: "/dashboard/staff/dealerlist" },
          { label: "Add Dealer", href: "/dashboard/admin/dealer/AddDealerForm" },
        ]
  ), [scope]);

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-[1840px]">
        <div className="mb-8">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
              <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {topActions.map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  {action.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <SegmentedTabs
              label="Dealer request status"
              value={tab}
              onChange={(next) => {
                setTab(next as DealerRequestStatus);
                setPage(1);
              }}
              items={(["pending", "accepted", "rejected"] as DealerRequestStatus[]).map((status) => ({
                value: status,
                label: tabLabel(status),
                tone: status === "accepted" ? "emerald" : status === "rejected" ? "rose" : "amber",
              }))}
            />

            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search requests..."
                className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm text-gray-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>
        </div>

        {accessDenied ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            You do not have access to this page.
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Request Ref</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Dealer</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">City</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Contact</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Assigned Staff</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    {scope === "admin" ? "Submitted By" : "Reviewed By"}
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    {tab === "accepted" ? "Accepted Date" : tab === "rejected" ? "Rejected Date" : "Submitted Date"}
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">Status</th>
                  <th className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isTableLoading ? (
                  Array.from({ length: PAGE_SIZE }).map((_, index) => (
                    <tr key={index}>
                      {Array.from({ length: 9 }).map((__, columnIndex) => (
                        <td key={columnIndex} className="px-4 py-4">
                          <div className="h-4 animate-pulse rounded bg-gray-200" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-14 text-center text-sm text-gray-500">
                      {search ? "No dealer requests match your search." : `No ${tabLabel(tab).toLowerCase()} requests found.`}
                    </td>
                  </tr>
                ) : (
                  rows.map((request) => {
                    const actionHref = requestActionHref(scope, request);
                    const showViewDealer = request.status === "accepted" && request.createdDealerId;
                    const actionLabel = scope === "admin" ? "Review" : "Correct";
                    const dateLabel = tab === "accepted"
                      ? request.acceptedAt
                      : tab === "rejected"
                        ? request.rejectedAt
                        : request.submittedAt;

                    return (
                      <tr key={request.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4">
                          <div className="font-mono text-xs font-semibold text-indigo-700">{request.requestReference}</div>
                          <div className="mt-1 text-xs text-gray-400">{request.dealerCode || "-"}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="font-medium text-gray-900">{request.dealerName || "-"}</div>
                          {tab === "rejected" && request.rejectionReason ? (
                            <div className="mt-1 max-w-xs text-xs text-red-600">{request.rejectionReason}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-4 text-gray-600">{request.city || "-"}</td>
                        <td className="px-4 py-4 text-xs text-gray-600">
                          <div>{request.contactEmail || "-"}</div>
                          <div className="mt-1">{request.contactPhone || "-"}</div>
                        </td>
                        <td className="px-4 py-4 text-xs text-gray-600">{request.assignedStaffNames || "-"}</td>
                        <td className="px-4 py-4 text-xs text-gray-600">
                          {scope === "admin" ? request.submittedByName || "-" : request.reviewedByName || "-"}
                        </td>
                        <td className="px-4 py-4 text-xs text-gray-500">
                          {dateLabel ? new Date(dateLabel).toLocaleString("en-IN") : "-"}
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${badgeStyles(request.status)}`}>
                            {badgeLabel(request.status)}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex justify-end gap-2">
                            {actionHref ? (
                              <Link
                                href={actionHref}
                                className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-indigo-700"
                              >
                                {actionLabel}
                              </Link>
                            ) : null}
                            {showViewDealer ? (
                              <Link
                                href={dealerViewHref(scope, request.createdDealerId)}
                                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                              >
                                View Dealer
                              </Link>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-6 py-4">
            <span className="text-xs text-gray-400">
              {total > 0 ? `Showing ${startIndex}-${endIndex} of ${total}` : "No results"}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page === 1}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Prev
              </button>
              <span className="text-xs text-gray-500">
                Page {page} of {Math.max(1, lastPage)}
              </span>
              <button
                type="button"
                onClick={() => setPage((value) => Math.min(Math.max(1, lastPage), value + 1))}
                disabled={page >= Math.max(1, lastPage)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
