export type SalesRegionKey = "NORTH_1" | "NORTH_2" | "SOUTH_1" | "SOUTH_2" | "WEST_1" | "WEST_2" | "EAST" | "ROM" | "CENTRAL";

export type SalesGranularity = "day" | "month" | "quarter" | "half" | "year";

export type AdminDashboardMonthlyPerformance = {
  month: string;
  total: string;
};

/**
 * `month` is kept for backwards compatibility and always mirrors `period`.
 * The period key format depends on the requested granularity:
 * day `YYYY-MM-DD`, month `YYYY-MM`, quarter `YYYY-Q1`, half `YYYY-H1`, year `YYYY`.
 */
export type AdminDashboardRegionalPerformance = {
  month: string;
  period: string;
} & Record<SalesRegionKey, string>;

export type AdminDashboardTopDealer = {
  dealerId: string;
  dealerName: string;
  total: string;
};

export type AdminDashboardResult = {
  summary: {
    dealerCount: number;
    orderCount: number;
  };
  monthlyPerformance: AdminDashboardMonthlyPerformance[];
  regionalGranularity: SalesGranularity;
  regionalPerformance: AdminDashboardRegionalPerformance[];
  topDealers: AdminDashboardTopDealer[];
  topDistributorsByRegion: Record<SalesRegionKey, AdminDashboardTopDealer[]>;
  warnings: string[];
};
