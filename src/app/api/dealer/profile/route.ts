import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { requireAuth } from "@/server/auth/session";
import { hashPassword } from "@/server/auth/password";
import { mapDealerProfileAliases } from "@/server/modules/profiles/profile-aliases";
import { staffRoleLabel, resolveStaffRoleKey } from "@/lib/staffRoleLabel";

export const runtime = "nodejs";

function bodyText(body: Record<string, unknown>, keys: string[], max = 1000) {
  for (const key of keys) {
    const value = String(body[key] ?? "").trim();
    if (value) return value.slice(0, max);
  }
  return "";
}

async function loadDealer(dealerId: bigint) {
  return prisma.dealerProfile.findFirst({
    where: { id: dealerId, deletedAt: null },
    include: { user: { select: { email: true, username: true, status: true } } },
  });
}

const contactSelect = {
  id: true,
  displayName: true,
  designation: true,
  mobileNo: true,
  staffRoleType: true,
  salesRegion: true,
  location: true,
  assignedStates: true,
  assignedCities: true,
  parentAsmId: true,
  parentRsmId: true,
  user: { select: { email: true, role: true, status: true, deletedAt: true } },
} satisfies Prisma.StaffProfileSelect;

type ContactRecord = Prisma.StaffProfileGetPayload<{ select: typeof contactSelect }>;

function mapContact(staff: ContactRecord) {
  const roleSource = { role: staff.user.role, staffRoleType: staff.staffRoleType, salesRegion: staff.salesRegion };
  return {
    id: staff.id.toString(),
    staffId: staff.id.toString(),
    name: staff.displayName || "",
    email: staff.user.email || "",
    phone: staff.mobileNo || "",
    designation: staff.designation || "",
    role: staff.user.role || "",
    roleKey: resolveStaffRoleKey(roleSource),
    roleLabel: staffRoleLabel(roleSource),
    salesRegion: staff.salesRegion || "",
    location: staff.location || "",
    assignedStates: staff.assignedStates ?? [],
    assignedCities: staff.assignedCities ?? [],
  };
}

// A dealer's contacts: the staff actively assigned to them, plus the ASM and
// RSM those staff roll up to. parentAsmId/parentRsmId are denormalised onto
// every staff row at creation, so both parents resolve in one extra query.
async function loadDealerContacts(dealerId: bigint) {
  const assignments = await prisma.dealerStaffAssignment.findMany({
    where: { dealerId, active: true, staff: { user: { status: "ACTIVE", deletedAt: null } } },
    select: { staff: { select: contactSelect } },
    orderBy: { assignedAt: "desc" },
  });

  const assignedStaff = assignments.map((assignment) => assignment.staff);

  const parentIds = new Set<bigint>();
  for (const staff of assignedStaff) {
    if (staff.parentAsmId) parentIds.add(staff.parentAsmId);
    if (staff.parentRsmId) parentIds.add(staff.parentRsmId);
  }
  // Drop ids already present as directly-assigned staff so nobody is listed twice.
  for (const staff of assignedStaff) parentIds.delete(staff.id);

  const parents = parentIds.size
    ? await prisma.staffProfile.findMany({
        where: { id: { in: [...parentIds] }, user: { status: "ACTIVE", deletedAt: null } },
        select: contactSelect,
      })
    : [];

  const byId = new Map(parents.map((parent) => [parent.id.toString(), parent]));
  const pick = (id: bigint | null) => (id ? byId.get(id.toString()) ?? null : null);

  const staff = assignedStaff.map(mapContact);
  // The ASM/RSM shown are those of the first assigned staff member; in practice
  // a dealer's staff share one branch of the hierarchy.
  const primary = assignedStaff[0] ?? null;
  const asmRecord = primary ? pick(primary.parentAsmId) : null;
  const rsmRecord = primary ? pick(primary.parentRsmId) : null;

  return {
    staff,
    asm: asmRecord ? mapContact(asmRecord) : staff.find((entry) => entry.roleKey === "ASM") ?? null,
    rsm: rsmRecord ? mapContact(rsmRecord) : staff.find((entry) => entry.roleKey === "RSM") ?? null,
  };
}

export async function GET() {
  try {
    const actor = await requireAuth();
    if (actor.role !== "DEALER" || !actor.dealerId) return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
    const dealer = await loadDealer(actor.dealerId);
    if (!dealer) return NextResponse.json({ success: false, message: "Dealer profile not found" }, { status: 404 });
    const contacts = await loadDealerContacts(actor.dealerId);
    return NextResponse.json({
      success: true,
      status: true,
      data: { ...mapDealerProfileAliases(dealer), assignedStaff: contacts.staff, asm: contacts.asm, rsm: contacts.rsm },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/dealer/profile]", error);
    return NextResponse.json({ success: false, message: "Dealer profile unavailable" }, { status: 401 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireAuth();
    if (actor.role !== "DEALER" || !actor.dealerId) return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const password = bodyText(input, ["Dealer_Password", "password"], 200);
    await prisma.$transaction(async (tx) => {
      await tx.dealerProfile.update({
        where: { id: actor.dealerId },
        data: {
          businessName: bodyText(input, ["Dealer_Name", "name", "businessName"], 300),
          phone: bodyText(input, ["Dealer_Number", "phone"], 80) || null,
          city: bodyText(input, ["Dealer_City", "city"], 160) || null,
          address: bodyText(input, ["Dealer_Address", "address"], 1000) || null,
          pincode: bodyText(input, ["Dealer_Pincode", "pincode"], 40) || null,
        },
      });
      const userData: { email?: string; passwordHash?: string } = {};
      const email = bodyText(input, ["Dealer_Email", "email"], 300);
      if (email) userData.email = email;
      if (password) userData.passwordHash = await hashPassword(password);
      if (Object.keys(userData).length) await tx.user.update({ where: { id: actor.userId }, data: userData });
    });
    const dealer = await loadDealer(actor.dealerId);
    return NextResponse.json({ success: true, status: true, msg: "Dealer profile updated", data: dealer ? mapDealerProfileAliases(dealer) : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[PATCH /api/dealer/profile]", error);
    return NextResponse.json({ success: false, message: "Dealer profile could not be updated" }, { status: 400 });
  }
}
