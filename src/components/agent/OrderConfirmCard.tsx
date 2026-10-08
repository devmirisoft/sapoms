"use client";

import { useEffect, useState } from "react";
import type { DraftSummary } from "@/lib/agent/types";
import type { DraftOutcome } from "./useAgentChat";
import { showToast } from "@/components/ui/toast";

const money = (value: number) => `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The only place an assistant draft becomes an order: Confirm posts to /api/agent/confirm,
 * which re-prices on the server. Every figure shown here came from the server too.
 */
export default function OrderConfirmCard({ draft, outcome, onUpdate, onNotice }: {
  draft: DraftSummary;
  outcome?: DraftOutcome;
  onUpdate: (patch: { draft?: DraftSummary; outcome?: DraftOutcome }) => void;
  onNotice: (text: string) => void;
}) {
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (outcome) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [outcome]);

  const minutesLeft = Math.ceil((Date.parse(draft.expiresAt) - now) / 60_000);
  const expired = minutesLeft <= 0;
  const discount = draft.customDiscount;

  async function act(action: "confirm" | "cancel") {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/agent/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ draftId: draft.draftId, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.status === "ORDER_PLACED") {
        const text = `Order ${data.orderNumber} placed.`;
        onUpdate({ outcome: { kind: "placed", text } });
        onNotice(`${text} You can track it under Orders.`);
        showToast("success", text);
      } else if (res.ok && data.status === "DISCOUNT_REQUESTED") {
        const text = `Discount request #${data.requestId} sent to ${discount?.approvers ?? "your approvers"}. The order is placed automatically once it is approved.`;
        onUpdate({ outcome: { kind: "requested", text } });
        onNotice(text);
      } else if ((res.ok && data.status === "CANCELLED") || data.error === "DRAFT_CANCELLED") {
        onUpdate({ outcome: { kind: "cancelled", text: "Draft cancelled." } });
      } else if (res.status === 409 && data.error === "PRICE_CHANGED" && data.draft) {
        onUpdate({ draft: data.draft });
        setError(data.message);
      } else {
        setError(data.message || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-white text-[12.5px] text-gray-800 shadow-sm">
      <div className="border-b border-brand-100 bg-brand-50/60 px-3 py-2 font-semibold text-brand-900">
        {discount ? "Draft order · discount request" : "Draft order · review and confirm"}
      </div>

      <table className="w-full">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
            <th className="px-3 pb-1 pt-2 font-medium">Product</th>
            <th className="px-1 pb-1 pt-2 text-right font-medium">Packs</th>
            <th className="px-1 pb-1 pt-2 text-right font-medium">Per pack</th>
            <th className="px-3 pb-1 pt-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {draft.items.map((item) => (
            <tr key={item.productId} className="border-t border-gray-100 align-top">
              <td className="px-3 py-1.5">
                <div className="font-medium">{item.productId}</div>
                <div className="text-[11px] text-gray-500">{item.name}</div>
              </td>
              <td className="px-1 py-1.5 text-right">
                {item.packs}
                <div className="text-[11px] text-gray-500">{item.packs * item.packSize} pcs</div>
              </td>
              <td className="px-1 py-1.5 text-right">{money(item.packPrice)}</td>
              <td className="px-3 py-1.5 text-right">{money(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="space-y-0.5 border-t border-gray-100 px-3 py-2">
        <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(draft.subtotal)}</dd></div>
        {draft.discount > 0 && <div className="flex justify-between text-emerald-700"><dt>Your discount ({draft.discountPercent}%)</dt><dd className="whitespace-nowrap">−{money(draft.discount)}</dd></div>}
        {!discount && draft.slabDiscount > 0 && <div className="flex justify-between text-emerald-700"><dt>Volume discount ({draft.slabDiscountPercent}%)</dt><dd className="whitespace-nowrap">−{money(draft.slabDiscount)}</dd></div>}
        {discount ? (
          <>
            <div className="flex justify-between text-brand-600"><dt>Extra discount asked ({discount.asked})</dt><dd className="whitespace-nowrap">−{money(discount.extraDiscount)}</dd></div>
            <div className="flex justify-between pt-1 text-[13.5px] font-semibold"><dt>Total if approved</dt><dd>{money(discount.totalIfApproved)}</dd></div>
            <p className="text-[11.5px] text-gray-500">Needs approval from {discount.approvers}.</p>
          </>
        ) : (
          <div className="flex justify-between pt-1 text-[13.5px] font-semibold"><dt>Total payable</dt><dd>{money(draft.total)}</dd></div>
        )}
      </dl>

      {draft.warnings.length > 0 && (
        <ul className="mx-3 mb-2 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          {draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}

      <div className="border-t border-gray-100 px-3 py-2">
        {outcome ? (
          <p role="status" className={`rounded-lg px-3 py-2 ${outcome.kind === "cancelled" ? "bg-gray-100 text-gray-600" : "bg-emerald-50 font-medium text-emerald-800"}`}>
            {outcome.text}
          </p>
        ) : (
          <>
            {error && <p role="alert" className="mb-2 text-[12px] text-red-600">{error}</p>}
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[11.5px] ${expired ? "text-red-600" : "text-gray-500"}`}>
                {expired ? "Draft expired. Ask the assistant to prepare it again." : `Expires in ${minutesLeft} min`}
              </span>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => void act("cancel")} disabled={busy !== null}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  Cancel
                </button>
                <button type="button" onClick={() => void act("confirm")} disabled={busy !== null || expired}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-500 disabled:opacity-50">
                  {busy === "confirm" ? "Placing…" : discount ? "Send for approval" : "Confirm order"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
