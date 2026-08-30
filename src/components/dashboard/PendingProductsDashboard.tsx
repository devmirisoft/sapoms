"use client";

import { formatDisplayOrderNumber } from '@/lib/orderDisplay';

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import PendingProductsReportModal from "./PendingProductsReportModal";
import { SegmentedTabs } from "@/components/SegmentedTabs";

type Role = "admin" | "staff" | "dealer";

type ClubBy = "product" | "dealer" | "category";

type ViewMode = "list" | "club";

const CLUB_OPTIONS: Record<ClubBy, { label: string; plural: string }> = {
  product: { label: "Product", plural: "products" },
  dealer: { label: "Dealer", plural: "dealers" },
  category: { label: "Category", plural: "categories" },
};

type DashboardActor = {
  role: Role;
  id: string;
  name: string;
  roletype?: string;
};

type PendingProductRow = {
  productKey: string;
  catalogueNumber: string;
  normalizedCatalogueNumber: string;
  productName: string;
  specification: string;
  category: string;
  image: string;
  productUnit: string;
  orderedQuantity: number;
  dispatchedQuantity: number;
  pendingQuantity: number;
  fulfillmentPercent: number;
  pendingOrders: number;
  dealersAffected: number;
  oldestPendingDate: string;
  oldestPendingDateMs: number | null;
};

type PendingProductSummary = {
  productsPending: number;
  totalPendingUnits: number;
  ordersWithPendingItems: number;
  dealersAffected: number;
};

type PendingFilters = {
  categories: string[];
  dealers: Array<{ id: string; name: string }>;
  staff: Array<{ id: string; name: string }>;
};

type PendingProductOrderRow = {
  orderId: string;
  orderDate: string;
  orderDateMs: number | null;
  dealerId: string;
  dealerName: string;
  assignedStaffIds: string[];
  assignedStaffNames: string[];
  orderedQuantity: number;
  dispatchedQuantity: number;
  pendingQuantity: number;
  fulfillmentPercent: number;
  packSummary: string;
  productUnit: string;
  dispatchStatus: string;
  acceptOrder: string;
  delStatus: string;
  orderStatus: string;
  mtstatus: string;
  reason: string;
  latestDispatchUpdateAt: string;
  latestDispatchUpdateMs: number | null;
  lineCount: number;
};

type PendingProductsListPayload = {
  items: PendingProductRow[];
  summary: PendingProductSummary;
  filters: PendingFilters;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  warnings: string[];
  limitation?: string;
};

type PendingProductsDetailPayload = {
  product: PendingProductRow;
  orders: PendingProductOrderRow[];
  summary: PendingProductSummary;
  filters: PendingFilters;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  warnings: string[];
  limitation?: string;
};

type ApiResponse<T> = {
  success: boolean;
  data: T;
  message?: string;
};

const pendingProductsQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

function resolveDashboardActor(expectedRole: Role): DashboardActor | null {
  if (typeof window === "undefined") return null;

  try {
    if (expectedRole === "dealer") {
      const userRaw = localStorage.getItem("UserData");
      if (userRaw) {
        const parsed = JSON.parse(userRaw);
        if (parsed?.Dealer_Id) {
          return {
            role: "dealer",
            id: String(parsed.Dealer_Id),
            name: parsed.Dealer_Name || "Dealer",
          };
        }
      }
      return null;
    }

    const staffRaw = localStorage.getItem("staffData");
    if (staffRaw) {
      const parsed = JSON.parse(staffRaw);
      if (parsed?.staff_id) {
        return {
          role: parsed.staff_roletype === "0" ? "admin" : "staff",
          id: String(parsed.staff_id),
          name: parsed.staff_name || "Staff",
          roletype: String(parsed.staff_roletype ?? ""),
        };
      }
    }

    const userRaw = localStorage.getItem("UserData");
    if (userRaw) {
      const parsed = JSON.parse(userRaw);
      if (parsed?.staff_id) {
        return {
          role: parsed.staff_roletype === "0" ? "admin" : "staff",
          id: String(parsed.staff_id),
          name: parsed.staff_name || "Staff",
          roletype: String(parsed.staff_roletype ?? ""),
        };
      }

      if (localStorage.getItem("roletype") === "3" && parsed && Object.keys(parsed).length > 0) {
        return {
          role: "admin",
          id: String(parsed.id || parsed.admin_id || parsed.Admin_Id || "admin"),
          name: parsed.name || parsed.email || "Admin",
          roletype: "0",
        };
      }
    }

    const adminRaw = localStorage.getItem("AdminData") || localStorage.getItem("admin");
    if (adminRaw) {
      const parsed = JSON.parse(adminRaw);
      if (parsed && Object.keys(parsed).length > 0) {
        return {
          role: "admin",
          id: String(parsed.id || parsed.admin_id || parsed.Admin_Id || "admin"),
          name: parsed.name || "Admin",
          roletype: "0",
        };
      }
    }
  } catch {}

  return null;
}

function buildActorHeaders(actor: DashboardActor | null): HeadersInit {
  return {};
}

async function fetchPendingProducts<T>(
  params: URLSearchParams,
  actor: DashboardActor | null,
  errorMessage: string
): Promise<ApiResponse<T>> {
  const response = await fetch(`/api/pending-products?${params.toString()}`, {
    headers: buildActorHeaders(actor),
  });
  const json = await response.json();
  if (!response.ok || !json?.success) {
    throw new Error(json?.message || errorMessage);
  }
  return json as ApiResponse<T>;
}

function formatNumber(value: number) {
  return value.toLocaleString("en-IN");
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatAge(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const now = Date.now();
  const dayDiff = Math.max(0, Math.floor((now - date.getTime()) / (1000 * 60 * 60 * 24)));
  return dayDiff === 0 ? "Today" : `${dayDiff}d`;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function subtitleForRole(role: Role) {
  if (role === "admin") return "Pending delivery quantities across all dealers.";
  if (role === "staff") return "Pending delivery quantities for your assigned dealers.";
  return "Products still pending from your orders.";
}

function ProductMetric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className={`mt-1.5 text-[21px] font-bold tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}

type ClubScope = {
  actor: DashboardActor | null;
  role: Role;
  actorScopeKey: string;
  clubBy: ClubBy;
  dealerId: string;
  assignedStaffId: string;
  refreshToken: number;
};

// The contributing orders for one clubbed row. Reuses the existing productKey
// drill-down endpoint, so there is no second grouping implementation.
function ClubOrderBreakdown({ scope, productKey }: { scope: ClubScope; productKey: string }) {
  const query = useQuery<ApiResponse<PendingProductsDetailPayload>>({
    queryKey: [
      "pending-products-club-orders",
      scope.role,
      scope.actorScopeKey,
      productKey,
      scope.clubBy,
      scope.dealerId,
      scope.assignedStaffId,
      scope.refreshToken,
    ],
    enabled: !!scope.actor,
    queryFn: async () => {
      const params = new URLSearchParams({ productKey, page: "1", pageSize: "200", clubBy: scope.clubBy });
      if (scope.dealerId) params.set("dealerId", scope.dealerId);
      if (scope.assignedStaffId) params.set("assignedStaffId", scope.assignedStaffId);
      if (scope.refreshToken > 0) params.set("refreshToken", String(scope.refreshToken));
      return fetchPendingProducts<PendingProductsDetailPayload>(params, scope.actor, "Failed to load contributing orders.");
    },
  });

  const payload = query.data?.data;

  if (query.isLoading && !payload) {
    return <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />;
  }

  if (query.isError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-700">
        {(query.error as Error)?.message || "Failed to load contributing orders."}
      </div>
    );
  }

  if (!payload) return null;

  return (
    <div className="space-y-2">
      {payload.orders.map((order) => (
        <div
          key={order.orderId}
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3"
        >
          <div className="min-w-0">
            <Link
              href={`/orders/${encodeURIComponent(order.orderId)}`}
              className="font-mono text-[13px] font-bold text-indigo-700 hover:underline"
            >
              {formatDisplayOrderNumber(order.orderId)}
            </Link>
            <p className="mt-1 text-[12px] text-slate-500">
              {formatDate(order.orderDate)}
              {scope.role !== "dealer" && order.dealerName ? ` · ${order.dealerName}` : ""}
              {order.packSummary ? ` · ${order.packSummary}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-4 text-right">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Dispatched</p>
              <p className="font-mono text-[13px] font-semibold text-emerald-700">{formatNumber(order.dispatchedQuantity)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Pending</p>
              <p className="font-mono text-[14px] font-bold text-rose-600">
                {formatNumber(order.pendingQuantity)} {order.productUnit || ""}
              </p>
            </div>
          </div>
        </div>
      ))}
      {payload.total > payload.orders.length && (
        <p className="px-1 text-[11px] text-slate-400">
          Showing {payload.orders.length} of {formatNumber(payload.total)} contributing orders.
        </p>
      )}
    </div>
  );
}

function PendingProductsDashboardInner({ role }: { role: Role }) {
  const [actor, setActor] = useState<DashboardActor | null>(() => resolveDashboardActor(role));
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [dealerId, setDealerId] = useState("");
  const [assignedStaffId, setAssignedStaffId] = useState("");
  const [sort, setSort] = useState<"pending_desc" | "oldest_pending" | "alphabetical">("pending_desc");
  const [clubBy, setClubBy] = useState<ClubBy>("product");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [expandedKey, setExpandedKey] = useState("");
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [detailProductKey, setDetailProductKey] = useState("");
  const [detailPage, setDetailPage] = useState(1);
  const [reportOpen, setReportOpen] = useState(false);
  const queryClient = useQueryClient();
  const actorScopeKey = `${actor?.role ?? ""}:${actor?.id ?? ""}`;

  useEffect(() => {
    const refreshActor = () => setActor(resolveDashboardActor(role));
    window.addEventListener("storage", refreshActor);
    window.addEventListener("omsons-auth-changed", refreshActor);
    return () => {
      window.removeEventListener("storage", refreshActor);
      window.removeEventListener("omsons-auth-changed", refreshActor);
    };
  }, [role]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchInput]);
  useEffect(() => {
    const handleDispatchUpdated = () => {
      setRefreshToken((current) => current + 1);
      void queryClient.invalidateQueries({ queryKey: ["pending-products"] });
      void queryClient.invalidateQueries({ queryKey: ["pending-products-detail"] });
    };

    window.addEventListener("orderDispatchUpdated", handleDispatchUpdated as EventListener);
    return () => {
      window.removeEventListener("orderDispatchUpdated", handleDispatchUpdated as EventListener);
    };
  }, [queryClient]);

  const listQuery = useQuery<ApiResponse<PendingProductsListPayload>>({
    queryKey: [
      "pending-products",
      role,
      actorScopeKey,
      search,
      category,
      dealerId,
      assignedStaffId,
      sort,
      clubBy,
      page,
      refreshToken,
    ],
    enabled: !!actor && actor.role === role,
    placeholderData: role === "dealer" ? undefined : keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "12",
        sort,
        clubBy,
      });
      if (search) params.set("search", search);
      if (category) params.set("category", category);
      if (dealerId) params.set("dealerId", dealerId);
      if (assignedStaffId) params.set("assignedStaffId", assignedStaffId);
      if (refreshToken > 0) params.set("refreshToken", String(refreshToken));

      return fetchPendingProducts<PendingProductsListPayload>(params, actor, "Failed to load pending products.");
    },
  });

  const detailQuery = useQuery<ApiResponse<PendingProductsDetailPayload>>({
    queryKey: [
      "pending-products-detail",
      role,
      actorScopeKey,
      detailProductKey,
      clubBy,
      dealerId,
      assignedStaffId,
      detailPage,
      refreshToken,
    ],
    enabled: !!actor && actor.role === role && !!detailProductKey,
    placeholderData: role === "dealer" ? undefined : keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams({
        productKey: detailProductKey,
        page: String(detailPage),
        pageSize: "8",
        clubBy,
      });
      if (dealerId) params.set("dealerId", dealerId);
      if (assignedStaffId) params.set("assignedStaffId", assignedStaffId);
      if (refreshToken > 0) params.set("refreshToken", String(refreshToken));

      return fetchPendingProducts<PendingProductsDetailPayload>(params, actor, "Failed to load pending product details.");
    },
  });

  const listPayload = listQuery.data?.data;
  const detailPayload = detailQuery.data?.data;
  const warnings = listPayload?.warnings ?? [];
  const summary = listPayload?.summary;

  const columns = useMemo(
    () =>
      [
        CLUB_OPTIONS[clubBy].label,
        clubBy === "product" ? "Catalogue" : null,
        clubBy === "product" ? "Category" : null,
        "Ordered",
        "Dispatched",
        "Pending",
        "Progress",
        "Orders",
        role !== "dealer" && clubBy !== "dealer" ? "Dealers" : null,
        "Oldest",
        "Action",
      ].filter((label): label is string => !!label),
    [clubBy, role]
  );

  const clubScope = useMemo<ClubScope>(
    () => ({ actor, role, actorScopeKey, clubBy, dealerId, assignedStaffId, refreshToken }),
    [actor, role, actorScopeKey, clubBy, dealerId, assignedStaffId, refreshToken]
  );

  const summaryCards = useMemo(() => {
    if (!summary) return [];
    const cards = [
      { label: "Products Pending", value: formatNumber(summary.productsPending), accent: "text-slate-900" },
      { label: "Total Pending Units", value: formatNumber(summary.totalPendingUnits), accent: "text-rose-600" },
      { label: "Orders With Pending Items", value: formatNumber(summary.ordersWithPendingItems), accent: "text-indigo-700" },
    ];

    if (role !== "dealer") {
      cards.push({ label: "Dealers Affected", value: formatNumber(summary.dealersAffected), accent: "text-emerald-700" });
    }

    return cards;
  }, [role, summary]);

  if (!actor) {
    return (
      <div className="px-6 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-sm text-slate-500 shadow-sm">
          Loading pending products...
        </div>
      </div>
    );
  }

  if (actor.role !== role) {
    return (
      <div className="px-6 py-10">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-10 text-sm text-amber-800 shadow-sm">
          This pending-products view is not available for your current signed-in role.
        </div>
      </div>
    );
  }

  return (
    <>
      <PendingProductsReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        enabled={!!actor && actor.role === role}
        scope={{ search, category, dealerId, assignedStaffId, sort }}
      />
      <div className="mx-auto max-w-[1840px] px-6 py-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-slate-900">Pending Products</h1>
            <p className="mt-1 text-[13px] text-slate-500">{subtitleForRole(role)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedTabs
              label="Pending products view"
              value={viewMode}
              onChange={(next) => {
                setViewMode(next as ViewMode);
                setExpandedKey("");
              }}
              items={[
                {
                  value: "list",
                  label: "List View",
                  icon: (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" />
                    </svg>
                  ),
                },
                {
                  value: "club",
                  label: "Club View",
                  icon: (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                  ),
                },
              ]}
            />
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download Report
            </button>
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-[13px] text-amber-800 shadow-sm">
            {warnings[0]}
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <ProductMetric key={card.label} label={card.label} value={card.value} accent={card.accent} />
          ))}
        </div>

        <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.5fr)_repeat(5,minmax(0,1fr))]">
            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                Search Products
              </label>
              <input
                type="text"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Name, catalogue no., specification, category..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] text-slate-900 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                Category
              </label>
              <select
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value);
                  setPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="">All categories</option>
                {(listPayload?.filters.categories ?? []).map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                Sort
              </label>
              <select
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as typeof sort);
                  setPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="pending_desc">Highest pending</option>
                <option value="oldest_pending">Oldest pending</option>
                <option value="alphabetical">Alphabetical</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                Club By
              </label>
              <select
                value={clubBy}
                onChange={(event) => {
                  setClubBy(event.target.value as ClubBy);
                  setPage(1);
                  setDetailProductKey("");
                  setDetailPage(1);
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="product">Product (default)</option>
                {role !== "dealer" && <option value="dealer">Dealer</option>}
                <option value="category">Category</option>
              </select>
            </div>

            {role !== "dealer" && (
              <div>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                  Dealer
                </label>
                <select
                  value={dealerId}
                  onChange={(event) => {
                    setDealerId(event.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="">All dealers</option>
                  {(listPayload?.filters.dealers ?? []).map((dealer) => (
                    <option key={dealer.id} value={dealer.id}>
                      {dealer.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {role === "admin" && (
              <div>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                  Assigned Staff
                </label>
                <select
                  value={assignedStaffId}
                  onChange={(event) => {
                    setAssignedStaffId(event.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="">All staff</option>
                  {(listPayload?.filters.staff ?? []).map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {listQuery.isError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-[13px] text-rose-700 shadow-sm">
            {(listQuery.error as Error)?.message || "Failed to load pending products."}
          </div>
        )}

        {!listQuery.isError && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-bold text-slate-900">Product Queue</h2>
                  <p className="mt-1 text-[12px] text-slate-500">
                    {listPayload ? `${formatNumber(listPayload.total)} matching ${CLUB_OPTIONS[clubBy].plural}` : "Loading pending products..."}
                  </p>
                </div>
              </div>
            </div>

            {listQuery.isLoading && !listPayload ? (
              <div className="space-y-3 px-5 py-5">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
                ))}
              </div>
            ) : listPayload && listPayload.items.length === 0 ? (
              <div className="px-5 py-16 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                    <rect x="9" y="3" width="6" height="4" rx="1" />
                  </svg>
                </div>
                <p className="text-[15px] font-semibold text-slate-900">No products are currently pending delivery.</p>
              </div>
            ) : (
              <>
                {viewMode === "club" ? (
                  <div className="divide-y divide-slate-100">
                    {listPayload?.items.map((item) => {
                      const expanded = expandedKey === item.productKey;
                      const identity =
                        clubBy === "product"
                          ? [item.catalogueNumber, item.specification, item.category].filter(Boolean).join(" · ") ||
                            "No catalogue"
                          : CLUB_OPTIONS[clubBy].label;

                      return (
                        <div key={item.productKey} className="px-5 py-4">
                          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                            <button
                              type="button"
                              onClick={() => setExpandedKey(expanded ? "" : item.productKey)}
                              aria-expanded={expanded}
                              className="flex min-w-[220px] flex-1 items-center gap-3 text-left"
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={`flex-shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`}
                              >
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                              <span className="min-w-0">
                                <span className="block truncate text-[14px] font-semibold text-slate-900">
                                  {item.productName}
                                </span>
                                <span className="mt-0.5 block truncate text-[12px] text-slate-500">{identity}</span>
                              </span>
                            </button>

                            <div className="text-right">
                              <p className="font-mono text-[22px] font-bold leading-none tabular-nums text-rose-600">
                                {formatNumber(item.pendingQuantity)}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-500">{item.productUnit || "Units"} pending</p>
                            </div>

                            <div className="w-20 text-right">
                              <p className="font-mono text-[14px] font-semibold tabular-nums text-indigo-700">
                                {formatNumber(item.pendingOrders)}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {item.pendingOrders === 1 ? "order" : "orders"}
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600">
                                {formatNumber(item.dispatchedQuantity)} / {formatNumber(item.orderedQuantity)} ·{" "}
                                {clampPercent(item.fulfillmentPercent)}%
                              </span>
                              <span className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700">
                                Oldest {formatAge(item.oldestPendingDate)}
                              </span>
                              {role !== "dealer" && clubBy !== "dealer" && (
                                <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
                                  {formatNumber(item.dealersAffected)} dealers
                                </span>
                              )}
                            </div>
                          </div>

                          {expanded && (
                            <div className="mt-3 rounded-2xl bg-slate-50 p-3">
                              <ClubOrderBreakdown scope={clubScope} productKey={item.productKey} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <>
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        {columns.map((label) => (
                          <th key={label} className="px-5 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {listPayload?.items.map((item) => (
                        <tr key={item.productKey} className="border-t border-slate-100 align-top">
                          <td className="px-5 py-4">
                            <div className="flex items-start gap-3">
                              <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                                {item.image ? (
                                  <Image
                                    src={item.image}
                                    alt={item.productName}
                                    width={48}
                                    height={48}
                                    unoptimized
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-slate-300">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                    </svg>
                                  </div>
                                )}
                              </div>
                              <div>
                                <p className="text-[14px] font-semibold text-slate-900">{item.productName}</p>
                                <p className="mt-1 text-[12px] text-slate-500">{item.specification || (clubBy === "product" ? "No specification" : CLUB_OPTIONS[clubBy].label)}</p>
                              </div>
                            </div>
                          </td>
                          {clubBy === "product" && (
                            <>
                              <td className="px-5 py-4 font-mono text-[12px] font-semibold text-amber-700">
                                {item.catalogueNumber || "—"}
                              </td>
                              <td className="px-5 py-4 text-[12px] text-slate-600">{item.category || "—"}</td>
                            </>
                          )}
                          <td className="px-5 py-4 font-mono text-[13px] font-semibold text-slate-900">{formatNumber(item.orderedQuantity)}</td>
                          <td className="px-5 py-4 font-mono text-[13px] font-semibold text-emerald-700">{formatNumber(item.dispatchedQuantity)}</td>
                          <td className="px-5 py-4 font-mono text-[13px] font-bold text-rose-600">{formatNumber(item.pendingQuantity)}</td>
                          <td className="px-5 py-4">
                            <div className="min-w-[130px]">
                              <div className="mb-2 flex items-center justify-between text-[11px] text-slate-500">
                                <span>{clampPercent(item.fulfillmentPercent)}%</span>
                                <span>{formatNumber(item.dispatchedQuantity)} / {formatNumber(item.orderedQuantity)}</span>
                              </div>
                              <div className="h-2 rounded-full bg-slate-100">
                                <div
                                  className="h-2 rounded-full bg-indigo-500"
                                  style={{ width: `${clampPercent(item.fulfillmentPercent)}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4 text-[12px] font-semibold text-slate-700">{formatNumber(item.pendingOrders)}</td>
                          {role !== "dealer" && clubBy !== "dealer" && (
                            <td className="px-5 py-4 text-[12px] font-semibold text-slate-700">{formatNumber(item.dealersAffected)}</td>
                          )}
                          <td className="px-5 py-4">
                            <p className="text-[12px] font-medium text-slate-700">{formatDate(item.oldestPendingDate)}</p>
                            <p className="mt-1 text-[11px] text-slate-400">{formatAge(item.oldestPendingDate)}</p>
                          </td>
                          <td className="px-5 py-4">
                            <button
                              type="button"
                              onClick={() => {
                                setDetailProductKey(item.productKey);
                                setDetailPage(1);
                              }}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                            >
                              View Orders
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-3 p-4 lg:hidden">
                  {listPayload?.items.map((item) => (
                    <div key={item.productKey} className="rounded-2xl border border-slate-200 p-4">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[15px] font-semibold text-slate-900">{item.productName}</p>
                          <p className="mt-1 text-[12px] text-slate-500">{clubBy === "product" ? `${item.catalogueNumber || "No catalogue"} · ${item.category || "Uncategorized"}` : CLUB_OPTIONS[clubBy].label}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[22px] font-bold text-rose-600">{formatNumber(item.pendingQuantity)}</p>
                          <p className="text-[11px] text-slate-500">pending</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-3 rounded-2xl bg-slate-50 px-3 py-3 text-center">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Ordered</p>
                          <p className="mt-1 font-mono text-[13px] font-semibold text-slate-900">{formatNumber(item.orderedQuantity)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Dispatched</p>
                          <p className="mt-1 font-mono text-[13px] font-semibold text-emerald-700">{formatNumber(item.dispatchedQuantity)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Orders</p>
                          <p className="mt-1 font-mono text-[13px] font-semibold text-slate-900">{formatNumber(item.pendingOrders)}</p>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <p className="text-[12px] text-slate-500">Oldest: {formatDate(item.oldestPendingDate)} · {formatAge(item.oldestPendingDate)}</p>
                        <button
                          type="button"
                          onClick={() => {
                            setDetailProductKey(item.productKey);
                            setDetailPage(1);
                          }}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700"
                        >
                          View Orders
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                  </>
                )}

                {listPayload && listPayload.totalPages > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
                    <p className="text-[12px] text-slate-500">
                      Page {listPayload.page} of {listPayload.totalPages}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPage((current) => Math.max(1, current - 1))}
                        disabled={listPayload.page === 1}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700 disabled:opacity-40"
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        onClick={() => setPage((current) => Math.min(listPayload.totalPages, current + 1))}
                        disabled={listPayload.page === listPayload.totalPages}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700 disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {detailProductKey && (
        <div className="fixed inset-0 z-[70] flex items-center justify-end bg-black/30 p-0 sm:p-4">
          <div className="h-full w-full max-w-4xl overflow-hidden bg-white shadow-2xl sm:h-[92vh] sm:rounded-xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Contributing Orders</p>
                <h2 className="mt-1 text-[20px] font-bold text-slate-900">
                  {detailPayload?.product.productName || "Pending product"}
                </h2>
                {clubBy === "product" && detailPayload?.product && (
                  <p className="mt-1 text-[13px] text-slate-500">
                    {detailPayload.product.catalogueNumber || "No catalogue"} · {detailPayload.product.category || "Uncategorized"}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDetailProductKey("")}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="h-[calc(100%-88px)] overflow-y-auto px-6 py-5">
              {detailQuery.isLoading && !detailPayload ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
                  ))}
                </div>
              ) : detailQuery.isError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-[13px] text-rose-700">
                  {(detailQuery.error as Error)?.message || "Failed to load the product drill-down."}
                </div>
              ) : detailPayload ? (
                <>
                  <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <ProductMetric label="Ordered" value={formatNumber(detailPayload.product.orderedQuantity)} accent="text-slate-900" />
                    <ProductMetric label="Dispatched" value={formatNumber(detailPayload.product.dispatchedQuantity)} accent="text-emerald-700" />
                    <ProductMetric label="Pending" value={formatNumber(detailPayload.product.pendingQuantity)} accent="text-rose-600" />
                    <ProductMetric label="Orders" value={formatNumber(detailPayload.product.pendingOrders)} accent="text-indigo-700" />
                  </div>

                  <div className="space-y-3">
                    {detailPayload.orders.map((order) => (
                      <div key={order.orderId} className="rounded-2xl border border-slate-200 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-[13px] font-bold text-indigo-700">{formatDisplayOrderNumber(order.orderId)}</p>
                            {role !== "dealer" && (
                              <p className="mt-1 text-[13px] font-medium text-slate-800">{order.dealerName || order.dealerId}</p>
                            )}
                            {role === "admin" && order.assignedStaffNames.length > 0 && (
                              <p className="mt-1 text-[12px] text-slate-500">
                                Staff: {order.assignedStaffNames.join(", ")}
                              </p>
                            )}
                          </div>
                          <Link
                            href={`/orders/${encodeURIComponent(order.orderId)}`}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                          >
                            View Order
                          </Link>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                          <div className="rounded-2xl bg-slate-50 px-3 py-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Order Date</p>
                            <p className="mt-1 text-[13px] font-semibold text-slate-900">{formatDate(order.orderDate)}</p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Ordered</p>
                            <p className="mt-1 font-mono text-[13px] font-semibold text-slate-900">{formatNumber(order.orderedQuantity)}</p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Dispatched</p>
                            <p className="mt-1 font-mono text-[13px] font-semibold text-emerald-700">{formatNumber(order.dispatchedQuantity)}</p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Pending</p>
                            <p className="mt-1 font-mono text-[13px] font-bold text-rose-600">{formatNumber(order.pendingQuantity)}</p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Pack Context</p>
                            <p className="mt-1 text-[13px] font-semibold text-slate-900">{order.packSummary || "—"}</p>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-3 py-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Latest Update</p>
                            <p className="mt-1 text-[13px] font-semibold text-slate-900">{formatDate(order.latestDispatchUpdateAt)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {detailPayload.totalPages > 1 && (
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-[12px] text-slate-500">
                        Page {detailPayload.page} of {detailPayload.totalPages}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setDetailPage((current) => Math.max(1, current - 1))}
                          disabled={detailPayload.page === 1}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700 disabled:opacity-40"
                        >
                          Prev
                        </button>
                        <button
                          type="button"
                          onClick={() => setDetailPage((current) => Math.min(detailPayload.totalPages, current + 1))}
                          disabled={detailPayload.page === detailPayload.totalPages}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700 disabled:opacity-40"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function PendingProductsDashboard({ role }: { role: Role }) {
  return (
    <QueryClientProvider client={pendingProductsQueryClient}>
      <PendingProductsDashboardInner role={role} />
    </QueryClientProvider>
  );
}
