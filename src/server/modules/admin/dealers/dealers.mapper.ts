import { normalizeDealerContacts } from "@/lib/dealerForm";
import { staffRoleLabel, resolveStaffRoleKey } from "@/lib/staffRoleLabel";
import type { AdminDealerRecord, AdminDealerStaffAssignment } from "./dealers.types";

function decimalToString(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function moneyToString(value: bigint | null | undefined) {
  return value === null || value === undefined ? "" : value.toString();
}

export function mapAdminDealerStaffAssignment(record: AdminDealerStaffAssignment) {
  const roleSource = {
    role: record.staff.user.role,
    staffRoleType: record.staff.staffRoleType,
    salesRegion: record.staff.salesRegion,
  };
  return {
    assignmentId: record.id.toString(),
    staffId: record.staffId.toString(),
    id: record.staffId.toString(),
    name: record.staff.displayName || "",
    email: record.staff.user.email || "",
    phone: record.staff.mobileNo || "",
    designation: record.staff.designation || "",
    role: record.staff.user.role || "",
    staffRoleType: record.staff.staffRoleType || "",
    salesRegion: record.staff.salesRegion || "",
    roleKey: resolveStaffRoleKey(roleSource),
    roleLabel: staffRoleLabel(roleSource),
    active: record.active,
    assignedAt: record.assignedAt.toISOString(),
  };
}

export function mapAdminDealer(record: AdminDealerRecord) {
  const id = record.id.toString();
  const businessName = record.businessName || "";
  const email = record.user.email || "";
  const phone = record.phone || "";
  const city = record.city || "";
  const state = record.state || "";
  const address = record.address || "";
  const pincode = record.pincode || "";
  const dealerCode = record.dealerCode || "";
  const discount = decimalToString(record.discountPercent);
  const creditDays = record.creditDays ?? 0;
  const creditLimitPaise = moneyToString(record.creditLimitPaise);
  const gstin = record.gstin || "";
  const annualTarget = moneyToString(record.annualTargetPaise);
  const notes = record.notes || "";
  const priorityContact = record.priorityContact === "secondary" ? "secondary" : "primary";
  const secondaryContactName = record.secondaryContactName || "";
  const secondaryContactPhone = record.secondaryContactPhone || "";
  const secondaryContactEmail = record.secondaryContactEmail || "";
  const extraContacts = normalizeDealerContacts(record.additionalContacts);
  const assignedStaff = (record.staffAssignments ?? [])
    .filter((assignment) => assignment.active && !assignment.staff.user.deletedAt && assignment.staff.user.status === "ACTIVE")
    .map(mapAdminDealerStaffAssignment);
  const assignedstaff = assignedStaff.map((staff) => staff.staffId).join(",");
  const region = record.region || "";
  const walletStatus = record.wallet?.status === "ACTIVE" ? "active" : "inactive";
  const rsm = record.regionalManager?.staffProfile ? {
    id: record.regionalManager.id.toString(),
    userId: record.regionalManager.id.toString(),
    name: record.regionalManager.staffProfile.displayName || "",
    email: record.regionalManager.email || "",
    role: "RSM",
    region: record.regionalManager.staffProfile.salesRegion || region,
  } : null;
  // Legacy flat string kept for older consumers; the admin table renders the
  // richer `assignedStaff` rows (which carry roleLabel) instead.
  const staffname = assignedStaff
    .map((staff) => (staff.name && staff.roleLabel ? `${staff.name} (${staff.roleLabel})` : staff.name))
    .filter(Boolean)
    .join(", ");

  return {
    id,
    dealerCode,
    businessName,
    email,
    phone,
    city,
    state,
    address,
    pincode,
    gstin,
    discountPercent: discount,
    creditDays,
    creditLimitPaise,
    annualTargetPaise: annualTarget,
    notes,
    priorityContact,
    priorityPerson: priorityContact,
    secondaryContactName,
    secondaryContactPhone,
    secondaryContactEmail,
    additionalContacts: extraContacts,
    status: record.user.status,
    walletStatus,
    assignedStaff,
    region,
    rsmUserId: record.rsmUserId?.toString() || "",
    rsm,
    regionalManager: rsm,
    Dealer_Region: region,
    Dealer_RSM: rsm?.name || "",
    Dealer_Id: id,
    Dealer_Name: businessName,
    Dealer_Email: email,
    Dealer_Number: phone,
    Dealer_City: city,
    Dealer_Address: address,
    Dealer_Pincode: pincode,
    Dealer_Dealercode: dealerCode,
    Dealer_Username: record.user.username || email,
    Dealer_Image: record.imageUrl || "",
    Dealer_Notes: notes,
    Dealer_Contact_Person: priorityContact,
    Dealer_Secondary_Contact_Name: secondaryContactName,
    Dealer_Secondary_Contact_Phone: secondaryContactPhone,
    Dealer_Secondary_Contact_Email: secondaryContactEmail,
    discount,
    gst: gstin,
    creditdays: String(creditDays),
    currentlimit: creditLimitPaise,
    annualtarget: annualTarget,
    assignedstaff,
    staffname,
  };
}
