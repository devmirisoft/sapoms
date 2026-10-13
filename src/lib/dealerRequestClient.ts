import { getCurrentSession } from "@/lib/currentUser";

export type DashboardActorRole = "admin" | "staff" | "dealer" | "accountant";

export type DashboardActor = {
  role: DashboardActorRole;
  actorId: string;
  actorName: string;
  roletype: string;
};

export function readDashboardActor(): DashboardActor | null {
  const session = getCurrentSession();
  if (session?.status !== "authenticated") return null;
  const user = session.user;

  if (session.role === "accountant") {
    return {
      role: "accountant",
      actorId: String(user.id ?? user.email ?? "").trim(),
      actorName: String(user.name ?? user.email ?? "Accountant").trim(),
      roletype: "accountant",
    };
  }

  if (session.role === "dealer") {
    return {
      role: "dealer",
      actorId: String(user.Dealer_Id ?? "").trim(),
      actorName: String(user.Dealer_Name ?? "Dealer").trim(),
      roletype: "2",
    };
  }

  if (session.role === "staff") {
    return {
      role: "staff",
      actorId: String(user.staff_id ?? "").trim(),
      actorName: String(user.staff_name ?? user.name ?? "Staff").trim(),
      roletype: String(user.staff_roletype ?? "1").trim(),
    };
  }

  return {
    role: "admin",
    actorId: String(user.staff_id ?? user.id ?? user.admin_id ?? user.Admin_Id ?? user.email ?? "admin").trim(),
    actorName: String(user.staff_name ?? user.name ?? user.username ?? user.email ?? "Admin").trim(),
    roletype: "0",
  };
}
