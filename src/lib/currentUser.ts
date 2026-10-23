import { getQueryClient } from "@/lib/queryClient";
import {
  clearAuthStorage,
  LEGACY_AUTH_KEYS,
  LOGIN_ROUTE,
  normalizeRoleFromProfile,
  roleTypeForRole,
  type AppRole,
  type AuthSession,
  type StoredUser,
} from "@/lib/roleAccess";

// The signed-in user lives only in this query, fed by /api/auth/me. Nothing about
// the user is written to localStorage; the cookies carry the credentials.
export const CURRENT_USER_KEY = ["current-user"] as const;

export function sessionFromProfile(profile: unknown): AuthSession {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return { status: "unauthenticated", reason: "invalid" };
  }
  const user = profile as StoredUser;
  const role = normalizeRoleFromProfile(user);
  if (!role) return { status: "unauthenticated", reason: "unsupported-role" };
  return {
    status: "authenticated",
    role,
    roletype: roleTypeForRole(role, user),
    // authRole keeps the server role ("nsm") that the app role collapses into "admin".
    user: { ...user, authRole: user.role, role },
  };
}

// A 401 here means the fetch wrapper already tried a refresh and failed: signed out.
// Anything else (5xx, network) throws, so the query keeps the last good session and
// retries instead of sending a signed-in user to the login page.
export async function fetchCurrentSession(): Promise<AuthSession> {
  const res = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
  if (res.status === 401) return { status: "unauthenticated", reason: "missing" };
  if (!res.ok) throw new Error(`/api/auth/me failed with ${res.status}`);
  const json = await res.json();
  return sessionFromProfile(json?.data);
}

export function getCurrentSession(): AuthSession | undefined {
  return getQueryClient().getQueryData<AuthSession>(CURRENT_USER_KEY);
}

// For code outside React. Inside RouteGuard the session is always resolved before
// children render; elsewhere use useAuthSession() so the component re-renders.
export function getCurrentUser(): StoredUser | null {
  const session = getCurrentSession();
  return session?.status === "authenticated" ? session.user : null;
}

export function getCurrentRole(): AppRole | null {
  const session = getCurrentSession();
  return session?.status === "authenticated" ? session.role : null;
}

const channel = typeof window !== "undefined" && "BroadcastChannel" in window ? new BroadcastChannel("omsons-auth") : null;

// Another tab signed in, out, or switched identity: re-check who we are and refetch
// everything, since cached data may belong to the previous user.
channel?.addEventListener("message", () => void getQueryClient().invalidateQueries());

export function announceAuthChange() {
  channel?.postMessage("changed");
}

// The server just returned this user's profile (login, impersonation): use it directly.
export function setCurrentUser(profile: unknown): AuthSession {
  const session = sessionFromProfile(profile);
  getQueryClient().setQueryData(CURRENT_USER_KEY, session);
  announceAuthChange();
  return session;
}

// The profile changed on the server (profile edit, terms, password): re-read it.
export function refreshCurrentUser() {
  announceAuthChange();
  return getQueryClient().invalidateQueries({ queryKey: CURRENT_USER_KEY });
}

// Browser-only. An admin signed in as a dealer gets their admin session back from the
// server instead of being logged out; a full page load drops the dealer's client state.
// Only the server's answer plus a fresh /api/auth/me decide the identity shown next.
export async function logout() {
  // 503 means a transient server error while ending an impersonation; the server kept what a retry
  // needs. Two retries, then ?final=1 tells it to give up and clear everything.
  const attempts = ["/api/auth/logout", "/api/auth/logout", "/api/auth/logout?final=1"];
  // Read before the cache is cleared: an admin leaving a staff account goes back to the staff list.
  const wasStaff = getCurrentRole() === "staff";
  let body: { data?: { restored?: unknown } } | null = null;
  for (const [index, url] of attempts.entries()) {
    const res = await fetch(url, { method: "POST", credentials: "include" }).catch(() => null);
    if (res && res.status !== 503) {
      body = await res.json().catch(() => null);
      break;
    }
    if (index < attempts.length - 1) await new Promise((resolve) => setTimeout(resolve, 750 * (index + 1)));
  }
  clearAuthStorage(localStorage);
  getQueryClient().clear();
  announceAuthChange();
  if (body?.data?.restored === true) {
    const session = await fetchCurrentSession().catch(() => null);
    if (session?.status === "authenticated" && session.role === "admin") {
      window.location.href = wasStaff ? "/dashboard/admin/staff/stafflist" : "/dashboard/admin/dealer/DealerList";
      return;
    }
  }
  window.location.href = LOGIN_ROUTE;
}

// Browser-only. Admin signs in as a dealer or staff member; logout() brings the admin back.
async function impersonate(target: { dealerId: string } | { staffId: string }, home: string) {
  const res = await fetch("/api/auth/impersonate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(target),
    credentials: "include",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.status) throw new Error(data?.message || "Unable to sign in as this account");
  clearAuthStorage(localStorage);
  announceAuthChange();
  window.location.href = home;
}

export function loginAsDealer(dealerId: string | number) {
  return impersonate({ dealerId: String(dealerId) }, "/home");
}

export function loginAsStaff(staffId: string | number) {
  return impersonate({ staffId: String(staffId) }, "/dashboard/staff");
}

// Browsers that ran the old build still hold profile copies; drop them.
if (typeof window !== "undefined") {
  try {
    LEGACY_AUTH_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch {
    // storage unavailable
  }
}
