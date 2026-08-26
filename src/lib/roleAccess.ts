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

export type AuthStorage = Pick<Storage, "getItem" | "removeItem">;
export type AuthStorageWriter = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const AUTH_KEYS = [
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


function parseObject(storage: AuthStorage, key: string): StoredUser | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as StoredUser;
}

export function clearAuthStorage(storage: AuthStorage) {
  AUTH_KEYS.forEach((key) => storage.removeItem(key));
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

export function persistAuthenticatedSession(storage: AuthStorageWriter, profile: StoredUser, roleOverride?: AppRole) {
  const role = roleOverride ?? normalizeRoleFromProfile(profile);
  if (!role) return null;

  const user = { ...profile, role } as StoredUser;
  const roletype = roleTypeForRole(role, user);
  clearAuthStorage(storage);
  storage.setItem("status", "true");
  storage.setItem("UserData", JSON.stringify(user));
  storage.setItem("roletype", roletype);
  storage.setItem("role", role);
  storage.setItem("roleType", roletype);

  if (role === "admin") storage.setItem("AdminData", JSON.stringify(user));
  if (role === "staff") storage.setItem("staffData", JSON.stringify(user));
  if (role === "accountant") storage.setItem("AccountantData", JSON.stringify(user));

  return session(role, user, roletype);
}

function normalizeRoleFromRoleType(roletype: unknown): AppRole | null {
  const value = String(roletype ?? "").trim().toLowerCase();
  if (value === "3" || value === "0" || value === "admin") return "admin";
  if (value === "1" || value === "staff") return "staff";
  if (value === "2" || value === "dealer") return "dealer";
  if (value === "4" || value === "accountant") return "accountant";
  return null;
}

function normalizeRoleFromStaffRoleType(staffRoletype: unknown): AppRole | null {
  const value = String(staffRoletype ?? "").trim().toLowerCase();
  if (value === "0" || value === "admin") return "admin";
  if (value === "1" || value === "2" || value === "staff" || value === "executive" || value === "field executive" || value === "rsm" || value === "asm") {
    return "staff";
  }
  return null;
}

function session(role: AppRole, user: StoredUser, roletype?: unknown): AuthSession {
  return {
    status: "authenticated",
    role,
    roletype: String(roletype ?? (role === "admin" ? "3" : role === "staff" ? "1" : role === "dealer" ? "2" : "4")),
    user: { ...user, role },
  };
}

export function resolveStoredAuth(storage: AuthStorage): AuthSession {
  try {
    const userData = parseObject(storage, "UserData");
    if (userData && Object.keys(userData).length > 0) {
      const role = normalizeRoleFromProfile(userData) ?? normalizeRoleFromRoleType(storage.getItem("roletype") ?? userData.role);
      if (role) return session(role, userData, roleTypeForRole(role, userData));
      return { status: "unauthenticated", reason: "unsupported-role" };
    }

    const staff = parseObject(storage, "staffData");
    if (staff?.staff_id) {
      const role = normalizeRoleFromStaffRoleType(staff.staff_roletype);
      if (role === "admin" || role === "staff") return session(role, staff, roleTypeForRole(role, staff));
      return { status: "unauthenticated", reason: "unsupported-role" };
    }

    const admin = parseObject(storage, "AdminData") ?? parseObject(storage, "admin");
    if (admin && Object.keys(admin).length > 0) {
      const role = normalizeRoleFromProfile(admin) ?? normalizeRoleFromRoleType(storage.getItem("roletype") ?? admin.role);
      if (role === "admin") return session("admin", admin, "3");
      return { status: "unauthenticated", reason: "unsupported-role" };
    }

    const accountant = parseObject(storage, "AccountantData");
    if (accountant && Object.keys(accountant).length > 0) {
      const role = normalizeRoleFromProfile(accountant) ?? normalizeRoleFromRoleType(storage.getItem("roletype") ?? accountant.role);
      if (role === "accountant") return session("accountant", accountant, "4");
      return { status: "unauthenticated", reason: "unsupported-role" };
    }

    return { status: "unauthenticated", reason: "missing" };
  } catch {
    clearAuthStorage(storage);
    return { status: "unauthenticated", reason: "invalid" };
  }
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
