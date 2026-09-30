"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Loader2, Package2, Search, UserRound, Users } from "lucide-react";
import { useCatalogueProducts } from "@/hooks/useCatalogueProducts";
import dashboardSearch from "@/lib/dashboardSearch.js";

type DashboardRole = "admin" | "staff" | "dealer";

type DashboardSearchResult = {
  id: string;
  type: "product" | "order" | "dealer" | "staff";
  title: string;
  subtitle?: string;
  metadata?: string;
  image?: string;
  href: string;
  score: number;
  matchType?: string;
  catalogueNumber?: string;
};

type DashboardSearchGroups = {
  products: DashboardSearchResult[];
  orders: DashboardSearchResult[];
  dealers: DashboardSearchResult[];
  staff: DashboardSearchResult[];
};

type DashboardSearchResponse = {
  success: boolean;
  query: string;
  results: DashboardSearchResult[];
  groups: DashboardSearchGroups;
};

type DashboardSmartSearchProps = {
  role: DashboardRole;
  actorId?: string;
  roletype?: string;
  placeholder?: string;
};

type EntitySearchState = {
  cacheKey: string;
  groups: DashboardSearchGroups;
  loading: boolean;
  error: string | null;
};

const EMPTY_GROUPS: DashboardSearchGroups = {
  products: [],
  orders: [],
  dealers: [],
  staff: [],
};

function getGroupLabel(type: keyof DashboardSearchGroups, role: DashboardRole) {
  if (type === "orders") {
    if (role === "staff") return "Assigned Orders";
    if (role === "dealer") return "My Orders";
    return "Orders";
  }

  if (type === "products") return "Products";
  if (type === "dealers") return "Dealers";
  return "Staff";
}

function getResultIcon(type: DashboardSearchResult["type"]) {
  if (type === "order") return ClipboardList;
  if (type === "dealer") return Users;
  if (type === "staff") return UserRound;
  return Package2;
}

function getTypeBadge(type: DashboardSearchResult["type"]) {
  if (type === "order") return "Order";
  if (type === "dealer") return "Dealer";
  if (type === "staff") return "Staff";
  return "Product";
}

export default function DashboardSmartSearch({
  role,
  actorId,
  roletype,
  placeholder = "Search products and orders...",
}: DashboardSmartSearchProps) {
  const router = useRouter();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const requestSeqRef = useRef(0);

  const { products, loading: catalogueLoading, error: catalogueError } = useCatalogueProducts();

  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [entityCache, setEntityCache] = useState<Record<string, DashboardSearchGroups>>({});
  const [entityState, setEntityState] = useState<EntitySearchState>({
    cacheKey: "",
    groups: EMPTY_GROUPS,
    loading: false,
    error: null,
  });

  const queryInfo = useMemo(() => dashboardSearch.getDashboardQueryInfo(query), [query]);
  const canFetchEntities = role === "admin" || Boolean(actorId);
  const cacheKey = useMemo(
    () => [role, actorId || "", roletype || "", queryInfo.rawQuery].join("::"),
    [actorId, queryInfo.rawQuery, role, roletype]
  );

  const cachedGroups = queryInfo.canSearch && canFetchEntities
    ? entityCache[cacheKey] ?? null
    : null;

  const productGroups = useMemo(() => {
    if (!queryInfo.canSearch) return [];
    return dashboardSearch.searchDashboardProducts(products, queryInfo, {
      role,
      limit: dashboardSearch.PRODUCT_GROUP_LIMIT,
    }) as DashboardSearchResult[];
  }, [products, queryInfo, role]);

  const entityGroups = cachedGroups ?? (entityState.cacheKey === cacheKey ? entityState.groups : EMPTY_GROUPS);
  const entityLoading = !cachedGroups && entityState.cacheKey === cacheKey ? entityState.loading : false;
  const entityError = !cachedGroups && entityState.cacheKey === cacheKey ? entityState.error : null;

  const mergedGroups = useMemo<DashboardSearchGroups>(() => ({
    products: productGroups,
    orders: entityGroups.orders,
    dealers: entityGroups.dealers,
    staff: entityGroups.staff,
  }), [entityGroups.dealers, entityGroups.orders, entityGroups.staff, productGroups]);

  const visibleGroups = useMemo(() => {
    const entries: Array<[keyof DashboardSearchGroups, DashboardSearchResult[]]> = [
      ["products", mergedGroups.products],
      ["orders", mergedGroups.orders],
    ];

    if (role === "admin") {
      entries.push(["dealers", mergedGroups.dealers], ["staff", mergedGroups.staff]);
    }

    return entries.filter(([, results]) => results.length > 0);
  }, [mergedGroups.dealers, mergedGroups.orders, mergedGroups.products, mergedGroups.staff, role]);

  const flatResults = useMemo(
    () => visibleGroups.flatMap(([, results]) => results),
    [visibleGroups]
  );

  const resolvedActiveIndex =
    activeIndex >= 0 && activeIndex < flatResults.length ? activeIndex : -1;

  const activeDescendant = resolvedActiveIndex >= 0 && flatResults[resolvedActiveIndex]
    ? `${listboxId}-${flatResults[resolvedActiveIndex].type}-${flatResults[resolvedActiveIndex].id}`
    : undefined;

  const showNoResults =
    queryInfo.canSearch &&
    !entityLoading &&
    !catalogueLoading &&
    flatResults.length === 0 &&
    !entityError &&
    !catalogueError;

  const showError = entityError || (catalogueError ? "Product suggestions are unavailable right now." : null);
  const isOpen =
    focused &&
    queryInfo.canSearch &&
    (entityLoading || catalogueLoading || flatResults.length > 0 || Boolean(showNoResults) || Boolean(showError));

  useEffect(() => {
    if (!queryInfo.canSearch || !canFetchEntities || cachedGroups) {
      return undefined;
    }

    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    const controller = new AbortController();

    const timer = window.setTimeout(() => {
      setEntityState({
        cacheKey,
        groups: EMPTY_GROUPS,
        loading: true,
        error: null,
      });

      fetch(`/api/dashboard-search?q=${encodeURIComponent(queryInfo.rawQuery)}`, {
        cache: "no-store",
        signal: controller.signal,

      })
        .then(async (response) => {
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload?.success) {
            throw new Error(payload?.message || "Dashboard search failed.");
          }
          return payload as DashboardSearchResponse;
        })
        .then((payload) => {
          if (requestSeq !== requestSeqRef.current) return;
          setEntityCache((current) => {
            if (current[cacheKey] === payload.groups) return current;
            return { ...current, [cacheKey]: payload.groups };
          });
          setEntityState({
            cacheKey,
            groups: payload.groups,
            loading: false,
            error: null,
          });
          setActiveIndex(-1);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
          const message = error instanceof Error ? error.message : "Dashboard search failed.";
          setEntityState({
            cacheKey,
            groups: EMPTY_GROUPS,
            loading: false,
            error: message,
          });
          setActiveIndex(-1);
        });
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [actorId, cacheKey, cachedGroups, canFetchEntities, queryInfo, role, roletype]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setFocused(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  const navigateToResult = (result: DashboardSearchResult) => {
    if (!result?.href) return;
    setFocused(false);
    setActiveIndex(-1);
    router.push(result.href);
  };

  const submitSearch = (highlightedResult?: DashboardSearchResult | null) => {
    const href = dashboardSearch.chooseDashboardSearchNavigation({
      query: queryInfo.rawQuery,
      highlightedResult,
      results: flatResults,
    }) as string;

    if (!href) return;
    setFocused(false);
    setActiveIndex(-1);
    router.push(href);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setFocused(false);
      setActiveIndex(-1);
      return;
    }

    if (event.key === "Tab") {
      setFocused(false);
      setActiveIndex(-1);
      return;
    }

    if (!isOpen || flatResults.length === 0) {
      if (event.key === "Enter") {
        event.preventDefault();
        submitSearch(null);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, flatResults.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      submitSearch(resolvedActiveIndex >= 0 ? flatResults[resolvedActiveIndex] : null);
    }
  };

  return (
    <div ref={rootRef} className="relative ml-auto flex w-full max-w-[640px] min-w-0 flex-1">
      <form
        className="flex h-[38px] w-full items-stretch overflow-hidden rounded-[11px] border border-white/10 bg-white/[0.09] shadow-sm backdrop-blur transition focus-within:border-indigo-400/60 focus-within:bg-white/[0.12]"
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch(resolvedActiveIndex >= 0 ? flatResults[resolvedActiveIndex] : null);
        }}
      >
        <div className="flex items-center px-3 text-white/45">
          <Search className="h-4 w-4" />
        </div>
        <input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={activeDescendant}
          placeholder={placeholder}
          value={query}
          onFocus={() => setFocused(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setFocused(true);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent pr-3 text-[13.5px] text-white outline-none placeholder:text-white/35"
        />
        {/* Enter submits via handleKeyDown; the header shows a Ctrl+K hint here. */}
        {entityLoading && <Loader2 className="mr-3 h-4 w-4 self-center animate-spin text-white/70" />}
      </form>

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Dashboard smart search suggestions"
          className="absolute left-0 right-0 top-[calc(100%+10px)] z-[9999] max-h-[min(32rem,70vh)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-900/20"
        >
          {(entityLoading || catalogueLoading) && (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading suggestions...
            </div>
          )}

          {showError && !entityLoading && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
              {showError}
            </div>
          )}

          {!entityLoading && !showError && visibleGroups.map(([type, results]) => (
            <div key={type} className="mb-2 last:mb-0">
              <div className="px-2 pb-2 pt-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                {getGroupLabel(type, role)}
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-100 bg-slate-50/40">
                {results.map((result) => {
                  const globalIndex = flatResults.findIndex((item) =>
                    item.href === result.href &&
                    item.type === result.type &&
                    item.id === result.id
                  );
                  const isActive = globalIndex === resolvedActiveIndex;
                  const ResultIcon = getResultIcon(result.type);

                  return (
                    <button
                      key={`${result.type}:${result.id}:${result.href}`}
                      id={`${listboxId}-${result.type}-${result.id}`}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActiveIndex(globalIndex)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        navigateToResult(result);
                      }}
                      className={`flex w-full items-start gap-3 border-b border-slate-100 px-3 py-3 text-left last:border-b-0 ${
                        isActive ? "bg-white" : "bg-transparent hover:bg-white"
                      }`}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-slate-500">
                        {result.image ? (
                          <img src={result.image} alt={result.title} className="h-full w-full object-contain" />
                        ) : (
                          <ResultIcon className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-900">{result.title}</span>
                          <span className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
                            {getTypeBadge(result.type)}
                          </span>
                        </div>
                        {result.subtitle && (
                          <div className="mt-1 truncate text-xs font-medium text-indigo-700">{result.subtitle}</div>
                        )}
                        {result.metadata && (
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{result.metadata}</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {showNoResults && (
            <div className="px-3 py-4 text-sm text-slate-600">
              {dashboardSearch.getNoResultsMessage(role) as string}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
