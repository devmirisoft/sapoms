import "server-only";

import { randomUUID } from "node:crypto";
import type { UploadApiResponse } from "cloudinary";
import { cloudinary } from "@/lib/cloudinary";
import { prisma } from "@/server/db/prisma";
import type { AuthActor } from "@/server/auth/session";
import { buildDealerRegionWhere, resolveRsmTeamStaffIds } from "@/server/auth/sales-scope";
import { assertDealerScope } from "@/lib/postgresDiscountDrafts";

// A dealer can attach one supporting document (quote, tender, competitor
// price...) to a custom discount request so the RSM and Admin can review it.
// Stored like invoices: an extension-less raw Cloudinary blob, streamed back
// through our own route so access stays behind the request's auth check.

const MAX_BYTES = 10 * 1024 * 1024;
const FOLDER = "sapoms/discount-references";

// The type is decided by extension, never by the browser-sent MIME type.
// SVG/HTML are deliberately absent: served inline they could run script.
const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function httpError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

async function loadRequest(id: string) {
  if (!/^\d+$/.test(id)) throw httpError("Request not found", 404);
  const row = await prisma.customDiscountRequest.findUnique({ where: { id: BigInt(id) } });
  if (!row) throw httpError("Request not found", 404);
  return row;
}

// Same rules as GET /api/custom-discount-requests/[id]: the owning dealer, an
// RSM whose region or team covers the request, or Admin/Accountant.
async function assertCanView(actor: AuthActor, row: { dealerId: bigint; staffId: bigint | null }) {
  if (actor.role === "DEALER") {
    if (!actor.dealerId || actor.dealerId !== row.dealerId) throw httpError("Request not found", 404);
    return;
  }
  if (actor.role !== "RSM") return assertDealerScope(actor, row.dealerId);
  if (row.staffId) {
    const teamStaffIds = await resolveRsmTeamStaffIds(actor, prisma);
    if (teamStaffIds.some((staffId) => staffId === row.staffId)) return;
  }
  const dealerWhere = await buildDealerRegionWhere(actor, undefined, prisma).catch(() => ({} as Record<string, never>));
  if (Object.keys(dealerWhere).length === 0) throw httpError("This request is outside your RSM scope", 403);
  const scoped = await prisma.dealerProfile.findFirst({ where: { id: row.dealerId, ...dealerWhere }, select: { id: true } });
  if (!scoped) throw httpError("This request is outside your RSM scope", 403);
}

export async function attachReferenceFile(actor: AuthActor, requestId: string, file: File) {
  const row = await loadRequest(requestId);
  if (actor.role === "RSM") throw httpError("Only the dealer can attach a reference document", 403);
  await assertCanView(actor, row);
  if (row.status !== "PENDING" || row.rsmApprovalStatus !== "PENDING") {
    throw httpError("The document can only be changed before the request is reviewed", 409);
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPES[ext];
  if (!type) throw httpError("Upload a PDF, Word, Excel or image file", 400);
  if (file.size === 0) throw httpError("The file is empty", 400);
  if (file.size > MAX_BYTES) throw httpError("The file must be 10 MB or smaller", 400);

  const buffer = Buffer.from(await file.arrayBuffer());
  const upload = await new Promise<UploadApiResponse>((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder: FOLDER, resource_type: "raw", public_id: randomUUID(), use_filename: false, unique_filename: false, overwrite: false },
      (error, result) => (error || !result ? reject(error ?? new Error("Cloudinary upload failed")) : resolve(result)),
    ).end(buffer);
  });

  await prisma.customDiscountRequest.update({
    where: { id: row.id },
    data: {
      referenceFileUrl: upload.secure_url,
      referenceFilePublicId: upload.public_id,
      referenceFileName: file.name.slice(0, 200),
      referenceFileType: type,
    },
  });

  if (row.referenceFilePublicId) {
    await cloudinary.uploader.destroy(row.referenceFilePublicId, { resource_type: "raw", invalidate: true }).catch((error: unknown) => {
      console.warn("[discountReferenceFile] Cloudinary cleanup failed", row.referenceFilePublicId, error);
    });
  }
  return { name: file.name.slice(0, 200), type };
}

export async function streamReferenceFile(actor: AuthActor, requestId: string) {
  const row = await loadRequest(requestId);
  await assertCanView(actor, row);
  if (!row.referenceFileUrl || !row.referenceFileType) throw httpError("No reference document attached", 404);

  const upstream = await fetch(row.referenceFileUrl, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) throw httpError("Stored document could not be fetched.", 502);

  const name = row.referenceFileName || "reference";
  const inline = row.referenceFileType === "application/pdf" || row.referenceFileType.startsWith("image/");
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const headers = new Headers({
    "Content-Type": row.referenceFileType,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  return new Response(upstream.body, { headers });
}
