"use client";

import { useEffect, useState } from "react";
import { TERMS_BLOCK_TYPES, TermsDocument, type TermsBlock, type TermsBlockType } from "@/components/terms/TermsDocument";

const TYPE_LABEL: Record<TermsBlockType, string> = {
  h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", h4: "Heading 4", h5: "Heading 5", h6: "Heading 6", p: "Paragraph",
};

const buttonClass = "h-8 rounded border border-[#d6dbe4] bg-white px-3 text-xs font-medium text-[#344054] hover:bg-[#f7f9fc] disabled:opacity-40";

// Loads and saves through `url`: the global template by default, or one dealer's document.
export default function TermsEditor({ url = "/api/terms/content" }: { url?: string }) {
  const [blocks, setBlocks] = useState<TermsBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch(url, { credentials: "include", cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => setBlocks(Array.isArray(payload?.data) ? payload.data : []))
      .catch(() => setMessage({ ok: false, text: "Could not load current terms." }))
      .finally(() => setLoading(false));
  }, [url]);

  function clearAll() {
    if (window.confirm("Remove all terms content? Nothing is saved until you click Save.")) setBlocks([]);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ blocks }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.msg || payload?.message || "Failed to save.");
      setBlocks(payload.data);
      setMessage({ ok: true, text: "Terms saved." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Failed to save." });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-[#667085]">Loading terms...</p>;

  return (
    <TermsBlocksEditor blocks={blocks} onChange={setBlocks}>
      <div className="flex flex-wrap items-center gap-2 border-t border-[#eef1f6] pt-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="h-9 rounded bg-[#1f2937] px-4 text-sm font-medium text-white hover:bg-[#374151] disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={clearAll} disabled={blocks.length === 0} className={`${buttonClass} h-9 text-red-600`}>
          Clear all
        </button>
        {message && <span className={`text-sm ${message.ok ? "text-emerald-600" : "text-red-500"}`}>{message.text}</span>}
      </div>
    </TermsBlocksEditor>
  );
}

// Controlled block list + live preview; `children` renders under the add buttons (e.g. a Save row).
export function TermsBlocksEditor({
  blocks,
  onChange,
  children,
}: {
  blocks: TermsBlock[];
  onChange: (blocks: TermsBlock[]) => void;
  children?: React.ReactNode;
}) {
  const update = (index: number, patch: Partial<TermsBlock>) =>
    onChange(blocks.map((block, i) => (i === index ? { ...block, ...patch } : block)));

  const move = (index: number, delta: number) => {
    const next = [...blocks];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange(next);
  };

  const remove = (index: number) => onChange(blocks.filter((_, i) => i !== index));

  const add = (type: TermsBlockType) => onChange([...blocks, { type, text: "" }]);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3">
        {blocks.length === 0 && (
          <p className="rounded border border-dashed border-[#d6dbe4] px-4 py-6 text-center text-sm text-[#667085]">
            No content. Add a heading or paragraph below.
          </p>
        )}

        {blocks.map((block, index) => (
          <div key={index} className="rounded border border-[#dfe3ec] bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <select
                value={block.type}
                onChange={(event) => update(index, { type: event.target.value as TermsBlockType })}
                aria-label="Block type"
                className="h-8 rounded border border-[#d6dbe4] bg-white px-2 text-xs"
              >
                {TERMS_BLOCK_TYPES.map((type) => (
                  <option key={type} value={type}>{TYPE_LABEL[type]}</option>
                ))}
              </select>
              <div className="ml-auto flex gap-1">
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className={buttonClass} aria-label="Move up">↑</button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === blocks.length - 1} className={buttonClass} aria-label="Move down">↓</button>
                <button type="button" onClick={() => remove(index)} className={`${buttonClass} text-red-600`}>Remove</button>
              </div>
            </div>
            <textarea
              value={block.text}
              onChange={(event) => update(index, { text: event.target.value })}
              rows={block.type === "p" ? 4 : 1}
              placeholder={TYPE_LABEL[block.type]}
              className="w-full rounded border border-[#d6dbe4] px-3 py-2 text-sm outline-none focus:border-[#5d7df0] focus:ring-2 focus:ring-[#dfe6ff]"
            />
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2">
          {TERMS_BLOCK_TYPES.map((type) => (
            <button key={type} type="button" onClick={() => add(type)} className={buttonClass}>
              + {type === "p" ? "Paragraph" : type.toUpperCase()}
            </button>
          ))}
        </div>

        {children}
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#667085]">Preview</p>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto rounded border border-[#dfe3ec] bg-white px-6 py-5 text-sm leading-relaxed text-slate-700">
          <TermsDocument blocks={blocks} />
        </div>
      </div>
    </div>
  );
}
