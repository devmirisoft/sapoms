import { AdminRouteError } from "@/server/admin/admin-errors";
import { adminStaffRepository } from "./staff.repository";
import { mapAdminStaff } from "./staff.mapper";
import type { AdminStaffListInput, CreateAdminStaffInput, UpdateAdminStaffInput, UpdateStaffStatusInput } from "./staff.types";
import type { AuthActor } from "@/server/auth/session";

export async function listAdminStaff(input: AdminStaffListInput) {
  const result = await adminStaffRepository.list(input);
  return { items: result.items.map((item) => mapAdminStaff(item)), total: result.total };
}

export async function getAdminStaff(staffId: bigint) {
  const record = await adminStaffRepository.findById(staffId);
  if (!record) throw new AdminRouteError("NOT_FOUND", "Staff member not found");
  return mapAdminStaff(record, true);
}
export async function createAdminStaff(input: CreateAdminStaffInput, actor: AuthActor) {
  return mapAdminStaff(await adminStaffRepository.create(input, actor), true);
}

export async function updateAdminStaff(staffId: bigint, input: UpdateAdminStaffInput, actor: AuthActor) {
  return mapAdminStaff(await adminStaffRepository.update(staffId, input, actor), true);
}

export async function updateAdminStaffStatus(staffId: bigint, input: UpdateStaffStatusInput, actor: AuthActor) {
  return mapAdminStaff(await adminStaffRepository.updateStatus(staffId, input, actor), true);
}

export async function deleteAdminStaff(staffId: bigint, actor: AuthActor) {
  await adminStaffRepository.hardDelete(staffId, actor);
}
