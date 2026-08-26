import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { getLedgerBillPdf } from "@/lib/ledgerSystem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bills live in Cloudinary as extension-less raw blobs (the account blocks
// PDF-format delivery), so they come back as application/octet-stream with a
// meaningless file name. This route streams the blob to the browser with the
// PDF content type and the file name the accountant uploaded.
function contentDisposition(mode: "attachment" | "inline", fileName: string) {
  const withExtension = /\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`;
  const ascii = withExtension.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(withExtension)}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ dealerId: string }> }) {
  try {
    const actor = await requireAuth();
    const { dealerId } = await params;

    const billId = request.nextUrl.searchParams.get("billId") || "";
    const index = Number(request.nextUrl.searchParams.get("index") || 0);
    const mode = request.nextUrl.searchParams.get("mode") === "inline" ? "inline" : "attachment";
    if (!Number.isInteger(index) || index < 0) throw Object.assign(new Error("Invalid file index."), { status: 400 });

    // Resolves through the dealer access check, so the URL cannot be pointed elsewhere.
    const file = await getLedgerBillPdf(actor, dealerId, billId, index);

    const upstream = await fetch(file.url, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      throw Object.assign(new Error("Stored bill PDF could not be fetched."), { status: 502 });
    }

    const headers = new Headers({
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(mode, file.name),
      "Cache-Control": "private, no-store",
    });
    const length = upstream.headers.get("content-length");
    if (length) headers.set("Content-Length", length);

    return new NextResponse(upstream.body, { headers });
  } catch (error: any) {
    console.error("[GET /api/ledger/[dealerId]/bill-pdf/download]", error);
    const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : 500);
    return NextResponse.json(
      { success: false, message: status >= 500 ? "Unable to download bill PDF." : error.message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
