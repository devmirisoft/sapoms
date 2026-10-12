"use client";

import { useEffect, useState } from "react";
import { termsRequest } from "@/components/TermsModal";
import { TermsDocument, type TermsBlock } from "@/components/terms/TermsDocument";

type DealerTerms = {
  blocks: TermsBlock[];
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

  useEffect(() => {
    termsRequest("GET")
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.data) throw new Error(payload?.msg || payload?.message || "Could not load your terms.");
        setTerms(payload.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load your terms."));
  }, []);

  async function acceptUpdated() {
    setAccepting(true);
    setError(null);
    try {
      const response = await termsRequest("POST");
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.msg || payload?.message || "Failed to save agreement.");
      setTerms((current) => current && { ...current, acceptedAt: payload?.data?.acceptedAt ?? new Date().toISOString(), updatedSinceAccepted: false });
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
          {terms && (
            <p className="mt-1 text-sm text-[#667085]">
              Accepted on {formatDate(terms.acceptedAt)} · Last updated {formatDate(terms.updatedAt)}
            </p>
          )}
        </div>

        {terms?.updatedSinceAccepted && (
          <div className="mb-5 flex flex-col gap-3 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
            <span>Your Terms &amp; Conditions were updated after you accepted them. Please review the document below.</span>
            <button
              type="button"
              onClick={acceptUpdated}
              disabled={accepting}
              className="h-9 shrink-0 rounded bg-[#1f2937] px-4 text-sm font-medium text-white hover:bg-[#374151] disabled:opacity-50"
            >
              {accepting ? "Saving..." : "I accept the updated terms"}
            </button>
          </div>
        )}

        {error && <p className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <div className="space-y-3 rounded border border-[#dfe3ec] bg-white px-8 py-6 text-sm leading-relaxed text-slate-700 shadow-sm">
          {terms ? <TermsDocument blocks={terms.blocks} /> : !error && <p className="text-[#667085]">Loading terms...</p>}
        </div>
      </div>
    </main>
  );
}
