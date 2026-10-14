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
  // What went out in each shipment, keyed by shipment id: "Flask 250 ml — 50 pcs".
  contents?: Record<string, string[]>;
  onSaved?: (shipments: DispatchTrackingInfo[]) => void;
};

const EMPTY = "—";
const NEW = "new";

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

  useEffect(() => {
    if (!savedText) return;
    const timeout = window.setTimeout(() => setSavedText(""), 2500);
    return () => window.clearTimeout(timeout);
  }, [savedText]);

  const editable = canEdit && editingSupported;

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
                    <ul className="space-y-0.5 font-medium">
                      {contents[shipment.id].map((line, lineIndex) => <li key={lineIndex}>{line}</li>)}
                    </ul>
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
    </div>
  );
}
