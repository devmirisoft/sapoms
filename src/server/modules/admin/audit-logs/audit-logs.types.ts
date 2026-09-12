import type { AuthRole } from "@/server/auth/providers/types";
import type { AdminListInput } from "@/server/admin/admin.types";

export type AdminAuditLogListInput = AdminListInput & {
  action?: string;
  entity?: string;
  actorRole?: AuthRole;
  entityId?: string;
  dateFrom?: Date;
  dateTo?: Date;
};

export type AdminAuditLogDto = {
  id: string;
  action: string | null;
  eventType: string;
  entity: string | null;
  entityId: string | null;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
};
