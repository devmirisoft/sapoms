export type AppRole = "admin" | "staff" | "dealer" | "accountant";

export type StoredUser = Record<string, unknown> & {
  role?: AppRole;
  staff_roletype?: string | number;
  staff_id?: string | number;
  staff_name?: string;
  staff_location?: string;
  staff_designation?: string;
  Dealer_Id?: string | number;
  Dealer_Name?: string;
  Dealer_City?: string;
  Dealer_Email?: string;
  Dealer_Number?: string;
  Dealer_Dealercode?: string;
  termsAcceptedAt?: string;
  passwordUpdatedAt?: string;
  name?: string;
  username?: string;
  email?: string;
  id?: string | number;
  admin_id?: string | number;
  Admin_Id?: string | number;
};

export type AuthSession =
  | { status: "authenticated"; role: AppRole; roletype: string; user: StoredUser }
  | { status: "unauthenticated"; reason: "missing" | "invalid" | "unsupported-role" };

export type AuthStorage = Pick<Storage, "removeItem">;

// Profile copies older builds kept in localStorage. Nothing writes them any more
// (the current-user query holds the profile); they are only ever removed.
export const LEGACY_AUTH_KEYS = [
  "status",
  "UserData",
  "roletype",
  "staffData",
  "AdminData",
  "admin",
  "user",
  "accountant_token",
  "AccountantData",
  "role",
  "roleType",
] as const;

export const LOGIN_ROUTE = "/auth/login";
export const ACCOUNTANT_LOGIN_ROUTE = "/auth/accountant-login";

// The cart is cached until logout, so it is cleared with the legacy auth keys.
export const CART_STORAGE_KEY = "cart";

export function clearAuthStorage(storage: AuthStorage) {
  LEGACY_AUTH_KEYS.forEach((key) => storage.removeItem(key));
  storage.removeItem(CART_STORAGE_KEY);
}

export function normalizeRoleFromProfile(profile: Record<string, unknown>): AppRole | null {
  const value = String(profile.role ?? "").trim().toLowerCase();
  if (value === "admin" || value === "staff" || value === "dealer" || value === "accountant") return value;
  if (value === "nsm") return "admin";
  if (value === "rsm" || value === "asm") return "staff";
  if (profile.Dealer_Id) return "dealer";
  if (profile.staff_id) return String(profile.staff_roletype ?? "") === "0" ? "admin" : "staff";
  if (profile.accountant_id || profile._id) return "accountant";
  if (profile.admin_id || profile.Admin_Id || profile.ADMIN_EMAIL) return "admin";
  return null;
}

export function roleTypeForRole(role: AppRole, profile: Record<string, unknown> = {}) {
  if (role === "admin") return "3";
  if (role === "staff") return String(profile.staff_roletype ?? "1");
  if (role === "dealer") return "2";
  return "4";
}

type Policy = { pattern: RegExp; roles: AppRole[] };

const ROUTE_POLICIES: Policy[] = [
  { pattern: /^\/dashboard\/admin\/forms(?:\/|$)/, roles: ["admin"] },
  { pattern: /^\/dashboard\/staff\/forms(?:\/|$)/, roles: ["staff"] },
  { pattern: /^\/dashboard\/admin\/dealer\/AddDealerForm(?:\/|$)/, roles: ["admin", "staff"] },
  { pattern: /^\/dashboard\/admin\/dealer\/DealerList(?:\/|$)/, roles: ["admin", "accountant"] },
  { pattern: /^\/dashboard\/admin\/dealer\/[^/]+\/ledger(?:\/|$)/, roles: ["admin", "staff", "accountant"] },
  { pattern: /^\/dashboard\/admin\/dealer\/[^/]+(?:\/|$)/, roles: ["admin", "staff"] },
  { pattern: /^\/dashboard\/admin\/ledger(?:\/|$)/, roles: ["admin", "staff", "accountant"] },
  { pattern: /^\/dashboard\/admin(?:\/|$)/, roles: ["admin"] },
  { pattern: /^\/dashboard\/staff(?:\/|$)/, roles: ["staff"] },
  { pattern: /^\/dashboard\/dealer(?:\/|$)/, roles: ["dealer"] },
  { pattern: /^\/dashboard\/accountant(?:\/|$)/, roles: ["accountant"] },
  { pattern: /^\/dashboard(?:\/|$)/, roles: ["admin", "staff", "dealer", "accountant"] },
  { pattern: /^\/Pages\/products\/addproducts(?:\/|$)/, roles: ["admin"] },
  { pattern: /^\/Pages\/products(?:\/|$)/, roles: ["admin"] },
  { pattern: /^\/Pages\/Cart(?:\/|$)/, roles: ["dealer"] },
  { pattern: /^\/Pages\/ledger(?:\/|$)/, roles: ["dealer", "admin", "staff", "accountant"] },
  { pattern: /^\/Pages\/Ordermanagement(?:\/|$)/, roles: ["admin", "staff", "dealer", "accountant"] },
  { pattern: /^\/Pages(?:\/|$)/, roles: ["admin", "staff", "dealer", "accountant"] },
  { pattern: /^\/orders(?:\/|$)/, roles: ["admin", "staff", "dealer", "accountant"] },
  { pattern: /^\/drafts(?:\/|$)/, roles: ["dealer"] },
];

export function getAllowedRoles(pathname: string): AppRole[] | null {
  const policy = ROUTE_POLICIES.find((item) => item.pattern.test(pathname));
  return policy?.roles ?? null;
}

export function canAccessRoute(role: AppRole, pathname: string) {
  const allowed = getAllowedRoles(pathname);
  return !allowed || allowed.includes(role);
}

export function getRoleHome(role: AppRole) {
  if (role === "admin") return "/dashboard/admin";
  if (role === "staff") return "/dashboard/staff";
  if (role === "dealer") return "/home";
  return "/dashboard/accountant";
}
