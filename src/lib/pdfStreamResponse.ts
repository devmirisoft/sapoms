import "server-only";

import { NextResponse } from "next/server";

// PDFs live in Cloudinary as extension-less raw blobs (the account blocks
// PDF-format delivery), so they come back as application/octet-stream with a
// meaningless file name. These helpers stream the blob to the browser with the
// PDF content type and the name the file was stored under.

export function pdfContentDisposition(mode: "attachment" | "inline", fileName: string) {
  const withExtension = /\.pdf$/i.test(fileName) ? fileName : `${fileName}.pdf`;
  const ascii = withExtension.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(withExtension)}`;
}

export async function streamStoredPdf(file: { url: string; name: string }, mode: "attachment" | "inline") {
  const upstream = await fetch(file.url, { cache: "no-store" });
  if (!upstream.ok || !upstream.body) {
    throw Object.assign(new Error("Stored PDF could not be fetched."), { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": pdfContentDisposition(mode, file.name),
    "Cache-Control": "private, no-store",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);

  return new NextResponse(upstream.body, { headers });
}
