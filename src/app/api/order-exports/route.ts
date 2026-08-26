import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { saveOrderExportPdf } from "@/lib/invoiceStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuth();

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw Object.assign(new Error("An export PDF file is required."), { status: 400 });
    }

    const record = await saveOrderExportPdf(actor, Buffer.from(await file.arrayBuffer()), {
      dealerId: form.get("dealerId"),
      fileName: form.get("fileName"),
      orderCount: form.get("orderCount"),
    });

    return NextResponse.json({ success: true, export: record }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    console.error("[POST /api/order-exports]", error);
    const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : 500);
    return NextResponse.json(
      { success: false, message: status >= 500 ? "Unable to save the export." : error.message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
