import { AdminRouteError } from "@/server/admin/admin-errors";
import { adminStaffRepository } from "./staff.repository";
import { mapAdminStaff } from "./staff.mapper";
import type { AdminStaffListInput, CreateAdminStaffInput, UpdateAdminStaffInput, UpdateStaffStatusInput } from "./staff.types";
import type { AuthActor } from "@/server/auth/session";

export async function listAdminStaff(input: AdminStaffListInput) {
  const result = await adminStaffRepository.list(input);
  return { items: result.items.map((item) => mapAdminStaff(item)), total: result.total };
}

// The NSM lives in admin_profiles and every other role in staff_profiles, two
// id sequences that overlap, so the route hands down which table it meant.
export type StaffTarget = { kind: "staff" | "nsm"; id: bigint };

export async function getAdminStaff(target: StaffTarget) {
  const record = target.kind === "nsm"
    ? await adminStaffRepository.findNsmById(target.id)
    : await adminStaffRepository.findById(target.id);
  if (!record) throw new AdminRouteError("NOT_FOUND", "Staff member not found");
  return mapAdminStaff(record, true);
}
export async function createAdminStaff(input: CreateAdminStaffInput, actor: AuthActor) {
  return mapAdminStaff(await adminStaffRepository.create(input, actor), true);
}

export async function updateAdminStaff(target: StaffTarget, input: UpdateAdminStaffInput, actor: AuthActor) {
  const record = target.kind === "nsm"
    ? await adminStaffRepository.updateNsm(target.id, input, actor)
    : await adminStaffRepository.update(target.id, input, actor);
  return mapAdminStaff(record, true);
}

export async function updateAdminStaffStatus(target: StaffTarget, input: UpdateStaffStatusInput, actor: AuthActor) {
  const record = target.kind === "nsm"
    ? await adminStaffRepository.updateNsmStatus(target.id, input, actor)
    : await adminStaffRepository.updateStatus(target.id, input, actor);
  return mapAdminStaff(record, true);
}

export async function deleteAdminStaff(target: StaffTarget, actor: AuthActor) {
  if (target.kind === "nsm") await adminStaffRepository.hardDeleteNsm(target.id, actor);
  else await adminStaffRepository.hardDelete(target.id, actor);
}
