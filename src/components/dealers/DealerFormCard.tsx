"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import {
  EMPTY_ROLE_ASSIGNMENTS,
  buildRegionSalesOptions,
  buildRoleAssignmentsFromIds,
  buildRoleOptions,
  getAssignedStaffNames,
  getStaffUserId,
  lowestSalesPerson,
  normalizeDealerFormSnapshot,
  regionFromAssignments,
  selectRegion,
  selectSalesPerson,
  uniqueStaffIds,
  type AssignmentRoleKey,
  type RoleAssignments,
  toDealerFormSnapshot,
  validateDealerFormSnapshot,
  type DealerContact,
  type DealerFormSnapshot,
  type DealerFormValues,
  type StaffMember,
} from "@/lib/dealerForm";
import { clampPercentInput, phoneInput, phoneInputProps } from "@/lib/fieldRules";
import { CITIES_BY_STATE, STATE_OPTIONS } from "@/lib/places";
import { SALES_REGION_OPTIONS } from "@/lib/salesRegions";
import { formatWarehouseLabel } from "@/lib/warehouses";

const ADMIN_STAFF_URL = "/api/admin/staff";
const DEALER_CODE_PREFIX = "OM-";

type DealerFormMode = "admin-create" | "staff-submit" | "admin-review" | "rsm-review" | "staff-resubmit";
type DealerDetailsTab = "company" | "alternate" | "remarks";

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
    // Shown when the reviewer stands in for an unavailable RSM.
    onBehalfNotice?: string;
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
    case "rsm-review":
      return {
        title: "Review Dealer Request",
        subtitle: "Review your team's request, make corrections if needed, and approve it to forward to admin.",
        submitLabel: "Approve & Forward to Admin",
        submittingLabel: "Forwarding...",
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

// Snapshots come straight from the API and may be missing keys, so normalize before
// they reach the inputs — an undefined value silently flips an input to uncontrolled.
function toFormValues(snapshot?: DealerFormSnapshot | null): DealerFormValues {
  return normalizeDealerFormSnapshot(snapshot ?? null);
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
  const [showPassword, setShowPassword] = useState(true);
  const [roleAssignments, setRoleAssignments] = useState<RoleAssignments>(() => ({ ...EMPTY_ROLE_ASSIGNMENTS }));
  const [region, setRegion] = useState(() => initialSnapshot?.region ?? "");
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
          const assignments = buildRoleAssignmentsFromIds(initialSnapshot?.assignedStaffIds ?? [], activeStaff);
          setStaffList(activeStaff);
          setRoleAssignments(assignments);
          setRegion(regionFromAssignments(assignments, activeStaff) || initialSnapshot?.region || "");
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
    setFormData((prev) => ({ ...prev, [name]: name === "whatsapp" || name === "secondaryContactPhone" ? phoneInput(value) : name === "discount" ? clampPercentInput(value) : value }));
  };

  const assignedStaffIds = useMemo(() => uniqueStaffIds(Object.values(roleAssignments)), [roleAssignments]);
  const selectedRsmUserId = useMemo(() => getStaffUserId(roleAssignments.rsm, staffList), [roleAssignments.rsm, staffList]);

  const isAdvanceDealer = formData.paymentType === "advance";

  const dealerCodeLocked = mode === "staff-submit" || mode === "staff-resubmit" || mode === "rsm-review";
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

  // City list depends on the state, so a state change drops a now-invalid city.
  const handleStateChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const state = event.target.value;
    setInlineError("");
    setFormData((prev) => ({
      ...prev,
      state,
      city: (CITIES_BY_STATE[state] ?? []).includes(prev.city) ? prev.city : "",
    }));
  };

  const cityOptions = CITIES_BY_STATE[formData.state] ?? [];

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

  const handleAssignmentChange = (nextRegion: string, nextAssignments: RoleAssignments) => {
    setInlineError("");
    setRegion(nextRegion);
    setRoleAssignments(nextAssignments);
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
    const assignments = buildRoleAssignmentsFromIds(snapshot.assignedStaffIds, staffList);
    setRoleAssignments(assignments);
    setRegion(regionFromAssignments(assignments, staffList) || snapshot.region || "");
    setActiveDetailsTab("company");
    setInlineError("");
  };

  // The validated snapshot, or null after showing why it is not valid yet.
  const buildValidSnapshot = () => {
    const staffNames = getAssignedStaffNames(assignedStaffIds, staffList) || initialSnapshot?.staffNames || "";
    const snapshot = toDealerFormSnapshot(formData, assignedStaffIds, staffNames, selectedRsmUserId, region);
    const validationError = !region
      ? "Select a region for this dealer."
      : !roleAssignments.executive
        ? "Select a Staff / Executive for this dealer."
        : validateDealerFormSnapshot(snapshot);

    setInlineError(validationError ?? "");
    return validationError ? null : snapshot;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const snapshot = buildValidSnapshot();
    if (snapshot) await onSubmit(snapshot);
  };

  const handleSecondaryAction = async () => {
    if (!secondaryAction) return;
    const snapshot = buildValidSnapshot();
    if (snapshot) await secondaryAction.onAction(snapshot);
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
            <div className="text-lg font-bold text-[30px]" >Add dealer</div>
          </div>

          <div className="px-5 pb-5 pt-5">
            {requestMeta?.requestReference ? (
              <div className="mt-4 border border-[#b9c7ee] bg-[#eef4ff] px-4 py-3 text-sm text-[#405064]">
                <span className="font-semibold">Request Ref: {requestMeta.requestReference}</span>
                {requestMeta.submittedByName ? <span className="ml-3">Submitted by {requestMeta.submittedByName}</span> : null}
                {requestMeta.submittedAt ? <span className="ml-3">{new Date(requestMeta.submittedAt).toLocaleString("en-IN")}</span> : null}
              </div>
            ) : null}

            {requestMeta?.onBehalfNotice ? (
              <div className="mt-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">
                {requestMeta.onBehalfNotice}
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
              <div className="pt-1 text-[36px] font-semibold text-[#405064]"></div>
              <div className="border-t border-[#e5e7eb] pt-7">
                <div className="grid grid-cols-1 gap-5 xl:grid-cols-[112px_1.2fr_1.8fr_1.8fr] xl:items-end">
                  <PriorityRadio number={1} value="primary" selected={formData.priorityPerson} onChange={handleInputChange} />
                  <Field label="Person Name" required>
                    <input name="contactName" type="text" value={formData.contactName} onChange={handleInputChange} placeholder="Person name" required />
                  </Field>
                  <Field label="Phone No." required>
                    <div className="flex gap-3">
                      <input className="!w-16 text-center" value="+91" readOnly aria-label="Country code" />
                      <input name="whatsapp" {...phoneInputProps} value={formData.whatsapp} onChange={handleInputChange} placeholder="10-digit phone number" required />
                    </div>
                  </Field>
                  <Field label="Email" required>
                    <input name="email" type="email" value={formData.email} onChange={handleInputChange} placeholder="Email" required />
                  </Field>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[112px_1.2fr_1.8fr_1.8fr] xl:items-end">
                  <PriorityRadio number={2} value="secondary" selected={formData.priorityPerson} onChange={handleInputChange} />
                  <Field label="Second Person Name">
                    <input name="secondaryContactName" type="text" value={formData.secondaryContactName} onChange={handleInputChange} placeholder="Second contact name" />
                  </Field>
                  <Field label="Second Phone No.">
                    <div className="flex gap-3">
                      <input className="!w-16 text-center" value="+91" readOnly aria-label="Country code" />
                      <input name="secondaryContactPhone" {...phoneInputProps} value={formData.secondaryContactPhone} onChange={handleInputChange} placeholder="Second phone number" />
                    </div>
                  </Field>
                  <Field label="Second Email">
                    <input name="secondaryContactEmail" type="email" value={formData.secondaryContactEmail} onChange={handleInputChange} placeholder="Second email" />
                  </Field>
                </div>

                {formData.additionalContacts.map((contact, index) => (
                  <div key={index} className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[112px_1.2fr_1.8fr_1.8fr_1.2fr] xl:items-end">
                    <div className="hidden h-9 items-center text-sm font-semibold text-[#405064] xl:flex">{index + 3}.</div>
                    <Field label="Person Name" required>
                      <input type="text" value={contact.name} onChange={(event) => handleAdditionalContactChange(index, "name", event.target.value)} placeholder="Contact name" required />
                    </Field>
                    <Field label="Phone No." required>
                      <div className="flex gap-3">
                        <input className="!w-16 text-center" value="+91" readOnly aria-label="Country code" />
                        <input {...phoneInputProps} value={contact.phone} onChange={(event) => handleAdditionalContactChange(index, "phone", phoneInput(event.target.value))} placeholder="10-digit phone number" required />
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
                      <Field label="State" required>
                        <select name="state" value={formData.state} onChange={handleStateChange} required className="h-9 w-full rounded border border-[#d6dbe4] bg-white px-3 text-sm text-[#59677a] outline-none focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#dfe6ff]">
                          <option value="">Select state</option>
                          {STATE_OPTIONS.map((state) => (
                            <option key={state} value={state}>{state}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="City" required>
                        <select name="city" value={formData.city} onChange={handleInputChange} required disabled={!formData.state} className="h-9 w-full rounded border border-[#d6dbe4] bg-white px-3 text-sm text-[#59677a] outline-none focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#dfe6ff] disabled:cursor-not-allowed disabled:bg-[#f1f3f7] disabled:text-[#9aa5b5]">
                          <option value="">{formData.state ? "Select city" : "Select state first"}</option>
                          {cityOptions.map((city) => (
                            <option key={city} value={city}>{city}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Username" required>
                        <input name="username" type="text" value={formData.username} onChange={handleInputChange} onBlur={(event) => setFormData((prev) => ({ ...prev, username: event.target.value.replace(/\s+/g, "") }))} placeholder="Login username" required />
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
                      staffList={staffList}
                      region={region}
                      roleAssignments={roleAssignments}
                      onChange={handleAssignmentChange}
                    />
                  </>
                ) : null}

                {activeDetailsTab === "alternate" ? (
                  <div className="grid grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-2 2xl:grid-cols-4">
                    <Field label="GST Number" required>
                      <input name="gstNo" type="text" value={formData.gstNo} onChange={handleInputChange} maxLength={15} required />
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
                    <Field label="Credit Limit" required>
                      <input name="currentLimit" type="number" value={formData.currentLimit} onChange={handleInputChange} placeholder="Credit limit in Rs" required />
                    </Field>
                    <Field label="Payment Type" required hint={formData.paymentType === "advance" ? "Dealer wallet will be activated on creation." : formData.paymentType === "credit" ? "Dealer wallet stays inactive until activated later." : undefined}>
                      <select name="paymentType" value={formData.paymentType} onChange={handlePaymentTypeChange} required className="h-9 w-full rounded border border-[#d6dbe4] bg-white px-3 text-sm text-[#59677a] outline-none focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#dfe6ff]">
                        <option value="" disabled>-Select-</option>
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

function PriorityRadio({
  number,
  value,
  selected,
  onChange,
}: {
  number: number;
  value: "primary" | "secondary";
  selected: "primary" | "secondary";
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const isSelected = selected === value;
  return (
    <div className="flex h-9 items-center gap-2">
      <span className="text-sm font-semibold text-[#405064]">{number}.</span>
      <label
        title="Priority person — used for calls"
        className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition ${
          isSelected
            ? "border-[#1d4ed8] bg-[#1d4ed8] text-white"
            : "border-[#d6dbe4] bg-white text-[#8b97a8] hover:border-[#1d4ed8] hover:text-[#1d4ed8]"
        }`}
      >
        <input
          type="radio"
          name="priorityPerson"
          value={value}
          checked={isSelected}
          onChange={onChange}
          className="h-3 w-3 accent-[#1d4ed8]"
        />
        Priority
      </label>
    </div>
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

// Shared with Edit Dealer: pick a region, then one sales person from it (lowest
// role first). The slots above that person fill from their real parents, and the
// region's RSM is always linked.
export function RoleAssignmentPanel({
  loading,
  staffList,
  region,
  roleAssignments,
  onChange,
}: {
  loading: boolean;
  staffList: StaffMember[];
  region: string;
  roleAssignments: RoleAssignments;
  onChange: (region: string, roleAssignments: RoleAssignments) => void;
}) {
  const roleOptions = useMemo(() => buildRoleOptions(staffList), [staffList]);
  const salesGroups = useMemo(() => buildRegionSalesOptions(roleOptions, staffList, region), [roleOptions, staffList, region]);
  const selectedRows = ASSIGNMENT_FIELDS.map((field) => {
    const staffId = roleAssignments[field.key];
    const staff = staffId ? roleOptions[field.key].find((entry) => String(entry.staff_id) === staffId) : null;
    return { ...field, staff };
  });

  return (
    <div className="mt-6">
      <label className="mb-2 block text-xs font-bold text-[#59677a]">
        Assign Staff<span className="ml-0.5 text-[#e25959]">*</span>
      </label>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0">
          <SelectLabel label="Region" required />
          <select
            value={region}
            disabled={loading}
            onChange={(event) => onChange(event.target.value, selectRegion(roleAssignments, roleOptions, staffList, event.target.value))}
            className={SELECT_CLASS}
          >
            <option value="">{loading ? "Loading..." : "Select region"}</option>
            {SALES_REGION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>

        <div className="min-w-0">
          <SelectLabel label="Sales Person" />
          <select
            value={lowestSalesPerson(roleAssignments)}
            disabled={loading || !region}
            onChange={(event) => onChange(region, selectSalesPerson(roleAssignments, roleOptions, staffList, region, event.target.value))}
            className={SELECT_CLASS}
          >
            <option value="">{!region ? "Select region first" : salesGroups.length ? "Select sales person" : "No active sales staff in this region"}</option>
            {salesGroups.map((group) => (
              <optgroup key={group.key} label={group.label}>
                {group.staff.map((staff) => {
                  const staffId = String(staff.staff_id);
                  return (
                    <option key={staffId} value={staffId}>
                      {staff.staff_name || "Staff #" + staffId}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Staff (staffRoleType "2") are free of the sales chain and the region;
            what matters is their warehouse, which decides the order list's tab. */}
        <div className="min-w-0">
          <SelectLabel label="Staff / Executive" required />
          <select
            value={roleAssignments.executive}
            disabled={loading}
            onChange={(event) => onChange(region, { ...roleAssignments, executive: event.target.value })}
            className={SELECT_CLASS}
          >
            <option value="">{loading ? "Loading..." : "Select staff"}</option>
            {!loading && !roleOptions.executive.length ? <option value="" disabled>No active Staff / Executive found</option> : null}
            {roleOptions.executive.map((staff) => {
              const staffId = String(staff.staff_id);
              const warehouse = formatWarehouseLabel(staff.warehouse);
              return (
                <option key={staffId} value={staffId}>
                  {staff.staff_name || "Staff #" + staffId}
                  {warehouse ? ` (${warehouse})` : ""}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 border border-[#d6dbe4] bg-white p-3 text-xs text-[#59677a] md:grid-cols-2 xl:grid-cols-4">
        {selectedRows.map((row) => (
          <div key={row.key} className="rounded border border-[#e0e6ef] bg-[#f8fbff] px-3 py-2">
            <div className="font-bold text-[#405064]">{row.label}</div>
            <div className="mt-1 truncate">{row.staff ? row.staff.staff_name : "Not selected"}</div>
          </div>
        ))}
      </div>
      {region && !roleAssignments.rsm && !loading ? (
        <p className="mt-2 text-[11px] text-amber-700">
          This region has no active RSM. Approvals for this dealer go to the NSM, or to Admin if there is no NSM.
        </p>
      ) : null}
    </div>
  );
}

const SELECT_CLASS = "h-9 w-full rounded border border-[#d6dbe4] bg-white px-3 text-sm text-[#344155] outline-none focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#dfe6ff] disabled:cursor-not-allowed disabled:bg-[#f1f3f7] disabled:text-[#9aa5b5]";

function SelectLabel({ label, required = false }: { label: string; required?: boolean }) {
  return (
    <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#6c7a8d]">
      {label}
      {required ? <span className="ml-0.5 text-[#e25959]">*</span> : null}
    </div>
  );
}

const ASSIGNMENT_FIELDS: Array<{ key: AssignmentRoleKey; label: string }> = [
  { key: "rsm", label: "RSM" },
  { key: "asm", label: "ASM" },
  { key: "salesManager", label: "Sales Manager" },
  { key: "executive", label: "Staff / Executive" },
];


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
