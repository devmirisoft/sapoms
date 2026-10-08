"use client";

import { FileText } from "lucide-react";

type Props = { requestId: string; file?: { name: string; type: string } | null };

// PDFs and images preview inline; Word/Excel can't render in a browser, so
// they get an open/download link instead.
export function DiscountReferencePreview({ requestId, file }: Props) {
  if (!file) return null;
  const src = `/api/custom-discount-requests/${encodeURIComponent(requestId)}/reference`;
  const isPdf = file.type === "application/pdf";
  const isImage = file.type.startsWith("image/");

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200">
      <div className="flex items-center justify-between gap-3 bg-gray-50 px-4 py-2.5">
        <p className="flex min-w-0 items-center gap-2 text-[12px] font-bold text-gray-700">
          <FileText size={14} className="shrink-0 text-brand-600" />
          <span className="shrink-0">Reference document:</span>
          <span className="truncate font-medium text-gray-600">{file.name}</span>
        </p>
        <a href={src} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[12px] font-semibold text-brand-600 hover:underline">
          {isPdf || isImage ? "Open" : "Download"}
        </a>
      </div>
      {isPdf && <iframe src={src} title={file.name} loading="lazy" className="h-[480px] w-full border-0 bg-white" />}
      {isImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={file.name} loading="lazy" className="max-h-[480px] w-full bg-white object-contain" />
      )}
    </div>
  );
}
