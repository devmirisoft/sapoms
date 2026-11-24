import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { serializePrismaValue } from "@/server/db/prisma-serialize";
import { getDealerLedger, recordLedgerBill, updateLedgerBill } from "@/lib/ledgerSystem";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ dealerId: string }> }) {
  try {
    const actor = await requireAuth();
    const { dealerId } = await params;
    const ledger = await getDealerLedger(actor, dealerId);
    return NextResponse.json(
      serializePrismaValue({ success: true, ...ledger, isLive: true, paymentsLive: true, updatedAt: new Date().toISOString() }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    console.error("[GET /api/ledger/[dealerId]]", error);
    const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : 500);
    return NextResponse.json({ success: false, message: status >= 500 ? "Unable to load dealer ledger." : error.message }, { status });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ dealerId: string }> }) {
  try {
    const actor = await requireAuth();
    const { dealerId } = await params;
    const body = await req.json();
    const result = await recordLedgerBill(actor, dealerId, body);
    return NextResponse.json(
      serializePrismaValue({
        success: true,
        created: result.created,
        message: result.created ? "Bill saved successfully" : "Bill updated successfully",
        bill: result.bill,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    console.error("[POST /api/ledger/[dealerId]]", error);
    const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : 500);
    return NextResponse.json({ success: false, message: status >= 500 ? "Unable to save ledger bill." : error.message }, { status });
  }
}

/** The accountant's correction of a saved bill; body carries billId. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ dealerId: string }> }) {
  try {
    const actor = await requireAuth();
    const { dealerId } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await updateLedgerBill(actor, dealerId, body);
    return NextResponse.json(serializePrismaValue({ success: true, ...result }), { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : 500);
    if (status >= 500) console.error("[PATCH /api/ledger/[dealerId]]", error);
    return NextResponse.json({ success: false, message: status >= 500 ? "Unable to update ledger bill." : error.message }, { status });
  }
}
