import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { getOrderExportFile } from "@/lib/invoiceStorage";
import { streamStoredPdf } from "@/lib/pdfStreamResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAuth();
    const { id } = await params;
    const mode = request.nextUrl.searchParams.get("mode") === "inline" ? "inline" : "attachment";

    const file = await getOrderExportFile(actor, id);
    return await streamStoredPdf(file, mode);
  } catch (error: any) {
    console.error("[GET /api/order-exports/[id]/download]", error);
    const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : 500);
    return NextResponse.json(
      { success: false, message: status >= 500 ? "Unable to download the export." : error.message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
