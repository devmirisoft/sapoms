"use client";

import { useCallback, useEffect, useState } from "react";
import { SignaturePadField } from "@/components/terms/SignaturePadField";
import { TermsDocument, type SignatureView, type TermsBlock } from "@/components/terms/TermsDocument";

type Agreement = { blocks: TermsBlock[]; signatures: Record<string, SignatureView>; signable: string[] };

// One dealer's agreement for admins and the dealer's assigned staff: dealer values filled in,
// saved signatures, and a signature pad on each open slot this user may sign.
export function DealerAgreement({ dealerId }: { dealerId: string }) {
  const url = `/api/terms/dealers/${encodeURIComponent(dealerId)}`;
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a signature is saved, to reload the document with it.
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    fetch(url, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.data) throw new Error(payload?.msg || payload?.message || "Failed to load document.");
        setAgreement(payload.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load document."));
  }, [url, version]);

  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (!agreement) return <p className="text-sm text-[#667085]">Loading document...</p>;

  return (
    <div className="space-y-3 text-sm leading-relaxed text-slate-700">
      <TermsDocument
        blocks={agreement.blocks}
        signatures={agreement.signatures}
        renderSlot={(slot) => (agreement.signable.includes(slot) ? <SlotSigner url={url} slot={slot} onSigned={reload} /> : null)}
      />
    </div>
  );
}

function SlotSigner({ url, slot, onSigned }: { url: string; slot: string; onSigned: () => void }) {
  const [image, setImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot, signature: image }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.msg || payload?.message || "Could not save the signature.");
      onSigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the signature.");
      setSaving(false);
    }
  }

  return (
    <div className="w-full space-y-1">
      <SignaturePadField onChange={setImage} />
      <button
        type="button"
        onClick={save}
        disabled={!image || saving}
        className="h-7 w-full rounded bg-[#1f2937] text-xs font-medium text-white hover:bg-[#374151] disabled:opacity-40"
      >
        {saving ? "Saving..." : "Save signature"}
      </button>
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
