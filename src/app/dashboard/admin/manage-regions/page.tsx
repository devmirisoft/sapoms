"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { STATE_OPTIONS } from "@/lib/places";
import { SALES_REGION_OPTIONS, type SalesRegionOptionValue } from "@/lib/salesRegions";

const ADMIN_STAFF_URL = "/api/admin/staff";

// A region's states are the states allotted to that region's RSM — one RSM per
// region, so the RSM row is the single source of truth and this page edits it.
type RegionRsm = { id: string; name: string; email: string; assignedStates: string[] };
type RegionRsms = Partial<Record<SalesRegionOptionValue, RegionRsm>>;

function sortedStates(states: unknown): string[] {
  if (!Array.isArray(states)) return [];
  return [...new Set(states.map(String).map((state) => state.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function mapRegionRsms(rows: unknown[]): RegionRsms {
  const byRegion: RegionRsms = {};
  for (const value of rows) {
    const row = value as Record<string, unknown>;
    if (String(row.role || "").toUpperCase() !== "RSM") continue;
    const region = String(row.salesRegion || row.sales_region || "").toUpperCase() as SalesRegionOptionValue;
    if (!SALES_REGION_OPTIONS.some((option) => option.value === region)) continue;
    byRegion[region] = {
      id: String(row.id || row.staff_id || ""),
      name: String(row.name || row.staff_name || ""),
      email: String(row.email || row.staff_email || ""),
      assignedStates: sortedStates(row.assignedStates ?? row.assigned_states),
    };
  }
  return byRegion;
}

function statesOf(rsms: RegionRsms) {
  return SALES_REGION_OPTIONS.reduce<Record<string, string[]>>((acc, region) => {
    acc[region.value] = rsms[region.value]?.assignedStates ?? [];
    return acc;
  }, {});
}

export default function ManageRegionsPage() {
  const [rsms, setRsms] = useState<RegionRsms>({});
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openRegion, setOpenRegion] = useState<SalesRegionOptionValue | null>(null);
  const [placeSearch, setPlaceSearch] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const savedAssignments = useMemo(() => statesOf(rsms), [rsms]);

  const filteredPlaceOptions = useMemo(() => {
    const query = placeSearch.trim().toLowerCase();
    if (!query) return STATE_OPTIONS;
    return STATE_OPTIONS.filter((place) => place.toLowerCase().includes(query));
  }, [placeSearch]);

  const changedRegions = SALES_REGION_OPTIONS
    .map((region) => region.value)
    .filter((region) => rsms[region] && JSON.stringify(assignments[region] ?? []) !== JSON.stringify(savedAssignments[region] ?? []));

  useEffect(() => {
    let cancelled = false;
    fetch(`${ADMIN_STAFF_URL}?page=1&limit=200`, { credentials: "include" })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const next = mapRegionRsms(json?.data || []);
        setRsms(next);
        setAssignments(statesOf(next));
      })
      .catch(() => { if (!cancelled) setSaveMessage("Could not load RSMs."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!openRegion) return;
    const close = (event: MouseEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node)) setOpenRegion(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [openRegion]);

  const togglePlace = (region: SalesRegionOptionValue, place: string) => {
    setAssignments((current) => {
      const selected = current[region] ?? [];
      return {
        ...current,
        [region]: selected.includes(place) ? selected.filter((entry) => entry !== place) : [...selected, place].sort((a, b) => a.localeCompare(b)),
      };
    });
    setSaveMessage("");
  };

  const clearRegion = (region: SalesRegionOptionValue) => {
    setAssignments((current) => ({ ...current, [region]: [] }));
    setSaveMessage("");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const region of changedRegions) {
        const rsm = rsms[region];
        if (!rsm) continue;
        const assignedStates = assignments[region] ?? [];
        const response = await fetch(`${ADMIN_STAFF_URL}/${encodeURIComponent(rsm.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ assignedStates }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.success === false) throw new Error(payload?.message || `Could not update ${rsm.name}`);
        setRsms((current) => ({ ...current, [region]: { ...rsm, assignedStates: sortedStates(assignedStates) } }));
      }
      setSaveMessage("Region assignments saved to their RSMs.");
      window.setTimeout(() => setSaveMessage(""), 2500);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Could not save region assignments.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f4f6fa] px-6 py-7 text-[#1f2937]">
      <div className="admin-page-shell">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Manage Regions</h1>
            <p className="mt-1 text-sm text-[#667085]">Each region has one RSM. The states you pick here are that RSM&apos;s allotted states.</p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <button type="button" onClick={handleSave} disabled={!changedRegions.length || saving} className="rounded bg-[#4f6eed] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3f5dd8] disabled:cursor-not-allowed disabled:bg-[#b9c4f8]">
              {saving ? "Saving..." : "Save"}
            </button>
            <p className="min-h-4 text-xs text-[#667085]">
              {saveMessage || (loading ? "Loading RSMs..." : changedRegions.length ? `Unsaved changes in ${changedRegions.length} region(s)` : "All changes saved")}
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {SALES_REGION_OPTIONS.map((region) => {
            const rsm = rsms[region.value];
            const selected = assignments[region.value] ?? [];
            const isOpen = openRegion === region.value;
            return (
              <section key={region.value} className="rounded border border-[#dfe3ec] bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">{region.label}</h2>
                    <p className="mt-1 text-xs text-[#667085]">
                      {rsm ? `${rsm.name} · ${selected.length} selected` : "No RSM assigned yet"}
                    </p>
                  </div>
                  <button type="button" onClick={() => clearRegion(region.value)} disabled={!rsm} className="rounded border border-[#d0d5dd] px-3 py-1.5 text-xs font-medium text-[#475467] hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-50">
                    Clear
                  </button>
                </div>

                <div className="relative mt-4" ref={isOpen ? dropdownRef : null}>
                  <button
                    type="button"
                    disabled={!rsm}
                    onClick={() => {
                      setOpenRegion(isOpen ? null : region.value);
                      setPlaceSearch("");
                    }}
                    className="flex h-10 w-full items-center justify-between rounded border border-[#d0d5dd] bg-white px-3 text-left text-sm text-[#344054] focus:border-[#5d7df0] focus:outline-none focus:ring-2 focus:ring-[#dfe6ff] disabled:cursor-not-allowed disabled:bg-[#f8fafc] disabled:text-[#98a2b3]"
                  >
                    <span>{rsm ? (selected.length ? `${selected.length} places selected` : "Select states / UTs") : "Create an RSM for this region first"}</span>
                    <span className="text-xs text-[#667085]">{rsm ? (isOpen ? "Close" : "Open") : ""}</span>
                  </button>

                  {isOpen ? (
                    <div className="absolute left-0 right-0 z-20 mt-2 rounded border border-[#cbd5e1] bg-white shadow-xl">
                      <div className="border-b border-[#eaecf0] p-2">
                        <input
                          type="search"
                          value={placeSearch}
                          onChange={(event) => setPlaceSearch(event.target.value)}
                          placeholder="Search states / UTs"
                          className="h-9 w-full rounded border border-[#d0d5dd] px-3 text-sm text-[#344054] placeholder:text-[#98a2b3] focus:border-[#5d7df0] focus:outline-none focus:ring-2 focus:ring-[#dfe6ff]"
                        />
                      </div>
                      <div className="max-h-64 overflow-y-auto py-1">
                        {filteredPlaceOptions.map((place) => (
                          <label key={place} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-[#f8fafc]">
                            <input type="checkbox" checked={selected.includes(place)} onChange={() => togglePlace(region.value, place)} className="h-4 w-4 accent-[#4f6eed]" />
                            <span>{place}</span>
                          </label>
                        ))}
                        {!filteredPlaceOptions.length ? <p className="px-3 py-3 text-sm text-[#98a2b3]">No places found.</p> : null}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 min-h-16 rounded border border-[#eaecf0] bg-[#f9fafb] p-2">
                  {selected.length ? (
                    <div className="flex flex-wrap gap-2">
                      {selected.map((place) => (
                        <span key={place} className="rounded border border-[#bfd7ff] bg-[#eff6ff] px-2 py-1 text-xs text-[#24537f]">{place}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[#98a2b3]">No states or union territories assigned.</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
