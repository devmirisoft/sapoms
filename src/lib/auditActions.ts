// Audit vocabulary, shared by the server writer and the admin page's filter
// dropdowns. Deliberately free of imports so the client bundle can use it.
//
// Naming follows SAPOMS, not generic CRUD: orders are ACCEPTED/DECLINED (see
// OrderAcceptanceStatus) while discount requests really are APPROVED/REJECTED
// (see DiscountRequestStatus). Using "APPROVE" for an order here would read as a
// different thing than it does everywhere else in the app.

export const AUDIT_ACTION = {
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",

  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  LOGIN_FAILED: "LOGIN_FAILED",

  ACCEPT: "ACCEPT",
  DECLINE: "DECLINE",
  APPROVE: "APPROVE",
  REJECT: "REJECT",
  CANCEL: "CANCEL",
  REVIVE: "REVIVE",

  STATUS_CHANGE: "STATUS_CHANGE",

  DISPATCH: "DISPATCH",
  DELIVER: "DELIVER",

  PAYMENT_RECEIVED: "PAYMENT_RECEIVED",
  MARK_PAID: "MARK_PAID",

  ASSIGN: "ASSIGN",
  UNASSIGN: "UNASSIGN",

  IMPORT: "IMPORT",
  EXPORT: "EXPORT",

  ROLE_CHANGE: "ROLE_CHANGE",

  DISCOUNT_APPLIED: "DISCOUNT_APPLIED",
  DISCOUNT_CHANGED: "DISCOUNT_CHANGED",

  // Defined for completeness; SAPOMS has no stock model yet, so nothing writes
  // these. Remove them only when an inventory subsystem lands and supersedes it.
  STOCK_ADJUSTED: "STOCK_ADJUSTED",
  STOCK_TRANSFERRED: "STOCK_TRANSFERRED",
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

export const AUDIT_ENTITY = {
  USER: "USER",
  STAFF: "STAFF",
  DEALER: "DEALER",
  ORDER: "ORDER",
  ORDER_ITEM: "ORDER_ITEM",
  PRODUCT: "PRODUCT",
  CATEGORY: "CATEGORY",
  INVOICE: "INVOICE",
  PAYMENT: "PAYMENT",
  DISPATCH: "DISPATCH",
  DISCOUNT_REQUEST: "DISCOUNT_REQUEST",
  WALLET: "WALLET",
  SETTLEMENT: "SETTLEMENT",
  COURIER: "COURIER",
  SETTINGS: "SETTINGS",
} as const;

export type AuditEntity = (typeof AUDIT_ENTITY)[keyof typeof AUDIT_ENTITY];

export const AUDIT_ACTIONS = Object.values(AUDIT_ACTION);
export const AUDIT_ENTITIES = Object.values(AUDIT_ENTITY);

/** "STATUS_CHANGE" -> "Status change"; also tidies the legacy ADMIN_* eventTypes. */
export function auditLabel(value: string | null | undefined) {
  if (!value) return "—";
  const text = value.replace(/^ADMIN_/, "").replace(/_/g, " ").toLowerCase().trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type Tone = "emerald" | "rose" | "amber" | "indigo" | "slate";

const TONE_BY_ACTION: Record<string, Tone> = {
  CREATE: "emerald",
  ACCEPT: "emerald",
  APPROVE: "emerald",
  DELIVER: "emerald",
  PAYMENT_RECEIVED: "emerald",
  MARK_PAID: "emerald",
  LOGIN: "emerald",

  DELETE: "rose",
  DECLINE: "rose",
  REJECT: "rose",
  CANCEL: "rose",
  LOGIN_FAILED: "rose",

  UPDATE: "amber",
  STATUS_CHANGE: "amber",
  ROLE_CHANGE: "amber",
  DISCOUNT_APPLIED: "amber",
  DISCOUNT_CHANGED: "amber",
  STOCK_ADJUSTED: "amber",
  STOCK_TRANSFERRED: "amber",

  DISPATCH: "indigo",
  ASSIGN: "indigo",
  UNASSIGN: "indigo",
  IMPORT: "indigo",
  EXPORT: "indigo",
  REVIVE: "indigo",
};

const TONE_CLASS: Record<Tone, string> = {
  emerald: "bg-emerald-50 text-emerald-700",
  rose: "bg-rose-50 text-rose-700",
  amber: "bg-amber-50 text-amber-700",
  indigo: "bg-indigo-50 text-indigo-700",
  slate: "bg-slate-100 text-slate-700",
};

/** Tailwind classes for an action badge. Falls back to neutral for legacy events. */
export function auditActionClass(action: string | null | undefined) {
  const tone = (action && TONE_BY_ACTION[action]) || "slate";
  return TONE_CLASS[tone];
}
