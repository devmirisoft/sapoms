"use client";

import { formatDisplayOrderNumber } from '@/lib/orderDisplay';
import Link from "next/link";
import { LayoutDashboard, UserRoundPlus, Users, SquareUser, Plus, ClipboardList, Search } from 'lucide-react';

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  QueryClient,
  QueryClientProvider,
  keepPreviousData,
  useQuery,
  useQueries,
} from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import { fetchDealerStatusOverrides, normalizeDealerStatus, type DealerStatusDocument } from "@/lib/dealerStatus";
import PendingProductsPreview from "@/components/dashboard/PendingProductsPreview";
import { clearAuthStorage } from "@/lib/roleAccess";


const year = new Date().getFullYear();

type Item = {
  order_id: string;
  total: string;
};

type Dealer = {
  Dealer_Name: string;
  total: string;
};

type SalesRegionKey = "NORTH_1" | "NORTH_2" | "SOUTH_1" | "SOUTH_2" | "WEST_1" | "WEST_2" | "EAST" | "ROM" | "CENTRAL";

type SalesGranularity = "day" | "month" | "quarter" | "half" | "year";

type RegionalSalesPoint = { period: string } & Record<SalesRegionKey, number>;

type RegionalPerformanceEntry = { month: string; period?: string } & Record<SalesRegionKey, string>;

type RegionalDistributor = {
  dealerId?: string;
  dealerName: string;
  total: string;
};

type AdminDashboardApiResponse = {
  success: boolean;
  data?: {
    summary?: {
      dealerCount?: number;
      orderCount?: number;
    };
    monthlyPerformance?: Array<{
      month: string;
      total: string;
    }>;
    topDealers?: Array<{
      dealerId?: string;
      dealerName: string;
      total: string;
    }>;
    regionalGranularity?: SalesGranularity;
    regionalPerformance?: RegionalPerformanceEntry[];
    topDistributorsByRegion?: Partial<Record<SalesRegionKey, Array<{
      dealerId?: string;
      dealerName: string;
      total: string;
    }>>>;
    warnings?: string[];
  };
  message?: string;
};

type AdminStats = {
  dealerCount: number;
  staffCount: number;
  orderCount: number;
  PorderCount: number;
};

type AdminUser = {
  username?: string;
  email?: string;
  role?: string;
  name?: string;
};

type DealerSummary = {
  Dealer_Id: string;
  Dealer_Name: string;
  Dealer_City: string;
  Dealer_Number?: string;
  Dealer_Dealercode?: string;
  status: string;
  assignedstaff?: string;
  staffname?: string;
  currentlimit: string;
};

type DealerPaginationResponse = {
  data: DealerSummary[];
  total?: number;
  last_page?: number;
  lastPage?: number;
};

type StaffSummary = {
  staff_roletype: string;
};

type LedgerSummary = {
  Dealer_Id: string;
  Dealer_Name: string;
  netBalance: number;
  walletBalance: number;
};

type DiscountApproval = {
  status: string;
};

type PendingOrderRecord = {
  order_id: string;
  Dealer_Name?: string;
  order_date?: string;
  orderDate?: string;
  order_amount?: string | number;
  total?: string | number;
  outstandingDate?: string;
  order_status?: string;
  accept_order?: string;
};

const SALES_REGIONS: SalesRegionKey[] = ["NORTH_1", "NORTH_2", "SOUTH_1", "SOUTH_2", "WEST_1", "WEST_2", "EAST", "ROM", "CENTRAL"];
const REGION_META: Record<SalesRegionKey, { label: string; color: string; soft: string }> = {
  NORTH_1: { label: "North 1", color: "#4f8fcb", soft: "#dbeafe" },
  NORTH_2: { label: "North 2", color: "#2563eb", soft: "#dbeafe" },
  SOUTH_1: { label: "South 1", color: "#f2cf5b", soft: "#fef3c7" },
  SOUTH_2: { label: "South 2", color: "#d97706", soft: "#fef3c7" },
  WEST_1: { label: "West 1", color: "#c084fc", soft: "#f3e8ff" },
  WEST_2: { label: "West 2", color: "#7c3aed", soft: "#f3e8ff" },
  EAST: { label: "East", color: "#6fd08c", soft: "#dcfce7" },
  ROM: { label: "ROM", color: "#0f766e", soft: "#ccfbf1" },
  CENTRAL: { label: "Central", color: "#f97316", soft: "#ffedd5" },
};

function formatRegionLabel(region: SalesRegionKey) {
  return REGION_META[region].label;
}

const DEFAULT_GRANULARITY: SalesGranularity = "month";

const GRANULARITY_OPTIONS: Array<{ value: SalesGranularity; label: string; sub: string }> = [
  { value: "day", label: "Day", sub: "Daily net sales by regional sales manager zone" },
  { value: "month", label: "Month", sub: "Monthly net sales by regional sales manager zone" },
  { value: "quarter", label: "Quarter", sub: "Quarterly net sales by regional sales manager zone" },
  { value: "half", label: "Half Year", sub: "Half-yearly net sales by regional sales manager zone" },
  { value: "year", label: "Year", sub: "Yearly net sales by regional sales manager zone" },
];

function formatMonthLabel(month: string) {
  const date = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
}

/** Renders a period key produced by the dashboard API for the given granularity. */
function formatPeriodLabel(period: string, granularity: SalesGranularity) {
  switch (granularity) {
    case "day": {
      const date = new Date(`${period}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) return period;
      return date.toLocaleString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
    }
    case "quarter":
    case "half": {
      const [year, part] = period.split("-");
      return part ? `${part} ${year.slice(2)}` : period;
    }
    case "year":
      return period;
    case "month":
    default:
      return formatMonthLabel(period);
  }
}

function mapRegionalPerformance(entries: RegionalPerformanceEntry[] | undefined): RegionalSalesPoint[] {
  return (entries ?? []).map((entry) => ({
    period: entry.period ?? entry.month,
    ...Object.fromEntries(SALES_REGIONS.map((region) => [region, Number((entry as Record<string, unknown>)[region] ?? 0)])),
  }) as RegionalSalesPoint);
}

function createEmptyRegionalDistributorMap(): Record<SalesRegionKey, RegionalDistributor[]> {
  return SALES_REGIONS.reduce((acc, region) => {
    acc[region] = [];
    return acc;
  }, {} as Record<SalesRegionKey, RegionalDistributor[]>);
}

const logoImage = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSpEaVwAg53quyQVTj-mv49IsltHY8yDluFOPemDksHkQ&s=10";


const NAV_ITEMS = [
  {
    label: "Dealer List",
    href: "/dashboard/admin/dealer/DealerList",
    icon: <LayoutDashboard />
  },
  {
    label: "Add Dealer",
    href: "/dashboard/admin/dealer/AddDealerForm",
    icon: <UserRoundPlus />
  },
  {
    label: "Staff List",
    href: "/dashboard/admin/staff/stafflist",
    icon: <Users />
  },
  {
    label: "Add Staff",
    href: "/dashboard/admin/staff/addstaff",
    icon: <SquareUser />
  },
  {
    label: "Products  ",
    href: "/Pages/products",
    icon: <SquareUser />
  },
  {
    label: "Add products",
    href: "/Pages/products/addproducts",
    icon: <SquareUser />
  },
  { label: "Order List",
     href: "/orders",
     icon: <ClipboardList size={15} />
  },
  { label: "Dealer Category Report",
     href: "/dashboard/admin/reports/dealer-category",
    icon: <ClipboardList size={15} />
  },
  { label: "Pending Orders",
     href: "/Pages/Ordermanagement/outstandingorders",
    icon: <ClipboardList size={15} />
  },
];

const STAT_CONFIG = [
  { key: "PorderCount", label: "Pending Orders", color: "#f59e0b" },
  { key: "dealerCount", label: "Total Distributors", color: "#10b981" },
  { key: "orderCount", label: "Total Orders", color: "#3b82f6" },
  { key: "staffCount", label: "Total Staff", color: "#8b5cf6" },
];

const dashboardQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: 2,
    },
  },
});

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  return parseJsonResponse<T>(res);
}

async function fetchAllDistributors(): Promise<DealerPaginationResponse> {
  const data: DealerSummary[] = [];
  const seenDealerIds = new Set<string>();
  let reportedTotal = 0;
  let reportedLastPage = 0;

  for (let page = 1; page <= 500; page += 1) {
    const response = await fetchJson<DealerPaginationResponse>(
      `/api/admin/dealers?page=${page}&limit=100&search=`,
    );
    const rows = Array.isArray(response.data) ? response.data : [];
    let newRows = 0;

    for (const dealer of rows) {
      const dealerId = String(dealer.Dealer_Id ?? "").trim();
      if (!dealerId || seenDealerIds.has(dealerId)) continue;
      seenDealerIds.add(dealerId);
      data.push(dealer);
      newRows += 1;
    }

    reportedTotal = Math.max(reportedTotal, Number(response.total) || 0);
    reportedLastPage = Math.max(
      reportedLastPage,
      Number(response.last_page ?? response.lastPage) || 0,
    );

    if (
      rows.length === 0 ||
      newRows === 0 ||
      (reportedTotal > 0 && data.length >= reportedTotal) ||
      (reportedLastPage > 0 && page >= reportedLastPage)
    ) {
      break;
    }
  }

  return {
    data,
    total: Math.max(reportedTotal, data.length),
    last_page: reportedLastPage || undefined,
  };
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (/^\s*</.test(text)) throw new Error("Expected JSON but received HTML");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Invalid JSON response");
  }
}

export default function AdminDashboard() {
  return (
    <QueryClientProvider client={dashboardQueryClient}>
      <AdminDashboardInner />
    </QueryClientProvider>
  );
}

function AdminDashboardInner() {
  const router = useRouter();
  const pathname = usePathname();

  const [data, setData] = useState<Item[]>([]);
  const [dealerData, setDealerData] = useState<Dealer[]>([]);
  const [regionalSalesData, setRegionalSalesData] = useState<RegionalSalesPoint[]>([]);
  const [regionalTopDistributors, setRegionalTopDistributors] = useState<Record<SalesRegionKey, RegionalDistributor[]>>(createEmptyRegionalDistributorMap);
  const [selectedRegion, setSelectedRegion] = useState<SalesRegionKey>("NORTH_1");
  const [regionalGranularity, setRegionalGranularity] = useState<SalesGranularity>(DEFAULT_GRANULARITY);
  const [regionalSalesLoading, setRegionalSalesLoading] = useState(false);
  const [adminData, setAdminData] = useState<AdminStats>({
    dealerCount: 0,
    staffCount: 0,
    orderCount: 0,
    PorderCount: 0,
  });
  const [adminUser, setAdminUser] = useState<AdminUser>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [distributorPage, setDistributorPage] = useState(1);
  const [distributorSearchInput, setDistributorSearchInput] = useState("");
  const [distributorSearch, setDistributorSearch] = useState("");

  // Load admin user from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const adminRaw = localStorage.getItem("AdminData") || localStorage.getItem("admin") || "{}";
      const adminParsed: AdminUser = JSON.parse(adminRaw);
      setAdminUser(adminParsed);
    } catch (err) {
      console.error("Error loading admin data from localStorage:", err);
    }
  }, []);

  // Fetch dashboard data
  useEffect(() => {
    async function fetchData() {
      try {
        const [activeOrdersRes, activePendingRes, dashboardRes] = await Promise.all([
          fetch(`/api/admin/orders?page=1&limit=100&search=`, { credentials: "include" }),
          fetch(`/api/admin/orders?page=1&limit=1&status=AWAITING_ACCEPTANCE`, { credentials: "include" }),
          fetch(`/api/admin/dashboard?granularity=${DEFAULT_GRANULARITY}`, { credentials: "include" }),
        ]);

        if (dashboardRes.status === 401) {
          clearAuthStorage(localStorage);
          window.dispatchEvent(new Event("omsons-auth-changed"));
          router.push("/auth/login");
          return;
        }

        if (dashboardRes.status === 403) {
          throw new Error("Forbidden");
        }

        const activeOrdersJson = await parseJsonResponse<any>(activeOrdersRes);
        const activePendingJson = await parseJsonResponse<any>(activePendingRes);
        const dashboardJson = await parseJsonResponse<AdminDashboardApiResponse>(dashboardRes);

        const activeOrders = (activeOrdersJson.data || []) as Array<Record<string, unknown>>;
        setData(activeOrders
          .map((order) => ({ order_id: String(order.orderNumber || order.id || ""), total: String(order.finalPayableAmountPaise ?? 0) }))
          .sort((left, right) => Number(right.total) - Number(left.total))
          .slice(0, 10));
        setDealerData((dashboardJson.data?.topDealers ?? []).map((dealer) => ({
          Dealer_Name: dealer.dealerName,
          total: dealer.total,
        }) as Dealer));
        setRegionalSalesData(mapRegionalPerformance(dashboardJson.data?.regionalPerformance));
        const distributorsByRegion = createEmptyRegionalDistributorMap();
        for (const region of SALES_REGIONS) {
          distributorsByRegion[region] = (dashboardJson.data?.topDistributorsByRegion?.[region] ?? []).map((dealer) => ({
            dealerId: dealer.dealerId,
            dealerName: dealer.dealerName,
            total: dealer.total,
          }));
        }
        setRegionalTopDistributors(distributorsByRegion);

        setAdminData({
          dealerCount: Number(dashboardJson.data?.summary?.dealerCount ?? 0),
          staffCount: 0,
          orderCount: Number(dashboardJson.data?.summary?.orderCount ?? activeOrdersJson.total ?? activeOrders.length),
          PorderCount: Number(activePendingJson.total ?? 0),
        });
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [router]);

  // Re-fetch only the regional series when the granularity filter changes.
  // Skipped on first render because the initial load already covers the default granularity.
  const initialGranularityLoad = useRef(true);
  useEffect(() => {
    if (initialGranularityLoad.current) {
      initialGranularityLoad.current = false;
      return;
    }

    const controller = new AbortController();
    setRegionalSalesLoading(true);

    (async () => {
      try {
        const res = await fetch(`/api/admin/dashboard?granularity=${regionalGranularity}`, {
          credentials: "include",
          signal: controller.signal,
        });
        const json = await parseJsonResponse<AdminDashboardApiResponse>(res);
        setRegionalSalesData(mapRegionalPerformance(json.data?.regionalPerformance));
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
        console.error("Error fetching regional sales:", error);
      } finally {
        if (!controller.signal.aborted) setRegionalSalesLoading(false);
      }
    })();

    return () => controller.abort();
  }, [regionalGranularity]);

  const [
    outstandingOrdersQ,
    discountApprovalsQ,
    ledgerQ,
    dealersQ,
    staffQ,
  ] = useQueries({
    queries: [
      {
        queryKey: ["adminSidebarSummary", "outstandingOrders"],
        queryFn: async () => {
          const result = await fetchJson<{ data: PendingOrderRecord[]; total?: number }>(`/api/admin/orders?page=1&limit=100&status=AWAITING_ACCEPTANCE`);
          return result;
        },
      },
      {
        queryKey: ["adminSidebarSummary", "discountApprovals"],
        queryFn: () => fetchJson<{ data: DiscountApproval[] }>("/api/custom-discount-requests?limit=200"),
      },
      {
        queryKey: ["adminSidebarSummary", "ledger"],
        queryFn: () => fetchJson<{ data: LedgerSummary[] }>("/api/ledger"),
      },
      {
        queryKey: ["adminSidebarSummary", "dealers"],
        queryFn: fetchAllDistributors,
      },
      {
        queryKey: ["adminSidebarSummary", "staff"],
        queryFn: () => fetchJson<{ data: StaffSummary[]; count?: number }>(`/api/admin/staff?page=1&limit=100&search=`),
      },
    ],
  });

  const { data: statusOverrides } = useQuery<DealerStatusDocument[]>({
    queryKey: ["adminSidebarSummary", "dealerStatuses"],
    queryFn: fetchDealerStatusOverrides,
    staleTime: 5 * 60 * 1000,
  });

  const summaryLoading = [outstandingOrdersQ, discountApprovalsQ, ledgerQ, dealersQ, staffQ].some(q => q.isLoading);
  const summaryError = [outstandingOrdersQ, discountApprovalsQ, ledgerQ, dealersQ, staffQ].find(q => q.isError);
  const retrySummary = () => {
    outstandingOrdersQ.refetch();
    discountApprovalsQ.refetch();
    ledgerQ.refetch();
    dealersQ.refetch();
    staffQ.refetch();
  };

  const {
    data: distributorResponse,
    isLoading: distributorsLoading,
    isError: distributorsError,
  } = useQuery<DealerPaginationResponse>({
    queryKey: ["adminDashboardDistributors", distributorPage, distributorSearch],
    queryFn: () => fetchJson<DealerPaginationResponse>(`/api/admin/dealers?page=${distributorPage}&limit=10&search=${encodeURIComponent(distributorSearch)}`),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDistributorPage(1);
      setDistributorSearch(distributorSearchInput);
    }, 400);
    return () => clearTimeout(timer);
  }, [distributorSearchInput]);

  const outstandingOrders = (outstandingOrdersQ.data?.data ?? []).filter((o) => o.order_status === "0" || o.accept_order === "0");
  const totalPendingOrders = outstandingOrdersQ.data?.total ?? outstandingOrders.length;
  const pendingApprovals = (discountApprovalsQ.data?.data ?? []).filter(r => r.status === "pending").length;
  const statusMap = useMemo(() => new Map(
    (statusOverrides ?? []).map((row) => [String(row.dealerId), normalizeDealerStatus(row.status)])
  ), [statusOverrides]);
  const dealerRows = useMemo(() => (dealersQ.data?.data ?? []).map((dealer) => ({
    ...dealer,
    status: statusMap.get(String(dealer.Dealer_Id)) ?? normalizeDealerStatus(dealer.status),
  })), [dealersQ.data?.data, statusMap]);
  const activeDealers = dealerRows.filter(d => normalizeDealerStatus(d.status) === "active").length;
  const inactiveDealers = dealerRows.filter(d => normalizeDealerStatus(d.status) !== "active").length;
  const staffRows = staffQ.data?.data ?? [];
  const roleCounts = staffRows.reduce((acc, s) => {
    acc[s.staff_roletype || "unknown"] = (acc[s.staff_roletype || "unknown"] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const ledgerRows = ledgerQ.data?.data ?? [];
  const outstandingExposure = dealerRows.reduce((sum, row) => sum + Math.max(0, Number(row.currentlimit) || 0), 0);
  const highExposureDealers = [...dealerRows]
    .sort((a, b) => (Number(b.currentlimit) || 0) - (Number(a.currentlimit) || 0))
    .slice(0, 5);
  const totalDistributors = adminData.dealerCount || dealersQ.data?.total || dealerRows.length;
  const distributorRows = useMemo(() => (distributorResponse?.data ?? []).map((dealer) => ({
    ...dealer,
    status: statusMap.get(String(dealer.Dealer_Id)) ?? normalizeDealerStatus(dealer.status),
  })), [distributorResponse?.data, statusMap]);
  const distributorTotal = distributorResponse?.total ?? ((distributorPage - 1) * 10 + distributorRows.length);
  const distributorTotalPages = distributorResponse?.last_page ?? Math.max(1, Math.ceil(distributorTotal / 10));
  const distributorStartIndex = distributorRows.length > 0 ? (distributorPage - 1) * 10 + 1 : 0;
  const distributorEndIndex = distributorRows.length > 0 ? (distributorPage - 1) * 10 + distributorRows.length : 0;
  const regionalLineData = useMemo(() => regionalSalesData.map((point) => ({
    ...point,
    label: formatPeriodLabel(point.period, regionalGranularity),
  })), [regionalSalesData, regionalGranularity]);
  const regionalGranularitySub = GRANULARITY_OPTIONS.find((option) => option.value === regionalGranularity)?.sub
    ?? GRANULARITY_OPTIONS[1].sub;
  const selectedRegionalDistributors = regionalTopDistributors[selectedRegion] ?? [];
  const hasRegionalSales = regionalSalesData.some((point) => SALES_REGIONS.some((region) => point[region] > 0));

  const distributorPageNumbers = (): (number | "...")[] => {
    const pages: (number | "...")[] = [];
    if (distributorTotalPages <= 7) {
      for (let i = 1; i <= distributorTotalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (distributorPage > 3) pages.push("...");
      for (let i = Math.max(2, distributorPage - 1); i <= Math.min(distributorTotalPages - 1, distributorPage + 1); i++) pages.push(i);
      if (distributorPage < distributorTotalPages - 2) pages.push("...");
      pages.push(distributorTotalPages);
    }
    return pages;
  };

  const handleDistributorPageChange = (newPage: number) => {
    if (newPage < 1 || newPage > distributorTotalPages) return;
    setDistributorPage(newPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const chartData = data.map((item) => ({
    name: `${item.order_id}`,
    value: Number(item.total),
  }));

  const dealerChartData = dealerData.map((dealer) => ({
    name: dealer.Dealer_Name.substring(0, 12),
    value: Number(dealer.total),
  }));

  const handleLogout = () => {
    clearAuthStorage(localStorage);
    window.dispatchEvent(new Event("omsons-auth-changed"));
    router.push("/auth/login");
  };

  const initials = (adminUser.name || adminUser.username || "Admin")
    .split(" ")
    .map((n: string) => n.charAt(0))
    .join("")
    .toUpperCase()
    .substring(0, 2) || "AD";


  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        button, input { font: inherit; }

        :root {
          --apple-bg: #f5f5f7;
          --apple-surface: rgba(255, 255, 255, 0.88);
          --apple-surface-solid: #ffffff;
          --apple-text: #1d1d1f;
          --apple-secondary: #6e6e73;
          --apple-tertiary: #8e8e93;
          --apple-blue: #007aff;
          --apple-green: #34c759;
          --apple-orange: #ff9500;
          --apple-red: #ff3b30;
          --apple-purple: #af52de;
          --apple-line: rgba(60, 60, 67, 0.11);
          --apple-shadow: 0 1px 2px rgba(0,0,0,.02), 0 10px 34px rgba(0,0,0,.045);
        }

        .root {
          min-height: 100vh;
          background:
            radial-gradient(circle at 12% -10%, rgba(0, 122, 255, .055), transparent 28%),
            var(--apple-bg);
          color: var(--apple-text);
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
          -webkit-font-smoothing: antialiased;
          text-rendering: optimizeLegibility;
        }

        .dashboard-shell {
          width: min(100%, 1840px);
          margin: 0 auto;
          padding: 38px 34px 48px;
        }

        .dashboard-header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 24px;
          margin-bottom: 30px;
        }

        .eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--apple-blue);
          font-size: 12px;
          line-height: 1;
          font-weight: 650;
          margin-bottom: 10px;
        }

        .eyebrow-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: var(--apple-blue);
          box-shadow: 0 0 0 4px rgba(0, 122, 255, .09);
        }

        .page-title {
          margin: 0;
          font-size: clamp(32px, 4vw, 46px);
          line-height: 1.02;
          letter-spacing: -.045em;
          font-weight: 720;
          color: var(--apple-text);
        }

        .page-subtitle {
          max-width: 620px;
          margin: 10px 0 0;
          color: var(--apple-secondary);
          font-size: 15px;
          line-height: 1.45;
          letter-spacing: -.01em;
        }

        .profile-chip {
          display: flex;
          align-items: center;
          gap: 11px;
          flex-shrink: 0;
          padding: 7px 9px 7px 7px;
          border: 1px solid rgba(60, 60, 67, .09);
          background: rgba(255,255,255,.72);
          box-shadow: 0 4px 18px rgba(0,0,0,.035);
          backdrop-filter: saturate(180%) blur(18px);
          border-radius: 999px;
        }

        .profile-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          background: linear-gradient(145deg, #1d1d1f, #52525a);
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: -.02em;
        }

        .profile-copy { min-width: 0; padding-right: 5px; }
        .profile-name {
          max-width: 180px;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          color: var(--apple-text);
          font-size: 12px;
          font-weight: 650;
        }
        .profile-role {
          color: var(--apple-tertiary);
          font-size: 10.5px;
          margin-top: 1px;
        }

        .section-label {
          margin: 0 0 12px 2px;
          color: var(--apple-secondary);
          font-size: 12px;
          font-weight: 650;
          letter-spacing: .01em;
        }

        .summary-error {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
          padding: 12px 14px;
          border: 1px solid rgba(255, 59, 48, .16);
          background: rgba(255,255,255,.8);
          border-radius: 16px;
          color: #b42318;
          font-size: 13px;
        }

        .retry-button {
          margin-left: auto;
          border: 0;
          background: transparent;
          color: var(--apple-blue);
          cursor: pointer;
          font-weight: 650;
          padding: 4px 7px;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(12, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 30px;
        }

        .metric-card,
        .panel {
          background: var(--apple-surface);
          border: 1px solid rgba(60, 60, 67, .075);
          box-shadow: var(--apple-shadow);
          backdrop-filter: saturate(180%) blur(20px);
        }

        .metric-card {
          grid-column: span 3;
          min-height: 158px;
          padding: 20px 21px;
          border-radius: 22px;
          position: relative;
          overflow: hidden;
          transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease;
        }

        .metric-card:hover {
          transform: translateY(-1px);
          box-shadow: 0 1px 2px rgba(0,0,0,.02), 0 14px 38px rgba(0,0,0,.055);
        }

        .metric-card.wide { grid-column: span 6; }

        .metric-label {
          color: var(--apple-secondary);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: -.005em;
        }

        .metric-value {
          margin-top: 12px;
          color: var(--apple-text);
          font-size: clamp(28px, 3.2vw, 38px);
          line-height: 1;
          font-weight: 700;
          letter-spacing: -.045em;
          font-variant-numeric: tabular-nums;
        }

        .metric-meta {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px 12px;
          margin-top: 15px;
          color: var(--apple-secondary);
          font-size: 11.5px;
          line-height: 1.35;
        }

        .status-inline {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
        }

        .status-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: var(--apple-tertiary);
        }
        .status-dot.green { background: var(--apple-green); }
        .status-dot.orange { background: var(--apple-orange); }
        .status-dot.red { background: var(--apple-red); }
        .status-dot.blue { background: var(--apple-blue); }
        .status-dot.purple { background: var(--apple-purple); }

        .metric-link {
          color: var(--apple-blue);
          text-decoration: none;
          font-size: 11.5px;
          font-weight: 620;
          white-space: nowrap;
        }
        .metric-link:hover { text-decoration: underline; text-underline-offset: 2px; }
        .metric-card .metric-link::after { content: ""; position: absolute; inset: 0; }

        .exposure-card {
          display: flex;
          flex-direction: column;
          min-height: 158px;
        }

        .exposure-list {
          display: flex;
          flex-direction: column;
          margin-top: 12px;
          min-width: 0;
        }

        .exposure-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 14px;
          min-height: 29px;
          border-top: 1px solid var(--apple-line);
          color: var(--apple-text);
          font-size: 11.5px;
        }
        .exposure-row:first-child { border-top: 0; }
        .exposure-row span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--apple-secondary); }
        .exposure-row strong { font-weight: 650; font-variant-numeric: tabular-nums; }

        .analytics-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.55fr) minmax(330px, .9fr);
          gap: 16px;
          margin-bottom: 16px;
        }

        .charts-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: 16px;
        }

        .panel {
          border-radius: 24px;
          padding: 22px;
          min-width: 0;
        }

        .panel-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 18px;
        }

        .panel-title {
          color: var(--apple-text);
          font-size: 16px;
          line-height: 1.2;
          font-weight: 680;
          letter-spacing: -.022em;
        }

        .panel-sub {
          margin-top: 4px;
          color: var(--apple-secondary);
          font-size: 11.5px;
          line-height: 1.35;
        }

        .legend {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 7px 10px;
          max-width: 62%;
        }

        .leg {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: var(--apple-secondary);
          font-size: 10.5px;
          white-space: nowrap;
        }

        .leg-dot {
          width: 6px;
          height: 6px;
          flex: 0 0 auto;
          border-radius: 50%;
        }

        .chart-canvas { width: 100%; height: 290px; }
        .chart-canvas.compact { height: 260px; }

        .empty-state {
          width: 100%;
          height: 100%;
          display: grid;
          place-items: center;
          color: var(--apple-tertiary);
          font-size: 12px;
          text-align: center;
        }

        .region-tabs-wrap {
          overflow-x: auto;
          padding-bottom: 2px;
          margin-bottom: 15px;
          scrollbar-width: none;
        }
        .region-tabs-wrap::-webkit-scrollbar { display: none; }

        .region-tabs {
          display: inline-flex;
          gap: 3px;
          padding: 3px;
          min-width: max-content;
          border-radius: 12px;
          background: rgba(118, 118, 128, .12);
        }

        .region-tab {
          border: 0;
          border-radius: 9px;
          background: transparent;
          color: var(--apple-secondary);
          padding: 6px 10px;
          font-size: 10.5px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 160ms ease, box-shadow 160ms ease, color 160ms ease;
        }

        .region-tab.active {
          background: #fff;
          color: var(--apple-text);
          box-shadow: 0 1px 4px rgba(0,0,0,.10);
        }

        .region-tab:disabled {
          cursor: default;
          opacity: .55;
        }

        .ranking-list { display: flex; flex-direction: column; }

        .ranking-row {
          display: grid;
          grid-template-columns: 30px minmax(0, 1fr) auto;
          align-items: center;
          gap: 10px;
          padding: 12px 0;
          border-top: 1px solid var(--apple-line);
        }
        .ranking-row:first-child { border-top: 0; }

        .rank-number {
          width: 25px;
          height: 25px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          background: rgba(118,118,128,.10);
          color: var(--apple-secondary);
          font-size: 10px;
          font-weight: 700;
        }
        .rank-number.top { background: rgba(0,122,255,.10); color: var(--apple-blue); }

        .ranking-name {
          min-width: 0;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
          color: var(--apple-text);
          font-size: 12.5px;
          font-weight: 610;
        }
        .ranking-meta { margin-top: 2px; color: var(--apple-tertiary); font-size: 10.5px; }
        .ranking-value { color: var(--apple-text); font-size: 12px; font-weight: 680; font-variant-numeric: tabular-nums; white-space: nowrap; }

        .reports-panel { margin-bottom: 2px; }
        .reports-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 26px;
        }

        .report-column-title {
          margin-bottom: 5px;
          color: var(--apple-secondary);
          font-size: 11px;
          font-weight: 650;
        }

        .report-item {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 12px;
          min-height: 39px;
          border-top: 1px solid var(--apple-line);
          font-size: 12px;
        }
        .report-item:first-of-type { border-top: 0; }
        .report-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--apple-secondary); }
        .report-value { color: var(--apple-text); font-weight: 650; font-variant-numeric: tabular-nums; }
        .report-loading { padding: 22px 0; color: var(--apple-tertiary); font-size: 12px; }

        @media (max-width: 1180px) {
          .metric-card { grid-column: span 4; }
          .metric-card.wide { grid-column: span 8; }
          .analytics-grid { grid-template-columns: 1fr; }
        }

        @media (max-width: 850px) {
          .dashboard-shell { padding: 28px 20px 36px; }
          .dashboard-header { align-items: flex-start; }
          .profile-copy { display: none; }
          .profile-chip { padding-right: 7px; }
          .metric-card { grid-column: span 6; }
          .metric-card.wide { grid-column: span 12; }
          .charts-grid, .reports-grid { grid-template-columns: 1fr; }
          .legend { max-width: 100%; justify-content: flex-start; }
          .panel-header { flex-direction: column; }
        }

        @media (max-width: 560px) {
          .dashboard-shell { padding: 24px 16px 32px; }
          .dashboard-header { margin-bottom: 24px; }
          .page-title { font-size: 34px; }
          .page-subtitle { font-size: 14px; }
          .profile-chip { display: none; }
          .metrics-grid { gap: 10px; }
          .metric-card, .metric-card.wide { grid-column: span 12; min-height: 140px; padding: 18px; border-radius: 20px; }
          .panel { padding: 18px; border-radius: 20px; }
          .chart-canvas { height: 250px; }
          .chart-canvas.compact { height: 230px; }
          .ranking-row { grid-template-columns: 28px minmax(0, 1fr) auto; }
        }
      `}</style>

      <div className="root">
        <main className="dashboard-shell">
          <header className="dashboard-header">
            {/* <div>
              <div className="eyebrow"><span className="eyebrow-dot" /> Admin overview</div>
              <h1 className="page-title">Dashboard</h1>
              <p className="page-subtitle">A focused view of sales, distributors, approvals and regional performance.</p>
            </div> */}

            <div className="profile-chip" aria-label="Current administrator">
              <div className="profile-avatar">{loading ? "…" : initials}</div>
              <div className="profile-copy">
                <div className="profile-name">{loading ? "Loading…" : (adminUser.name || adminUser.username || "Administrator")}</div>
                <div className="profile-role">{adminUser.role || "Administrator"}</div>
              </div>
            </div>
          </header>

          <div className="section-label">At a glance</div>

          {summaryError && (
            <div className="summary-error">
              Some summary data failed to load.
              <button type="button" className="retry-button" onClick={retrySummary}>Retry</button>
            </div>
          )}

          <section className="metrics-grid" aria-label="Dashboard summary">
            <article className="metric-card">
              <div className="metric-label">Today&apos;s Sale</div>
              <div className="metric-value">₹0</div>
              <div className="metric-meta">
                <span className="status-inline"><span className="status-dot green" />Today</span>
              </div>
            </article>

            <article className="metric-card">
              <div className="metric-label">Pending Orders</div>
              <div className="metric-value">{summaryLoading ? "—" : totalPendingOrders}</div>
              <div className="metric-meta">
                <span className="status-inline"><span className="status-dot orange" />{totalPendingOrders} awaiting review</span>
                <Link href="/Pages/Ordermanagement/outstandingorders" className="metric-link">Review →</Link>
              </div>
            </article>

            <article className="metric-card">
              <div className="metric-label">Total Distributors</div>
              <div className="metric-value">{summaryLoading ? "—" : totalDistributors}</div>
              <div className="metric-meta">
                <span className="status-inline"><span className="status-dot green" />{activeDealers} active</span>
                <span className="status-inline"><span className="status-dot red" />{inactiveDealers} inactive</span>
                <Link href="/dashboard/admin/dealer/DealerList" className="metric-link">Open →</Link>
              </div>
            </article>

            <article className="metric-card">
              <div className="metric-label">Staff</div>
              <div className="metric-value">{summaryLoading ? "—" : (adminData.staffCount || staffQ.data?.count || staffRows.length)}</div>
              <div className="metric-meta">
                <span className="status-inline"><span className="status-dot purple" />{roleCounts["1"] ?? 0} sales manager</span>
                <span className="status-inline"><span className="status-dot blue" />{roleCounts["2"] ?? 0} field</span>
                <Link href="/dashboard/admin/staff/stafflist" className="metric-link">View →</Link>
              </div>
            </article>

            <article className="metric-card">
              <div className="metric-label">Discount Approvals</div>
              <div className="metric-value">{summaryLoading ? "—" : pendingApprovals}</div>
              <div className="metric-meta">
                <span className="status-inline"><span className={`status-dot ${pendingApprovals > 0 ? "orange" : "green"}`} />{pendingApprovals > 0 ? "Needs attention" : "All clear"}</span>
                <Link href="/dashboard/admin/custom-discount-approvals" className="metric-link">Review →</Link>
              </div>
            </article>

            <article className="metric-card">
              <div className="metric-label">Credit Exposure</div>
              <div className="metric-value">{summaryLoading ? "—" : `₹${outstandingExposure.toLocaleString("en-IN")}`}</div>
              <div className="metric-meta">
                <span>{ledgerRows.length} ledgers</span>
                <Link href="/dashboard/admin/ledger" className="metric-link">Ledger →</Link>
              </div>
            </article>

            <article className="metric-card wide exposure-card">
              <div className="metric-label">Highest Credit Exposure</div>
              <div className="exposure-list">
                {summaryLoading ? (
                  <div className="report-loading">Loading exposure…</div>
                ) : highExposureDealers.length > 0 ? highExposureDealers.map((dealer) => (
                  <div className="exposure-row" key={dealer.Dealer_Id}>
                    <span>{dealer.Dealer_Name}</span>
                    <strong>₹{Number(dealer.currentlimit || 0).toLocaleString("en-IN")}</strong>
                  </div>
                )) : (
                  <div className="report-loading">No exposure recorded.</div>
                )}
              </div>
            </article>
          </section>

          <div className="section-label">Regional performance</div>

          <section className="analytics-grid">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">RSM Net Sales</div>
                  <div className="panel-sub">{regionalGranularitySub}</div>
                </div>
                <div className="legend">
                  {SALES_REGIONS.map((region) => (
                    <span key={region} className="leg">
                      <span className="leg-dot" style={{ background: REGION_META[region].color }} />
                      {formatRegionLabel(region)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="region-tabs-wrap">
                <div className="region-tabs" role="group" aria-label="Net sales period">
                  {GRANULARITY_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`region-tab${regionalGranularity === option.value ? " active" : ""}`}
                      aria-pressed={regionalGranularity === option.value}
                      disabled={regionalSalesLoading}
                      onClick={() => setRegionalGranularity(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="chart-canvas">
                {loading || regionalSalesLoading ? (
                  <div className="empty-state">Loading regional sales…</div>
                ) : hasRegionalSales ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={regionalLineData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(60,60,67,.10)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: "#8e8e93" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10.5, fill: "#8e8e93" }} axisLine={false} tickLine={false} width={52} />
                      <Tooltip
                        cursor={{ stroke: "rgba(60,60,67,.12)", strokeWidth: 1 }}
                        contentStyle={{ backgroundColor: "rgba(255,255,255,.96)", border: "1px solid rgba(60,60,67,.12)", borderRadius: "14px", boxShadow: "0 10px 30px rgba(0,0,0,.10)", color: "#1d1d1f", fontSize: "11px" }}
                        labelStyle={{ color: "#6e6e73", marginBottom: "5px" }}
                        formatter={(value, _name, item) => {
                          const region = String(item?.dataKey ?? "") as SalesRegionKey;
                          return [`₹${Number(value ?? 0).toLocaleString("en-IN")}`, formatRegionLabel(region)];
                        }}
                      />
                      {SALES_REGIONS.map((region) => (
                        <Line
                          key={region}
                          type="monotone"
                          dataKey={region}
                          stroke={REGION_META[region].color}
                          strokeWidth={2.25}
                          dot={false}
                          activeDot={{ r: 4, fill: "#ffffff", stroke: REGION_META[region].color, strokeWidth: 2 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-state">No regional sales data available yet.</div>
                )}
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Top Distributors by Region</div>
                  <div className="panel-sub">Select a zone to review its highest net sales distributors</div>
                </div>
              </div>

              <div className="region-tabs-wrap">
                <div className="region-tabs">
                  {SALES_REGIONS.map((region) => (
                    <button
                      key={region}
                      type="button"
                      className={`region-tab${selectedRegion === region ? " active" : ""}`}
                      onClick={() => setSelectedRegion(region)}
                    >
                      {formatRegionLabel(region)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="ranking-list">
                {loading ? (
                  <div className="empty-state" style={{ minHeight: 220 }}>Loading distributors…</div>
                ) : selectedRegionalDistributors.length > 0 ? (
                  selectedRegionalDistributors.map((dealer, index) => (
                    <div key={`${selectedRegion}-${dealer.dealerId || dealer.dealerName}-${index}`} className="ranking-row">
                      <span className={`rank-number${index < 3 ? " top" : ""}`}>{index + 1}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="ranking-name">{dealer.dealerName}</div>
                        <div className="ranking-meta">{formatRegionLabel(selectedRegion)} region</div>
                      </div>
                      <div className="ranking-value">₹{Number(dealer.total).toLocaleString("en-IN")}</div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state" style={{ minHeight: 220 }}>No distributors found for the {formatRegionLabel(selectedRegion).toLowerCase()} region.</div>
                )}
              </div>
            </article>
          </section>

          <div className="section-label">Sales leaders</div>

          <section className="charts-grid">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Top Orders</div>
                  <div className="panel-sub">Highest order values in the current dataset</div>
                </div>
                <span className="leg"><span className="leg-dot" style={{ background: "#007aff" }} />Order value</span>
              </div>
              <div className="chart-canvas compact">
                {loading ? (
                  <div className="empty-state">Loading chart…</div>
                ) : data.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(60,60,67,.08)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#8e8e93" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#8e8e93" }} axisLine={false} tickLine={false} width={50} />
                      <Tooltip
                        cursor={{ fill: "rgba(0,122,255,.035)" }}
                        contentStyle={{ backgroundColor: "rgba(255,255,255,.96)", border: "1px solid rgba(60,60,67,.12)", borderRadius: "14px", boxShadow: "0 10px 30px rgba(0,0,0,.10)", fontSize: "11px" }}
                        labelStyle={{ color: "#6e6e73" }}
                        formatter={(value) => `₹${Number(value).toLocaleString("en-IN")}`}
                      />
                      <Bar dataKey="value" fill="#007aff" radius={[8, 8, 2, 2]} maxBarSize={38} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-state">No order data available.</div>
                )}
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Top Distributors</div>
                  <div className="panel-sub">Distributor performance by total value</div>
                </div>
                <span className="leg"><span className="leg-dot" style={{ background: "#8e8e93" }} />Total value</span>
              </div>
              <div className="chart-canvas compact">
                {loading ? (
                  <div className="empty-state">Loading chart…</div>
                ) : dealerData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dealerChartData} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(60,60,67,.08)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#8e8e93" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#8e8e93" }} axisLine={false} tickLine={false} width={50} />
                      <Tooltip
                        cursor={{ fill: "rgba(60,60,67,.035)" }}
                        contentStyle={{ backgroundColor: "rgba(255,255,255,.96)", border: "1px solid rgba(60,60,67,.12)", borderRadius: "14px", boxShadow: "0 10px 30px rgba(0,0,0,.10)", fontSize: "11px" }}
                        labelStyle={{ color: "#6e6e73" }}
                        formatter={(value) => `₹${Number(value).toLocaleString("en-IN")}`}
                      />
                      <Bar dataKey="value" fill="#8e8e93" radius={[8, 8, 2, 2]} maxBarSize={38} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty-state">No distributor data available.</div>
                )}
              </div>
            </article>
          </section>

          <section className="panel reports-panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">Reports</div>
                <div className="panel-sub">Quick ranked view of your strongest orders and distributors</div>
              </div>
            </div>

            <div className="reports-grid">
              <div>
                <div className="report-column-title">Top orders</div>
                {loading ? (
                  <div className="report-loading">Loading…</div>
                ) : data.length > 0 ? (
                  data.map((item) => (
                    <div key={item.order_id} className="report-item">
                      <span className="report-name">{formatDisplayOrderNumber(item.order_id)}</span>
                      <span className="report-value">₹{Number(item.total).toLocaleString("en-IN")}</span>
                    </div>
                  ))
                ) : (
                  <div className="report-loading">No order data available.</div>
                )}
              </div>

              <div>
                <div className="report-column-title">Top distributors</div>
                {loading ? (
                  <div className="report-loading">Loading…</div>
                ) : dealerData.length > 0 ? (
                  dealerData.map((dealer, index) => (
                    <div key={`${dealer.Dealer_Name}-${index}`} className="report-item">
                      <span className="report-name">{dealer.Dealer_Name}</span>
                      <span className="report-value">₹{Number(dealer.total).toLocaleString("en-IN")}</span>
                    </div>
                  ))
                ) : (
                  <div className="report-loading">No distributor data available.</div>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>
    </>
  );
}