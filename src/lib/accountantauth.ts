// Lightweight auth helpers for the accountant cookie session flow

export const ACCOUNTANT_API = "/api";

export async function isAuthenticated(): Promise<boolean> {
  const res = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
  return res.ok;
}

// ── Authenticated fetch wrapper ───────────────────────────────────────────────

export async function accountantFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${ACCOUNTANT_API}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

// ── Typed API calls ───────────────────────────────────────────────────────────

export async function fetchAllAccountants() {
  const res = await accountantFetch("/admin/accountants");
  if (!res.ok) throw new Error("Failed to fetch accountants");
  const json = await res.json();
  return json.data;
}

export async function fetchAccountantById(id: string) {
  const res = await accountantFetch(`/admin/accountants/${id}`);
  if (!res.ok) throw new Error("Accountant not found");
  const json = await res.json();
  return json.data;
}

export async function createAccountant(body: {
  name: string;
  email: string;
  password: string;
  phone: string;
}) {
  const res = await accountantFetch("/admin/accountants", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || "Create failed");
  return json.data;
}

export async function updateAccountant(
  id: string,
  body: Partial<{ name: string; email: string; phone: string; role: string }>
) {
  const res = await accountantFetch(`/admin/accountants/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || "Update failed");
  return json.data;
}

export async function deleteAccountant(id: string) {
  const res = await accountantFetch(`/admin/accountants/${id}`, { method: "DELETE" });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || "Delete failed");
}

export async function fetchAllOrders() {
  const res = await accountantFetch("/orders");
  if (!res.ok) throw new Error("Failed to fetch orders");
  const json = await res.json();
  return json.data;
}

export async function fetchNewOrders() {
  const res = await accountantFetch("/orders/new");
  if (!res.ok) throw new Error("Failed to fetch new orders");
  const json = await res.json();
  return json.data;
}

