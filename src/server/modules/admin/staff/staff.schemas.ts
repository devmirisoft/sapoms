import { z } from "zod";
import { AdminRouteError } from "@/server/admin/admin-errors";
import { parseAdminPagination } from "@/server/admin/admin-pagination";
import type { AdminStaffListInput } from "./staff.types";

export function parseAdminStaffListInput(searchParams: URLSearchParams): AdminStaffListInput {
  const base = parseAdminPagination(searchParams);
  const roleParam = String(searchParams.get("role") ?? "").trim().toUpperCase();
  const includeNsm = ["1", "true", "yes"].includes(String(searchParams.get("includeNsm") ?? "").trim().toLowerCase());
  return { ...base, role: roleParam === "NSM" ? "NSM" : undefined, includeNsm };
}

const salesRegion = z.preprocess((value) => {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  return String(value).trim().toUpperCase();
}, z.enum(["NORTH_1", "NORTH_2", "SOUTH_1", "SOUTH_2", "WEST_1", "WEST_2", "EAST", "ROM", "CENTRAL"]).optional());

const warehouse = z.preprocess((value) => {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  return String(value).trim().toUpperCase();
}, z.enum(["AHMEDABAD", "AMBALA"]).optional());

const text = (max: number) => z.preprocess(
  (value) => (value === undefined || value === null ? undefined : String(value).trim()),
  z.string().max(max).optional(),
);

const requiredText = (max: number) => z.preprocess(
  (value) => (value === undefined || value === null ? "" : String(value).trim()),
  z.string().min(1).max(max),
);

const idText = z.preprocess((value) => {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  return String(value).trim();
}, z.string().regex(/^\d+$/).optional());

const assignedStates = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  const single = String(value).trim();
  return single ? [single] : [];
}, z.array(z.string().min(1).max(100)).max(40).optional());

const assignedCities = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  const single = String(value).trim();
  return single ? [single] : [];
}, z.array(z.string().min(1).max(100)).max(200).optional());

const dateValue = z.preprocess((value) => {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  const normalized = String(value).trim();
  const parsed = new Date(normalized + "T00:00:00.000Z");
  return Number.isNaN(parsed.getTime()) ? value : parsed;
}, z.date().optional());

function aliases(body: Record<string, unknown>) {
  return {
    name: body.name ?? body.staff_name ?? body.displayName,
    email: body.email ?? body.staff_email,
    password: body.password,
    role: body.role,
    designation: body.designation ?? body.staff_designation,
    location: body.location ?? body.staff_location,
    mobileNo: body.mobileNo ?? body.mobile_no ?? body.staff_mobile_no,
    alternateNo: body.alternateNo ?? body.alternate_no,
    permanentAddress: body.permanentAddress ?? body.permanent_address,
    localAddress: body.localAddress ?? body.local_address,
    gender: body.gender,
    dob: body.dob ?? body.date_of_birth,
    nationality: body.nationality,
    maritalStatus: body.maritalStatus ?? body.marital_status,
    qualification: body.qualification,
    emergencyContactNo1: body.emergencyContactNo1 ?? body.emergency_contact_no_1,
    emergencyContactNo2: body.emergencyContactNo2 ?? body.emergency_contact_no_2,
    staffRoleType: body.staffRoleType ?? body.staff_roletype,
    salesRegion: body.salesRegion ?? body.region,
    warehouse: body.warehouse ?? body.warehouse_code,
    parentRsmId: body.parentRsmId ?? body.parent_rsm_id ?? body.rsmId,
    parentAsmId: body.parentAsmId ?? body.parent_asm_id ?? body.asmId,
    assignedStates: body.assignedStates ?? body.assigned_states ?? body.states,
    assignedCities: body.assignedCities ?? body.assigned_cities ?? body.cities,
    reportingManagerId: body.reportingManagerId ?? body.reporting_manager_id ?? body.nsmId,
    status: body.status,
  };
}

const createRole = z.enum(["NSM", "RSM", "ASM", "STAFF"]);
const updateRole = z.enum(["STAFF", "RSM", "ASM", "NSM"]);

const baseStaffSchema = {
  name: requiredText(200),
  email: z.preprocess((value) => String(value ?? "").trim().toLowerCase(), z.string().email()),
  role: z.preprocess((value) => String(value ?? "STAFF").trim().toUpperCase(), createRole),
  designation: text(100),
  location: text(100),
  mobileNo: text(30),
  alternateNo: text(30),
  permanentAddress: text(1000),
  localAddress: text(1000),
  gender: text(20),
  dob: dateValue,
  nationality: text(100),
  maritalStatus: text(40),
  qualification: text(120),
  emergencyContactNo1: text(30),
  emergencyContactNo2: text(30),
  staffRoleType: text(30),
  salesRegion,
  warehouse,
  parentRsmId: idText,
  parentAsmId: idText,
  assignedStates,
  assignedCities,
  reportingManagerId: idText,
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
};

function requireValidRoleRegion<T extends { role?: string; salesRegion?: string; warehouse?: string; staffRoleType?: string; parentRsmId?: string; parentAsmId?: string; assignedStates?: string[]; assignedCities?: string[]; reportingManagerId?: string }>(value: T) {
  if (value.role === "RSM" && !value.salesRegion) throw new AdminRouteError("INVALID_REQUEST", "RSM region is required", { code: "RSM_REGION_REQUIRED" });
  if (value.role && value.role !== "RSM") value.salesRegion = undefined;
  if (value.role === "STAFF" && value.staffRoleType !== "1" && value.staffRoleType !== "2") {
    throw new AdminRouteError("INVALID_REQUEST", "Staff role type is required", { code: "STAFF_ROLE_TYPE_REQUIRED" });
  }
  if (value.role === "ASM" && !value.parentRsmId) throw new AdminRouteError("INVALID_REQUEST", "ASM must have a valid RSM parent", { code: "ASM_RSM_REQUIRED" });
  if (value.role === "STAFF" && value.staffRoleType === "1" && !value.parentAsmId) throw new AdminRouteError("INVALID_REQUEST", "Sales Manager must have a valid ASM parent", { code: "EXECUTIVE_ASM_REQUIRED" });
  if (value.role === "ASM" && value.assignedStates && !value.assignedStates.length) throw new AdminRouteError("INVALID_REQUEST", "ASM must cover at least one state", { code: "ASM_STATES_REQUIRED" });
  if (value.role === "STAFF" && value.staffRoleType === "1" && value.assignedCities && !value.assignedCities.length) throw new AdminRouteError("INVALID_REQUEST", "Sales Manager must cover at least one city", { code: "EXECUTIVE_CITIES_REQUIRED" });
  if (value.role === "STAFF" && value.staffRoleType === "2" && !value.parentRsmId) throw new AdminRouteError("INVALID_REQUEST", "Staff must have a valid RSM parent", { code: "STAFF_RSM_REQUIRED" });
  // Only a Staff member is pinned to a warehouse; every other role sees both.
  if (value.role === "STAFF" && value.staffRoleType === "2" && !value.warehouse) throw new AdminRouteError("INVALID_REQUEST", "Warehouse is required", { code: "STAFF_WAREHOUSE_REQUIRED" });
  if (value.role && !(value.role === "STAFF" && value.staffRoleType === "2")) value.warehouse = undefined;
  if (value.role === "NSM") { value.staffRoleType = undefined; value.parentRsmId = undefined; value.parentAsmId = undefined; value.assignedStates = undefined; }
  if (value.role === "RSM") { value.staffRoleType = "RSM"; value.parentRsmId = undefined; value.parentAsmId = undefined; }
  if (value.role === "ASM") { value.staffRoleType = "ASM"; value.parentAsmId = undefined; }
  // A Sales Manager's territory is a city list carved out of its ASM's cities; its
  // states are derived from those cities on write, never picked in the form.
  if (value.role === "STAFF" && value.staffRoleType === "1") { value.parentRsmId = undefined; value.assignedStates = undefined; }
  if (value.role === "STAFF" && value.staffRoleType === "2") { value.parentAsmId = undefined; value.assignedStates = undefined; value.assignedCities = undefined; }
  // Only RSM has an explicit reporting manager (NSM); ASM/STAFF derive theirs from parentRsm/parentAsm.
  if (value.role && value.role !== "RSM") value.reportingManagerId = undefined;
  // Only the Sales Manager holds a city list, carved out of its ASM's states;
  // NSM/RSM/ASM/Staff hold no cities of their own.
  if (!(value.role === "STAFF" && value.staffRoleType === "1")) value.assignedCities = undefined;
  return value;
}

const requireReportingManagerForCreate = <T extends { role?: string; reportingManagerId?: string }>(value: T) => {
  if (value.role === "RSM" && !value.reportingManagerId) {
    throw new AdminRouteError("INVALID_REQUEST", "RSM must have a valid NSM reporting manager", { code: "RSM_NSM_REQUIRED" });
  }
  return value;
};

/**
 * Territory is mandatory at creation time. The shared transform only rejects a
 * list that was sent explicitly empty, so that a partial update may leave the
 * field alone; on create an omitted list is just as invalid as an empty one.
 */
const requireTerritoryForCreate = <T extends { role?: string; staffRoleType?: string; assignedStates?: string[]; assignedCities?: string[] }>(value: T) => {
  if (value.role === "ASM" && !value.assignedStates?.length) {
    throw new AdminRouteError("INVALID_REQUEST", "ASM must cover at least one state", { code: "ASM_STATES_REQUIRED" });
  }
  if (value.role === "STAFF" && value.staffRoleType === "1" && !value.assignedCities?.length) {
    throw new AdminRouteError("INVALID_REQUEST", "Sales Manager must cover at least one city", { code: "EXECUTIVE_CITIES_REQUIRED" });
  }
  return value;
};

const createSchema = z.preprocess((value) => aliases((value && typeof value === "object" ? value : {}) as Record<string, unknown>), z.object({
  ...baseStaffSchema,
  password: z.string().min(10).max(200),
}).transform(requireValidRoleRegion).transform(requireReportingManagerForCreate).transform(requireTerritoryForCreate));

const updateSchema = z.preprocess((value) => aliases((value && typeof value === "object" ? value : {}) as Record<string, unknown>), z.object({
  name: text(200),
  email: z.preprocess((value) => value === undefined || value === null || String(value).trim() === "" ? undefined : String(value).trim().toLowerCase(), z.string().email().optional()),
  role: z.preprocess((value) => value === undefined || value === null || String(value).trim() === "" ? undefined : String(value).trim().toUpperCase(), updateRole.optional()),
  designation: text(100),
  location: text(100),
  staffRoleType: text(30),
  salesRegion,
  warehouse,
  parentRsmId: idText,
  parentAsmId: idText,
  assignedStates,
  assignedCities,
  reportingManagerId: idText,
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
}).refine((value) => Object.values(value).some((entry) => entry !== undefined), "At least one field is required").transform(requireValidRoleRegion));

const statusSchema = z.object({
  status: z.preprocess((value) => String(value ?? "").trim().toUpperCase(), z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"])),
  reason: text(500),
});

function parseWith<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message || "Invalid request";
    throw new AdminRouteError("INVALID_REQUEST", first, { code: "INVALID_REQUEST" });
  }
  return parsed.data;
}

export function parseCreateAdminStaffInput(body: unknown) {
  return parseWith(createSchema, body);
}

export function parseUpdateAdminStaffInput(body: unknown) {
  return parseWith(updateSchema, body);
}

export function parseUpdateStaffStatusInput(body: unknown) {
  return parseWith(statusSchema, body);
}
