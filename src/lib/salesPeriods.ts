import type { SalesGranularity } from "@/server/modules/admin-dashboard/admin-dashboard.types";

function formatMonthLabel(month: string) {
  const date = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
}

/** Renders a period key produced by the dashboard APIs for the given granularity. */
export function formatPeriodLabel(period: string, granularity: SalesGranularity) {
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
