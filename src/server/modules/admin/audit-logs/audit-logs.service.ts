import { mapAuditLogToDto } from "./audit-logs.mapper";
import { auditLogsRepository } from "./audit-logs.repository";
import type { AdminAuditLogListInput } from "./audit-logs.types";

export async function listAdminAuditLogs(input: AdminAuditLogListInput) {
  const { items, total } = await auditLogsRepository.list(input);
  return { items: items.map(mapAuditLogToDto), total };
}
