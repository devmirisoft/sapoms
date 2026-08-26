import placesData from "@/../public/data/places.json";

export type PlaceRegion = { name: string; cities?: string[] };
type PlacesData = { states?: PlaceRegion[]; union_territories?: PlaceRegion[] };

const data = placesData as PlacesData;

/** States and union territories as one flat list — the app treats both the same way. */
export const PLACE_REGIONS: PlaceRegion[] = [...(data.states ?? []), ...(data.union_territories ?? [])];

export const STATE_OPTIONS: string[] = PLACE_REGIONS
  .map((region) => region.name)
  .sort((a, b) => a.localeCompare(b));

export const CITIES_BY_STATE: Record<string, string[]> = PLACE_REGIONS.reduce<Record<string, string[]>>((map, region) => {
  map[region.name] = [...(region.cities ?? [])].sort((a, b) => a.localeCompare(b));
  return map;
}, {});

// A city name can repeat across states, so the reverse index holds every state
// that lists it and callers narrow with the scope they already have.
const STATES_BY_CITY: Map<string, string[]> = PLACE_REGIONS.reduce((map, region) => {
  (region.cities ?? []).forEach((city) => {
    const key = city.trim().toLowerCase();
    map.set(key, [...(map.get(key) ?? []), region.name]);
  });
  return map;
}, new Map<string, string[]>());

/** Every city belonging to any of `states`, de-duplicated and sorted. */
export function citiesForStates(states: string[]): string[] {
  return [...new Set(states.flatMap((state) => CITIES_BY_STATE[state] ?? []))].sort((a, b) => a.localeCompare(b));
}

/**
 * The states covered by `cities`, restricted to `withinStates` when given.
 *
 * Used to derive a Sales Manager's `assignedStates` from the cities picked out
 * of its ASM's territory: the ASM's own states are the scope, so a city name
 * shared with another state cannot pull that state into the SM's scope.
 */
export function statesForCities(cities: string[], withinStates?: string[]): string[] {
  const scope = withinStates?.length ? new Set(withinStates.map((state) => state.toLowerCase())) : null;
  const matched = new Set<string>();
  cities.forEach((city) => {
    (STATES_BY_CITY.get(city.trim().toLowerCase()) ?? []).forEach((state) => {
      if (!scope || scope.has(state.toLowerCase())) matched.add(state);
    });
  });
  return [...matched].sort((a, b) => a.localeCompare(b));
}
