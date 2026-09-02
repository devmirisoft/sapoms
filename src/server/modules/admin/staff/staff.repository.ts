import "server-only";

import { Prisma, type SalesRegion, type UserStatus } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { paginationToPrisma } from "@/server/admin/admin-pagination";
import { AdminRouteError } from "@/server/admin/admin-errors";
import { normalizeEmail } from "@/server/auth/providers/postgres-auth.provider";
import { hashPassword } from "@/server/auth/password";
import { citiesForStates, statesForCities } from "@/lib/places";
import { formatSalesRegionLabel, SALES_REGION_OPTIONS } from "@/lib/salesRegions";
import type { AdminStaffListInput, AdminStaffRecord, CreateAdminStaffInput, UpdateAdminStaffInput, UpdateStaffStatusInput } from "./staff.types";
import { staffPageWindow } from "./staff.paging";
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
    warehouse: null,
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

// Deactivating must also cut the staff member off mid-session: bumping the
// token version invalidates issued access tokens, revoking kills refresh.
async function applyUserStatus(tx: Prisma.TransactionClient, userId: bigint, status: UserStatus) {
  const disable = status !== "ACTIVE";
  await tx.user.update({ where: { id: userId }, data: { status, ...(disable ? { tokenVersion: { increment: 1 } } : {}) } });
  if (disable) await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
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
    select: { id: true, parentRsmId: true, assignedStates: true },
  });
  if (!asm?.parentRsmId) throw invalid("Selected ASM was not found or has no RSM parent", "ASM_PARENT_INVALID", { asmId: id.toString() });
  return { id: asm.id, parentRsmId: asm.parentRsmId, assignedStates: asm.assignedStates };
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

// One region, one RSM. Status is ignored on purpose: a deactivated RSM still
// holds its region, so reactivating can never produce two RSMs for one region.
async function assertRegionFree(tx: Prisma.TransactionClient, salesRegion: SalesRegion | null, exceptStaffId: bigint | null) {
  if (!salesRegion) throw invalid("RSM region is required", "RSM_REGION_REQUIRED");
  const taken = await tx.staffProfile.findFirst({
    where: {
      salesRegion,
      ...(exceptStaffId ? { id: { not: exceptStaffId } } : {}),
      user: { role: "RSM", deletedAt: null },
    },
    select: { displayName: true },
  });
  if (!taken) return;
  throw conflict(`${formatSalesRegionLabel(salesRegion)} already has an RSM (${taken.displayName})`, "RSM_REGION_TAKEN");
}

export class PostgresAdminStaffRepository {
  // The NSM lives in admin_profiles, so it is fetched whole (create() caps it at
  // one) rather than paged.
  private async findNsmRecords(input: AdminStaffListInput): Promise<AdminStaffRecord[]> {
    const profiles = await prisma.adminProfile.findMany({
      where: buildNsmWhere(input),
      include: { user: { select: { id: true, email: true, username: true, status: true, role: true } } },
      orderBy: { id: "desc" },
      take: 50,
    });
    return profiles.map((profile) => buildSyntheticRecord({
      id: profile.id,
      displayName: profile.displayName,
      designation: "NSM",
      location: null,
      staffRoleType: "NSM",
      salesRegion: null,
      user: profile.user,
    }));
  }

  async list(input: AdminStaffListInput): Promise<{ items: AdminStaffRecord[]; total: number }> {
    const { skip, take } = paginationToPrisma(input);

    if (input.role === "NSM") {
      const nsmItems = await this.findNsmRecords(input);
      return { items: nsmItems.slice(skip, skip + take), total: nsmItems.length };
    }

    // includeNsm puts the NSM rows at the head of the combined list, so the
    // staff query is offset by however many of them this page already used.
    const nsmItems = input.includeNsm ? await this.findNsmRecords(input) : [];
    const where = buildWhere(input);
    const staffWindow = staffPageWindow(nsmItems.length, skip, take);
    const [staff, total] = await prisma.$transaction([
      prisma.staffProfile.findMany({ where, include, orderBy: { id: "desc" }, skip: staffWindow.skip, take: staffWindow.take }),
      prisma.staffProfile.count({ where }),
    ]);
    return { items: [...nsmItems.slice(skip, skip + take), ...staff], total: total + nsmItems.length };
  }

  async findById(staffId: bigint): Promise<AdminStaffRecord | null> {
    return prisma.staffProfile.findUnique({ where: { id: staffId }, include });
  }

  async findNsmById(nsmId: bigint): Promise<AdminStaffRecord | null> {
    const profile = await prisma.adminProfile.findFirst({
      where: { id: nsmId, user: { role: "NSM", deletedAt: null } },
      include: { user: { select: { id: true, email: true, username: true, status: true, role: true } } },
    });
    if (!profile) return null;
    return buildSyntheticRecord({
      id: profile.id,
      displayName: profile.displayName,
      designation: "NSM",
      location: null,
      staffRoleType: "NSM",
      salesRegion: null,
      user: profile.user,
    });
  }

  async create(input: CreateAdminStaffInput, actor: AuthActor): Promise<AdminStaffRecord> {
    return prisma.$transaction(async (tx) => {
      if (input.role === "NSM") {
        const existingNsm = await tx.adminProfile.count({ where: nsmWhereBase });
        if (existingNsm >= 1) throw conflict("An NSM already exists", "NSM_LIMIT_REACHED");
      }
      if (input.role === "RSM") {
        const existingRsm = await tx.staffProfile.count({ where: { user: { role: "RSM", status: "ACTIVE", deletedAt: null } } });
        if (existingRsm >= SALES_REGION_OPTIONS.length) throw conflict("All regions already have an RSM assigned", "RSM_LIMIT_REACHED");
        await assertRegionFree(tx, input.salesRegion ?? null, null);
      }

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
        parentRsmId = rsm.id;
        assignedCities = [];
      } else if (input.role === "STAFF" && input.staffRoleType === "1") {
        const asm = await resolveAsm(tx, parseId(input.parentAsmId, "EXECUTIVE_ASM_INVALID"));
        parentAsmId = asm.id;
        parentRsmId = asm.parentRsmId;
        // A Sales Manager works a subset of the cities in its ASM's assigned
        // states; its own states are derived from those cities.
        assertSubset(assignedCities, citiesForStates(asm.assignedStates), "EXECUTIVE_CITIES_OUTSIDE_ASM_SCOPE", "cities");
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
          warehouse: input.warehouse ?? null,
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
        staffData.warehouse = null;
        staffData.parentAsm = { disconnect: true };
        staffData.assignedCities = [];
        if (input.salesRegion !== undefined) {
          await assertRegionFree(tx, input.salesRegion, staffId);
          staffData.salesRegion = input.salesRegion;
        } else if (current.user.role !== "RSM") {
          // Promoted into RSM without naming a region: the row would land with
          // no region at all, so refuse rather than create a regionless RSM.
          await assertRegionFree(tx, current.salesRegion, staffId);
        }
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
        staffData.warehouse = null;
        staffData.parentRsm = { connect: { id: rsm.id } };
        staffData.parentAsm = { disconnect: true };
        staffData.assignedStates = assignedStates;
        staffData.assignedCities = [];
        staffData.reportingManager = { disconnect: true };
      } else if (nextRole === "STAFF" && nextStaffRoleType === "1") {
        const asm = await resolveAsm(tx, parseId(input.parentAsmId ?? current.parentAsmId?.toString(), "EXECUTIVE_ASM_INVALID"));
        // Re-validate against the ASM even when the cities were not edited: the
        // ASM may have changed, or its own territory may have shrunk since.
        const assignedCities = uniqueStrings(input.assignedCities ?? current.assignedCities);
        assertSubset(assignedCities, citiesForStates(asm.assignedStates), "EXECUTIVE_CITIES_OUTSIDE_ASM_SCOPE", "cities");
        staffData.staffRoleType = "1";
        staffData.salesRegion = null;
        staffData.warehouse = null;
        staffData.parentAsm = { connect: { id: asm.id } };
        staffData.parentRsm = { connect: { id: asm.parentRsmId } };
        staffData.assignedStates = statesForCities(assignedCities, asm.assignedStates);
        staffData.assignedCities = assignedCities;
        staffData.reportingManager = { disconnect: true };
      } else if (nextRole === "STAFF" && nextStaffRoleType === "2") {
        const rsm = await resolveRsm(tx, parseId(input.parentRsmId ?? current.parentRsmId?.toString(), "STAFF_RSM_INVALID"));
        staffData.staffRoleType = "2";
        staffData.salesRegion = null;
        if (input.warehouse !== undefined) staffData.warehouse = input.warehouse;
        staffData.parentRsm = { connect: { id: rsm.id } };
        staffData.parentAsm = { disconnect: true };
        staffData.assignedStates = [];
        staffData.assignedCities = [];
        staffData.reportingManager = { disconnect: true };
      } else if (nextRole === "NSM") {
        staffData.staffRoleType = null;
        staffData.salesRegion = null;
        staffData.warehouse = null;
        staffData.parentRsm = { disconnect: true };
        staffData.parentAsm = { disconnect: true };
        staffData.assignedStates = [];
        staffData.assignedCities = [];
        staffData.reportingManager = { disconnect: true };
      }
      if (Object.keys(userData).length) await tx.user.update({ where: { id: current.userId }, data: userData });
      if (input.status !== undefined) await applyUserStatus(tx, current.userId, input.status);
      if (Object.keys(staffData).length) await tx.staffProfile.update({ where: { id: staffId }, data: staffData });
      await audit(tx, actor, "ADMIN_STAFF_UPDATED", { staffId: staffId.toString(), role: nextRole });
      return tx.staffProfile.findUniqueOrThrow({ where: { id: staffId }, include });
    });
  }

  // The NSM row lives in admin_profiles and holds no territory, hierarchy or
  // staff-only fields, so an edit is just its name, login and status.
  async updateNsm(nsmId: bigint, input: UpdateAdminStaffInput, actor: AuthActor): Promise<AdminStaffRecord> {
    return prisma.$transaction(async (tx) => {
      const current = await tx.adminProfile.findFirst({ where: { id: nsmId, user: { role: "NSM", deletedAt: null } }, include: { user: true } });
      if (!current) throw notFound("Staff member not found", "STAFF_NOT_FOUND");
      // Moving an NSM into a staff role would have to move the row between
      // tables; nothing needs that, so refuse rather than half-do it.
      if (input.role !== undefined && input.role !== "NSM") throw invalid("An NSM cannot be changed into another role", "NSM_ROLE_IMMUTABLE");

      const userData: Prisma.UserUpdateInput = {};
      if (input.email !== undefined) {
        const normalizedEmail = await ensureUniqueEmail(tx, input.email, current.userId);
        userData.email = normalizedEmail;
        userData.normalizedEmail = normalizedEmail;
        userData.username = normalizedEmail;
        userData.normalizedUsername = normalizedEmail;
      }
      if (Object.keys(userData).length) await tx.user.update({ where: { id: current.userId }, data: userData });
      if (input.status !== undefined) await applyUserStatus(tx, current.userId, input.status);
      if (input.name !== undefined) await tx.adminProfile.update({ where: { id: nsmId }, data: { displayName: input.name } });
      await audit(tx, actor, "ADMIN_NSM_UPDATED", { nsmId: nsmId.toString() });

      const updated = await tx.adminProfile.findUniqueOrThrow({
        where: { id: nsmId },
        include: { user: { select: { id: true, email: true, username: true, status: true, role: true } } },
      });
      return buildSyntheticRecord({ id: updated.id, displayName: updated.displayName, designation: "NSM", location: null, staffRoleType: "NSM", salesRegion: null, user: updated.user });
    });
  }

  async updateNsmStatus(nsmId: bigint, input: UpdateStaffStatusInput, actor: AuthActor): Promise<AdminStaffRecord> {
    return prisma.$transaction(async (tx) => {
      const current = await tx.adminProfile.findFirst({ where: { id: nsmId, user: { role: "NSM", deletedAt: null } }, include: { user: true } });
      if (!current) throw notFound("Staff member not found", "STAFF_NOT_FOUND");
      await applyUserStatus(tx, current.userId, input.status);
      await audit(tx, actor, "ADMIN_NSM_STATUS_CHANGED", { nsmId: nsmId.toString(), oldStatus: current.user.status, newStatus: input.status, reason: input.reason });

      const updated = await tx.adminProfile.findUniqueOrThrow({
        where: { id: nsmId },
        include: { user: { select: { id: true, email: true, username: true, status: true, role: true } } },
      });
      return buildSyntheticRecord({ id: updated.id, displayName: updated.displayName, designation: "NSM", location: null, staffRoleType: "NSM", salesRegion: null, user: updated.user });
    });
  }

  // Same hard delete as staff, but the RSMs reporting to this NSM block it.
  // reportingManagerId is SetNull, so without this check the delete would
  // quietly leave every RSM without a reporting manager instead of failing.
  async hardDeleteNsm(nsmId: bigint, actor: AuthActor): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const nsm = await tx.adminProfile.findFirst({ where: { id: nsmId, user: { role: "NSM", deletedAt: null } }, include: { user: { select: { id: true, email: true, role: true } } } });
      if (!nsm) throw notFound("Staff member not found", "STAFF_NOT_FOUND");

      const reports = await tx.staffProfile.count({ where: { reportingManagerId: nsmId } });
      if (reports) throw conflict("Reassign the RSMs reporting to this NSM before deleting", "STAFF_HAS_REPORTS");

      await tx.adminProfile.delete({ where: { id: nsmId } });
      await tx.user.delete({ where: { id: nsm.userId } });
      await audit(tx, actor, "ADMIN_NSM_DELETED", { nsmId: nsmId.toString(), email: nsm.user.email, role: nsm.user.role });
    });
  }

  // Hard delete: the profile and its user row leave the database. Everything
  // that points at the staff either cascades (diagnostic passwords, sessions,
  // OTPs) or nulls out (orders, discount requests, fund requests, children).
  async hardDelete(staffId: bigint, actor: AuthActor): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const staff = await tx.staffProfile.findUnique({ where: { id: staffId }, include: { user: { select: { id: true, email: true, role: true } } } });
      if (!staff) throw notFound("Staff member not found", "STAFF_NOT_FOUND");

      const children = await tx.staffProfile.count({ where: { OR: [{ parentRsmId: staffId }, { parentAsmId: staffId }] } });
      if (children) throw conflict("Reassign the staff reporting to this member before deleting", "STAFF_HAS_REPORTS");

      const activeDealers = await tx.dealerStaffAssignment.count({ where: { staffId, active: true } });
      if (activeDealers) throw conflict("Reassign this member's dealers before deleting", "STAFF_HAS_DEALERS");

      // Join rows are Restrict-guarded; only stale ones remain at this point.
      await tx.dealerStaffAssignment.deleteMany({ where: { staffId } });
      await tx.staffProfile.delete({ where: { id: staffId } });
      await tx.user.delete({ where: { id: staff.userId } });
      await audit(tx, actor, "ADMIN_STAFF_DELETED", { staffId: staffId.toString(), email: staff.user.email, role: staff.user.role });
    });
  }

  async updateStatus(staffId: bigint, input: UpdateStaffStatusInput, actor: AuthActor): Promise<AdminStaffRecord> {
    return prisma.$transaction(async (tx) => {
      const staff = await tx.staffProfile.findFirst({ where: { id: staffId, user: { deletedAt: null } }, include: { user: true } });
      if (!staff) throw notFound("Staff member not found", "STAFF_NOT_FOUND");
      await applyUserStatus(tx, staff.userId, input.status);
      await audit(tx, actor, "ADMIN_STAFF_STATUS_CHANGED", { staffId: staffId.toString(), oldStatus: staff.user.status, newStatus: input.status, reason: input.reason });
      return tx.staffProfile.findUniqueOrThrow({ where: { id: staffId }, include });
    });
  }
}

export const adminStaffRepository = new PostgresAdminStaffRepository();
