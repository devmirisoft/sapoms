import type { DealerProfile, StaffProfile, User } from "@prisma/client";

function text(value: unknown) { return value === null || value === undefined ? "" : String(value); }
function moneyFromPaise(value: bigint | null | undefined) { return value ? String(Number(value) / 100) : "0"; }
function decimal(value: unknown) { return value === null || value === undefined ? "0" : String(value); }

export type DealerWithUser = DealerProfile & { user: Pick<User, "email" | "username" | "status"> };
export type StaffWithUser = StaffProfile & { user: Pick<User, "email" | "username" | "status"> };

export function mapDealerProfileAliases(profile: DealerWithUser, assignedStaffName = "") {
  return {
    id: profile.id.toString(),
    Dealer_Id: profile.id.toString(),
    Dealer_Name: profile.businessName,
    Dealer_Email: profile.user.email,
    Dealer_Number: text(profile.phone),
    Dealer_City: text(profile.city),
    Dealer_Address: text(profile.address),
    Dealer_Pincode: text(profile.pincode),
    Dealer_Dealercode: text(profile.dealerCode),
    Dealer_Username: text(profile.user.username || profile.user.email),
    Dealer_Image: text(profile.imageUrl),
    discount: decimal(profile.discountPercent),
    gst: text(profile.gstin),
    creditdays: text(profile.creditDays ?? 0),
    currentlimit: moneyFromPaise(profile.creditLimitPaise),
    annualtarget: moneyFromPaise(profile.annualTargetPaise),
    status: profile.user.status === "ACTIVE" && !profile.deletedAt ? "1" : "0",
    assignedstaff: assignedStaffName,
    name: profile.businessName,
    email: profile.user.email,
    image: text(profile.imageUrl),
  };
}

export function mapStaffProfileAliases(profile: StaffWithUser) {
  const salesRegion = profile.salesRegion || "";
  return {
    id: profile.id.toString(),
    staff_id: profile.id.toString(),
    staffname: profile.displayName,
    staff_name: profile.displayName,
    staff_email: profile.user.email,
    staff_designation: text(profile.designation),
    staff_location: text(profile.location),
    staff_roletype: profile.staffRoleType || "1",
    sales_region: salesRegion,
    salesRegion,
    staff_username: text(profile.user.username || profile.user.email),
    name: profile.displayName,
    email: profile.user.email,
    role: "staff",
  };
}
