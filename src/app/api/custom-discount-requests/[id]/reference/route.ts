import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/session";
import { attachReferenceFile, streamReferenceFile } from "@/lib/discountReferenceFile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: any, fallback: string) {
  const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : error?.message === "Forbidden" ? 403 : 500);
  return NextResponse.json({ success: false, message: status >= 500 ? fallback : error.message }, { status });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAuth();
    const { id } = await params;
    return await streamReferenceFile(actor, id);
  } catch (error) {
    console.error("[GET /api/custom-discount-requests/[id]/reference]", error);
    return jsonError(error, "Unable to load the reference document.");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAuth();
    const { id } = await params;
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) return NextResponse.json({ success: false, message: "file is required" }, { status: 400 });
    return NextResponse.json({ success: true, data: await attachReferenceFile(actor, id, file) });
  } catch (error) {
    console.error("[POST /api/custom-discount-requests/[id]/reference]", error);
    return jsonError(error, "Unable to upload the reference document.");
  }
}
