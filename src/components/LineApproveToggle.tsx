import { showToast } from "@/components/ui/toast";
import { customDiscountOnNet } from "@/lib/customDiscountRequests";

/** Per-line tick on a discount review: unticked lines are rejected back to a dealer draft. */
export function LineApproveToggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <label className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-[10px] font-bold text-gray-600">
      <input type="checkbox" checked={checked} onChange={onChange} className="h-3.5 w-3.5 accent-emerald-600" />
      Approve
    </label>
  );
}

/**
 * Approve-button label and helper text while some lines are unticked; null when none are.
 * Every custom line unticked leaves the standard lines to go ahead as a normal order;
 * with no standard lines either, the reviewer must use the Reject button instead.
 */
export function partialApproval(products: { usesCustomDiscount: boolean }[], rejectedCount: number, rest: string) {
  if (rejectedCount === 0) return null;
  const customCount = products.filter((product) => product.usesCustomDiscount).length;
  const standardCount = products.length - customCount;
  if (rejectedCount < customCount) {
    return {
      blocked: false,
      label: `Approve ${customCount - rejectedCount} of ${customCount} lines`,
      message: `${rejectedCount} unticked line(s) will go back to the dealer as a new draft; the rest ${rest}. A note is required.`,
    };
  }
  if (standardCount > 0) {
    return {
      blocked: false,
      label: `Place ${standardCount} standard item(s) as normal order`,
      message: `No discount approved. The discount items go back to the dealer as a draft; the ${standardCount} standard item(s) are placed as a normal order and go through the usual order approval. A note is required.`,
    };
  }
  return { blocked: true, label: "Approve", message: "Every item is unticked — use Disapprove/Reject instead." };
}

/** Toast what a review did beyond the plain status change. */
export function toastReviewOutcome(data: { standardOnlyOrder?: boolean; placedOrderNumber?: string; rejectedLineCount?: number; orderSnapshot?: unknown }) {
  if (data.standardOnlyOrder) {
    const standardCount = Array.isArray((data.orderSnapshot as { products?: unknown[] } | null)?.products)
      ? (data.orderSnapshot as { products: unknown[] }).products.length
      : 0;
    showToast(
      "success",
      "Placed as a normal order",
      `No discount approved. ${standardCount} standard item(s) placed as order ${data.placedOrderNumber ?? ""} and sent for normal order approval; the discount items went back to the dealer's drafts.`,
    );
  } else if (data.rejectedLineCount) {
    showToast("info", `${data.rejectedLineCount} item(s) returned to dealer draft`);
  }
}

/** A line an earlier review rejected; stored in orderSnapshot.rejectedProducts by the PATCH route. */
type RejectedLine = {
  sku?: string;
  catalogueNumber?: string;
  productName?: string;
  quantity?: number;
  packSize?: number;
  totalPieces?: number;
  unitPrice?: number;
  grossAmount?: number;
  baseDiscountPercent?: number;
  baseDiscountAmount?: number;
  requestedCustomDiscountPercent?: number;
  requestedCustomDiscountAmount?: number;
  finalAmount?: number;
  rejectedBy?: string;
  rejectedNote?: string;
};

export function rejectedProductsOf(orderSnapshot: unknown): RejectedLine[] {
  const rejected = (orderSnapshot as { rejectedProducts?: unknown } | null | undefined)?.rejectedProducts;
  return Array.isArray(rejected) ? rejected as RejectedLine[] : [];
}

/** How many lines earlier reviews already sent back to the dealer. */
export function rejectedLineCount(orderSnapshot: unknown) {
  return rejectedProductsOf(orderSnapshot).length;
}

function money(value: unknown) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function RejectedBadge({ line }: { line: RejectedLine }) {
  return (
    <span className="rounded-full border border-red-300 bg-white px-2 py-0.5 text-[10px] font-bold text-red-700">
      Rejected{line.rejectedBy ? ` by ${line.rejectedBy}` : ""} · returned to dealer draft
    </span>
  );
}

/** Rows for the 10-column review table (Cat. No. … Final); amounts are struck as they are not in the totals. */
export function RejectedTableRows({ orderSnapshot }: { orderSnapshot: unknown }) {
  return rejectedProductsOf(orderSnapshot).map((line, index) => (
    <tr key={`rejected-${line.sku}-${index}`} className="bg-red-50/60 text-gray-400">
      <td className="px-3 py-3 font-mono text-[12px] font-bold text-red-400">{line.catalogueNumber || line.sku || "-"}</td>
      <td className="px-3 py-3">
        <p className="text-[12px] font-semibold text-gray-500">{line.productName || "-"}</p>
        <div className="mt-1"><RejectedBadge line={line} /></div>
        {line.rejectedNote && <p className="mt-1 text-[11px] text-red-600">Reason: {line.rejectedNote}</p>}
      </td>
      <td className="px-3 py-3 font-mono text-[12px]">{line.quantity}</td>
      <td className="px-3 py-3 font-mono text-[12px]">{line.packSize}</td>
      <td className="px-3 py-3 font-mono text-[12px]">{line.totalPieces}</td>
      <td className="px-3 py-3 font-mono text-[12px]">{money(line.unitPrice)}</td>
      <td className="px-3 py-3 font-mono text-[12px]">{money(line.grossAmount)}</td>
      <td className="px-3 py-3 font-mono text-[12px]">{line.baseDiscountPercent ?? 0}% · -{money(line.baseDiscountAmount)}</td>
      <td className="px-3 py-3 font-mono text-[12px]">{customDiscountOnNet(line.baseDiscountPercent, line.requestedCustomDiscountPercent)}% on net · -{money(line.requestedCustomDiscountAmount)}</td>
      <td className="px-3 py-3 font-mono text-[12px] font-bold">{money(line.finalAmount)}</td>
    </tr>
  ));
}

type Resubmission = { previousRequestId?: string; rejectedBy?: string | null; changes?: Array<{ summary?: string }> };

/** Set by buildCustomDiscountCreate when a request was raised from a rejection draft. */
export function ResubmissionNote({ orderSnapshot }: { orderSnapshot: unknown }) {
  const resubmission = (orderSnapshot as { resubmission?: Resubmission } | null | undefined)?.resubmission;
  if (!resubmission) return null;
  const changes = Array.isArray(resubmission.changes) ? resubmission.changes : [];
  return (
    <div className="rounded-xl border border-rose-200 bg-white px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-rose-600">
        Resubmitted after rejection{resubmission.rejectedBy ? ` by ${resubmission.rejectedBy}` : ""}
        {resubmission.previousRequestId ? ` · replaces request #${resubmission.previousRequestId}` : ""}
      </p>
      {changes.length === 0 ? (
        <p className="mt-1 text-[13px] font-semibold text-amber-700">No changes were made.</p>
      ) : (
        <ul className="mt-1 list-disc pl-5">
          {changes.map((change, index) => <li key={index} className="text-[12px] leading-5 text-gray-700">{change.summary}</li>)}
        </ul>
      )}
    </div>
  );
}

/** The same rejected lines for the compact card product list. */
export function RejectedListItems({ orderSnapshot }: { orderSnapshot: unknown }) {
  return rejectedProductsOf(orderSnapshot).map((line, index) => (
    <div key={`rejected-${line.sku}-${index}`} className="bg-red-50/60 px-3 py-2 text-gray-400">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-bold text-red-400">{line.catalogueNumber || line.sku || "-"}</p>
          <p className="truncate text-[12px] font-semibold text-gray-500">{line.productName || "-"}</p>
        </div>
        <p className="shrink-0 font-mono text-[12px] font-bold">{money(line.finalAmount)}</p>
      </div>
      <div className="mt-1"><RejectedBadge line={line} /></div>
      {line.rejectedNote && <p className="mt-1 text-[11px] text-red-600">Reason: {line.rejectedNote}</p>}
    </div>
  ));
}
