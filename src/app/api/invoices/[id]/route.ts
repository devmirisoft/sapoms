import { NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { deleteInvoiceForActor } from "@/lib/invoiceStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAuth();
    const { id } = await params;
    await deleteInvoiceForActor(actor, id);
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    console.error("[DELETE /api/invoices/[id]]", error);
    const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : 500);
    return NextResponse.json(
      { success: false, message: status >= 500 ? "Unable to delete invoice." : error.message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
