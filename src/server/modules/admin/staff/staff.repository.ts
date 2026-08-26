import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { paginationToPrisma } from "@/server/admin/admin-pagination";
import { AdminRouteError } from "@/server/admin/admin-errors";
import { normalizeEmail } from "@/server/auth/providers/postgres-auth.provider";
import { hashPassword } from "@/server/auth/password";
import { citiesForStates, statesForCities } from "@/lib/places";
import type { AdminStaffListInput, AdminStaffRecord, CreateAdminStaffInput, UpdateAdminStaffInput } from "./staff.types";
import type { AuthActor } from "@/server/auth/session";

function buildWhere(input: AdminStaffListInput): Prisma.StaffProfileWhereInput {
  const search = input.search.trim();
  if (!search) return {};
  return {
    OR: [
      { displayName: { contains: search, mode: "insensitive" } },
      { designation: { contains: search, mode: "insensitive" } },
      { location: { contains: search, mode: "insensitive" } },
      { user: { email: { contains: search, mode: "insensitive" } } },
      { user: { username: { contains: search, mode: "insensitive" } } },
    ],
  };
}

const include = {
  user: { select: { id: true, email: true, username: true, status: true, role: true } },
  parentRsm: { select: { id: true, displayName: true, user: { select: { id: true, email: true } } } },
  parentAsm: { select: { id: true, displayName: true, user: { select: { id: true, email: true } } } },
  reportingManager: { select: { id: true, displayName: true, user: { select: { id: true, email: true } } } },
} satisfies Prisma.StaffProfileInclude;

const nsmWhereBase: Prisma.AdminProfileWhereInput = { user: { role: "NSM", status: "ACTIVE", deletedAt: null } };

function buildNsmWhere(input: AdminStaffListInput): Prisma.AdminProfileWhereInput {
  const search = input.search.trim();
  if (!search) return nsmWhereBase;
  return {
    ...nsmWhereBase,
    OR: [
      { displayName: { contains: search, mode: "insensitive" } },
      { user: { email: { contains: search, mode: "insensitive" } } },
    ],
  };
}

function conflict(message: string, code: string) {
  return new AdminRouteError("CONFLICT", message, { code });
}

function invalid(message: string, code: string, details?: Record<string, unknown>) {
  return new AdminRouteError("INVALID_REQUEST", message, { code, ...details });
}

function notFound(message: string, code = "NOT_FOUND") {
  return new AdminRouteError("NOT_FOUND", message, { code });
}

function cleanOptional(value: string | undefined) {
  return value === undefined ? undefined : value.trim();
}

function uniqueStrings(values?: string[]) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function parseId(value: string | undefined, code: string) {
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    throw invalid("Invalid staff hierarchy id", code, { value });
  }
}

function assertSubset(selected: string[], allowed: string[], code: string, label: "states" | "cities" = "states") {
  const allowedSet = new Set(allowed.map((entry) => entry.toLowerCase()));
  const outside = selected.filter((entry) => !allowedSet.has(entry.toLowerCase()));
  if (!outside.length) return;
  const scope = label === "cities" ? "parent ASM" : "parent RSM";
  throw invalid(`Selected ${label} must be within the ${scope} scope`, code, { [label]: outside });
}

function buildSyntheticRecord(args: {
  id: bigint;
  displayName: string;
  designation: string | null;
  location: string | null;
  staffRoleType: string | null;
  salesRegion: AdminStaffRecord["salesRegion"];
  user: AdminStaffRecord["user"];
}): AdminStaffRecord {
  return {
    id: args.id,
    displayName: args.displayName,
    designation: args.designation,
    location: args.location,
    mobileNo: null,
    alternateNo: null,
    permanentAddress: null,
    localAddress: null,
    gender: null,
    dob: null,
    nationality: null,
    maritalStatus: null,
    qualification: null,
    emergencyContactNo1: null,
    emergencyContactNo2: null,
    staffRoleType: args.staffRoleType,
    salesRegion: args.salesRegion,
    parentRsmId: null,
    parentAsmId: null,
    assignedStates: [],
    assignedCities: [],
    reportingManagerId: null,
    parentRsm: null,
    parentAsm: null,
    reportingManager: null,
    user: args.user,
  };
}

async function audit(tx: Prisma.TransactionClient, actor: AuthActor, eventType: string, metadata: Record<string, unknown>) {
  await tx.authAuditLog.create({
    data: { sessionId: actor.sessionId, role: actor.role, eventType, metadata: { ...metadata, userId: actor.userId.toString() } },
  });
}

async function ensureUniqueEmail(tx: Prisma.TransactionClient, email: string, currentUserId?: bigint) {
  const normalizedEmail = normalizeEmail(email);
  const duplicate = await tx.user.findUnique({ where: { normalizedEmail }, select: { id: true } });
  if (duplicate && duplicate.id !== currentUserId) throw conflict("Email already exists", "EMAIL_CONFLICT");
  return normalizedEmail;
}

async function resolveRsm(tx: Prisma.TransactionClient, id: bigint | null) {
  if (!id) throw invalid("RSM parent is required", "RSM_PARENT_REQUIRED");
  const rsm = await tx.staffProfile.findFirst({
    where: { id, user: { role: "RSM", status: "ACTIVE", deletedAt: null } },
    select: { id: true, assignedStates: true },
  });
  if (!rsm) throw invalid("Selected RSM was not found", "RSM_PARENT_INVALID", { rsmId: id.toString() });
  return rsm;
}

async function resolveAsm(tx: Prisma.TransactionClient, id: bigint | null) {
  if (!id) throw invalid("ASM parent is required", "ASM_PARENT_REQUIRED");
  const asm = await tx.staffProfile.findFirst({
    where: { id, user: { role: "ASM", status: "ACTIVE", deletedAt: null } },
    select: { id: true, parentRsmId: true, assignedStates: true, assignedCities: true },
  });
  if (!asm?.parentRsmId) throw invalid("Selected ASM was not found or has no RSM parent", "ASM_PARENT_INVALID", { asmId: id.toString() });
  return { id: asm.id, parentRsmId: asm.parentRsmId, assignedStates: asm.assignedStates, assignedCities: asm.assignedCities };
}

async function resolveNsm(tx: Prisma.TransactionClient, id: bigint | null) {
  if (!id) throw invalid("NSM reporting manager is required", "RSM_NSM_REQUIRED");
  const nsm = await tx.adminProfile.findFirst({
    where: { id, user: { role: "NSM", status: "ACTIVE", deletedAt: null } },
    select: { id: true },
  });
  if (!nsm) throw invalid("Selected NSM was not found", "RSM_NSM_INVALID", { nsmId: id.toString() });
  return nsm;
}

export class PostgresAdminStaffRepository {
  async list(input: AdminStaffListInput): Promise<{ items: AdminStaffRecord[]; total: number }> {
    const { skip, take } = paginationToPrisma(input);

    if (input.role === "NSM") {
      const where = buildNsmWhere(input);
      const [profiles, total] = await prisma.$transaction([
        prisma.adminProfile.findMany({
          where,
          include: { user: { select: { id: true, email: true, username: true, status: true, role: true } } },
          orderBy: { id: "desc" },
          skip,
          take,
        }),
        prisma.adminProfile.count({ where }),
      ]);
      const items = profiles.map((profile) => buildSyntheticRecord({
        id: profile.id,
        displayName: profile.displayName,
        designation: "NSM",
        location: null,
        staffRoleType: "NSM",
        salesRegion: null,
        user: profile.user,
      }));
      return { items, total };
    }

    const where = buildWhere(input);
    const [items, total] = await prisma.$transaction([
      prisma.staffProfile.findMany({ where, include, orderBy: { id: "desc" }, skip, take }),
      prisma.staffProfile.count({ where }),
    ]);
    return { items, total };
  }

  async findById(staffId: bigint): Promise<AdminStaffRecord | null> {
    return prisma.staffProfile.findUnique({ where: { id: staffId }, include });
  }

  async create(input: CreateAdminStaffInput, actor: AuthActor): Promise<AdminStaffRecord> {
    return prisma.$transaction(async (tx) => {
      const normalizedEmail = await ensureUniqueEmail(tx, input.email);
      const passwordHash = await hashPassword(input.password);
      let parentRsmId: bigint | null = null;
      let parentAsmId: bigint | null = null;
      let reportingManagerId: bigint | null = null;
      let assignedStates = uniqueStrings(input.assignedStates);
      let assignedCities = uniqueStrings(input.assignedCities);

      if (input.role === "ASM") {
        const rsm = await resolveRsm(tx, parseId(input.parentRsmId, "ASM_RSM_INVALID"));
        assertSubset(assignedStates, rsm.assignedStates, "ASM_STATES_OUTSIDE_RSM_SCOPE");
        assertSubset(assignedCities, citiesForStates(assignedStates), "ASM_CITIES_OUTSIDE_STATE_SCOPE", "cities");
        parentRsmId = rsm.id;
      } else if (input.role === "STAFF" && input.staffRoleType === "1") {
        const asm = await resolveAsm(tx, parseId(input.parentAsmId, "EXECUTIVE_ASM_INVALID"));
        parentAsmId = asm.id;
        parentRsmId = asm.parentRsmId;
        // A Sales Manager works a subset of its ASM's cities; its states are
        // derived from those cities rather than picked separately.
        assertSubset(assignedCities, asm.assignedCities, "EXECUTIVE_CITIES_OUTSIDE_ASM_SCOPE", "cities");
        assignedStates = statesForCities(assignedCities, asm.assignedStates);
      } else if (input.role === "STAFF" && input.staffRoleType === "2") {
        const rsm = await resolveRsm(tx, parseId(input.parentRsmId, "STAFF_RSM_INVALID"));
        parentRsmId = rsm.id;
        assignedStates = [];
        assignedCities = [];
      } else if (input.role === "RSM") {
        const nsm = await resolveNsm(tx, parseId(input.reportingManagerId, "RSM_NSM_INVALID"));
        reportingManagerId = nsm.id;
        assignedCities = [];
      } else {
        assignedStates = [];
        assignedCities = [];
      }

      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          normalizedEmail,
          username: normalizedEmail,
          normalizedUsername: normalizedEmail,
          passwordHash,
          role: input.role,
          status: input.status ?? "ACTIVE",
        },
      });

      if (input.role === "NSM") {
        const profile = await tx.adminProfile.create({ data: { userId: user.id, displayName: input.name } });
        await audit(tx, actor, "ADMIN_NSM_CREATED", { userId: user.id.toString() });
        return buildSyntheticRecord({
          id: profile.id,
          displayName: profile.displayName,
          designation: "NSM",
          location: null,
          staffRoleType: "NSM",
          salesRegion: null,
          user: { id: user.id, email: user.email, username: user.username, status: user.status, role: user.role },
        });
      }

      const staff = await tx.staffProfile.create({
        data: {
          userId: user.id,
          parentRsmId,
          parentAsmId,
          displayName: input.name,
          designation: cleanOptional(input.designation),
          location: cleanOptional(input.location),
          mobileNo: cleanOptional(input.mobileNo),
          alternateNo: cleanOptional(input.alternateNo),
          permanentAddress: cleanOptional(input.permanentAddress),
          localAddress: cleanOptional(input.localAddress),
          gender: cleanOptional(input.gender),
          dob: input.dob,
          nationality: cleanOptional(input.nationality),
          maritalStatus: cleanOptional(input.maritalStatus),
          qualification: cleanOptional(input.qualification),
          emergencyContactNo1: cleanOptional(input.emergencyContactNo1),
          emergencyContactNo2: cleanOptional(input.emergencyContactNo2),
          staffRoleType: input.role === "RSM" ? "RSM" : input.role === "ASM" ? "ASM" : cleanOptional(input.staffRoleType),
          salesRegion: input.role === "RSM" ? input.salesRegion : null,
          assignedStates,
          assignedCities,
          reportingManagerId,
        },
        include,
      });
      await audit(tx, actor, input.role === "RSM" ? "ADMIN_RSM_CREATED" : "ADMIN_STAFF_CREATED", { staffId: staff.id.toString(), region: staff.salesRegion, parentRsmId: staff.parentRsmId?.toString(), parentAsmId: staff.parentAsmId?.toString(), reportingManagerId: staff.reportingManagerId?.toString() });
      return staff;
    });
  }

  async update(staffId: bigint, input: UpdateAdminStaffInput, actor: AuthActor): Promise<AdminStaffRecord> {
    return prisma.$transaction(async (tx) => {
      const current = await tx.staffProfile.findUnique({ where: { id: staffId }, include: { user: true } });
      if (!current) throw notFound("Staff member not found", "STAFF_NOT_FOUND");
      const userData: Prisma.UserUpdateInput = {};
      const staffData: Prisma.StaffProfileUpdateInput = {};
      if (input.email !== undefined) {
        const normalizedEmail = await ensureUniqueEmail(tx, input.email, current.userId);
        userData.email = normalizedEmail;
        userData.normalizedEmail = normalizedEmail;
        userData.username = normalizedEmail;
        userData.normalizedUsername = normalizedEmail;
      }
      if (input.status !== undefined) userData.status = input.status;
      if (input.role !== undefined) userData.role = input.role;
      if (input.name !== undefined) staffData.displayName = input.name;
      if (input.designation !== undefined) staffData.designation = input.designation;
      if (input.location !== undefined) staffData.location = input.location;
      if (input.staffRoleType !== undefined) staffData.staffRoleType = input.staffRoleType;
      const nextRole = input.role ?? current.user.role;
      const nextStaffRoleType = nextRole === "ASM" ? "ASM" : nextRole === "RSM" ? "RSM" : input.staffRoleType ?? current.staffRoleType;

      if (nextRole === "RSM") {
        staffData.staffRoleType = "RSM";
        staffData.parentRsm = { disconnect: true };
        staffData.parentAsm = { disconnect: true };
        staffData.assignedCities = [];
        if (input.salesRegion !== undefined) staffData.salesRegion = input.salesRegion;
        if (input.assignedStates !== undefined) staffData.assignedStates = uniqueStrings(input.assignedStates);
        if (input.reportingManagerId !== undefined) {
          const nsm = await resolveNsm(tx, parseId(input.reportingManagerId, "RSM_NSM_INVALID"));
          staffData.reportingManager = { connect: { id: nsm.id } };
        }
      } else if (nextRole === "ASM") {
        const rsm = await resolveRsm(tx, parseId(input.parentRsmId ?? current.parentRsmId?.toString(), "ASM_RSM_INVALID"));
        const assignedStates = uniqueStrings(input.assignedStates ?? current.assignedStates);
        assertSubset(assignedStates, rsm.assignedStates, "ASM_STATES_OUTSIDE_RSM_SCOPE");
        staffData.staffRoleType = "ASM";
        staffData.salesRegion = null;
        staffData.parentRsm = { connect: { id: rsm.id } };
        staffData.parentAsm = { disconnect: true };
        const assignedCities = uniqueStrings(input.assignedCities ?? current.assignedCities);
        assertSubset(assignedCities, citiesForStates(assignedStates), "ASM_CITIES_OUTSIDE_STATE_SCOPE", "cities");
        staffData.assignedStates = assignedStates;
        staffData.assignedCities = assignedCities;
        staffData.reportingManager = { disconnect: true };
      } else if (nextRole === "STAFF" && nextStaffRoleType === "1") {
        const asm = await resolveAsm(tx, parseId(input.parentAsmId ?? current.parentAsmId?.toString(), "EXECUTIVE_ASM_INVALID"));
        // Re-validate against the ASM even when the cities were not edited: the
        // ASM may have changed, or its own territory may have shrunk since.
        const assignedCities = uniqueStrings(input.assignedCities ?? current.assignedCities);
        assertSubset(assignedCities, asm.assignedCities, "EXECUTIVE_CITIES_OUTSIDE_ASM_SCOPE", "cities");
        staffData.staffRoleType = "1";
        staffData.salesRegion = null;
        staffData.parentAsm = { connect: { id: asm.id } };
        staffData.parentRsm = { connect: { id: asm.parentRsmId } };
        staffData.assignedStates = statesForCities(assignedCities, asm.assignedStates);
        staffData.assignedCities = assignedCities;
        staffData.reportingManager = { disconnect: true };
      } else if (nextRole === "STAFF" && nextStaffRoleType === "2") {
        const rsm = await resolveRsm(tx, parseId(input.parentRsmId ?? current.parentRsmId?.toString(), "STAFF_RSM_INVALID"));
        staffData.staffRoleType = "2";
        staffData.salesRegion = null;
        staffData.parentRsm = { connect: { id: rsm.id } };
        staffData.parentAsm = { disconnect: true };
        staffData.assignedStates = [];
        staffData.assignedCities = [];
        staffData.reportingManager = { disconnect: true };
      } else if (nextRole === "NSM") {
        staffData.staffRoleType = null;
        staffData.salesRegion = null;
        staffData.parentRsm = { disconnect: true };
        staffData.parentAsm = { disconnect: true };
        staffData.assignedStates = [];
        staffData.assignedCities = [];
        staffData.reportingManager = { disconnect: true };
      }
      if (Object.keys(userData).length) await tx.user.update({ where: { id: current.userId }, data: userData });
      if (Object.keys(staffData).length) await tx.staffProfile.update({ where: { id: staffId }, data: staffData });
      await audit(tx, actor, "ADMIN_STAFF_UPDATED", { staffId: staffId.toString(), role: nextRole });
      return tx.staffProfile.findUniqueOrThrow({ where: { id: staffId }, include });
    });
  }
}

export const adminStaffRepository = new PostgresAdminStaffRepository();
