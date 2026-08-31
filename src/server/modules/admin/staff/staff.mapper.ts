import type { AdminStaffRecord } from "./staff.types";

export function mapAdminStaff(record: AdminStaffRecord, detail = false) {
  const id = record.id.toString();
  const name = record.displayName || "";
  const userId = record.user.id.toString();
  const email = record.user.email || "";
  const designation = record.designation || "";
  const location = record.location || "";
  const mobileNo = record.mobileNo || "";
  const alternateNo = record.alternateNo || "";
  const permanentAddress = record.permanentAddress || "";
  const localAddress = record.localAddress || "";
  const gender = record.gender || "";
  const dob = record.dob ? record.dob.toISOString().slice(0, 10) : "";
  const nationality = record.nationality || "";
  const maritalStatus = record.maritalStatus || "";
  const qualification = record.qualification || "";
  const emergencyContactNo1 = record.emergencyContactNo1 || "";
  const emergencyContactNo2 = record.emergencyContactNo2 || "";
  const staffRoleType = record.staffRoleType || "";
  const role = record.user.role;
  const salesRegion = record.salesRegion || "";
  const warehouse = record.warehouse || "";
  const parentRsmId = record.parentRsmId?.toString() || "";
  const parentAsmId = record.parentAsmId?.toString() || "";
  const assignedCities = record.assignedCities ?? [];
  const reportingManagerId = record.reportingManagerId?.toString() || "";

  return {
    id,
    userId,
    name,
    email,
    designation,
    location,
    mobileNo,
    alternateNo,
    permanentAddress,
    localAddress,
    gender,
    dob,
    nationality,
    maritalStatus,
    qualification,
    emergencyContactNo1,
    emergencyContactNo2,
    staffRoleType,
    salesRegion,
    warehouse,
    parentRsmId,
    parentAsmId,
    assignedStates: record.assignedStates ?? [],
    assignedCities,
    reportingManagerId,
    parentRsm: record.parentRsm ? {
      id: record.parentRsm.id.toString(),
      name: record.parentRsm.displayName,
      email: record.parentRsm.user.email,
      userId: record.parentRsm.user.id.toString(),
    } : null,
    parentAsm: record.parentAsm ? {
      id: record.parentAsm.id.toString(),
      name: record.parentAsm.displayName,
      email: record.parentAsm.user.email,
      userId: record.parentAsm.user.id.toString(),
    } : null,
    reportingManager: record.reportingManager ? {
      id: record.reportingManager.id.toString(),
      name: record.reportingManager.displayName,
      email: record.reportingManager.user.email,
      userId: record.reportingManager.user.id.toString(),
    } : null,
    role,
    status: record.user.status,
    assignedDealerCount: 0,
    ...(detail ? { assignedDealers: [] } : {}),
    staff_id: id,
    staff_name: name,
    staff_email: email,
    staff_designation: designation,
    staff_location: location,
    mobile_no: mobileNo,
    alternate_no: alternateNo,
    permanent_address: permanentAddress,
    local_address: localAddress,
    marital_status: maritalStatus,
    emergency_contact_no_1: emergencyContactNo1,
    emergency_contact_no_2: emergencyContactNo2,
    staff_roletype: staffRoleType,
    sales_region: salesRegion,
    parent_rsm_id: parentRsmId,
    parent_asm_id: parentAsmId,
    assigned_states: record.assignedStates ?? [],
    assigned_cities: assignedCities,
    reporting_manager_id: reportingManagerId,
  };
}
