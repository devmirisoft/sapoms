import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { serializePrismaValue } from "@/server/db/prisma-serialize";
import { applySettlement } from "@/lib/walletSettlement";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ settlementId: string }> }) {
  try {
    const actor = await requireAuth();
    const { settlementId } = await params;
    const body = await req.json();
    const result = await applySettlement(actor, settlementId, body, req.headers.get("idempotency-key"));
    return NextResponse.json(
      serializePrismaValue({
        success: true,
        message: result.duplicate ? "Duplicate settlement ignored" : "Settlement applied successfully",
        ...result,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    console.error("[POST /api/settlements/[settlementId]/apply]", error);
    const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : 500);
    return NextResponse.json(
      { success: false, code: error?.code, message: status >= 500 ? "Unable to apply settlement." : error?.message },
      { status },
    );
  }
}
