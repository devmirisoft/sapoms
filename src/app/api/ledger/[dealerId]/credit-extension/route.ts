import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { extendDealerCredit } from "@/lib/ledgerSystem";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ dealerId: string }> }) {
  try {
    const actor = await requireAuth();
    const { dealerId } = await params;
    const body = await req.json();
    const result = await extendDealerCredit(actor, dealerId, body);
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    console.error("[POST /api/ledger/[dealerId]/credit-extension]", error);
    const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : 500);
    return NextResponse.json({ success: false, message: status >= 500 ? "Unable to extend credit." : error.message }, { status });
  }
}
