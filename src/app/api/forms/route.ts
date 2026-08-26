import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { requireAuth, type AuthActor } from "@/server/auth/session";
import { isAdminLike, isStaffLike } from "@/server/auth/sales-scope";
import {
  nextLeadNo,
  serializeFormSubmission,
  toFormSubmissionColumns,
  validateFormSubmissionBody,
} from "@/lib/formSubmissions";

export const runtime = "nodejs";

export function formsErrorResponse(label: string, error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;

  if (message === "Unauthenticated") {
    return NextResponse.json({ success: false, message: "Unauthenticated" }, { status: 401 });
  }
  if (message === "Forbidden") {
    return NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 });
  }

  console.error(label, error);
  const status = message.includes("required") ? 400 : 500;
  return NextResponse.json({ success: false, message: status === 400 ? message : fallback }, { status });
}

export function listQuery(req: NextRequest, actor?: AuthActor): Prisma.FormSubmissionWhereInput {
  const params = req.nextUrl.searchParams;
  const where: Prisma.FormSubmissionWhereInput = {};

  if (actor) {
    where.submittedByUserId = actor.userId;
  }

  const search = (params.get("search") ?? "").trim();
  if (search) {
    where.OR = [
      { leadNo: { contains: search, mode: "insensitive" } },
      { companyName: { contains: search, mode: "insensitive" } },
      { submittedByName: { contains: search, mode: "insensitive" } },
    ];
  }

  const from = (params.get("from") ?? "").trim();
  const to = (params.get("to") ?? "").trim();
  const range: Prisma.DateTimeFilter = {};
  if (from) {
    const date = new Date(from);
    if (!Number.isNaN(date.getTime())) range.gte = date;
  }
  if (to) {
    const date = new Date(to);
    if (!Number.isNaN(date.getTime())) {
      date.setHours(23, 59, 59, 999);
      range.lte = date;
    }
  }
  if (range.gte || range.lte) {
    where.visitedDate = range;
  }

  return where;
}

export async function listForms(req: NextRequest, actor?: AuthActor) {
  const params = req.nextUrl.searchParams;
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(params.get("limit") ?? 20) || 20));
  const where = listQuery(req, actor);

  const [rows, total] = await Promise.all([
    prisma.formSubmission.findMany({
      where,
      orderBy: { visitedDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.formSubmission.count({ where }),
  ]);

  return NextResponse.json(
    {
      success: true,
      data: rows.map(serializeFormSubmission),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAuth();
    if (!isStaffLike(actor)) {
      return NextResponse.json({ success: false, message: "Only staff can submit forms" }, { status: 403 });
    }

    const data = validateFormSubmissionBody(await req.json());
    const now = new Date();

    const created = await prisma.$transaction(async (tx) => {
      const leadNo = await nextLeadNo(tx);
      return tx.formSubmission.create({
        data: {
          ...toFormSubmissionColumns(data),
          leadNo,
          submittedByUserId: actor.userId,
          submittedByName: (actor.displayName || actor.email).slice(0, 200),
          submittedByRole: actor.role,
          visitedDate: now,
          submittedAt: now,
        },
      });
    });

    return NextResponse.json({ success: true, data: serializeFormSubmission(created) }, { status: 201 });
  } catch (error) {
    return formsErrorResponse("[POST /api/forms]", error, "Failed to submit form");
  }
}

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth();
    if (!isAdminLike(actor)) {
      return NextResponse.json(
        { success: false, message: "Only admin can view all form submissions" },
        { status: 403 }
      );
    }
    return await listForms(req);
  } catch (error) {
    return formsErrorResponse("[GET /api/forms]", error, "Failed to load form submissions");
  }
}
