/* Region-first "Reports to" for the Add/Edit Staff forms.
   A Sales Manager reports to an ASM (its RSM follows) or straight to the RSM;
   an ASM reports to its region's RSM. One RSM per region. In a region with no
   RSM yet, ASMs and Sales Managers float there (carrying their own region) and
   take their territory from the region's state list. */

export type HierarchyStaff = {
  id: string;
  role: string;
  staffRoleType: string;
  salesRegion: string;
  parentRsmId?: string;
  assignedStates: string[];
  status?: string;
};

const isActive = (staff: HierarchyStaff) => !staff.status || staff.status.toUpperCase() === "ACTIVE";
const isRsm = (staff: HierarchyStaff) => staff.role === "RSM";
const isAsm = (staff: HierarchyStaff) => staff.role === "ASM" || staff.staffRoleType === "ASM";

export function regionRsm<T extends HierarchyStaff>(staff: T[], region: string): T | null {
  return region ? staff.find((entry) => isRsm(entry) && isActive(entry) && entry.salesRegion === region) ?? null : null;
}

// A person's own region (RSMs, and floating ASMs / Sales Managers), else their RSM's.
export function regionOfStaff(staff: HierarchyStaff[], id: string) {
  const person = staff.find((entry) => entry.id === id);
  if (!person) return "";
  if (person.salesRegion) return person.salesRegion;
  return staff.find((entry) => entry.id === person.parentRsmId)?.salesRegion ?? "";
}

// Who a Sales Manager can report to in a region, lowest role first.
export function reportsToGroups<T extends HierarchyStaff>(staff: T[], region: string): Array<{ label: string; staff: T[] }> {
  if (!region) return [];
  const rsm = regionRsm(staff, region);
  return [
    { label: "ASM", staff: staff.filter((entry) => isAsm(entry) && isActive(entry) && regionOfStaff(staff, entry.id) === region) },
    { label: "RSM", staff: rsm ? [rsm] : [] },
  ].filter((group) => group.staff.length > 0);
}

export function pickReportsTo(staff: HierarchyStaff[], id: string) {
  const person = staff.find((entry) => entry.id === id);
  if (!person) return { parentAsmId: "", parentRsmId: "" };
  return isRsm(person)
    ? { parentAsmId: "", parentRsmId: person.id }
    : { parentAsmId: person.id, parentRsmId: person.parentRsmId ?? "" };
}

// A Sales Manager's cities come from whoever they report to, or the region's
// states when they float in a region with no ASM or RSM.
export function cityScopeStates(staff: HierarchyStaff[], parentAsmId: string, parentRsmId: string, regionStates: string[] = []) {
  const parent = staff.find((entry) => entry.id === (parentAsmId || parentRsmId));
  return parent ? parent.assignedStates : regionStates;
}
