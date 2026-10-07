import { PHONE_ERROR, isValidPhone } from "@/lib/fieldRules";

export type StaffMember = {
  staff_id: string;
  id?: string;
  userId?: string;
  staff_name: string;
  staff_roletype: string | number;
  role?: string;
  status?: string;
  location?: string;
  staff_location?: string;
  salesRegion?: string;
  sales_region?: string;
  parentRsmId?: string;
  parentAsmId?: string;
  parent_rsm_id?: string;
  parent_asm_id?: string;
  warehouse?: string;
  assignedCities?: string[];
  rsmUserId?: string;
  rsmId?: string;
  asmId?: string;
};

export type DealerContact = {
  name: string;
  phone: string;
  email: string;
};

export type DealerFormValues = {
  name: string;
  email: string;
  whatsapp: string;
  priorityPerson: "primary" | "secondary";
  contactName: string;
  secondaryContactName: string;
  secondaryContactPhone: string;
  secondaryContactEmail: string;
  additionalContacts: DealerContact[];
  city: string;
  state: string;
  address: string;
  pincode: string;
  dealerCode: string;
  username: string;
  password: string;
  gstNo: string;
  discount: string;
  creditDays: string;
  annualTarget: string;
  currentLimit: string;
  notes: string;
  paymentType: "" | "advance" | "credit";
};

export type DealerFormSnapshot = DealerFormValues & {
  assignedStaffIds: string[];
  staffNames: string;
  rsmUserId?: string;
  // Sales region picked on the form. Kept for a region with no active RSM, where
  // the region cannot be derived from rsmUserId on the server.
  region?: string;
};

export const emptyDealerForm: DealerFormValues = {
  name: "",
  email: "",
  whatsapp: "",
  priorityPerson: "primary",
  contactName: "",
  secondaryContactName: "",
  secondaryContactPhone: "",
  secondaryContactEmail: "",
  additionalContacts: [],
  city: "",
  state: "",
  address: "",
  pincode: "",
  dealerCode: "",
  username: "",
  password: "",
  gstNo: "",
  discount: "",
  creditDays: "",
  annualTarget: "",
  currentLimit: "",
  notes: "",
  paymentType: "",
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStaffIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => normalizeStaffIds(entry))
      .filter(Boolean);
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

export function getAssignedStaffNames(selectedStaff: string[], staffList: StaffMember[]) {
  return selectedStaff
    .map((staffId) => staffList.find((staff) => String(staff.staff_id) === String(staffId))?.staff_name ?? "")
    .filter(Boolean)
    .join(",");
}

export function normalizeDealerContacts(value: unknown): DealerContact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const source = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
      return {
        name: cleanText(source.name),
        phone: cleanText(source.phone),
        email: cleanText(source.email),
      };
    })
    .filter((contact) => contact.name || contact.phone || contact.email);
}

export function normalizeDealerFormSnapshot(value: unknown): DealerFormSnapshot {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};

  return {
    name: cleanText(source.name),
    email: cleanText(source.email),
    whatsapp: cleanText(source.whatsapp),
    // `contactPerson` is the legacy key kept for snapshots stored before the rename to `priorityPerson`.
    priorityPerson: cleanText(source.priorityPerson ?? source.contactPerson) === "secondary" ? "secondary" : "primary",
    contactName: cleanText(source.contactName),
    secondaryContactName: cleanText(source.secondaryContactName),
    secondaryContactPhone: cleanText(source.secondaryContactPhone),
    secondaryContactEmail: cleanText(source.secondaryContactEmail),
    additionalContacts: normalizeDealerContacts(source.additionalContacts),
    city: cleanText(source.city),
    state: cleanText(source.state),
    address: cleanText(source.address),
    pincode: cleanText(source.pincode),
    dealerCode: cleanText(source.dealerCode),
    username: cleanText(source.username),
    password: cleanText(source.password),
    gstNo: cleanText(source.gstNo),
    discount: cleanText(source.discount),
    creditDays: cleanText(source.creditDays),
    annualTarget: cleanText(source.annualTarget),
    currentLimit: cleanText(source.currentLimit),
    notes: cleanText(source.notes),
    paymentType: source.paymentType === "advance" || source.paymentType === "credit" ? source.paymentType : "",
    assignedStaffIds: normalizeStaffIds(source.assignedStaffIds),
    staffNames: cleanText(source.staffNames),
    rsmUserId: cleanText(source.rsmUserId),
    region: cleanText(source.region),
  };
}

export function validateDealerFormSnapshot(snapshot: DealerFormSnapshot): string | null {
  const requiredFields: Array<{ key: keyof DealerFormSnapshot; label: string }> = [
    { key: "name", label: "Name" },
    { key: "email", label: "Email address" },
    { key: "whatsapp", label: "WhatsApp number" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "address", label: "Bill-to address" },
    { key: "pincode", label: "Pin code" },
    { key: "dealerCode", label: "Dealer code" },
    { key: "username", label: "Username" },
    { key: "password", label: "Password" },
    { key: "gstNo", label: "GST number" },
    { key: "paymentType", label: "Payment type" },
    { key: "discount", label: "Discount %" },
    { key: "annualTarget", label: "Annual target" },
    { key: "currentLimit", label: "Current limit" },
  ];

  for (const field of requiredFields) {
    if (!cleanText(snapshot[field.key])) {
      return `${field.label} is required`;
    }
  }

  if (!isValidPhone(snapshot.whatsapp)) return `WhatsApp number: ${PHONE_ERROR}`;

  const discount = Number(snapshot.discount);
  if (!(discount >= 0 && discount <= 100)) return "Discount % must be between 0 and 100";

  if (cleanText(snapshot.gstNo).length !== 15) {
    return "GST number must be 15 characters";
  }

  // Advance dealers pay upfront, so credit days do not apply to them.
  if (snapshot.paymentType !== "advance" && !cleanText(snapshot.creditDays)) {
    return "Credit days is required";
  }

  if (!snapshot.assignedStaffIds.length) {
    return "Please assign at least one staff member";
  }

  if (!/^\d{4}$/.test(cleanText(snapshot.dealerCode))) {
    return "Dealer code must be a unique 4-digit number";
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(snapshot.email)) {
    return "Enter a valid email address";
  }

  const hasSecondaryContact = Boolean(cleanText(snapshot.secondaryContactName) || cleanText(snapshot.secondaryContactPhone) || cleanText(snapshot.secondaryContactEmail));
  if (snapshot.priorityPerson === "secondary" || hasSecondaryContact) {
    if (!cleanText(snapshot.secondaryContactName)) return "Second contact name is required";
    if (!cleanText(snapshot.secondaryContactPhone)) return "Second contact phone is required";
    if (!isValidPhone(snapshot.secondaryContactPhone)) return `Second contact phone: ${PHONE_ERROR}`;
    if (!cleanText(snapshot.secondaryContactEmail)) return "Second contact email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(snapshot.secondaryContactEmail)) {
      return "Enter a valid second contact email address";
    }
  }

  for (const [index, contact] of snapshot.additionalContacts.entries()) {
    const position = index + 3;
    if (!contact.name) return `Contact ${position} name is required`;
    if (!contact.phone) return `Contact ${position} phone is required`;
    if (!isValidPhone(contact.phone)) return `Contact ${position} phone: ${PHONE_ERROR}`;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) return `Enter a valid contact ${position} email address`;
  }

  return null;
}

export function getSelectedDealerContact(snapshot: DealerFormSnapshot) {
  if (snapshot.priorityPerson === "secondary") {
    return {
      name: snapshot.secondaryContactName,
      email: snapshot.secondaryContactEmail,
      phone: snapshot.secondaryContactPhone,
    };
  }

  return {
    name: snapshot.contactName || snapshot.name,
    email: snapshot.email,
    phone: snapshot.whatsapp,
  };
}

export const PRIORITY_PERSON_LABELS = {
  primary: "Contact 1",
  secondary: "Contact 2",
} as const;

export function getPriorityPersonLabel(priorityPerson: "primary" | "secondary") {
  return PRIORITY_PERSON_LABELS[priorityPerson] ?? PRIORITY_PERSON_LABELS.primary;
}

export function buildDealerPhpFormData(snapshot: DealerFormSnapshot): FormData {
  const formData = new FormData();

  formData.append("Dealer_Name", snapshot.name);
  formData.append("Dealer_Email", snapshot.email);
  formData.append("Dealer_Number", snapshot.whatsapp);
  formData.append("Dealer_Contact_Person", snapshot.priorityPerson);
  formData.append("Dealer_Contact_Name", snapshot.contactName);
  formData.append("Dealer_Secondary_Contact_Name", snapshot.secondaryContactName);
  formData.append("Dealer_Secondary_Contact_Phone", snapshot.secondaryContactPhone);
  formData.append("Dealer_Secondary_Contact_Email", snapshot.secondaryContactEmail);
  formData.append("Dealer_City", snapshot.city);
  formData.append("Dealer_State", snapshot.state);
  formData.append("Dealer_Address", snapshot.address);
  formData.append("Dealer_Pincode", snapshot.pincode);
  formData.append("Dealer_Dealercode", snapshot.dealerCode);
  formData.append("Dealer_Username", snapshot.username);
  formData.append("Dealer_Password", snapshot.password);
  formData.append("gst", snapshot.gstNo);
  formData.append("discount", snapshot.discount);
  formData.append("creditdays", snapshot.creditDays);
  formData.append("annualtarget", snapshot.annualTarget);
  formData.append("currentlimit", snapshot.currentLimit);
  formData.append("Dealer_Notes", snapshot.notes);
  formData.append("assignedstaff", snapshot.assignedStaffIds.join(","));
  formData.append("staffname", snapshot.staffNames);

  return formData;
}

export function toDealerFormSnapshot(
  values: DealerFormValues,
  assignedStaffIds: string[],
  staffNames: string,
  rsmUserId = "",
  region = "",
): DealerFormSnapshot {
  return normalizeDealerFormSnapshot({
    ...values,
    assignedStaffIds,
    staffNames,
    rsmUserId,
    region,
  });
}

/* ---- Staff assignment (shared by Add Dealer and Edit Dealer) ----
   The admin picks a region, then one sales person from it (lowest role first).
   The slots above that person fill from their real parents; a region's RSM is
   always linked so the dealer keeps its region and RSM approval routing. */

export type AssignmentRoleKey = "rsm" | "asm" | "salesManager" | "executive";
export type RoleAssignments = Record<AssignmentRoleKey, string>;
export type SalesRoleKey = Exclude<AssignmentRoleKey, "executive">;
type RoleOptions = Record<AssignmentRoleKey, StaffMember[]>;

export const EMPTY_ROLE_ASSIGNMENTS: RoleAssignments = { rsm: "", asm: "", salesManager: "", executive: "" };

// Lowest role first: the dropdown lists people in this order.
export const SALES_ROLE_GROUPS: Array<{ key: SalesRoleKey; label: string }> = [
  { key: "salesManager", label: "Sales Manager" },
  { key: "asm", label: "ASM" },
  { key: "rsm", label: "RSM" },
];

export function uniqueStaffIds(ids: string[]) {
  return Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)));
}

export function normalizeStaffRole(staff: StaffMember): AssignmentRoleKey | null {
  const role = String(staff.role ?? "").toUpperCase();
  const roleType = String((staff as StaffMember & { staffRoleType?: string | number }).staffRoleType ?? staff.staff_roletype ?? "").toUpperCase();

  if (role === "RSM") return "rsm";
  if (role === "ASM") return "asm";
  if (role === "STAFF" && (roleType === "1" || roleType === "EXECUTIVE")) return "salesManager";
  if (role === "STAFF" && (roleType === "2" || roleType === "STAFF")) return "executive";

  return null;
}

export function buildRoleOptions(staffList: StaffMember[]): RoleOptions {
  return staffList.reduce<RoleOptions>((groups, staff) => {
    const roleKey = normalizeStaffRole(staff);
    if (roleKey) groups[roleKey].push(staff);
    return groups;
  }, { rsm: [], asm: [], salesManager: [], executive: [] });
}

export function getStaffUserId(staffId: string, staffList: StaffMember[]) {
  const staff = staffList.find((entry) => String(entry.staff_id) === String(staffId));
  return String(staff?.userId ?? staff?.id ?? "").trim();
}

export function findStaffByAnyId(id: string, staffList: StaffMember[]) {
  const normalized = String(id ?? "").trim();
  if (!normalized) return null;
  return staffList.find((staff) => [staff.staff_id, staff.id, staff.userId].some((value) => String(value ?? "").trim() === normalized)) ?? null;
}

const parentRsmOf = (staff: StaffMember | null) => String(staff?.parentRsmId ?? staff?.parent_rsm_id ?? "");
const parentAsmOf = (staff: StaffMember | null) => String(staff?.parentAsmId ?? staff?.parent_asm_id ?? "");

// Only RSMs carry a region; ASMs and Sales Managers take their RSM's.
export function getStaffRegion(staff: StaffMember | null, staffList: StaffMember[]) {
  const own = String(staff?.sales_region ?? staff?.salesRegion ?? "").trim();
  if (own || !staff) return own;
  const rsm = findStaffByAnyId(parentRsmOf(staff), staffList);
  return String(rsm?.sales_region ?? rsm?.salesRegion ?? "").trim();
}

export function regionRsmId(roleOptions: RoleOptions, staffList: StaffMember[], region: string) {
  const rsm = region ? roleOptions.rsm.find((staff) => getStaffRegion(staff, staffList) === region) : null;
  return rsm ? String(rsm.staff_id) : "";
}

export function buildRegionSalesOptions(roleOptions: RoleOptions, staffList: StaffMember[], region: string) {
  if (!region) return [];
  return SALES_ROLE_GROUPS
    .map((group) => ({ ...group, staff: roleOptions[group.key].filter((staff) => getStaffRegion(staff, staffList) === region) }))
    .filter((group) => group.staff.length > 0);
}

// A new region resets the sales chain to just that region's RSM (if any).
export function selectRegion(prev: RoleAssignments, roleOptions: RoleOptions, staffList: StaffMember[], region: string): RoleAssignments {
  return { ...EMPTY_ROLE_ASSIGNMENTS, executive: prev.executive, rsm: regionRsmId(roleOptions, staffList, region) };
}

// Picking a sales person fills their slot and the real parents above them.
export function selectSalesPerson(prev: RoleAssignments, roleOptions: RoleOptions, staffList: StaffMember[], region: string, staffId: string): RoleAssignments {
  const next = selectRegion(prev, roleOptions, staffList, region);
  const staff = findStaffByAnyId(staffId, staffList);
  const roleKey = staff ? normalizeStaffRole(staff) : null;
  if (!staff || !roleKey || roleKey === "executive") return next;

  next[roleKey] = String(staff.staff_id);
  if (roleKey === "salesManager") {
    const asm = findStaffByAnyId(parentAsmOf(staff), roleOptions.asm);
    if (asm) next.asm = String(asm.staff_id);
  }
  if (roleKey !== "rsm") {
    const rsm = findStaffByAnyId(parentRsmOf(staff), roleOptions.rsm);
    if (rsm) next.rsm = String(rsm.staff_id);
  }
  return next;
}

// The single dropdown shows the lowest filled sales slot as selected.
export function lowestSalesPerson(assignments: RoleAssignments) {
  return assignments.salesManager || assignments.asm || assignments.rsm;
}

export function regionFromAssignments(assignments: RoleAssignments, staffList: StaffMember[]) {
  for (const key of ["rsm", "asm", "salesManager"] as const) {
    const region = getStaffRegion(findStaffByAnyId(assignments[key], staffList), staffList);
    if (region) return region;
  }
  return "";
}

export function buildRoleAssignmentsFromIds(ids: string[], staffList: StaffMember[]): RoleAssignments {
  const next = { ...EMPTY_ROLE_ASSIGNMENTS };
  const staffById = new Map(staffList.map((staff) => [String(staff.staff_id), staff]));

  uniqueStaffIds(ids).forEach((staffId) => {
    const staff = staffById.get(staffId);
    const roleKey = staff ? normalizeStaffRole(staff) : null;
    if (roleKey && !next[roleKey]) next[roleKey] = staffId;
  });

  return next;
}
