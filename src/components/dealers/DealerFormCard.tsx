"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import {
  emptyDealerForm,
  getAssignedStaffNames,
  normalizeDealerFormSnapshot,
  toDealerFormSnapshot,
  validateDealerFormSnapshot,
  type DealerContact,
  type DealerFormSnapshot,
  type DealerFormValues,
  type StaffMember,
} from "@/lib/dealerForm";
import { STATE_OPTIONS } from "@/lib/places";

const ADMIN_STAFF_URL = "/api/admin/staff";
const DEALER_CODE_PREFIX = "OM-";

type DealerFormMode = "admin-create" | "staff-submit" | "admin-review" | "staff-resubmit";
type DealerDetailsTab = "company" | "alternate" | "remarks";
type AssignmentRoleKey = "rsm" | "asm" | "salesManager" | "executive";
type RoleAssignments = Record<AssignmentRoleKey, string>;

const EMPTY_ROLE_ASSIGNMENTS: RoleAssignments = {
  rsm: "",
  asm: "",
  salesManager: "",
  executive: "",
};

async function fetchWithAuthRetry(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, { credentials: "include", cache: "no-store", ...init });
  if (response.status !== 401) return response;

  const refreshed = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
  }).then((res) => res.ok).catch(() => false);

  if (!refreshed) return response;
  return fetch(input, { credentials: "include", cache: "no-store", ...init });
}

type DealerFormContext = {
  mode: DealerFormMode;
  initialSnapshot?: DealerFormSnapshot | null;
  isSubmitting?: boolean;
  onSubmit: (snapshot: DealerFormSnapshot) => Promise<void> | void;
  secondaryAction?: {
    label: string;
    loadingLabel: string;
    onAction: (snapshot: DealerFormSnapshot) => Promise<void> | void;
  };
  isSecondarySubmitting?: boolean;
  onCancel?: () => void;
  requestMeta?: {
    requestReference?: string;
    rejectionReason?: string;
    submittedByName?: string;
    submittedAt?: string;
  };
};

function getModeCopy(mode: DealerFormMode) {
  switch (mode) {
    case "staff-submit":
      return {
        title: "Add Dealer",
        subtitle: "Fill the same dealer details and send this request for admin approval.",
        submitLabel: "Send for Approval",
        submittingLabel: "Sending...",
      };
    case "admin-review":
      return {
        title: "Review Dealer Request",
        subtitle: "Review the submitted values, make corrections if needed, and accept the request to create the real dealer.",
        submitLabel: "Accept Request",
        submittingLabel: "Approving...",
      };
    case "staff-resubmit":
      return {
        title: "Correct Dealer Request",
        subtitle: "Update the rejected request and send it back for approval without creating a duplicate request.",
        submitLabel: "Resubmit for Approval",
        submittingLabel: "Resubmitting...",
      };
    default:
      return {
        title: "Add dealer",
        subtitle: "Create a dealer directly using the existing admin flow.",
        submitLabel: "Submit",
        submittingLabel: "Submitting...",
      };
  }
}

function toFormValues(snapshot?: DealerFormSnapshot | null): DealerFormValues {
  if (!snapshot) return { ...emptyDealerForm };
  return {
    name: snapshot.name,
    email: snapshot.email,
    whatsapp: snapshot.whatsapp,
    priorityPerson: snapshot.priorityPerson,
    secondaryContactName: snapshot.secondaryContactName,
    secondaryContactPhone: snapshot.secondaryContactPhone,
    secondaryContactEmail: snapshot.secondaryContactEmail,
    additionalContacts: snapshot.additionalContacts.map((contact) => ({ ...contact })),
    city: snapshot.city,
    state: snapshot.state,
    address: snapshot.address,
    pincode: snapshot.pincode,
    dealerCode: snapshot.dealerCode,
    username: snapshot.username,
    password: snapshot.password,
    gstNo: snapshot.gstNo,
    discount: snapshot.discount,
    creditDays: snapshot.creditDays,
    annualTarget: snapshot.annualTarget,
    currentLimit: snapshot.currentLimit,
    notes: snapshot.notes,
    paymentType: snapshot.paymentType,
  };
}

export default function DealerFormCard({
  mode,
  initialSnapshot,
  isSubmitting = false,
  onSubmit,
  secondaryAction,
  isSecondarySubmitting = false,
  onCancel,
  requestMeta,
}: DealerFormContext) {
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [staffError, setStaffError] = useState("");
  const [inlineError, setInlineError] = useState("");
  const [formData, setFormData] = useState<DealerFormValues>(() => toFormValues(initialSnapshot));
  const [showPassword, setShowPassword] = useState(false);
  const [roleAssignments, setRoleAssignments] = useState<RoleAssignments>(() => ({ ...EMPTY_ROLE_ASSIGNMENTS }));
  const [activeDetailsTab, setActiveDetailsTab] = useState<DealerDetailsTab>("company");
  const [dealerCodeLoading, setDealerCodeLoading] = useState(false);
  const [dealerCodeError, setDealerCodeError] = useState("");
  const [dealerCodeInitialized, setDealerCodeInitialized] = useState(() => Boolean(initialSnapshot?.dealerCode));

  useEffect(() => {
    let active = true;

    const loadStaffMembers = async () => {
      setStaffLoading(true);
      setStaffError("");
      try {
        const response = await fetchWithAuthRetry(`${ADMIN_STAFF_URL}?page=1&limit=100`);
        if (!response.ok) {
          throw new Error(`Failed to load staff list (${response.status})`);
        }

        const json = await response.json();
        if (!active) return;

        if (Array.isArray(json?.data)) {
          const activeStaff = json.data.filter((staff: StaffMember) => {
            const role = String(staff.role ?? "").toUpperCase();
            const status = String(staff.status ?? "").toUpperCase();
            return ["STAFF", "RSM", "ASM"].includes(role) && (!status || status === "ACTIVE");
          });
          setStaffList(activeStaff);
          setRoleAssignments(buildRoleAssignmentsFromIds(initialSnapshot?.assignedStaffIds ?? [], activeStaff));
          return;
        }

        setStaffList([]);
        setStaffError("Staff list response did not contain an array.");
      } catch (error) {
        if (!active) return;
        setStaffList([]);
        setStaffError(error instanceof Error ? error.message : "Failed to load staff list.");
      } finally {
        if (active) {
          setStaffLoading(false);
        }
      }
    };

    void loadStaffMembers();
    return () => {
      active = false;
    };
  }, [initialSnapshot?.assignedStaffIds]);

  useEffect(() => {
    if (initialSnapshot?.dealerCode) {
      setDealerCodeInitialized(true);
    }
  }, [initialSnapshot?.dealerCode]);


  useEffect(() => {
    const shouldAutoGenerateDealerCode =
      mode === "admin-create" ||
      mode === "staff-submit" ||
      mode === "staff-resubmit" ||
      mode === "admin-review";

    if (!shouldAutoGenerateDealerCode || dealerCodeInitialized || initialSnapshot?.dealerCode) {
      return;
    }

    let active = true;

    const loadDealerCode = async () => {
      setDealerCodeLoading(true);
      setDealerCodeError("");
      try {
        const response = await fetchWithAuthRetry("/api/dealer-code");
        const json = await response.json();

        if (!response.ok || !json?.success || typeof json.dealerCode !== "string") {
          throw new Error(json?.message ?? "Failed to generate dealer code");
        }

        if (!active) return;

        setFormData((prev) => (prev.dealerCode ? prev : { ...prev, dealerCode: json.dealerCode }));
      } catch (error) {
        if (!active) return;
        setDealerCodeError(error instanceof Error ? error.message : "Failed to generate dealer code");
      } finally {
        if (!active) return;
        setDealerCodeLoading(false);
        setDealerCodeInitialized(true);
      }
    };

    void loadDealerCode();
    return () => {
      active = false;
    };
  }, [dealerCodeInitialized, initialSnapshot?.dealerCode, mode]);

  const copy = useMemo(() => getModeCopy(mode), [mode]);

  const handleInputChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = event.target;
    setInlineError("");
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const roleOptions = useMemo(() => buildRoleOptions(staffList), [staffList]);
  const assignedStaffIds = useMemo(() => uniqueStaffIds(Object.values(roleAssignments)), [roleAssignments]);
  const selectedRsmUserId = useMemo(() => getStaffUserId(roleAssignments.rsm, staffList), [roleAssignments.rsm, staffList]);

  const isAdvanceDealer = formData.paymentType === "advance";

  const dealerCodeLocked = mode === "staff-submit" || mode === "staff-resubmit";
  const dealerCodeHint = dealerCodeError
    ? dealerCodeError
    : dealerCodeLoading
      ? "Generating a unique 4-digit dealer code..."
      : dealerCodeLocked
        ? "Generated automatically for staff requests and locked for editing."
        : "Admin can edit this code. The OM- prefix is added automatically.";

  // The stored dealer code stays a bare 4-digit number; "OM-" is a fixed display prefix.
  const handleDealerCodeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const typed = event.target.value.replace(/^(?:OM-?)+/i, "");
    setInlineError("");
    setFormData((prev) => ({ ...prev, dealerCode: typed }));
  };

  const handleAdditionalContactChange = (index: number, field: keyof DealerContact, value: string) => {
    setInlineError("");
    setFormData((prev) => ({
      ...prev,
      additionalContacts: prev.additionalContacts.map((contact, position) => (position === index ? { ...contact, [field]: value } : contact)),
    }));
  };

  const handleAddContact = () => {
    setInlineError("");
    setFormData((prev) => ({ ...prev, additionalContacts: [...prev.additionalContacts, { name: "", phone: "", email: "" }] }));
  };

  const handleRemoveContact = (index: number) => {
    setInlineError("");
    setFormData((prev) => ({ ...prev, additionalContacts: prev.additionalContacts.filter((_, position) => position !== index) }));
  };

  const handleAssignmentChange = (roleKey: AssignmentRoleKey, staffId: string) => {
    setInlineError("");
    setRoleAssignments((prev) => resolveNextRoleAssignments(prev, roleOptions, roleKey, staffId));
  };

  const handlePaymentTermsChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setInlineError("");
    setFormData((prev) => ({ ...prev, creditDays: event.target.value }));
  };

  // Advance dealers pay upfront, so credit days are not applicable to them.
  const handlePaymentTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const paymentType = event.target.value === "advance" ? "advance" : "credit";
    setInlineError("");
    setFormData((prev) => ({
      ...prev,
      paymentType,
      creditDays: paymentType === "advance" ? "" : prev.creditDays,
    }));
  };

  const resetForm = () => {
    const snapshot = normalizeDealerFormSnapshot(initialSnapshot ?? null);
    const nextForm = toFormValues(snapshot);
    if (!initialSnapshot?.dealerCode && formData.dealerCode) {
      nextForm.dealerCode = formData.dealerCode;
    }
    setFormData(nextForm);
    setRoleAssignments(buildRoleAssignmentsFromIds(snapshot.assignedStaffIds, staffList));
    setActiveDetailsTab("company");
    setInlineError("");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const staffNames = getAssignedStaffNames(assignedStaffIds, staffList) || initialSnapshot?.staffNames || "";
    const snapshot = toDealerFormSnapshot(formData, assignedStaffIds, staffNames, selectedRsmUserId);
    const validationError = validateDealerFormSnapshot(snapshot);

    if (validationError) {
      setInlineError(validationError);
      return;
    }

    setInlineError("");
    await onSubmit(snapshot);
  };

  const handleSecondaryAction = async () => {
    if (!secondaryAction) return;
    const staffNames = getAssignedStaffNames(assignedStaffIds, staffList) || initialSnapshot?.staffNames || "";
    const snapshot = toDealerFormSnapshot(formData, assignedStaffIds, staffNames, selectedRsmUserId);
    const validationError = validateDealerFormSnapshot(snapshot);

    if (validationError) {
      setInlineError(validationError);
      return;
    }

    setInlineError("");
    await secondaryAction.onAction(snapshot);
  };

  return (
    <div className="min-h-screen bg-[#f4f6fa] px-4 py-7 text-[#344155]">
      <div className="mx-auto w-full max-w-[1840px] min-w-0">
        <form onSubmit={handleSubmit} className="border border-[#dfe3ec] bg-white shadow-sm">
          <div className="flex items-end border-b-2 border-[#1d4ed8] px-5 pt-4">
            {/* <button
              type="button"
              onClick={resetForm}
              disabled={isSubmitting || isSecondarySubmitting || dealerCodeLoading || Boolean(dealerCodeError)}
              className="mb-2 rounded bg-[#ffc107] px-4 py-2 text-[11px] font-bold text-white shadow-sm transition hover:bg-[#e7ad00] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Reset
            </button> */}
          </div>

          <div className="px-5 pb-5 pt-5">
            {requestMeta?.requestReference ? (
              <div className="mt-4 border border-[#b9c7ee] bg-[#eef4ff] px-4 py-3 text-sm text-[#405064]">
                <span className="font-semibold">Request Ref: {requestMeta.requestReference}</span>
                {requestMeta.submittedByName ? <span className="ml-3">Submitted by {requestMeta.submittedByName}</span> : null}
                {requestMeta.submittedAt ? <span className="ml-3">{new Date(requestMeta.submittedAt).toLocaleString("en-IN")}</span> : null}
              </div>
            ) : null}

            {requestMeta?.rejectionReason ? (
              <div className="mt-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <span className="font-semibold">Rejection Reason:</span> {requestMeta.rejectionReason}
              </div>
            ) : null}

            {inlineError ? (
              <div className="mt-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{inlineError}</div>
            ) : null}

            {staffError ? (
              <div className="mt-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{staffError}</div>
            ) : null}

            <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-[210px_1fr]">
              <div className="pt-1 text-[16px] font-semibold text-[#405064]">Point of Contact</div>
              <div className="border-t border-[#e5e7eb] pt-7">
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-[34px_1fr_1.2fr_1.8fr_1.8fr] xl:items-end">
                  <div className="hidden pb-3 text-sm font-semibold text-[#405064] xl:block">
                    1.
                    {formData.priorityPerson === "primary" ? <PriorityBadge /> : null}
                  </div>
                  <Field label="Username" required>
                    <input name="username" type="text" value={formData.username} onChange={handleInputChange} placeholder="Login username" required />
                  </Field>
                  <Field label="Person Name" required>
                    <input name="name" type="text" value={formData.name} onChange={handleInputChange} placeholder="Person name" required />
                  </Field>
                  <Field label="Phone No." required>
                    <div className="flex gap-3">
                      <input className="!w-16 text-center" value="+91" readOnly aria-label="Country code" />
                      <input name="whatsapp" type="number" value={formData.whatsapp} onChange={handleInputChange} placeholder="Phone number" required />
                    </div>
                  </Field>
                  <Field label="Email" required>
                    <input name="email" type="email" value={formData.email} onChange={handleInputChange} placeholder="Email" required />
                  </Field>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[34px_1.2fr_1.8fr_1.8fr_1.2fr] xl:items-end">
                  <div className="hidden pb-3 text-sm font-semibold text-[#405064] xl:block">
                    2.
                    {formData.priorityPerson === "secondary" ? <PriorityBadge /> : null}
                  </div>
                  <Field label="Second Person Name">
                    <input name="secondaryContactName" type="text" value={formData.secondaryContactName} onChange={handleInputChange} placeholder="Second contact name" />
                  </Field>
                  <Field label="Second Phone No.">
                    <div className="flex gap-3">
                      <input className="!w-16 text-center" value="+91" readOnly aria-label="Country code" />
                      <input name="secondaryContactPhone" type="number" value={formData.secondaryContactPhone} onChange={handleInputChange} placeholder="Second phone number" />
                    </div>
                  </Field>
                  <Field label="Second Email">
                    <input name="secondaryContactEmail" type="email" value={formData.secondaryContactEmail} onChange={handleInputChange} placeholder="Second email" />
                  </Field>
                  <Field label="Priority Person" required hint="Contact used for calls">
                    <select name="priorityPerson" value={formData.priorityPerson} onChange={handleInputChange} className="h-9 w-full rounded border border-[#d6dbe4] bg-white px-3 text-sm text-[#59677a] outline-none focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#dfe6ff]">
                      <option value="primary">Contact 1</option>
                      <option value="secondary">Contact 2</option>
                    </select>
                  </Field>
                </div>

                {formData.additionalContacts.map((contact, index) => (
                  <div key={index} className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[34px_1.2fr_1.8fr_1.8fr_1.2fr] xl:items-end">
                    <div className="hidden pb-3 text-sm font-semibold text-[#405064] xl:block">{index + 3}.</div>
                    <Field label="Person Name" required>
                      <input type="text" value={contact.name} onChange={(event) => handleAdditionalContactChange(index, "name", event.target.value)} placeholder="Contact name" required />
                    </Field>
                    <Field label="Phone No." required>
                      <div className="flex gap-3">
                        <input className="!w-16 text-center" value="+91" readOnly aria-label="Country code" />
                        <input type="number" value={contact.phone} onChange={(event) => handleAdditionalContactChange(index, "phone", event.target.value)} placeholder="Phone number" required />
                      </div>
                    </Field>
                    <Field label="Email" required>
                      <input type="email" value={contact.email} onChange={(event) => handleAdditionalContactChange(index, "email", event.target.value)} placeholder="Email" required />
                    </Field>
                    <div className="pb-1">
                      <button
                        type="button"
                        onClick={() => handleRemoveContact(index)}
                        className="h-9 rounded border border-[#e3b7b7] px-4 text-[12px] font-semibold text-[#c0392b] transition hover:bg-[#fdecea]"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={handleAddContact}
                  className="mt-5 rounded border border-[#1d4ed8] px-4 py-2 text-[12px] font-semibold text-[#1d4ed8] transition hover:bg-[#eef2ff]"
                >
                  + Add Contact
                </button>
              </div>
            </div>

            <div className="mt-7 border-t border-[#edf0f5] pt-4">
              <div className="flex flex-wrap gap-7 pl-6">
                <Tab active={activeDetailsTab === "company"} onClick={() => setActiveDetailsTab("company")}>Company Details</Tab>
                <Tab active={activeDetailsTab === "alternate"} onClick={() => setActiveDetailsTab("alternate")}>Business details</Tab>
                <Tab active={activeDetailsTab === "remarks"} onClick={() => setActiveDetailsTab("remarks")}>Remarks</Tab>
              </div>

              <div className="relative overflow-visible bg-[#e7eef7] px-8 pb-7 pt-6">
                {activeDetailsTab === "company" ? (
                  <>
                    <div className="grid grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-2 2xl:grid-cols-4">
                      <Field label="Company Name" required>
                        <input name="name" type="text" value={formData.name} onChange={handleInputChange} required />
                      </Field>
                      <Field label="Customer Code" required hint={dealerCodeHint}>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-[#59677a]">
                            {DEALER_CODE_PREFIX}
                          </span>
                          <input
                            name="dealerCode"
                            type="text"
                            value={formData.dealerCode}
                            onChange={handleDealerCodeChange}
                            placeholder={dealerCodeLoading ? "Generating unique code..." : "0000"}
                            required
                            readOnly={dealerCodeLocked}
                            className={`!pl-11 ${dealerCodeLocked ? "cursor-not-allowed bg-gray-100 text-gray-500" : ""}`}
                          />
                        </div>
                      </Field>
                      <Field label="Phone" required>
                        <input name="whatsapp" type="number" value={formData.whatsapp} onChange={handleInputChange} required />
                      </Field>
                      <Field label="Email" required>
                        <input name="email" type="email" value={formData.email} onChange={handleInputChange} required />
                      </Field>
                      <Field label="Address" required>
                        <input name="address" type="text" value={formData.address} onChange={handleInputChange} required />
                      </Field>
                      <Field label="Pin Code" required>
                        <input name="pincode" type="number" value={formData.pincode} onChange={handleInputChange} required />
                      </Field>
                      <Field label="City" required>
                        <input name="city" type="text" value={formData.city} onChange={handleInputChange} placeholder="City" required />
                      </Field>
                      <Field label="State" required>
                        <select name="state" value={formData.state} onChange={handleInputChange} required className="h-9 w-full rounded border border-[#d6dbe4] bg-white px-3 text-sm text-[#59677a] outline-none focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#dfe6ff]">
                          <option value="">Select state</option>
                          {STATE_OPTIONS.map((state) => (
                            <option key={state} value={state}>{state}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Password" required>
                        <div className="relative">
                          <input
                            name="password"
                            type={showPassword ? "text" : "password"}
                            value={formData.password}
                            onChange={handleInputChange}
                            placeholder="Set a password"
                            required
                            className="pr-10"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((visible) => !visible)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-[#7b8797] transition hover:bg-[#f1f3f7] hover:text-[#344155]"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </Field>
                    </div>

                    <RoleAssignmentPanel
                      loading={staffLoading}
                      roleAssignments={roleAssignments}
                      roleOptions={roleOptions}
                      onChange={handleAssignmentChange}
                    />
                  </>
                ) : null}

                {activeDetailsTab === "alternate" ? (
                  <div className="grid grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-2 2xl:grid-cols-4">
                    <Field label="GST Number" required>
                      <input name="gstNo" type="text" value={formData.gstNo} onChange={handleInputChange} required />
                    </Field>
                    <Field label="Discount %" required>
                      <input name="discount" type="number" value={formData.discount} onChange={handleInputChange} min={0} max={100} required />
                    </Field>
                    <Field label="Credit Days" required={!isAdvanceDealer} hint={isAdvanceDealer ? "Not applicable for advance dealers." : undefined}>
                      <select name="creditDays" value={formData.creditDays} onChange={handlePaymentTermsChange} disabled={isAdvanceDealer} className="h-9 w-full rounded border border-[#d6dbe4] bg-white px-3 text-sm text-[#59677a] outline-none focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#dfe6ff] disabled:cursor-not-allowed disabled:bg-[#f1f3f7] disabled:text-[#9aa5b5]">
                        <option value="">{isAdvanceDealer ? "Not applicable" : "Select credit days"}</option>
                        <option value="30">Net 30</option>
                        <option value="45">Net 45</option>
                        <option value="60">Net 60</option>
                      </select>
                    </Field>
                    <Field label="Annual Target" required>
                      <input name="annualTarget" type="number" value={formData.annualTarget} onChange={handleInputChange} placeholder="Amount in Rs" required />
                    </Field>
                    <Field label="Current Limit" required>
                      <input name="currentLimit" type="number" value={formData.currentLimit} onChange={handleInputChange} placeholder="Credit limit in Rs" required />
                    </Field>
                    <Field label="Payment Type" required hint={formData.paymentType === "advance" ? "Dealer wallet will be activated on creation." : "Dealer wallet stays inactive until activated later."}>
                      <select name="paymentType" value={formData.paymentType} onChange={handlePaymentTypeChange} className="h-9 w-full rounded border border-[#d6dbe4] bg-white px-3 text-sm text-[#59677a] outline-none focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#dfe6ff]">
                        <option value="credit">Credit dealer (wallet inactive)</option>
                        <option value="advance">Advance dealer (activate wallet)</option>
                      </select>
                    </Field>
                  </div>
                ) : null}

                {activeDetailsTab === "remarks" ? (
                  <Field label="Notes / Remarks">
                    <textarea
                      name="notes"
                      value={formData.notes}
                      onChange={handleInputChange}
                      rows={6}
                      className="w-full resize-none rounded border border-[#d6dbe4] bg-white px-3 py-2 text-sm text-[#344155] outline-none placeholder:text-[#9aa5b5] focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#dfe6ff]"
                      placeholder="Add dealer notes or payment remarks"
                    />
                  </Field>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-[#edf0f5] px-1 pt-5">
              {onCancel ? (
                <button type="button" onClick={onCancel} className="rounded border border-[#cbd3df] bg-white px-6 py-2 text-sm font-semibold text-[#405064] transition hover:bg-[#f5f7fb]">
                  Cancel
                </button>
              ) : null}
              {secondaryAction ? (
                <button
                  type="button"
                  onClick={handleSecondaryAction}
                  disabled={isSubmitting || isSecondarySubmitting || dealerCodeLoading || Boolean(dealerCodeError)}
                  className="rounded bg-[#d33f49] px-6 py-2 text-sm font-semibold text-white transition hover:bg-[#bd303a] disabled:cursor-not-allowed disabled:bg-gray-400"
                >
                  {isSecondarySubmitting ? secondaryAction.loadingLabel : secondaryAction.label}
                </button>
              ) : null}
              <button
                type="submit"
                disabled={isSubmitting || isSecondarySubmitting || dealerCodeLoading || Boolean(dealerCodeError)}
                className="rounded bg-[#17bfd0] px-7 py-2 text-sm font-semibold text-white transition hover:bg-[#12aebe] disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {isSubmitting ? copy.submittingLabel : copy.submitLabel}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function PriorityBadge() {
  return (
    <span
      title="Priority person — used for calls"
      className="mt-1 block w-fit rounded-full bg-[#1d4ed8] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
    >
      Priority
    </span>
  );
}

function Tab({ active = false, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={active
        ? "-mb-px rounded-t bg-[#e8eef8] px-5 py-3 text-xs font-bold text-[#263447]"
        : "rounded-t bg-[#17bfd0] px-5 py-3 text-xs font-bold text-white shadow-sm transition hover:bg-[#13aebe]"}
    >
      {children}
    </button>
  );
}

function RoleAssignmentPanel({
  loading,
  roleAssignments,
  roleOptions,
  onChange,
}: {
  loading: boolean;
  roleAssignments: RoleAssignments;
  roleOptions: Record<AssignmentRoleKey, StaffMember[]>;
  onChange: (roleKey: AssignmentRoleKey, staffId: string) => void;
}) {
  const selectedRows = ASSIGNMENT_FIELDS.map((field) => {
    const staffId = roleAssignments[field.key];
    const staff = staffId ? roleOptions[field.key].find((entry) => String(entry.staff_id) === staffId) : null;
    return { ...field, staffId, staff };
  });
  const selectedSalesManager = findStaffByAnyId(roleAssignments.salesManager, roleOptions.salesManager);
  // Staff (staffRoleType "2") hang off an RSM and have no ASM of their own, so
  // the shared parent with a Sales Manager is the RSM at the top of its chain.
  const selectedAsm = findStaffByAnyId(roleAssignments.asm, roleOptions.asm);
  const selectedSalesManagerRsmId = getStaffRsmId(selectedSalesManager) || getStaffRsmId(selectedAsm);
  const staffOptions = selectedSalesManagerRsmId
    ? roleOptions.executive.filter((staff) => getStaffRsmId(staff) === selectedSalesManagerRsmId)
    : roleOptions.executive;

  return (
    <div className="mt-6">
      <label className="mb-2 block text-xs font-bold text-[#59677a]">
        Assign Staff<span className="ml-0.5 text-[#e25959]">*</span>
      </label>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AssignmentSelect
          label="Sales Manager"
          roleKey="salesManager"
          value={roleAssignments.salesManager}
          options={roleOptions.salesManager}
          loading={loading}
          placeholder="Select sales manager"
          onChange={onChange}
        />
        <AssignmentSelect
          label="Staff / Executive"
          roleKey="executive"
          value={roleAssignments.executive}
          options={staffOptions}
          loading={loading}
          disabled={!roleAssignments.salesManager}
          placeholder={roleAssignments.salesManager ? "Select staff" : "Select sales manager first"}
          onChange={onChange}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 border border-[#d6dbe4] bg-white p-3 text-xs text-[#59677a] md:grid-cols-2 xl:grid-cols-4">
        {selectedRows.map((row) => (
          <div key={row.key} className="rounded border border-[#e0e6ef] bg-[#f8fbff] px-3 py-2">
            <div className="font-bold text-[#405064]">{row.label}</div>
            <div className="mt-1 truncate">{row.staff ? row.staff.staff_name : "Not selected"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AssignmentSelect({
  label,
  roleKey,
  value,
  options,
  loading,
  disabled = false,
  placeholder,
  onChange,
}: {
  label: string;
  roleKey: AssignmentRoleKey;
  value: string;
  options: StaffMember[];
  loading: boolean;
  disabled?: boolean;
  placeholder: string;
  onChange: (roleKey: AssignmentRoleKey, staffId: string) => void;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#6c7a8d]">{label}</div>
      <select
        value={value}
        disabled={loading || disabled}
        onChange={(event) => onChange(roleKey, event.target.value)}
        className="h-9 w-full rounded border border-[#d6dbe4] bg-white px-3 text-sm text-[#344155] outline-none focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#dfe6ff] disabled:cursor-not-allowed disabled:bg-[#f1f3f7] disabled:text-[#9aa5b5]"
      >
        <option value="">{loading ? "Loading..." : placeholder}</option>
        {!loading && !options.length ? <option value="" disabled>No active {label} found</option> : null}
        {options.map((staff) => {
          const staffId = String(staff.staff_id);
          return (
            <option key={staffId} value={staffId}>
              {staff.staff_name || "Staff #" + staffId}
            </option>
          );
        })}
      </select>
    </div>
  );
}

const ASSIGNMENT_FIELDS: Array<{ key: AssignmentRoleKey; label: string }> = [
  { key: "rsm", label: "RSM" },
  { key: "asm", label: "ASM" },
  { key: "salesManager", label: "Sales Manager" },
  { key: "executive", label: "Staff / Executive" },
];

function uniqueStaffIds(ids: string[]) {
  return Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)));
}

function normalizeStaffRole(staff: StaffMember): AssignmentRoleKey | null {
  const role = String(staff.role ?? "").toUpperCase();
  const roleType = String((staff as StaffMember & { staffRoleType?: string | number }).staffRoleType ?? staff.staff_roletype ?? "").toUpperCase();

  if (role === "RSM") return "rsm";
  if (role === "ASM") return "asm";
  if (role === "STAFF" && (roleType === "1" || roleType === "EXECUTIVE")) return "salesManager";
  if (role === "STAFF" && (roleType === "2" || roleType === "STAFF")) return "executive";

  return null;
}

function buildRoleOptions(staffList: StaffMember[]): Record<AssignmentRoleKey, StaffMember[]> {
  return staffList.reduce<Record<AssignmentRoleKey, StaffMember[]>>((groups, staff) => {
    const roleKey = normalizeStaffRole(staff);
    if (roleKey) groups[roleKey].push(staff);
    return groups;
  }, { rsm: [], asm: [], salesManager: [], executive: [] });
}

function normalizeHierarchyText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function getStaffUserId(staffId: string, staffList: StaffMember[]) {
  const staff = staffList.find((entry) => String(entry.staff_id) === String(staffId));
  return String(staff?.userId ?? staff?.id ?? "").trim();
}

function findStaffByAnyId(id: string, staffList: StaffMember[]) {
  const normalized = String(id).trim();
  if (!normalized) return null;
  return staffList.find((staff) => [staff.staff_id, staff.id, staff.userId].some((value) => String(value ?? "").trim() === normalized)) ?? null;
}

function getStaffRsmId(staff: StaffMember | null) {
  return String(staff?.parentRsmId ?? staff?.parent_rsm_id ?? staff?.rsmId ?? "").trim();
}

function getStaffLocation(staff: StaffMember | null) {
  return normalizeHierarchyText(staff?.staff_location ?? staff?.location);
}

function getStaffRegion(staff: StaffMember | null) {
  return normalizeHierarchyText(staff?.sales_region ?? staff?.salesRegion);
}

function findUniqueMatchingStaff(candidates: StaffMember[], predicate: (staff: StaffMember) => boolean) {
  const matches = candidates.filter(predicate);
  return matches.length === 1 ? String(matches[0].staff_id) : "";
}

function resolveParentAssignments(
  next: RoleAssignments,
  roleOptions: Record<AssignmentRoleKey, StaffMember[]>,
  sourceStaff: StaffMember | null,
) {
  next.asm = "";
  next.rsm = "";

  const explicitAsm = findStaffByAnyId(
    String(sourceStaff?.parentAsmId ?? sourceStaff?.parent_asm_id ?? sourceStaff?.asmId ?? ""),
    roleOptions.asm,
  );
  if (explicitAsm) next.asm = String(explicitAsm.staff_id);

  const sourceLocation = getStaffLocation(sourceStaff);
  if (!next.asm && sourceLocation) {
    next.asm = findUniqueMatchingStaff(roleOptions.asm, (staff) => getStaffLocation(staff) === sourceLocation);
  }

  const asm = findStaffByAnyId(next.asm, roleOptions.asm);
  const explicitRsm = findStaffByAnyId(
    String(sourceStaff?.parentRsmId ?? sourceStaff?.parent_rsm_id ?? sourceStaff?.rsmUserId ?? sourceStaff?.rsmId ?? asm?.parentRsmId ?? asm?.parent_rsm_id ?? ""),
    roleOptions.rsm,
  );
  if (explicitRsm) next.rsm = String(explicitRsm.staff_id);

  const region = getStaffRegion(sourceStaff) || getStaffRegion(asm);
  if (!next.rsm && region) {
    next.rsm = findUniqueMatchingStaff(roleOptions.rsm, (staff) => getStaffRegion(staff) === region);
  }

  if (!next.rsm && sourceLocation) {
    next.rsm = findUniqueMatchingStaff(roleOptions.rsm, (staff) => getStaffLocation(staff) === sourceLocation);
  }

  return next;
}

function resolveNextRoleAssignments(
  prev: RoleAssignments,
  roleOptions: Record<AssignmentRoleKey, StaffMember[]>,
  roleKey: AssignmentRoleKey,
  staffId: string,
): RoleAssignments {
  const next = { ...prev, [roleKey]: staffId };

  if (roleKey === "salesManager") {
    next.executive = "";
    return resolveParentAssignments(next, roleOptions, findStaffByAnyId(staffId, roleOptions.salesManager));
  }

  if (roleKey === "executive") {
    const staff = findStaffByAnyId(staffId, roleOptions.executive);
    return resolveParentAssignments(next, roleOptions, staff ?? findStaffByAnyId(next.salesManager, roleOptions.salesManager));
  }

  return resolveParentAssignments(next, roleOptions, findStaffByAnyId(next.salesManager, roleOptions.salesManager));
}

function buildRoleAssignmentsFromIds(ids: string[], staffList: StaffMember[]): RoleAssignments {
  const next = { ...EMPTY_ROLE_ASSIGNMENTS };
  const staffById = new Map(staffList.map((staff) => [String(staff.staff_id), staff]));

  uniqueStaffIds(ids).forEach((staffId) => {
    const staff = staffById.get(staffId);
    const roleKey = staff ? normalizeStaffRole(staff) : null;
    if (roleKey && !next[roleKey]) next[roleKey] = staffId;
  });

  return next;
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="mb-2 block text-xs font-bold text-[#59677a]">
        {label}
        {required ? <span className="ml-0.5 text-[#e25959]">*</span> : null}
      </label>
      <div className="[&_input]:h-9 [&_input]:w-full [&_input]:rounded [&_input]:border [&_input]:border-[#d6dbe4] [&_input]:bg-white [&_input]:px-3 [&_input]:text-sm [&_input]:text-[#344155] [&_input]:outline-none [&_input]:placeholder:text-[#9aa5b5] [&_input]:focus:border-[#1d4ed8] [&_input]:focus:ring-2 [&_input]:focus:ring-[#dfe6ff] [&_input:disabled]:bg-[#f1f3f7]">
        {children}
      </div>
      {hint ? <p className="mt-1 text-[11px] text-[#6c7a8d]">{hint}</p> : null}
    </div>
  );
}
