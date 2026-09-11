import type { AdminProfile, AccountantProfile, DealerProfile, StaffProfile, User } from "@prisma/client";
import { sanitizeLegacyProfile, withClientRole } from "@/server/auth/sanitize-profile";
import type { AuthRole } from "@/server/auth/providers/types";

type UserLike = Pick<User, "email" | "role"> & Partial<Pick<User, "passwordUpdatedAt">>;

function valueOrEmpty(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function valueOrZero(value: unknown) {
  return value === null || value === undefined ? "0" : String(value);
}

export function mapAdminProfile(user: UserLike, profile: AdminProfile) {
  return sanitizeLegacyProfile({
    admin_id: profile.id.toString(),
    name: profile.displayName,
    ADMIN_NAME: profile.displayName,
    ADMIN_EMAIL: user.email,
    ADMIN_PHONE: valueOrEmpty(profile.phone),
    ADMIN_IMAGE: valueOrEmpty(profile.imageUrl),
    role: "admin",
  });
}

export function mapAccountantProfile(user: UserLike, profile: AccountantProfile) {
  return sanitizeLegacyProfile({
    accountant_id: profile.id.toString(),
    _id: profile.id.toString(),
    name: profile.displayName,
    email: user.email,
    phone: "",
    designation: valueOrEmpty(profile.designation),
    role: "accountant",
  });
}

export function mapStaffProfile(user: UserLike, profile: Pick<StaffProfile, "id" | "displayName" | "designation" | "location" | "staffRoleType" | "salesRegion">) {
  const staffRoleType = profile.staffRoleType ?? (user.role === "STAFF" ? "1" : user.role);
  return sanitizeLegacyProfile({
    staff_id: profile.id.toString(),
    staff_name: profile.displayName,
    staff_email: user.email,
    staff_roletype: staffRoleType,
    staff_designation: valueOrEmpty(profile.designation),
    staff_location: valueOrEmpty(profile.location),
    sales_region: valueOrEmpty(profile.salesRegion),
    salesRegion: valueOrEmpty(profile.salesRegion),
    role: "staff",
  });
}

export function mapDealerProfile(user: UserLike, profile: DealerProfile) {
  return sanitizeLegacyProfile({
    Dealer_Id: profile.id.toString(),
    Dealer_Name: profile.businessName,
    Dealer_Email: user.email,
    Dealer_Number: valueOrEmpty(profile.phone),
    Dealer_City: valueOrEmpty(profile.city),
    Dealer_Address: valueOrEmpty(profile.address),
    Dealer_Pincode: valueOrEmpty(profile.pincode),
    Dealer_Dealercode: valueOrEmpty(profile.dealerCode),
    discount: valueOrZero(profile.discountPercent),
    gst: valueOrEmpty(profile.gstin),
    creditdays: valueOrZero(profile.creditDays),
    termsAcceptedAt: profile.termsAcceptedAt?.toISOString() ?? "",
    passwordUpdatedAt: user.passwordUpdatedAt?.toISOString() ?? "",
    role: "dealer",
  });
}

export function mapPostgresUserToLegacyProfile(user: User & {
  adminProfile?: AdminProfile | null;
  accountantProfile?: AccountantProfile | null;
  staffProfile?: Pick<StaffProfile, "id" | "displayName" | "designation" | "location" | "staffRoleType" | "salesRegion"> | null;
  dealerProfile?: DealerProfile | null;
}) {
  switch (user.role as AuthRole) {
    case "ADMIN":
    case "NSM":
      if (!user.adminProfile) throw new Error("Missing role profile");
      return withClientRole(mapAdminProfile(user, user.adminProfile), user.role);
    case "ACCOUNTANT":
      if (!user.accountantProfile) throw new Error("Missing role profile");
      return withClientRole(mapAccountantProfile(user, user.accountantProfile), user.role);
    case "STAFF":
    case "RSM":
    case "ASM":
      if (!user.staffProfile) throw new Error("Missing role profile");
      return withClientRole(mapStaffProfile(user, user.staffProfile), user.role);
    case "DEALER":
      if (!user.dealerProfile) throw new Error("Missing role profile");
      return withClientRole(mapDealerProfile(user, user.dealerProfile), user.role);
    default:
      throw new Error("Unsupported role");
  }
}

export function getProfileId(user: {
  role: string;
  adminProfile?: Pick<AdminProfile, "id"> | null;
  accountantProfile?: Pick<AccountantProfile, "id"> | null;
  staffProfile?: Pick<StaffProfile, "id"> | null;
  dealerProfile?: Pick<DealerProfile, "id"> | null;
}) {
  if ((user.role === "ADMIN" || user.role === "NSM") && user.adminProfile) return user.adminProfile.id;
  if (user.role === "ACCOUNTANT" && user.accountantProfile) return user.accountantProfile.id;
  if ((user.role === "STAFF" || user.role === "RSM" || user.role === "ASM") && user.staffProfile) return user.staffProfile.id;
  if (user.role === "DEALER" && user.dealerProfile) return user.dealerProfile.id;
  throw new Error("Missing role profile");
}

