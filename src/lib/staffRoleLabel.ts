// Single source of truth for turning a staff member's authoritative role
// (User.role) plus their StaffProfile.staffRoleType into a human label.
//
// The two fields overlap on purpose: RSM/ASM/NSM are real AuthRoles, while the
// STAFF role is subdivided by staffRoleType ("2" = Sales Manager, "1" = Staff /
// Executive). Callers that only have one of the two still get a sensible label.

export type StaffRoleKey = "NSM" | "RSM" | "ASM" | "SALES_MANAGER" | "STAFF" | "UNKNOWN";

export type StaffRoleSource = {
  role?: string | null;
  staffRoleType?: string | number | null;
  salesRegion?: string | null;
};

const ROLE_LABELS: Record<StaffRoleKey, string> = {
  NSM: "NSM",
  RSM: "RSM",
  ASM: "ASM",
  SALES_MANAGER: "Sales Manager",
  STAFF: "Staff",
  UNKNOWN: "Staff",
};

// Tailwind classes mirror the admin staff list badges so the same role reads
// the same colour wherever it is rendered.
const ROLE_BADGES: Record<StaffRoleKey, { bg: string; text: string }> = {
  NSM: { bg: "bg-emerald-50", text: "text-emerald-700" },
  RSM: { bg: "bg-sky-50", text: "text-sky-700" },
  ASM: { bg: "bg-cyan-50", text: "text-cyan-700" },
  SALES_MANAGER: { bg: "bg-violet-50", text: "text-violet-700" },
  STAFF: { bg: "bg-indigo-50", text: "text-indigo-700" },
  UNKNOWN: { bg: "bg-gray-100", text: "text-gray-500" },
};

export function formatSalesRegion(value?: string | null) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return "";
  return normalized.charAt(0) + normalized.slice(1).toLowerCase();
}

export function resolveStaffRoleKey(source: StaffRoleSource): StaffRoleKey {
  const role = String(source.role ?? "").trim().toUpperCase();
  const roleType = String(source.staffRoleType ?? "").trim().toUpperCase();

  if (role === "NSM" || roleType === "NSM") return "NSM";
  if (role === "RSM" || roleType === "RSM") return "RSM";
  if (role === "ASM" || roleType === "ASM") return "ASM";
  if (roleType === "2") return "SALES_MANAGER";
  if (roleType === "1" || roleType === "EXECUTIVE" || roleType === "STAFF") return "STAFF";
  return role === "STAFF" ? "STAFF" : "UNKNOWN";
}

export function staffRoleLabel(source: StaffRoleSource): string {
  return ROLE_LABELS[resolveStaffRoleKey(source)];
}

export function staffRoleBadge(source: StaffRoleSource) {
  const key = resolveStaffRoleKey(source);
  // Region only qualifies an RSM — an ASM's region is implied by its parent.
  const region = key === "RSM" ? formatSalesRegion(source.salesRegion) : "";
  return { key, ...ROLE_BADGES[key], label: region ? `${region} ${ROLE_LABELS[key]}` : ROLE_LABELS[key] };
}
