export const WAREHOUSE_OPTIONS = [
  { value: "AHMEDABAD", label: "Ahmedabad" },
  { value: "AMBALA", label: "Ambala" },
] as const;

export type WarehouseValue = typeof WAREHOUSE_OPTIONS[number]["value"];

export function formatWarehouseLabel(value?: string | null) {
  return WAREHOUSE_OPTIONS.find((entry) => entry.value === value)?.label ?? "";
}
