"use client";

import { useEffect, useState } from "react";
import { normalizeDispatchTrackingInput, type DispatchTrackingInfo } from "@/lib/orderDispatch";
import { EMPTY_SHIPMENT_FORM, ShipmentFields, toShipmentForm, type ShipmentForm } from "@/components/orders/ShipmentFields";

type Props = {
  orderId: string;
  // Staff/admin who may record dispatch updates for this order.
  canEdit: boolean;
  // Editing needs a PostgreSQL order; legacy PHP orders stay read-only.
  editingSupported: boolean;
  value: DispatchTrackingInfo[];
  // What went out in each shipment, keyed by shipment id.
  contents?: Record<string, ShipmentContentLine[]>;
  onSaved?: (shipments: DispatchTrackingInfo[]) => void;
};

export type ShipmentContentLine = { catNo: string; pieces: number };

const EMPTY = "—";
const NEW = "new";
// Contents lines shown inline per shipment; the rest open in a popup.
const CONTENTS_PREVIEW = 2;

function ReadOnlyField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
      <div className="mt-1 text-[13px] font-semibold text-gray-900 break-words">{children}</div>
    </div>
  );
}

function TrackingNumberValue({ trackingNumber }: { trackingNumber: string | null }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  if (!trackingNumber) return <>{EMPTY}</>;

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono">{trackingNumber}</span>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(trackingNumber).then(() => setCopied(true)).catch(() => setCopied(false));
        }}
        className="rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-50"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

export default function DispatchTrackingCard({ orderId, canEdit, editingSupported, value, contents, onSaved }: Props) {
  const [form, setForm] = useState<ShipmentForm>(EMPTY_SHIPMENT_FORM);
  // null = viewing; "new" = adding a shipment; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedText, setSavedText] = useState("");
  // Index of the shipment whose full contents are open in the popup.
  const [contentsOpen, setContentsOpen] = useState<number | null>(null);

  useEffect(() => {
    if (contentsOpen === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContentsOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contentsOpen]);

  useEffect(() => {
    if (!savedText) return;
    const timeout = window.setTimeout(() => setSavedText(""), 2500);
    return () => window.clearTimeout(timeout);
  }, [savedText]);

  const editable = canEdit && editingSupported;
  const openShipment = contentsOpen === null ? null : value[contentsOpen] ?? null;
  const openContents = (openShipment?.id && contents?.[openShipment.id]) || [];

  const startEditing = (shipment: DispatchTrackingInfo | null) => {
    setForm(shipment ? toShipmentForm(shipment) : EMPTY_SHIPMENT_FORM);
    setError("");
    setEditing(shipment?.id ?? NEW);
  };

  const handleSave = async () => {
    const validated = normalizeDispatchTrackingInput(form);
    if (!validated.ok) {
      setError(validated.message);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/order-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_dispatch_tracking",
          orderId,
          ...(editing && editing !== NEW ? { shipmentId: editing } : {}),
          ...validated.value,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.success) {
        setError(json?.message || "Failed to save dispatch details.");
        return;
      }
      setSavedText(editing === NEW ? "Shipment added." : "Shipment saved.");
      setEditing(null);
      if (Array.isArray(json.tracking)) onSaved?.(json.tracking as DispatchTrackingInfo[]);
    } catch {
      setError("Failed to save dispatch details.");
    } finally {
      setSaving(false);
    }
  };

  const editor = (
    <div className="space-y-4">
      <ShipmentFields idPrefix="dispatch-details" value={form} onChange={setForm} disabled={saving} onError={setError} />

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-700">{error}</div>
      )}

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => {
            setError("");
            setEditing(null);
          }}
          disabled={saving}
          className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-xl bg-gray-900 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Shipment"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round">
              <path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
          </div>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Dispatch Details</p>
        </div>
        <div className="flex items-center gap-2">
          {savedText && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
              {savedText}
            </span>
          )}
          {!editable && (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-[11px] font-semibold text-gray-500">
              Read only
            </span>
          )}
          {editable && editing === null && (
            <button
              type="button"
              onClick={() => startEditing(null)}
              className="rounded-xl border border-brand-200 px-3 py-1.5 text-[12px] font-semibold text-brand-600 transition hover:bg-brand-50"
            >
              + Add Shipment
            </button>
          )}
        </div>
      </div>

      {value.length === 0 && editing !== NEW && (
        <p className="text-[13px] text-gray-500">No shipments yet.</p>
      )}

      <div className="divide-y divide-gray-100">
        {value.map((shipment, index) => (
          <div key={shipment.id ?? index} className="py-4 first:pt-0 last:pb-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[12px] font-bold text-gray-700">Shipment {index + 1}</p>
              {editable && editing === null && shipment.id && (
                <button
                  type="button"
                  onClick={() => startEditing(shipment)}
                  className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-50"
                >
                  Edit
                </button>
              )}
            </div>
            {editing !== null && editing === shipment.id ? editor : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-4">
                <ReadOnlyField label="Dispatched By">{shipment.dispatchPartner || EMPTY}</ReadOnlyField>
                <ReadOnlyField label="Tracking Number">
                  <TrackingNumberValue trackingNumber={shipment.trackingNumber} />
                </ReadOnlyField>
                <ReadOnlyField label="Tracking Link">
                  {shipment.trackingLink ? (
                    <a
                      href={shipment.trackingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-600 underline underline-offset-2 hover:text-brand-500"
                    >
                      Track Shipment →
                    </a>
                  ) : (
                    EMPTY
                  )}
                </ReadOnlyField>
                <ReadOnlyField label="Contents">
                  {shipment.id && contents?.[shipment.id]?.length ? (
                    <>
                      <ul className="space-y-0.5 font-medium">
                        {contents[shipment.id].slice(0, CONTENTS_PREVIEW).map((line, lineIndex) => (
                          <li key={lineIndex} className="flex items-baseline justify-between gap-3">
                            <span className="font-mono text-[12px] text-amber-700">{line.catNo}</span>
                            <span className="font-mono text-[12px] whitespace-nowrap">{line.pieces} pcs</span>
                          </li>
                        ))}
                      </ul>
                      {contents[shipment.id].length > CONTENTS_PREVIEW && (
                        <button
                          type="button"
                          onClick={() => setContentsOpen(index)}
                          className="mt-1 text-[12px] font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-500"
                        >
                          Show more ({contents[shipment.id].length - CONTENTS_PREVIEW})
                        </button>
                      )}
                    </>
                  ) : (
                    EMPTY
                  )}
                </ReadOnlyField>
              </div>
            )}
          </div>
        ))}
      </div>

      {editing === NEW && (
        <div className={value.length ? "mt-4 border-t border-gray-100 pt-4" : ""}>
          <p className="mb-3 text-[12px] font-bold text-gray-700">Shipment {value.length + 1}</p>
          {editor}
        </div>
      )}

      {openShipment?.id && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]"
          onClick={() => setContentsOpen(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="shipment-contents-title"
            className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-50">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round">
                    <path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
                  </svg>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Shipment {(contentsOpen ?? 0) + 1}</p>
                  <h2 id="shipment-contents-title" className="mt-0.5 text-[17px] font-bold text-slate-900">
                    {openShipment.dispatchPartner || "Shipment"} contents
                  </h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
                    {openShipment.trackingNumber && (
                      <span className="rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-slate-700">{openShipment.trackingNumber}</span>
                    )}
                    {openShipment.trackingLink && (
                      <a
                        href={openShipment.trackingLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-500"
                      >
                        Track →
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                autoFocus
                onClick={() => setContentsOpen(null)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                aria-label="Close shipment contents"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="border-b border-slate-200">
                    <th className="w-16 px-6 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Sr. No.</th>
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Cat No.</th>
                    <th className="px-6 py-3 text-right text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Dispatch Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {openContents.map((line, lineIndex) => (
                    <tr key={lineIndex} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70">
                      <td className="px-6 py-3 font-mono text-[12px] text-slate-400">{String(lineIndex + 1).padStart(2, "0")}</td>
                      <td className="px-4 py-3 font-mono text-[13px] font-semibold text-amber-700">{line.catNo}</td>
                      <td className="px-6 py-3 text-right font-mono text-[13px] font-semibold text-slate-900">{line.pieces} pcs</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
              <p className="text-[12px] text-slate-500">
                {openContents.length} product{openContents.length === 1 ? "" : "s"}
              </p>
              <p className="text-[13px] font-semibold text-slate-700">
                Total <span className="ml-1 font-mono font-bold text-slate-900">{openContents.reduce((sum, line) => sum + line.pieces, 0)} pcs</span>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
