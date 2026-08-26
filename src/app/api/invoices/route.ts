import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { listInvoicesForActor, saveInvoicePdf } from "@/lib/invoiceStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(scope: string, error: any) {
  console.error(scope, error);
  const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : 500);
  return NextResponse.json(
    { success: false, message: status >= 500 ? "Unable to process invoices." : error.message },
    { status, headers: NO_STORE },
  );
}

// The PDF is still rendered in the browser (jsPDF needs the DOM), then posted
// here as a file so Cloudinary and the metadata write both stay server-side.
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAuth();

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw Object.assign(new Error("An invoice PDF file is required."), { status: 400 });
    }

    const invoice = await saveInvoicePdf(actor, Buffer.from(await file.arrayBuffer()), {
      dealerId: form.get("dealerId"),
      invoiceNumber: form.get("invoiceNumber"),
      orderNumber: form.get("orderNumber"),
      buyerName: form.get("buyerName"),
      invoiceDate: form.get("invoiceDate"),
      totalAmount: form.get("totalAmount"),
    });

    return NextResponse.json({ success: true, invoice }, { headers: NO_STORE });
  } catch (error: any) {
    return errorResponse("[POST /api/invoices]", error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireAuth();
    const invoices = await listInvoicesForActor(
      actor,
      request.nextUrl.searchParams.get("dealerId"),
      Number(request.nextUrl.searchParams.get("limit") || 100),
    );
    return NextResponse.json({ success: true, invoices }, { headers: NO_STORE });
  } catch (error: any) {
    return errorResponse("[GET /api/invoices]", error);
  }
}
