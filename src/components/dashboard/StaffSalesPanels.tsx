"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import DateInput from "@/components/ui/date-input";
import { SegmentedDropdown, type SegItem } from "@/components/SegmentedTabs";
import { formatPeriodLabel } from "@/lib/salesPeriods";
import type { StaffDashboardData, StaffSalesSummaryData } from "@/server/modules/staff-dashboard";
import type { StaffBreakdown } from "@/server/modules/staff-dashboard-charts";

type Granularity = StaffDashboardData["granularity"];

const BREAKDOWN: Record<StaffBreakdown, { title: string; by: string; noun: string; all: string }> = {
  asm: { title: "ASM", by: "ASM", noun: "ASM", all: "All ASMs" },
  salesManager: { title: "Sales Manager", by: "sales manager", noun: "Sales Manager", all: "All sales managers" },
  city: { title: "City", by: "city", noun: "City", all: "All cities" },
};

const GRANULARITY_OPTIONS: Array<{ value: Granularity; label: string; adjective: string }> = [
  { value: "day", label: "Day", adjective: "Daily" },
  { value: "month", label: "Month", adjective: "Monthly" },
  { value: "quarter", label: "Quarter", adjective: "Quarterly" },
  { value: "half", label: "Half Year", adjective: "Half-yearly" },
  { value: "year", label: "Year", adjective: "Yearly" },
];

// The admin dashboard's region colours.
const LINE_COLORS = ["#4f8fcb", "#d97706", "#7c3aed", "#6fd08c", "#f97316", "#2563eb", "#f2cf5b", "#c084fc", "#0f766e"];

const AXIS_TICK = { fontSize: 10.5, fill: "#8e8e93" };
const TOOLTIP_STYLE = { backgroundColor: "rgba(255,255,255,.96)", border: "1px solid rgba(60,60,67,.12)", borderRadius: "14px", boxShadow: "0 10px 30px rgba(0,0,0,.10)", color: "#1d1d1f", fontSize: "11px" };

const rupee = (value: unknown) => `₹${Number(value ?? 0).toLocaleString("en-IN")}`;

/** Axis labels: 130000 as 1.3L, since the narrow axis cuts off the leading digit otherwise. */
export const compactAxisLabel = (value: number) => new Intl.NumberFormat("en-IN", { notation: "compact" }).format(value);

export const STAFF_PANEL_CSS = `
  /* The admin dashboard's grid: tiles on the left, the Sale Chart beside them. */
  .metrics-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; margin-bottom: 30px; }
  .metrics-left { grid-column: span 6; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: auto auto 1fr; gap: 14px; }
  .analytics-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(330px, .9fr); gap: 16px; margin-bottom: 16px; }
  .staff-only-chart { margin-bottom: 16px; }

  .metrics-left .target-overview { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 16px; }
  .metrics-left .target-overview:hover { transform: none; }
  .target-head { display: flex; align-items: center; gap: 14px; }
  .target-icon { display: grid; place-items: center; flex-shrink: 0; width: 48px; height: 48px; border-radius: 14px; background: linear-gradient(135deg, #4f7cff, #7b4dff); color: #fff; }
  .target-title { font-size: 18px; font-weight: 700; letter-spacing: -.02em; }
  .target-sub { margin-top: 2px; color: #6e6e73; font-size: 12.5px; }
  .target-pairs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .target-pair { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 16px; border-radius: 16px; border: 1px solid; }
  .target-pair.blue { background: rgba(0, 122, 255, .045); border-color: rgba(0, 122, 255, .12); }
  .target-pair.green { background: rgba(52, 199, 89, .06); border-color: rgba(52, 199, 89, .16); }
  .target-pair-head { font-size: 14px; font-weight: 650; }
  .target-pair-value { font-size: 22px; font-weight: 750; letter-spacing: -.03em; line-height: 1.15; font-variant-numeric: tabular-nums; }
  .target-pair-value span { color: #8e8e93; font-weight: 500; }
  .target-pair .stat-badge { margin-top: 0; }
  @container (max-width: 420px) { .target-pairs { grid-template-columns: 1fr; } }

  .metrics-grid .staff-roles { grid-column: 1 / -1; min-height: 0; display: flex; align-items: center; gap: 14px; padding: 12px 16px; }
  .metrics-grid .staff-roles:hover { transform: none; }
  .staff-roles .stat-lbl { flex-shrink: 0; }
  .staff-roles .role-pills { flex-wrap: nowrap; overflow-x: auto; margin-top: 0; scrollbar-width: thin; }
  .staff-roles .role-pill { flex-shrink: 0; white-space: nowrap; }

  @media (max-width: 1180px) {
    .metrics-left, .sale-panel { grid-column: span 12; }
    .analytics-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 560px) {
    .metrics-grid { gap: 10px; }
    .metrics-left { grid-template-columns: 1fr; }
  }

  .region-tabs-wrap { overflow-x: auto; padding-bottom: 2px; margin-bottom: 15px; scrollbar-width: none; }
  .region-tabs-wrap::-webkit-scrollbar { display: none; }
  .region-tabs { display: inline-flex; gap: 3px; padding: 3px; min-width: max-content; border-radius: 12px; background: rgba(118, 118, 128, .12); }
  .region-tab { border: 0; border-radius: 9px; background: transparent; color: #6e6e73; padding: 6px 10px; font-size: 10.5px; font-weight: 600; cursor: pointer; transition: background-color 160ms ease, box-shadow 160ms ease, color 160ms ease; }
  .region-tab.active { background: #fff; color: #1d1d1f; box-shadow: 0 1px 4px rgba(0,0,0,.10); }

  .legend-group { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px 10px; max-width: 62%; }
  @media (max-width: 850px) { .legend-group { max-width: 100%; justify-content: flex-start; } }

  .ranking-list { display: flex; flex-direction: column; }
  .ranking-row { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 12px 0; border-top: 1px solid rgba(60, 60, 67, .11); }
  .ranking-row:first-child { border-top: 0; }
  .rank-number { width: 25px; height: 25px; display: grid; place-items: center; border-radius: 50%; background: rgba(118,118,128,.10); color: #6e6e73; font-size: 10px; font-weight: 700; }
  .rank-number.top { background: rgba(0,122,255,.10); color: #006162; }
  .ranking-name { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #1d1d1f; font-size: 12.5px; font-weight: 610; }
  .ranking-value { color: #1d1d1f; font-size: 12px; font-weight: 680; font-variant-numeric: tabular-nums; white-space: nowrap; }

  .sale-panel { grid-column: span 6; display: flex; flex-direction: column; gap: 10px; }
  .sale-chart { flex: 1; min-height: 220px; }
  .sale-range, .sale-filters { display: flex; flex-wrap: wrap; gap: 10px; }
  .sale-field { display: flex; align-items: center; gap: 8px; color: #6e6e73; font-size: 12px; font-weight: 600; }
  .sale-field input { padding: 6px 10px; border: 1px solid rgba(60, 60, 67, .14); border-radius: 10px; background: rgba(255, 255, 255, .88); color: #1d1d1f; font: inherit; font-weight: 600; }
  .sale-all-time { padding: 6px 12px; border: 1px solid rgba(60, 60, 67, .14); border-radius: 10px; background: rgba(255, 255, 255, .88); color: #6e6e73; font-size: 12px; font-weight: 650; cursor: pointer; }
  .sale-all-time:hover:not(:disabled) { color: #1d1d1f; }
  .sale-all-time:disabled { opacity: .45; cursor: default; }
  .sale-total-label { color: #6e6e73; font-size: 12px; font-weight: 600; }
  .sale-total { font-size: 30px; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .sale-total-meta { margin-top: -4px; color: #8e8e93; font-size: 11.5px; }

  .role-pills { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
  .role-pill { display: inline-flex; align-items: center; gap: 10px; padding: 5px 5px 5px 14px; border-radius: 999px; border: 1px solid rgba(60, 60, 67, .12); background: rgba(118, 118, 128, .06); color: #1d1d1f; font-size: 13px; font-weight: 600; }
  .role-count { display: inline-grid; place-items: center; min-width: 28px; height: 28px; padding: 0 6px; border-radius: 999px; background: #fff; font-size: 12px; font-variant-numeric: tabular-nums; }
`;

async function fetchSalesSummary(query: string) {
  const res = await fetch(`/api/staff/sales-summary?${query}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).data as StaffSalesSummaryData;
}

export function SaleChartPanel({ breakdown, members, enabled }: {
  breakdown: StaffBreakdown;
  members: Array<{ id: string; name: string }>;
  enabled: boolean;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [member, setMember] = useState("");
  const [city, setCity] = useState("");
  // en-CA formats as yyyy-mm-dd, in the viewer's own calendar day.
  const today = new Date().toLocaleDateString("en-CA");

  const query = new URLSearchParams({ from, to, member, city }).toString();
  const summaryQ = useQuery({
    queryKey: ["staffSalesSummary", query],
    queryFn: () => fetchSalesSummary(query),
    placeholderData: keepPreviousData,
    enabled,
  });
  const summary = summaryQ.data;
  const series = (summary?.series ?? []).map((point) => ({
    label: formatPeriodLabel(point.period, (summary?.granularity ?? "day") as Granularity),
    total: point.total,
  }));

  const memberItems: SegItem[] = [
    { value: "", label: BREAKDOWN[breakdown].all, tone: "neutral" },
    ...members.map((option) => ({ value: option.id, label: option.name, tone: "amber" as const })),
  ];
  const cityItems: SegItem[] = [
    { value: "", label: "All cities", tone: "neutral" },
    ...(summary?.cities ?? []).map((option) => ({ value: option, label: option, tone: "emerald" as const })),
  ];

  return (
    <article className="panel sale-panel">
      <div className="panel-title">Sale Chart</div>
      <div className="sale-range">
        <label className="sale-field">
          <span>From</span>
          <DateInput value={from} min={summary?.earliest ?? undefined} max={to} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="sale-field">
          <span>To</span>
          <DateInput value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} />
        </label>
        <button
          type="button"
          className="sale-all-time"
          disabled={!from && !to}
          onClick={() => { setFrom(""); setTo(""); }}
        >
          All time
        </button>
      </div>

      <div className="sale-total-label">Booking</div>
      <div className="sale-total">{summaryQ.isPending ? "—" : rupee(summary?.total)}</div>
      <div className="sale-total-meta">
        {summaryQ.isError
          ? "Sales summary failed to load."
          : `${summary?.orderCount ?? 0} accepted orders · ${from || to ? `${from || "start"} to ${to || "today"}` : "all time"}${city ? ` · ${city}` : ""}`}
      </div>

      <div className="sale-filters">
        {breakdown !== "city" && (
          <SegmentedDropdown
            label={BREAKDOWN[breakdown].noun}
            value={member}
            onChange={(next) => { setMember(next); setCity(""); }}
            items={memberItems}
          />
        )}
        <SegmentedDropdown
          label="City"
          value={city}
          onChange={setCity}
          items={cityItems}
          disabled={!summary?.cities.length}
        />
      </div>

      {summaryQ.isPending ? (
        <div className="chart-empty">Loading sales…</div>
      ) : series.length === 0 ? (
        <div className="chart-empty">No accepted sales in this range.</div>
      ) : (
        <div className="sale-chart">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={series} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="rgba(60,60,67,.10)" vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} tickFormatter={compactAxisLabel} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [rupee(value), "Net sale"]} />
              <Line type="monotone" dataKey="total" stroke="#00494B" strokeWidth={2.25} dot={false} activeDot={{ r: 4, fill: "#ffffff", stroke: "#00494B", strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </article>
  );
}

export function NetSalesPanel({ breakdown, data, loading, granularity, onGranularityChange }: {
  breakdown: StaffBreakdown;
  data: StaffDashboardData | undefined;
  loading: boolean;
  granularity: Granularity;
  onGranularityChange: (next: Granularity) => void;
}) {
  const groups = data?.groups ?? [];
  const points = (data?.netSales ?? []).map((point) => ({
    ...point,
    label: formatPeriodLabel(String(point.period), data?.granularity ?? granularity),
  }));
  const adjective = GRANULARITY_OPTIONS.find((option) => option.value === granularity)?.adjective;

  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">{BREAKDOWN[breakdown].title} Net Sales</div>
          <div className="panel-sub">{adjective} net sales by {BREAKDOWN[breakdown].by}</div>
        </div>
        <div className="legend-group">
          {groups.map((group, index) => (
            <span key={group.key} className="legend">
              <span className="leg-dot" style={{ background: LINE_COLORS[index % LINE_COLORS.length] }} />
              {group.label}
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
              className={`region-tab${granularity === option.value ? " active" : ""}`}
              aria-pressed={granularity === option.value}
              onClick={() => onGranularityChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="chart-empty">Loading net sales…</div>
      ) : points.length === 0 ? (
        <div className="chart-empty">No accepted sales yet.</div>
      ) : (
        <div className="chart-canvas" style={{ height: 290 }}>
          <ResponsiveContainer width="100%" height={290} minWidth={0}>
            <LineChart data={points} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="rgba(60,60,67,.10)" vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={52} tickFormatter={compactAxisLabel} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [rupee(value), name]} />
              {groups.map((group, index) => (
                <Line
                  key={group.key}
                  type="monotone"
                  dataKey={group.key}
                  name={group.label}
                  stroke={LINE_COLORS[index % LINE_COLORS.length]}
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{ r: 4, fill: "#ffffff", stroke: LINE_COLORS[index % LINE_COLORS.length], strokeWidth: 2 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </article>
  );
}

export function TopByGroupPanel({ breakdown, data, loading }: {
  breakdown: StaffBreakdown;
  data: StaffDashboardData | undefined;
  loading: boolean;
}) {
  const [selectedLabel, setSelectedLabel] = useState("");
  const groups = data?.groups ?? [];
  // Held by label: a group's g0, g1 key can change as its rank does.
  const selected = groups.find((group) => group.label === selectedLabel) ?? groups[0];
  const dealers = selected ? data?.topByGroup[selected.key] ?? [] : [];

  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">Top Dealers by {BREAKDOWN[breakdown].title}</div>
          <div className="panel-sub">Highest net sales dealers for each {BREAKDOWN[breakdown].by}</div>
        </div>
      </div>

      {groups.length > 0 && (
        <div className="region-tabs-wrap">
          <div className="region-tabs">
            {groups.map((group) => (
              <button
                key={group.key}
                type="button"
                className={`region-tab${group.key === selected?.key ? " active" : ""}`}
                onClick={() => setSelectedLabel(group.label)}
              >
                {group.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="chart-empty">Loading dealers…</div>
      ) : dealers.length === 0 ? (
        <div className="chart-empty">No accepted sales yet.</div>
      ) : (
        <div className="ranking-list">
          {dealers.map((dealer, index) => (
            <div key={dealer.dealerId} className="ranking-row">
              <span className={`rank-number${index < 3 ? " top" : ""}`}>{index + 1}</span>
              <div className="ranking-name">{dealer.dealerName}</div>
              <div className="ranking-value">{rupee(dealer.total)}</div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
