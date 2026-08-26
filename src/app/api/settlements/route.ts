import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { serializePrismaValue } from "@/server/db/prisma-serialize";
import { listSettlements } from "@/lib/walletSettlement";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth();
    const data = await listSettlements(actor, {
      status: req.nextUrl.searchParams.get("status") ?? undefined,
      dealerId: req.nextUrl.searchParams.get("dealerId") ?? undefined,
      search: req.nextUrl.searchParams.get("search") ?? undefined,
    });
    return NextResponse.json(serializePrismaValue({ success: true, ...data }), { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    console.error("[GET /api/settlements]", error);
    const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : 500);
    return NextResponse.json(
      { success: false, message: status >= 500 ? "Unable to load settlements." : error?.message },
      { status },
    );
  }
}
