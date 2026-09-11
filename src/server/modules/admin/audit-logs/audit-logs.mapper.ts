import type { AdminAuditLogDto } from "./audit-logs.types";
import type { AdminAuditLogRow } from "./audit-logs.repository";

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function mapAuditLogToDto(row: AdminAuditLogRow): AdminAuditLogDto {
  return {
    id: row.id.toString(),
    action: row.action,
    eventType: row.eventType,
    entity: row.entity,
    entityId: row.entityId,
    // Older rows predate the actor columns and kept the id in metadata instead.
    actorId: row.actorId?.toString() ?? null,
    actorName: row.actorName,
    actorEmail: row.actorEmail,
    actorRole: row.role,
    oldValues: jsonObject(row.oldValues),
    newValues: jsonObject(row.newValues),
    metadata: jsonObject(row.metadata),
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  };
}
