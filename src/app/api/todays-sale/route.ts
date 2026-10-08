import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/prisma";
import { adminErrorResponse } from "@/server/admin/admin-errors";
import { auditAdminAction, requestIdFrom, requireAdminOnly } from "@/server/admin/admin-route";
import { isSaleLive, parseTodaysSale, type TodaysSale } from "@/lib/todaysSale";
import { readTodaysSale, TODAYS_SALE_KEY as KEY } from "@/server/todays-sale";

export const runtime = "nodejs";

function toBody(sale: TodaysSale) {
  return { success: true, data: { ...sale, live: isSaleLive(sale) } };
}

// Public: the homepage reads it and shows the items only while `live`.
export async function GET() {
  try {
    return NextResponse.json(toBody(await readTodaysSale()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/todays-sale]", error);
    return NextResponse.json({ success: false, message: "Unable to load today's sale" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const actor = await requireAdminOnly();
    const sale = parseTodaysSale(await request.json().catch(() => null));
    if (!sale) {
      return NextResponse.json({ success: false, message: "Invalid sale: check the date and that every discount is 1–90%." }, { status: 400 });
    }

    await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: sale }, update: { value: sale } });
    await auditAdminAction({ actor, request, eventType: "TODAYS_SALE_PUBLISHED", route: "/api/todays-sale", requestId: requestIdFrom(request) });

    return NextResponse.json(toBody(sale), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[PUT /api/todays-sale]", error);
    return adminErrorResponse(error, "Could not save today's sale");
  }
}
