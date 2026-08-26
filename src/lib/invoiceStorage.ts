import "server-only";

import { randomUUID } from "node:crypto";
import type { UploadApiResponse } from "cloudinary";
import { Prisma } from "@prisma/client";
import { cloudinary } from "@/lib/cloudinary";
import { prisma } from "@/server/db/prisma";
import type { AuthActor } from "@/server/auth/session";
import { isStaffLike } from "@/server/auth/sales-scope";
import { fromPaise, toPaise } from "@/lib/postgresWallet";

// Invoices and order exports used to live in Supabase: the PDF in a storage
// bucket, the metadata in Supabase tables, both written straight from the
// browser with the public anon key. The PDFs now go to Cloudinary and the
// metadata to Postgres, which forces the whole path server-side -- the
// Cloudinary secret cannot ship to the client.

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const INVOICE_FOLDER = "sapoms/invoices";
const EXPORT_FOLDER = "sapoms/order-exports";

export type StoredInvoice = {
  id: string;
  invoiceNumber: string;
  orderNumber: string;
  dealerId: string;
  buyerName: string;
  invoiceDate: string;
  totalAmount: number;
  fileName: string;
  downloadUrl: string;
  createdAt: string;
};

export type StoredOrderExport = {
  id: string;
  dealerId: string;
  fileName: string;
  orderCount: number;
  downloadUrl: string;
  createdAt: string;
};

function httpError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function text(value: unknown, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

// Cloudinary stores these as opaque raw blobs with no extension, so the public
// id is built by hand rather than derived from a filename.
function safeBaseName(value: string, fallback: string) {
  const cleaned = value
    .replace(/\.pdf$/i, "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

function parseDateOnly(value: unknown): Date {
  const raw = String(value ?? "").trim();
  const isoDay = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDay)) {
    const parsed = new Date(`${isoDay}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const loose = new Date(raw);
  if (!Number.isNaN(loose.getTime())) {
    return new Date(`${loose.toISOString().slice(0, 10)}T00:00:00.000Z`);
  }
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

// The browser still speaks in legacy PHP dealer ids, so a dealer reference can
// arrive as either the Postgres row id or the legacy id.
export async function resolveDealerId(rawDealerId: unknown): Promise<bigint> {
  const raw = text(rawDealerId, 40);
  if (!raw) throw httpError("A dealer id is required.", 400);

  const dealer = await prisma.dealerProfile.findFirst({
    where: /^\d+$/.test(raw)
      ? { OR: [{ id: BigInt(raw) }, { legacyPhpId: raw }] }
      : { OR: [{ legacyPhpId: raw }, { dealerCode: raw }] },
    select: { id: true },
  });
  if (!dealer) throw httpError("Dealer not found.", 404);
  return dealer.id;
}

export async function canAccessDealer(actor: AuthActor, dealerId: bigint) {
  if (actor.role === "ADMIN" || actor.role === "ACCOUNTANT") return true;
  if (actor.role === "DEALER") return actor.dealerId === dealerId;
  if (isStaffLike(actor) && actor.staffId) {
    const assignment = await prisma.dealerStaffAssignment.findFirst({
      where: { dealerId, staffId: actor.staffId, active: true, dealer: { deletedAt: null, user: { status: "ACTIVE" } } },
      select: { id: true },
    });
    return Boolean(assignment);
  }
  return false;
}

async function assertDealerAccess(actor: AuthActor, dealerId: bigint) {
  if (!(await canAccessDealer(actor, dealerId))) throw httpError("Invoice access denied.", 403);
}

// Dealers may read their own invoices but never create or delete them.
function assertCanWriteInvoices(actor: AuthActor) {
  if (actor.role === "DEALER") throw httpError("Dealers cannot issue invoices.", 403);
}

function uploadPdf(buffer: Buffer, folder: string, publicId: string) {
  if (buffer.byteLength === 0) throw httpError("The generated PDF was empty.", 400);
  if (buffer.byteLength > MAX_PDF_BYTES) throw httpError("The generated PDF is larger than 10 MB.", 400);

  return new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        // Raw + no .pdf extension: Cloudinary blocks delivery of PDF-format
        // assets by default (401). The download route re-attaches the content
        // type and the real file name.
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

async function destroyQuietly(publicId: string | null | undefined) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "raw", invalidate: true });
  } catch (error) {
    console.warn("[invoiceStorage] Cloudinary cleanup failed", publicId, error);
  }
}

function invoiceDownloadUrl(dealerId: bigint, invoiceId: bigint) {
  return `/api/invoices/${invoiceId.toString()}/download?dealerId=${dealerId.toString()}`;
}

function normalizeInvoice(row: {
  id: bigint;
  dealerId: bigint;
  invoiceNumber: string;
  orderNumber: string;
  buyerName: string;
  invoiceDate: Date;
  totalAmountPaise: bigint;
  fileName: string;
  createdAt: Date;
}): StoredInvoice {
  return {
    id: row.id.toString(),
    invoiceNumber: row.invoiceNumber,
    orderNumber: row.orderNumber,
    dealerId: row.dealerId.toString(),
    buyerName: row.buyerName,
    invoiceDate: row.invoiceDate.toISOString().slice(0, 10),
    totalAmount: fromPaise(row.totalAmountPaise),
    fileName: row.fileName,
    downloadUrl: invoiceDownloadUrl(row.dealerId, row.id),
    createdAt: row.createdAt.toISOString(),
  };
}

const invoiceSelect = {
  id: true,
  dealerId: true,
  invoiceNumber: true,
  orderNumber: true,
  buyerName: true,
  invoiceDate: true,
  totalAmountPaise: true,
  fileName: true,
  createdAt: true,
} satisfies Prisma.InvoiceSelect;

export type SaveInvoiceInput = {
  dealerId: unknown;
  invoiceNumber: unknown;
  orderNumber?: unknown;
  buyerName?: unknown;
  invoiceDate?: unknown;
  totalAmount?: unknown;
};

export async function saveInvoicePdf(actor: AuthActor, pdf: Buffer, input: SaveInvoiceInput): Promise<StoredInvoice> {
  assertCanWriteInvoices(actor);

  const dealerId = await resolveDealerId(input.dealerId);
  await assertDealerAccess(actor, dealerId);

  const invoiceNumber = text(input.invoiceNumber, 60);
  if (!invoiceNumber) throw httpError("An invoice number is required.", 400);
  const orderNumber = text(input.orderNumber, 60) || invoiceNumber;

  // Reject the duplicate before spending a Cloudinary upload on it. The unique
  // index below is still the real guard against concurrent bulk billing.
  const existing = await prisma.invoice.findFirst({
    where: { dealerId, invoiceNumber, deletedAt: null },
    select: { id: true },
  });
  if (existing) throw httpError(`Invoice ${invoiceNumber} already exists for this dealer.`, 409);

  const order = await prisma.order.findFirst({
    where: { dealerId, OR: [{ orderNumber }, { legacyPhpId: orderNumber }] },
    select: { id: true },
  });

  const fileName = `${invoiceNumber.replace(/\//g, "-")}.pdf`;
  const publicId = `${safeBaseName(invoiceNumber, "invoice")}-${randomUUID().slice(0, 8)}`;
  const upload = await uploadPdf(pdf, `${INVOICE_FOLDER}/${dealerId.toString()}`, publicId);

  try {
    const row = await prisma.invoice.create({
      data: {
        dealerId,
        orderId: order?.id ?? null,
        invoiceNumber,
        orderNumber,
        buyerName: text(input.buyerName, 200) || "Dealer",
        invoiceDate: parseDateOnly(input.invoiceDate),
        totalAmountPaise: toPaise(input.totalAmount),
        cloudinaryUrl: upload.secure_url,
        cloudinaryPublicId: upload.public_id,
        fileName,
        fileBytes: Number.isFinite(upload.bytes) ? upload.bytes : null,
        createdByUserId: actor.userId,
      },
      select: invoiceSelect,
    });
    return normalizeInvoice(row);
  } catch (error) {
    // Never leave an orphan blob behind when the metadata write loses a race.
    await destroyQuietly(upload.public_id);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw httpError(`Invoice ${invoiceNumber} already exists for this dealer.`, 409);
    }
    throw error;
  }
}

export async function listInvoicesForActor(actor: AuthActor, rawDealerId: unknown, limit = 100): Promise<StoredInvoice[]> {
  const take = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const requested = text(rawDealerId, 40);

  let where: Prisma.InvoiceWhereInput;
  if (requested) {
    const dealerId = await resolveDealerId(requested);
    await assertDealerAccess(actor, dealerId);
    where = { dealerId, deletedAt: null };
  } else if (actor.role === "DEALER") {
    if (!actor.dealerId) throw httpError("Invoice access denied.", 403);
    where = { dealerId: actor.dealerId, deletedAt: null };
  } else if (actor.role === "ADMIN" || actor.role === "ACCOUNTANT") {
    where = { deletedAt: null };
  } else if (isStaffLike(actor) && actor.staffId) {
    // Staff see only the dealers actually assigned to them.
    where = {
      deletedAt: null,
      dealer: { staffAssignments: { some: { staffId: actor.staffId, active: true } } },
    };
  } else {
    throw httpError("Invoice access denied.", 403);
  }

  const rows = await prisma.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    select: invoiceSelect,
  });
  return rows.map(normalizeInvoice);
}

// Resolves through the dealer access check so a guessed invoice id cannot be
// used to reach another dealer's PDF.
export async function getInvoiceFile(actor: AuthActor, rawInvoiceId: unknown) {
  const raw = text(rawInvoiceId, 40);
  if (!/^\d+$/.test(raw)) throw httpError("Invalid invoice id.", 400);

  const invoice = await prisma.invoice.findFirst({
    where: { id: BigInt(raw), deletedAt: null },
    select: { id: true, dealerId: true, cloudinaryUrl: true, fileName: true },
  });
  if (!invoice) throw httpError("Invoice not found.", 404);

  await assertDealerAccess(actor, invoice.dealerId);
  return { url: invoice.cloudinaryUrl, name: invoice.fileName };
}

export async function deleteInvoiceForActor(actor: AuthActor, rawInvoiceId: unknown): Promise<void> {
  assertCanWriteInvoices(actor);

  const raw = text(rawInvoiceId, 40);
  if (!/^\d+$/.test(raw)) throw httpError("Invalid invoice id.", 400);

  const invoice = await prisma.invoice.findFirst({
    where: { id: BigInt(raw), deletedAt: null },
    select: { id: true, dealerId: true, cloudinaryPublicId: true },
  });
  if (!invoice) throw httpError("Invoice not found.", 404);

  await assertDealerAccess(actor, invoice.dealerId);

  // Soft delete: an issued invoice is a financial record, so the row is kept
  // and only the stored PDF is released.
  await prisma.invoice.update({ where: { id: invoice.id }, data: { deletedAt: new Date() } });
  await destroyQuietly(invoice.cloudinaryPublicId);
}

export type SaveOrderExportInput = {
  dealerId: unknown;
  fileName?: unknown;
  orderCount?: unknown;
};

export async function saveOrderExportPdf(actor: AuthActor, pdf: Buffer, input: SaveOrderExportInput): Promise<StoredOrderExport> {
  const dealerId = await resolveDealerId(input.dealerId);
  await assertDealerAccess(actor, dealerId);

  const requestedName = text(input.fileName, 120) || "order-export";
  const fileName = `${safeBaseName(requestedName, "order-export")}.pdf`;
  const publicId = `${safeBaseName(requestedName, "order-export")}-${randomUUID().slice(0, 8)}`;
  const upload = await uploadPdf(pdf, `${EXPORT_FOLDER}/${dealerId.toString()}`, publicId);

  try {
    const orderCount = Number(input.orderCount);
    const row = await prisma.orderExport.create({
      data: {
        dealerId,
        fileName,
        cloudinaryUrl: upload.secure_url,
        cloudinaryPublicId: upload.public_id,
        fileBytes: Number.isFinite(upload.bytes) ? upload.bytes : null,
        orderCount: Number.isFinite(orderCount) && orderCount > 0 ? Math.trunc(orderCount) : 0,
        createdByUserId: actor.userId,
      },
      select: { id: true, dealerId: true, fileName: true, orderCount: true, createdAt: true },
    });

    return {
      id: row.id.toString(),
      dealerId: row.dealerId.toString(),
      fileName: row.fileName,
      orderCount: row.orderCount,
      downloadUrl: `/api/order-exports/${row.id.toString()}/download`,
      createdAt: row.createdAt.toISOString(),
    };
  } catch (error) {
    await destroyQuietly(upload.public_id);
    throw error;
  }
}

export async function getOrderExportFile(actor: AuthActor, rawExportId: unknown) {
  const raw = text(rawExportId, 40);
  if (!/^\d+$/.test(raw)) throw httpError("Invalid export id.", 400);

  const record = await prisma.orderExport.findFirst({
    where: { id: BigInt(raw) },
    select: { dealerId: true, cloudinaryUrl: true, fileName: true },
  });
  if (!record) throw httpError("Export not found.", 404);

  await assertDealerAccess(actor, record.dealerId);
  return { url: record.cloudinaryUrl, name: record.fileName };
}
