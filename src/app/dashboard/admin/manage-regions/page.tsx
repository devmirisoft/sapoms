"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import places from "@/../public/data/places.json";
import { SALES_REGION_OPTIONS, type SalesRegionOptionValue } from "@/lib/salesRegions";
import { emptyRegionAssignments, loadRegionAssignments, saveRegionAssignments, type RegionAssignments } from "@/lib/regionAssignments";

type PlacesData = {
  states?: { name: string; cities: string[] }[];
  union_territories?: { name: string; cities: string[] }[];
};

export default function ManageRegionsPage() {
  const [assignments, setAssignments] = useState<RegionAssignments>(() => loadRegionAssignments());
  const [savedAssignments, setSavedAssignments] = useState<RegionAssignments>(() => loadRegionAssignments());
  const [openRegion, setOpenRegion] = useState<SalesRegionOptionValue | null>(null);
  const [placeSearch, setPlaceSearch] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const placeOptions = useMemo(() => {
    const data = places as PlacesData;
    return [...(data.states ?? []), ...(data.union_territories ?? [])].map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  }, []);

  const filteredPlaceOptions = useMemo(() => {
    const query = placeSearch.trim().toLowerCase();
    if (!query) return placeOptions;
    return placeOptions.filter((place) => place.toLowerCase().includes(query));
  }, [placeOptions, placeSearch]);

  const hasUnsavedChanges = JSON.stringify(assignments) !== JSON.stringify(savedAssignments);


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
    setAssignments((current) => ({ ...current, [region]: emptyRegionAssignments()[region] }));
    setSaveMessage("");
  };

  const handleSave = () => {
    saveRegionAssignments(assignments);
    setSavedAssignments(assignments);
    setSaveMessage("Region assignments saved.");
    window.setTimeout(() => setSaveMessage(""), 2500);
  };

  return (
    <main className="min-h-screen bg-[#f4f6fa] px-6 py-7 text-[#1f2937]">
      <div className="admin-page-shell">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Manage Regions</h1>
            <p className="mt-1 text-sm text-[#667085]">Assign states and union territories to the regions used for RSM creation.</p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <button type="button" onClick={handleSave} disabled={!hasUnsavedChanges} className="rounded bg-[#4f6eed] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3f5dd8] disabled:cursor-not-allowed disabled:bg-[#b9c4f8]">
              Save
            </button>
            <p className="min-h-4 text-xs text-[#667085]">{saveMessage || (hasUnsavedChanges ? "Unsaved changes" : "All changes saved")}</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {SALES_REGION_OPTIONS.map((region) => {
            const selected = assignments[region.value] ?? [];
            const isOpen = openRegion === region.value;
            return (
              <section key={region.value} className="rounded border border-[#dfe3ec] bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">{region.label}</h2>
                    <p className="mt-1 text-xs text-[#667085]">{selected.length} selected</p>
                  </div>
                  <button type="button" onClick={() => clearRegion(region.value)} className="rounded border border-[#d0d5dd] px-3 py-1.5 text-xs font-medium text-[#475467] hover:bg-[#f8fafc]">
                    Clear
                  </button>
                </div>

                <div className="relative mt-4" ref={isOpen ? dropdownRef : null}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenRegion(isOpen ? null : region.value);
                      setPlaceSearch("");
                    }}
                    className="flex h-10 w-full items-center justify-between rounded border border-[#d0d5dd] bg-white px-3 text-left text-sm text-[#344054] focus:border-[#5d7df0] focus:outline-none focus:ring-2 focus:ring-[#dfe6ff]"
                  >
                    <span>{selected.length ? `${selected.length} places selected` : "Select states / UTs"}</span>
                    <span className="text-xs text-[#667085]">{isOpen ? "Close" : "Open"}</span>
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