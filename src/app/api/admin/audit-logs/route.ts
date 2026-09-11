import { NextRequest, NextResponse } from "next/server";
import { adminErrorResponse } from "@/server/admin/admin-errors";
import { adminListResponse } from "@/server/admin/admin-response";
import { requireAdminOnly } from "@/server/admin/admin-route";
import { parseAdminAuditLogListInput } from "@/server/modules/admin/audit-logs/audit-logs.schemas";
import { listAdminAuditLogs } from "@/server/modules/admin/audit-logs/audit-logs.service";

export const runtime = "nodejs";

// Read-only by design: there is deliberately no POST/PATCH/DELETE here, so audit
// rows cannot be edited or removed through the application.
//
// Guarded with requireAdminOnly rather than requireAdmin: this is the one admin
// surface that exposes every actor's activity, the NSM's included, so it stays
// with ADMIN instead of the usual admin-like set.
export async function GET(request: NextRequest) {
  try {
    await requireAdminOnly();
    const input = parseAdminAuditLogListInput(request.nextUrl.searchParams);
    const result = await listAdminAuditLogs(input);

    // Reading the audit log is not itself audited: it would bury real activity
    // under a row for every page view and every filter change.
    return NextResponse.json(
      adminListResponse({
        items: result.items,
        page: input.page,
        pageSize: input.pageSize,
        total: result.total,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[GET /api/admin/audit-logs]", error);
    return adminErrorResponse(error, "Audit logs are unavailable");
  }
}
