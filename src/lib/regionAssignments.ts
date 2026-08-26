import { SALES_REGION_OPTIONS, type SalesRegionOptionValue } from "@/lib/salesRegions";

export type RegionAssignments = Record<SalesRegionOptionValue, string[]>;

export const REGION_ASSIGNMENTS_STORAGE_KEY = "sapoms-region-state-assignments";

export function emptyRegionAssignments(): RegionAssignments {
  return SALES_REGION_OPTIONS.reduce((acc, region) => {
    acc[region.value] = [];
    return acc;
  }, {} as RegionAssignments);
}

function cleanStates(states: unknown): string[] {
  if (!Array.isArray(states)) return [];
  return [...new Set(states.map(String).map((state) => state.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function normalizeRegionAssignments(value: unknown): RegionAssignments {
  const parsed = value as Partial<Record<SalesRegionOptionValue, unknown>> | null | undefined;
  const next = emptyRegionAssignments();
  for (const region of SALES_REGION_OPTIONS) next[region.value] = cleanStates(parsed?.[region.value]);
  return next;
}

export function loadRegionAssignments(): RegionAssignments {
  if (typeof window === "undefined") return emptyRegionAssignments();
  try {
    return normalizeRegionAssignments(JSON.parse(window.localStorage.getItem(REGION_ASSIGNMENTS_STORAGE_KEY) || "{}"));
  } catch {
    return emptyRegionAssignments();
  }
}

export function saveRegionAssignments(assignments: RegionAssignments) {
  window.localStorage.setItem(REGION_ASSIGNMENTS_STORAGE_KEY, JSON.stringify(normalizeRegionAssignments(assignments)));
}

export function mergeRegionAssignment(region: string, states: string[]) {
  if (!SALES_REGION_OPTIONS.some((option) => option.value === region)) return;
  const assignments = loadRegionAssignments();
  const regionKey = region as SalesRegionOptionValue;
  assignments[regionKey] = cleanStates([...(assignments[regionKey] ?? []), ...states]);
  saveRegionAssignments(assignments);
}
