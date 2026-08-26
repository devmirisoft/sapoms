import { z } from "zod";
import { AdminRouteError } from "@/server/admin/admin-errors";
import { parseAdminPagination } from "@/server/admin/admin-pagination";

const staffId = z.preprocess(
  (value) => (value === undefined || value === null || String(value).trim() === "" ? undefined : String(value).trim()),
  z.string().regex(/^\d+$/).optional(),
);

const listStatus = z.preprocess(
  (value) => (value === undefined || value === null || String(value).trim() === "" ? undefined : String(value).trim().toUpperCase()),
  z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
);

const walletFilter = z.preprocess(
  (value) => (value === undefined || value === null || String(value).trim() === "" ? undefined : String(value).trim().toLowerCase()),
  z.enum(["active", "inactive"]).optional(),
);

const listText = (max: number) => z.preprocess(
  (value) => (value === undefined || value === null || String(value).trim() === "" ? undefined : String(value).trim()),
  z.string().max(max).optional(),
);

export function parseAdminDealerListInput(searchParams: URLSearchParams) {
  const base = parseAdminPagination(searchParams);
  return {
    ...base,
    staffId: staffId.parse(searchParams.get("staffId")),
    status: listStatus.parse(searchParams.get("status")),
    wallet: walletFilter.parse(searchParams.get("wallet")),
    city: listText(100).parse(searchParams.get("city")),
    name: listText(200).parse(searchParams.get("name")),
    email: listText(200).parse(searchParams.get("email")),
    phone: listText(30).parse(searchParams.get("phone")),
  };
}

const text = (max: number) => z.preprocess(
  (value) => (value === undefined || value === null ? undefined : String(value).trim()),
  z.string().max(max).optional(),
);

const requiredText = (max: number) => z.preprocess(
  (value) => (value === undefined || value === null ? "" : String(value).trim()),
  z.string().min(1).max(max),
);

const optionalInteger = (max: number) => z.preprocess((value) => {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  const parsed = Number(String(value).trim());
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}, z.number().int().min(0).max(max).optional());

const optionalDecimalPercent = z.preprocess((value) => {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  return String(value).trim();
}, z.string().regex(/^\d+(?:\.\d{1,4})?$/).refine((value) => Number(value) >= 0 && Number(value) <= 100, "Discount must be between 0 and 100").optional());

const optionalBigIntString = z.preprocess((value) => {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  // Amounts arrive from the admin forms as free text, so tolerate grouping separators,
  // a currency prefix, and a decimal tail rather than rejecting the whole save.
  const cleaned = String(value).trim().replace(/[\s,₹]/g, "");
  const whole = /^\d+(?:\.\d+)?$/.test(cleaned) ? cleaned.split(".")[0] : cleaned;
  return whole === "" ? undefined : whole;
}, z.string().regex(/^\d+$/).optional());

const optionalPriorityContact = z.preprocess((value) => {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  return String(value).trim().toLowerCase() === "secondary" ? "secondary" : "primary";
}, z.enum(["primary", "secondary"]).optional());

const optionalEmail = z.preprocess(
  (value) => (value === undefined || value === null || String(value).trim() === "" ? undefined : String(value).trim().toLowerCase()),
  z.string().email().max(200).optional(),
);

const optionalBoolean = z.preprocess((value) => {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "advance"].includes(normalized)) return true;
  if (["false", "0", "credit"].includes(normalized)) return false;
  return undefined;
}, z.boolean().optional());

const staffIds = z.preprocess((value) => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (typeof value === "number" || typeof value === "bigint") return [String(value)];
  return value;
}, z.array(z.string().regex(/^\d+$/)).transform((values) => Array.from(new Set(values))));

const optionalStaffIds = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (typeof value === "number" || typeof value === "bigint") return [String(value)];
  return value;
}, z.array(z.string().regex(/^\d+$/)).transform((values) => Array.from(new Set(values))).optional());

function aliases(body: Record<string, unknown>) {
  return {
    businessName: body.businessName ?? body.Dealer_Name ?? body.name,
    email: body.email ?? body.Dealer_Email,
    password: body.password ?? body.Dealer_Password,
    phone: body.phone ?? body.Dealer_Number ?? body.whatsapp,
    dealerCode: body.dealerCode ?? body.Dealer_Dealercode,
    address: body.address ?? body.Dealer_Address,
    city: body.city ?? body.Dealer_City,
    state: body.state,
    pincode: body.pincode ?? body.Dealer_Pincode,
    gstin: body.gstin ?? body.gst ?? body.gstNo,
    discountPercent: body.discountPercent ?? body.discount,
    creditDays: body.creditDays ?? body.creditdays,
    creditLimitPaise: body.creditLimitPaise ?? body.currentLimit,
    annualTargetPaise: body.annualTargetPaise ?? body.annualTarget ?? body.annualtarget,
    notes: body.notes ?? body.Dealer_Notes,
    // `contactPerson` is the legacy key kept for payloads built before the rename to `priorityPerson`.
    priorityContact: body.priorityContact ?? body.priorityPerson ?? body.contactPerson ?? body.Dealer_Contact_Person,
    secondaryContactName: body.secondaryContactName ?? body.Dealer_Secondary_Contact_Name,
    secondaryContactPhone: body.secondaryContactPhone ?? body.Dealer_Secondary_Contact_Phone,
    secondaryContactEmail: body.secondaryContactEmail ?? body.Dealer_Secondary_Contact_Email,
    imageUrl: body.imageUrl,
    status: body.status,
    assignedStaffIds: body.assignedStaffIds ?? body.assignedstaff,
    rsmUserId: body.rsmUserId ?? body.rsmId ?? body.regionalManagerId,
    walletActive: body.walletActive ?? body.paymentType,
  };
}

const createSchema = z.preprocess((value) => aliases((value && typeof value === "object" ? value : {}) as Record<string, unknown>), z.object({
  businessName: requiredText(200),
  email: z.preprocess((value) => String(value ?? "").trim().toLowerCase(), z.string().email()),
  password: z.string().min(10).max(200),
  phone: text(30),
  dealerCode: text(50),
  address: text(500),
  city: text(100),
  state: text(100),
  pincode: text(20),
  gstin: text(30),
  discountPercent: optionalDecimalPercent,
  creditDays: optionalInteger(3650),
  creditLimitPaise: optionalBigIntString,
  annualTargetPaise: optionalBigIntString,
  notes: text(2000),
  priorityContact: optionalPriorityContact,
  secondaryContactName: text(200),
  secondaryContactPhone: text(30),
  secondaryContactEmail: optionalEmail,
  imageUrl: text(1000),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
  assignedStaffIds: staffIds.default([]),
  rsmUserId: optionalBigIntString,
  walletActive: optionalBoolean,
}));

const updateSchema = z.preprocess((value) => aliases((value && typeof value === "object" ? value : {}) as Record<string, unknown>), z.object({
  businessName: text(200),
  email: z.preprocess((value) => value === undefined || value === null || String(value).trim() === "" ? undefined : String(value).trim().toLowerCase(), z.string().email().optional()),
  phone: text(30),
  dealerCode: text(50),
  address: text(500),
  city: text(100),
  state: text(100),
  pincode: text(20),
  gstin: text(30),
  discountPercent: optionalDecimalPercent,
  creditDays: optionalInteger(3650),
  creditLimitPaise: optionalBigIntString,
  annualTargetPaise: optionalBigIntString,
  notes: text(2000),
  priorityContact: optionalPriorityContact,
  secondaryContactName: text(200),
  secondaryContactPhone: text(30),
  secondaryContactEmail: optionalEmail,
  imageUrl: text(1000),
  assignedStaffIds: optionalStaffIds,
  rsmUserId: optionalBigIntString,
  walletActive: optionalBoolean,
}).refine((value) => Object.values(value).some((entry) => entry !== undefined), "At least one field is required"));

const statusSchema = z.object({
  status: z.preprocess((value) => String(value ?? "").trim().toUpperCase(), z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"])),
  reason: text(500),
});

const staffReplaceSchema = z.object({
  staffIds,
  rsmUserId: optionalBigIntString,
});

function parseWith<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message || "Invalid request";
    throw new AdminRouteError("INVALID_REQUEST", first, { code: "INVALID_REQUEST" });
  }
  return parsed.data;
}

export function parseCreateAdminDealerInput(body: unknown) {
  return parseWith(createSchema, body);
}

export function parseUpdateAdminDealerInput(body: unknown) {
  return parseWith(updateSchema, body);
}

export function parseUpdateDealerStatusInput(body: unknown) {
  return parseWith(statusSchema, body);
}

export function parseReplaceDealerStaffInput(body: unknown) {
  return parseWith(staffReplaceSchema, body);
}


