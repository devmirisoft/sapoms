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
  paymentType: "advance" | "credit";
};

export type DealerFormSnapshot = DealerFormValues & {
  assignedStaffIds: string[];
  staffNames: string;
  rsmUserId?: string;
};

export const emptyDealerForm: DealerFormValues = {
  name: "",
  email: "",
  whatsapp: "",
  priorityPerson: "primary",
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
  paymentType: "credit",
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
    paymentType: source.paymentType === "advance" ? "advance" : "credit",
    assignedStaffIds: normalizeStaffIds(source.assignedStaffIds),
    staffNames: cleanText(source.staffNames),
    rsmUserId: cleanText(source.rsmUserId),
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
    { key: "discount", label: "Discount %" },
    { key: "annualTarget", label: "Annual target" },
    { key: "currentLimit", label: "Current limit" },
  ];

  for (const field of requiredFields) {
    if (!cleanText(snapshot[field.key])) {
      return `${field.label} is required`;
    }
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
    if (!cleanText(snapshot.secondaryContactEmail)) return "Second contact email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(snapshot.secondaryContactEmail)) {
      return "Enter a valid second contact email address";
    }
  }

  for (const [index, contact] of snapshot.additionalContacts.entries()) {
    const position = index + 3;
    if (!contact.name) return `Contact ${position} name is required`;
    if (!contact.phone) return `Contact ${position} phone is required`;
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
    name: snapshot.name,
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
): DealerFormSnapshot {
  return normalizeDealerFormSnapshot({
    ...values,
    assignedStaffIds,
    staffNames,
    rsmUserId,
  });
}
