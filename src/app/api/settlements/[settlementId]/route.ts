import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { serializePrismaValue } from "@/server/db/prisma-serialize";
import { getSettlement, voidSettlement } from "@/lib/walletSettlement";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ settlementId: string }> }) {
  try {
    const actor = await requireAuth();
    const { settlementId } = await params;
    const data = await getSettlement(actor, settlementId);
    return NextResponse.json(serializePrismaValue({ success: true, ...data }), { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    console.error("[GET /api/settlements/[settlementId]]", error);
    const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : 500);
    return NextResponse.json(
      { success: false, message: status >= 500 ? "Unable to load settlement." : error?.message },
      { status },
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ settlementId: string }> }) {
  try {
    const actor = await requireAuth();
    const { settlementId } = await params;
    const body = await req.json().catch(() => ({}));
    const data = await voidSettlement(actor, settlementId, body);
    return NextResponse.json(
      serializePrismaValue({ success: true, message: "Settlement voided.", ...data }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    console.error("[DELETE /api/settlements/[settlementId]]", error);
    const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : 500);
    return NextResponse.json(
      { success: false, code: error?.code, message: status >= 500 ? "Unable to void settlement." : error?.message },
      { status },
    );
  }
}
