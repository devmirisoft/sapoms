import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { requireAuth, type AuthActor } from "@/server/auth/session";
import { isAdminLike, isStaffLike } from "@/server/auth/sales-scope";
import {
  formIdFromString,
  serializeFormSubmission,
  toFormSubmissionColumns,
  validateFormSubmissionBody,
} from "@/lib/formSubmissions";
import { formsErrorResponse } from "../route";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Admin-like actors reach any submission; staff-like only their own. Returning a
 * where-clause (rather than filtering after the read) keeps the ownership check
 * in the query, so a staff member never loads another user's row.
 */
function accessWhere(actor: AuthActor, id: string): Prisma.FormSubmissionWhereInput | NextResponse {
  const formId = formIdFromString(id);
  if (formId === null) {
    return NextResponse.json({ success: false, message: "Invalid submission id" }, { status: 400 });
  }

  if (isAdminLike(actor)) return { id: formId };
  if (isStaffLike(actor)) return { id: formId, submittedByUserId: actor.userId };

  return NextResponse.json({ success: false, message: "Form access denied" }, { status: 403 });
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const actor = await requireAuth();
    const { id } = await context.params;
    const where = accessWhere(actor, id);
    if (where instanceof NextResponse) return where;

    const doc = await prisma.formSubmission.findFirst({ where });
    if (!doc) {
      return NextResponse.json({ success: false, message: "Form submission not found" }, { status: 404 });
    }

    return NextResponse.json(
      { success: true, data: serializeFormSubmission(doc) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return formsErrorResponse("[GET /api/forms/:id]", error, "Failed to load form submission");
  }
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const actor = await requireAuth();
    const { id } = await context.params;
    const where = accessWhere(actor, id);
    if (where instanceof NextResponse) return where;

    const data = validateFormSubmissionBody(await req.json());

    // leadNo, submittedBy*, visitedDate and createdAt are never modified by PUT.
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.formSubmission.findFirst({ where, select: { id: true } });
      if (!existing) return null;
      return tx.formSubmission.update({
        where: { id: existing.id },
        data: toFormSubmissionColumns(data),
      });
    });

    if (!updated) {
      return NextResponse.json({ success: false, message: "Form submission not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: serializeFormSubmission(updated) });
  } catch (error) {
    return formsErrorResponse("[PUT /api/forms/:id]", error, "Failed to update form submission");
  }
}
