import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { UploadApiResponse } from "cloudinary";
import { requireAuth } from "@/server/auth/session";
import { cloudinary } from "@/lib/cloudinary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;
const CLOUDINARY_FOLDER = "sapoms/ledger-bills";

function assertPdf(file: File) {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) throw Object.assign(new Error("Only PDF bills can be uploaded."), { status: 400 });
  if (file.size > MAX_PDF_BYTES) throw Object.assign(new Error(`${file.name} is larger than 10 MB.`), { status: 400 });
}

// upload_stream has no filename to read, so the public id is built by hand.
// It deliberately does NOT end in .pdf: Cloudinary blocks delivery of PDF-format
// assets by default (401), so the file is stored extension-less as an opaque raw
// blob and served to the browser by the download route below, which sets the
// application/pdf content type and the real file name itself.
function safeBaseName(fileName: string) {
  const cleaned = fileName
    .replace(/\.pdf$/i, "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return cleaned || "bill";
}

// fl_attachment:<name> makes Cloudinary send Content-Disposition with the
// original file name, so the download lands as "<original name>.pdf".
function attachmentUrl(secureUrl: string, baseName: string) {
  if (!secureUrl.includes("/upload/")) return secureUrl;
  return secureUrl.replace("/upload/", `/upload/fl_attachment:${encodeURIComponent(baseName)}/`);
}

async function uploadPdf(file: File, dealerId: string) {
  assertPdf(file);
  const buffer = Buffer.from(await file.arrayBuffer());
  const publicId = `${safeBaseName(file.name)}-${randomUUID().slice(0, 8)}`;
  return new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `${CLOUDINARY_FOLDER}/${dealerId}`,
        resource_type: "raw",
        public_id: publicId,
        use_filename: false,
        unique_filename: false,
        overwrite: false,
      },
      (error, result) => {
        if (error || !result) reject(error ?? new Error("Cloudinary upload failed"));
        else resolve(result);
      },
    );
    stream.end(buffer);
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ dealerId: string }> }) {
  try {
    const actor = await requireAuth();
    if (actor.role !== "ACCOUNTANT") throw Object.assign(new Error("Only Accountant can upload ledger bills."), { status: 403 });

    const { dealerId } = await params;
    if (!/^\d+$/.test(String(dealerId || "").trim())) throw Object.assign(new Error("Invalid dealer id."), { status: 400 });

    const form = await request.formData();
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
    if (files.length === 0) throw Object.assign(new Error("At least one PDF file is required."), { status: 400 });
    if (files.length > MAX_FILES) throw Object.assign(new Error(`Upload at most ${MAX_FILES} PDFs at a time.`), { status: 400 });

    files.forEach(assertPdf);
    const uploads = await Promise.all(files.map((file) => uploadPdf(file, dealerId)));

    const uploaded = uploads.map((result, index) => ({
      name: files[index].name,
      url: result.secure_url,
      downloadUrl: attachmentUrl(result.secure_url, safeBaseName(files[index].name)),
      publicId: result.public_id,
      bytes: result.bytes,
    }));

    return NextResponse.json({ success: true, files: uploaded }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    console.error("[POST /api/ledger/[dealerId]/bill-pdf]", error);
    const status = Number(error?.status) || (error?.message === "Unauthenticated" ? 401 : 500);
    return NextResponse.json(
      { success: false, message: status >= 500 ? "Unable to upload bill PDFs." : error.message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
