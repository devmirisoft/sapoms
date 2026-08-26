"use client";

import { useEffect, useState } from "react";
import {
  DISPATCH_PARTNERS,
  DOCK_LIMIT,
  TRACKING_LINK_LIMIT,
  TRACKING_NUMBER_LIMIT,
  normalizeDispatchTrackingInput,
  type DispatchTrackingInfo,
} from "@/lib/orderDispatch";

type Props = {
  orderId: string;
  // Staff/admin who may record dispatch updates for this order.
  canEdit: boolean;
  // Editing needs a PostgreSQL order; legacy PHP orders stay read-only.
  editingSupported: boolean;
  value: DispatchTrackingInfo;
  onSaved?: (tracking: DispatchTrackingInfo) => void;
};

type FormState = {
  dispatchPartner: string;
  trackingNumber: string;
  trackingLink: string;
  dock: string;
};

const EMPTY = "—";

function toFormState(value: DispatchTrackingInfo): FormState {
  return {
    dispatchPartner: value.dispatchPartner ?? "",
    trackingNumber: value.trackingNumber ?? "",
    trackingLink: value.trackingLink ?? "",
    dock: value.dock ?? "",
  };
}

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

export default function DispatchTrackingCard({ orderId, canEdit, editingSupported, value, onSaved }: Props) {
  const [form, setForm] = useState<FormState>(() => toFormState(value));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedText, setSavedText] = useState("");

  useEffect(() => {
    if (!savedText) return;
    const timeout = window.setTimeout(() => setSavedText(""), 2500);
    return () => window.clearTimeout(timeout);
  }, [savedText]);

  const editable = canEdit && editingSupported;

  const handleChange = (field: keyof FormState, next: string) => {
    setForm((previous) => ({ ...previous, [field]: next }));
    setError("");
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
          ...validated.value,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.success) {
        setError(json?.message || "Failed to save dispatch details.");
        return;
      }
      const saved = (json.tracking ?? validated.value) as DispatchTrackingInfo;
      setEditing(false);
      setSavedText("Dispatch details saved.");
      onSaved?.(saved);
    } catch {
      setError("Failed to save dispatch details.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center">
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
          {editable && !editing && (
            <button
              type="button"
              onClick={() => {
                setForm(toFormState(value));
                setError("");
                setEditing(true);
              }}
              className="rounded-xl border border-indigo-200 px-3 py-1.5 text-[12px] font-semibold text-indigo-700 transition hover:bg-indigo-50"
            >
              Edit Dispatch Details
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div>
              <label htmlFor="dispatch-partner" className="mb-1.5 block text-[12px] font-semibold text-gray-700">Dispatched By</label>
              <select
                id="dispatch-partner"
                value={form.dispatchPartner}
                onChange={(event) => handleChange("dispatchPartner", event.target.value)}
                disabled={saving}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-900 outline-none transition focus:border-indigo-300"
              >
                <option value="">Select dispatch partner</option>
                {DISPATCH_PARTNERS.map((partner) => (
                  <option key={partner} value={partner}>{partner}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="tracking-number" className="mb-1.5 block text-[12px] font-semibold text-gray-700">Tracking Number</label>
              <input
                id="tracking-number"
                type="text"
                maxLength={TRACKING_NUMBER_LIMIT}
                value={form.trackingNumber}
                onChange={(event) => handleChange("trackingNumber", event.target.value)}
                disabled={saving}
                placeholder="AWB123456789"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] text-gray-900 outline-none transition focus:border-indigo-300"
              />
            </div>
            <div>
              <label htmlFor="tracking-link" className="mb-1.5 block text-[12px] font-semibold text-gray-700">Tracking Link</label>
              <input
                id="tracking-link"
                type="url"
                maxLength={TRACKING_LINK_LIMIT}
                value={form.trackingLink}
                onChange={(event) => handleChange("trackingLink", event.target.value)}
                disabled={saving}
                placeholder="https://..."
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] text-gray-900 outline-none transition focus:border-indigo-300"
              />
            </div>
            <div>
              <label htmlFor="dispatch-dock" className="mb-1.5 block text-[12px] font-semibold text-gray-700">Dock</label>
              <input
                id="dispatch-dock"
                type="text"
                maxLength={DOCK_LIMIT}
                value={form.dock}
                onChange={(event) => handleChange("dock", event.target.value)}
                disabled={saving}
                placeholder="Dock 04"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] text-gray-900 outline-none transition focus:border-indigo-300"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-700">{error}</div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setForm(toFormState(value));
                setError("");
                setEditing(false);
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
              {saving ? "Saving..." : "Save Dispatch Details"}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-4">
          <ReadOnlyField label="Dispatched By">{value.dispatchPartner || EMPTY}</ReadOnlyField>
          <ReadOnlyField label="Tracking Number">
            <TrackingNumberValue trackingNumber={value.trackingNumber} />
          </ReadOnlyField>
          <ReadOnlyField label="Tracking Link">
            {value.trackingLink ? (
              <a
                href={value.trackingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-700 underline underline-offset-2 hover:text-indigo-900"
              >
                Track Shipment →
              </a>
            ) : (
              EMPTY
            )}
          </ReadOnlyField>
          <ReadOnlyField label="Dock">{value.dock || EMPTY}</ReadOnlyField>
        </div>
      )}
    </div>
  );
}
