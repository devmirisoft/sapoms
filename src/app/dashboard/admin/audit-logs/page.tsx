"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITIES,
  auditActionClass,
  auditLabel,
} from "@/lib/auditActions";

const AUDIT_LOGS_URL = "/api/admin/audit-logs";
const ITEMS_PER_PAGE = 50;
const ROLES = ["ADMIN", "NSM", "ACCOUNTANT", "RSM", "ASM", "STAFF", "DEALER"];
const SHIMMER = "animate-pulse bg-gray-200 rounded";

type AuditLog = {
  id: string;
  action: string | null;
  eventType: string;
  entity: string | null;
  entityId: string | null;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
};

type AuditResponse = {
  data: AuditLog[];
  total?: number;
  count?: number;
  last_page?: number;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  const text = await res.text();
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const payload = JSON.parse(text);
      message = payload?.msg || payload?.message || message;
    } catch {
      /* non-JSON error page; keep the status */
    }
    throw new Error(message);
  }
  if (/^\s*</.test(text)) throw new Error("Expected JSON but received HTML");
  return JSON.parse(text) as T;
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const day = date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const time = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${day} · ${time.toUpperCase()}`;
}

/** "rsmApprovalStatus" -> "Rsm approval status" */
function fieldLabel(key: string) {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Renders a stored JSON value as something a person can read. */
function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map(formatValue).join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  // Values written by the sanitizer keep ISO dates; show them as dates.
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(text)) return formatWhen(text);
  return text;
}

function entityLine(log: AuditLog) {
  const entity = log.entity ? auditLabel(log.entity) : null;
  const record = log.entityId || (log.metadata?.orderNumber as string | undefined) || null;
  if (!entity && !record) return "—";
  return [entity, record].filter(Boolean).join(" · ");
}

function actorLine(log: AuditLog) {
  // Rows written before the actor columns existed kept the id in metadata only.
  return log.actorName || log.actorEmail || (log.metadata?.userId ? `User ${log.metadata.userId}` : "System");
}

const selectClass =
  "h-9 w-full appearance-none rounded border border-[#d6dbe4] bg-white pl-3 pr-8 text-sm text-[#1f2937] outline-none focus:border-[#5d7df0] focus:ring-2 focus:ring-[#dfe6ff]";
const inputClass =
  "h-9 w-full rounded border border-[#d6dbe4] bg-white px-3 text-sm outline-none focus:border-[#5d7df0] focus:ring-2 focus:ring-[#dfe6ff]";

function Select({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly string[];
}) {
  return (
    <div className="relative">
      <label className="mb-1 block text-xs font-medium text-[#667085]">{label}</label>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}>
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>{auditLabel(option)}</option>
        ))}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute bottom-2.5 right-2.5 text-[#98a2b3]" />
    </div>
  );
}

function ChangeRows({ oldValues, newValues }: { oldValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null }) {
  const keys = Array.from(new Set([...Object.keys(oldValues ?? {}), ...Object.keys(newValues ?? {})]));
  if (!keys.length) return null;

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#667085]">Changes</h3>
      <dl className="divide-y divide-[#eef1f6] rounded border border-[#dfe3ec]">
        {keys.map((key) => (
          <div key={key} className="px-3 py-2.5">
            <dt className="text-xs font-medium text-[#667085]">{fieldLabel(key)}</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded bg-rose-50 px-2 py-0.5 text-rose-700 line-through decoration-rose-300">
                {formatValue(oldValues?.[key])}
              </span>
              <span aria-hidden="true" className="text-[#98a2b3]">→</span>
              <span className="rounded bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                {formatValue(newValues?.[key])}
              </span>
              <span className="sr-only">
                changed from {formatValue(oldValues?.[key])} to {formatValue(newValues?.[key])}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-[#667085]">{label}</dt>
      <dd className="mt-0.5 text-sm text-[#1f2937]">{children}</dd>
    </div>
  );
}

function DetailDrawer({ log, onClose }: { log: AuditLog; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hasChanges = Boolean(
    (log.oldValues && Object.keys(log.oldValues).length) || (log.newValues && Object.keys(log.newValues).length),
  );

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Audit detail"
        className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-xl"
      >
        <header className="flex items-start justify-between border-b border-[#dfe3ec] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#1f2937]">Audit Detail</h2>
            <p className="mt-0.5 text-xs text-[#667085]">{formatWhen(log.createdAt)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close audit detail"
            autoFocus
            className="rounded p-1 text-[#667085] transition-colors hover:bg-[#f4f6fa] hover:text-[#1f2937]"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <dl className="grid grid-cols-2 gap-4">
            <DetailField label="Action">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${auditActionClass(log.action)}`}>
                {auditLabel(log.action ?? log.eventType)}
              </span>
            </DetailField>
            <DetailField label="Entity">{log.entity ? auditLabel(log.entity) : "—"}</DetailField>
            <DetailField label="Record">{log.entityId || "—"}</DetailField>
            <DetailField label="Performed By">
              <span className="font-medium">{actorLine(log)}</span>
              {log.actorRole ? <span className="block text-xs text-[#667085]">{auditLabel(log.actorRole)}</span> : null}
              {log.actorEmail && log.actorName ? <span className="block text-xs text-[#667085]">{log.actorEmail}</span> : null}
            </DetailField>
          </dl>

          {hasChanges ? <ChangeRows oldValues={log.oldValues} newValues={log.newValues} /> : null}

          <dl className="grid grid-cols-2 gap-4 border-t border-[#eef1f6] pt-4">
            <DetailField label="Event type">{log.eventType}</DetailField>
            <DetailField label="IP address">{log.ipAddress || "—"}</DetailField>
            <DetailField label="Request ID">
              <span className="break-all text-xs">{log.requestId || "—"}</span>
            </DetailField>
            <DetailField label="Session user">{log.actorId || "—"}</DetailField>
          </dl>

          {log.metadata && Object.keys(log.metadata).length ? (
            <details className="rounded border border-[#dfe3ec]">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[#667085]">Raw data</summary>
              <pre className="overflow-x-auto border-t border-[#eef1f6] px-3 py-2 text-xs text-[#59677a]">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function AuditLogsPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [actorRole, setActorRole] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditLog | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setSearch(searchInput);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(ITEMS_PER_PAGE) });
    if (search) params.set("search", search);
    if (action) params.set("action", action);
    if (entity) params.set("entity", entity);
    if (actorRole) params.set("actorRole", actorRole);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params.toString();
  }, [page, search, action, entity, actorRole, dateFrom, dateTo]);

  const { data, isLoading, isError, error } = useQuery<AuditResponse>({
    queryKey: ["adminAuditLogs", queryString],
    queryFn: () => fetchJson<AuditResponse>(`${AUDIT_LOGS_URL}?${queryString}`),
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });

  // The admin portal is shared with the NSM, who cannot read this report.
  const forbidden = isError && error instanceof Error && /forbidden/i.test(error.message);
  const rows = data?.data ?? [];
  const total = data?.total ?? data?.count ?? 0;
  const lastPage = Number(data?.last_page) || Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));
  const filtersActive = Boolean(search || action || entity || actorRole || dateFrom || dateTo);

  const resetFilters = useCallback(() => {
    setSearchInput("");
    setSearch("");
    setAction("");
    setEntity("");
    setActorRole("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }, []);

  const withReset = (setter: (value: string) => void) => (value: string) => {
    setPage(1);
    setter(value);
  };

  const startIndex = total === 0 ? 0 : (page - 1) * ITEMS_PER_PAGE + 1;
  const endIndex = Math.min(page * ITEMS_PER_PAGE, total);

  return (
    <main className="min-h-screen bg-[#f4f6fa] px-6 py-7 text-[#1f2937]">
      <div className="admin-page-shell">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Audit Logs</h1>
          <p className="mt-1 text-sm text-[#667085]">System activity and administrative actions</p>
        </div>

        <div className="mb-4 rounded border border-[#dfe3ec] bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <label htmlFor="audit-search" className="mb-1 block text-xs font-medium text-[#667085]">Search</label>
              <input
                id="audit-search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Actor, record, action..."
                className={inputClass}
              />
            </div>
            <Select label="Action" value={action} onChange={withReset(setAction)} options={AUDIT_ACTIONS} />
            <Select label="Entity" value={entity} onChange={withReset(setEntity)} options={AUDIT_ENTITIES} />
            <Select label="Role" value={actorRole} onChange={withReset(setActorRole)} options={ROLES} />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="audit-from" className="mb-1 block text-xs font-medium text-[#667085]">From</label>
                <input id="audit-from" type="date" value={dateFrom} onChange={(event) => withReset(setDateFrom)(event.target.value)} className={inputClass} />
              </div>
              <div>
                <label htmlFor="audit-to" className="mb-1 block text-xs font-medium text-[#667085]">To</label>
                <input id="audit-to" type="date" value={dateTo} onChange={(event) => withReset(setDateTo)(event.target.value)} className={inputClass} />
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-[#667085]">
              {isLoading ? "Loading…" : `${total.toLocaleString("en-IN")} ${total === 1 ? "entry" : "entries"}`}
            </p>
            <button
              type="button"
              onClick={resetFilters}
              disabled={!filtersActive}
              className="rounded border border-[#d6dbe4] px-3 py-1.5 text-xs font-medium text-[#59677a] transition-colors hover:bg-[#f4f6fa] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear filters
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded border border-[#dfe3ec] bg-white shadow-sm">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-[#f7f9fc] text-xs uppercase tracking-wide text-[#667085]">
              <tr>
                <th scope="col" className="px-4 py-3">Actor</th>
                <th scope="col" className="px-4 py-3">Action</th>
                <th scope="col" className="px-4 py-3">Record</th>
                <th scope="col" className="px-4 py-3 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: 12 }).map((_, index) => (
                  <tr key={index} className="border-t border-[#eef1f6]">
                    <td className="px-4 py-3"><div className={`${SHIMMER} h-4 w-32`} /></td>
                    <td className="px-4 py-3"><div className={`${SHIMMER} h-4 w-24`} /></td>
                    <td className="px-4 py-3"><div className={`${SHIMMER} h-4 w-40`} /></td>
                    <td className="px-4 py-3"><div className={`${SHIMMER} ml-auto h-4 w-36`} /></td>
                  </tr>
                ))}

              {!isLoading && isError && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center">
                    {forbidden ? (
                      <>
                        <p className="font-medium text-[#1f2937]">Audit logs are restricted to Admin accounts.</p>
                        <p className="mt-1 text-sm text-[#667085]">Your account can use the rest of the admin portal, but not this report.</p>
                      </>
                    ) : (
                      <span className="text-red-500">{error instanceof Error ? error.message : "Audit logs are unavailable."}</span>
                    )}
                  </td>
                </tr>
              )}

              {!isLoading && !isError && rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-[#667085]">
                    {filtersActive ? "No entries match these filters." : "No activity recorded yet."}
                  </td>
                </tr>
              )}

              {!isLoading && !isError && rows.map((log) => (
                <tr
                  key={log.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`View audit detail for ${auditLabel(log.action ?? log.eventType)} by ${actorLine(log)}`}
                  onClick={() => setSelected(log)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelected(log);
                    }
                  }}
                  className="cursor-pointer border-t border-[#eef1f6] transition-colors hover:bg-[#f7f9fc] focus:bg-[#f7f9fc] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#5d7df0]"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-[#1f2937]">{actorLine(log)}</div>
                    <div className="text-xs text-[#667085]">{log.actorRole ? auditLabel(log.actorRole) : "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${auditActionClass(log.action)}`}>
                      {auditLabel(log.action ?? log.eventType)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#59677a]">{entityLine(log)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-[#59677a]">{formatWhen(log.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-xs text-[#667085]">
              Showing {startIndex.toLocaleString("en-IN")}–{endIndex.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 rounded border border-[#d6dbe4] px-2.5 py-1.5 text-xs font-medium text-[#59677a] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <span className="px-3 text-xs text-[#667085]">Page {page} of {lastPage}</span>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(lastPage, current + 1))}
                disabled={page >= lastPage}
                className="inline-flex items-center gap-1 rounded border border-[#d6dbe4] px-2.5 py-1.5 text-xs font-medium text-[#59677a] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {selected ? <DetailDrawer log={selected} onClose={() => setSelected(null)} /> : null}
    </main>
  );
}
