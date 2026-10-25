"use client";

import { useCallback, useEffect, useState } from "react";
import { termsRequest } from "@/components/TermsModal";
import { SignaturePadField } from "@/components/terms/SignaturePadField";
import { TermsDocument, type SignatureView, type TermsBlock } from "@/components/terms/TermsDocument";

type DealerTerms = {
  active: boolean;
  blocks: TermsBlock[];
  signatures: Record<string, SignatureView>;
  // Dealer slots still to sign, e.g. accepted before signatures existed or the document changed since.
  signable: string[];
  acceptedAt: string | null;
  updatedAt: string | null;
  updatedSinceAccepted: boolean;
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export default function DealerTermsPage() {
  const [terms, setTerms] = useState<DealerTerms | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);

  const load = useCallback(
    () =>
      termsRequest("GET")
        .then(async (response) => {
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload?.data) throw new Error(payload?.msg || payload?.message || "Could not load your terms.");
          setTerms(payload.data);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Could not load your terms.")),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const mustSign = Boolean(terms?.signable.length);

  async function acceptUpdated() {
    setAccepting(true);
    setError(null);
    try {
      const response = await termsRequest("POST", { signature });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.msg || payload?.message || "Failed to save agreement.");
      // Reload so the saved signature replaces the pad.
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save agreement.");
    } finally {
      setAccepting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f6fa] px-6 py-7 text-[#1f2937]">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Terms &amp; Conditions</h1>
          {terms?.active && (
            <p className="mt-1 text-sm text-[#667085]">
              Accepted on {formatDate(terms.acceptedAt)} · Last updated {formatDate(terms.updatedAt)}
            </p>
          )}
        </div>

        {(terms?.updatedSinceAccepted || mustSign) && (
          <div className="mb-5 flex flex-col gap-3 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {terms?.updatedSinceAccepted
                ? "Your Terms & Conditions were updated after you accepted them. Please review the document below."
                : "Your agreement is waiting for your signature."}
              {mustSign && " Draw your signature in the signature box at the end of the document."}
            </span>
            <button
              type="button"
              onClick={acceptUpdated}
              disabled={accepting || (mustSign && !signature)}
              className="h-9 shrink-0 rounded bg-[#1f2937] px-4 text-sm font-medium text-white hover:bg-[#374151] disabled:opacity-50"
            >
              {accepting ? "Saving..." : mustSign ? "Sign and accept" : "I accept the updated terms"}
            </button>
          </div>
        )}

        {error && <p className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <div className="space-y-3 rounded border border-[#dfe3ec] bg-white px-8 py-6 text-sm leading-relaxed text-slate-700 shadow-sm">
          {terms && !terms.active ? (
            <p className="text-[#667085]">No Terms &amp; Conditions document is active for your account.</p>
          ) : terms ? (
            <TermsDocument
              blocks={terms.blocks}
              signatures={terms.signatures}
              renderSlot={(slot) => (terms.signable.includes(slot) ? <SignaturePadField onChange={setSignature} /> : null)}
            />
          ) : (
            !error && <p className="text-[#667085]">Loading terms...</p>
          )}
        </div>
      </div>
    </main>
  );
}
