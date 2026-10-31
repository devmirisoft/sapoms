import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { linkShipmentBill, listLinkableBills, unlinkShipmentBill } from "@/lib/shipmentBilling";

export const runtime = "nodejs";

type Params = { params: Promise<{ shipmentId: string }> };

function errorResponse(error: unknown, label: string) {
  const status = Number((error as { status?: unknown })?.status) || ((error as Error)?.message === "Unauthenticated" ? 401 : 500);
  if (status >= 500) console.error(`[${label} /api/dispatch-tracking/shipments/[shipmentId]/bill]`, error);
  return NextResponse.json(
    { success: false, message: status >= 500 ? "Unable to update the shipment's bill." : (error as Error).message },
    { status }
  );
}

/** Ledger bills of this shipment's order that it can be linked to. */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const bills = await listLinkableBills(await requireAuth(), (await params).shipmentId);
    return NextResponse.json({ success: true, bills }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "GET");
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const body = await req.json().catch(() => ({}));
    await linkShipmentBill(await requireAuth(), (await params).shipmentId, body?.billId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, "POST");
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await unlinkShipmentBill(await requireAuth(), (await params).shipmentId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, "DELETE");
  }
}
