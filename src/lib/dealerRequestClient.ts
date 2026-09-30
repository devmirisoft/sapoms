export type DashboardActorRole = "admin" | "staff" | "dealer" | "accountant";

export type DashboardActor = {
  role: DashboardActorRole;
  actorId: string;
  actorName: string;
  roletype: string;
};

function parseStoredObject(key: string) {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function readDashboardActor(): DashboardActor | null {
  if (typeof window === "undefined") return null;

  const accountantToken = localStorage.getItem("AccountantData");
  if (accountantToken) {
    const accountant = parseStoredObject("AccountantData");
    return {
      role: "accountant",
      actorId: String(accountant?.id ?? accountant?.email ?? "").trim(),
      actorName: String(accountant?.name ?? accountant?.email ?? "Accountant").trim(),
      roletype: "accountant",
    };
  }

  const staff = parseStoredObject("staffData");
  if (typeof staff?.staff_id === "string" && staff.staff_id.trim()) {
    const isAdmin = String(staff.staff_roletype ?? "") === "0";
    return {
      role: isAdmin ? "admin" : "staff",
      actorId: String(staff.staff_id).trim(),
      actorName: String(staff.staff_name ?? staff.name ?? (isAdmin ? "Admin" : "Staff")).trim(),
      roletype: String(staff.staff_roletype ?? (isAdmin ? "0" : "1")).trim(),
    };
  }

  const userData = parseStoredObject("UserData");
  if (typeof userData?.staff_id === "string" && userData.staff_id.trim()) {
    const isAdmin = String(userData.staff_roletype ?? "") === "0";
    return {
      role: isAdmin ? "admin" : "staff",
      actorId: String(userData.staff_id).trim(),
      actorName: String(userData.staff_name ?? userData.name ?? (isAdmin ? "Admin" : "Staff")).trim(),
      roletype: String(userData.staff_roletype ?? (isAdmin ? "0" : "1")).trim(),
    };
  }

  if (typeof userData?.Dealer_Id === "string" && userData.Dealer_Id.trim()) {
    return {
      role: "dealer",
      actorId: String(userData.Dealer_Id).trim(),
      actorName: String(userData.Dealer_Name ?? "Dealer").trim(),
      roletype: "2",
    };
  }

  const admin = parseStoredObject("AdminData") ?? parseStoredObject("admin") ?? userData;
  if (admin && (Object.keys(admin).length > 0 || localStorage.getItem("roletype") === "3")) {
    return {
      role: "admin",
      actorId: String(admin.id ?? admin.admin_id ?? admin.Admin_Id ?? admin.staff_id ?? admin.email ?? "admin").trim(),
      actorName: String(admin.name ?? admin.username ?? admin.email ?? "Admin").trim(),
      roletype: "0",
    };
  }

  return null;
}
