"use client";

import { useEffect, useState } from "react";
import {
  DISPATCH_PARTNER_LIMIT,
  DISPATCH_PARTNERS,
  TRACKING_LINK_LIMIT,
  TRACKING_NUMBER_LIMIT,
  buildTrackingLink,
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
};

const EMPTY = "—";
const ADD_COURIER = "__add_courier__";

type CourierOption = { name: string; trackingUrlPrefix: string | null };

// Couriers are admin-managed (/dashboard/admin/couriers). The hardcoded list
// stays only as the fallback when that fetch fails, so dispatch is never
// blocked by an unreachable courier list.
function useCourierOptions(enabled: boolean) {
  const [couriers, setCouriers] = useState<CourierOption[]>(() =>
    DISPATCH_PARTNERS.map((name) => ({ name, trackingUrlPrefix: null })),
  );

  useEffect(() => {
    if (!enabled) return;
    let active = true;

    fetch("/api/couriers", { credentials: "include", cache: "no-store" })
      .then((response) => response.json())
      .then((json) => {
        if (!active || !json?.success || !Array.isArray(json.data) || !json.data.length) return;
        setCouriers(json.data.map((row: CourierOption) => ({
          name: row.name,
          trackingUrlPrefix: row.trackingUrlPrefix ?? null,
        })));
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [enabled]);

  const addCourier = (courier: CourierOption) =>
    setCouriers((previous) =>
      previous.some((option) => option.name === courier.name) ? previous : [...previous, courier]);

  return [couriers, addCourier] as const;
}

function toFormState(value: DispatchTrackingInfo): FormState {
  return {
    dispatchPartner: value.dispatchPartner ?? "",
    trackingNumber: value.trackingNumber ?? "",
    trackingLink: value.trackingLink ?? "",
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
  const [courierOptions, addCourierOption] = useCourierOptions(editable);
  // null = not adding; an object = the name/prefix being typed inline.
  const [newCourier, setNewCourier] = useState<CourierOption | null>(null);
  const [addingCourier, setAddingCourier] = useState(false);

  const prefixFor = (partner: string) =>
    courierOptions.find((option) => option.name === partner)?.trackingUrlPrefix ?? null;

  // Joining the courier's saved prefix to the tracking number is the whole
  // point of storing the prefix, so it rewrites the link whenever either side
  // changes. Selecting a courier shows its bare prefix until a number is typed;
  // a courier with no prefix leaves a hand-typed link alone.
  const linkFor = (prefix: string | null, trackingNumber: string) =>
    buildTrackingLink(prefix, trackingNumber) ?? prefix;

  const applyPartner = (partner: string, prefix?: string | null) => {
    setForm((previous) => {
      const next = { ...previous, dispatchPartner: partner };
      const link = linkFor(prefix === undefined ? prefixFor(partner) : prefix, next.trackingNumber);
      return link ? { ...next, trackingLink: link } : next;
    });
    setError("");
  };

  const handleAddCourier = async () => {
    const name = (newCourier?.name ?? "").trim();
    const trackingUrlPrefix = (newCourier?.trackingUrlPrefix ?? "").trim() || null;
    if (!name) {
      setError("Courier name is required.");
      return;
    }

    setAddingCourier(true);
    setError("");
    try {
      const response = await fetch("/api/couriers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, trackingUrlPrefix }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.success) {
        setError(json?.message || "Failed to add courier.");
        return;
      }
      const saved: CourierOption = {
        name: String(json.data?.name || name),
        trackingUrlPrefix: json.data?.trackingUrlPrefix ?? trackingUrlPrefix,
      };
      addCourierOption(saved);
      applyPartner(saved.name, saved.trackingUrlPrefix);
      setNewCourier(null);
    } catch {
      setError("Failed to add courier.");
    } finally {
      setAddingCourier(false);
    }
  };

  const handleChange = (field: keyof FormState, next: string) => {
    setForm((previous) => {
      if (field === "trackingLink") return { ...previous, trackingLink: next };
      const updated = { ...previous, [field]: next };
      const link = linkFor(prefixFor(updated.dispatchPartner), updated.trackingNumber);
      return link ? { ...updated, trackingLink: link } : updated;
    });
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
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <div>
              <label htmlFor="dispatch-partner" className="mb-1.5 block text-[12px] font-semibold text-gray-700">Dispatched By</label>
              <select
                id="dispatch-partner"
                value={form.dispatchPartner}
                onChange={(event) => {
                  if (event.target.value === ADD_COURIER) {
                    setNewCourier({ name: "", trackingUrlPrefix: "" });
                    return;
                  }
                  applyPartner(event.target.value);
                }}
                disabled={saving}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-900 outline-none transition focus:border-indigo-300"
              >
                <option value="">Select dispatch partner</option>
                {/* A courier saved earlier but since removed still shows, so
                    editing another field cannot silently blank it. */}
                {(form.dispatchPartner && !courierOptions.some((option) => option.name === form.dispatchPartner)
                  ? [{ name: form.dispatchPartner, trackingUrlPrefix: null }, ...courierOptions]
                  : courierOptions
                ).map((option) => (
                  <option key={option.name} value={option.name}>{option.name}</option>
                ))}
                <option value={ADD_COURIER}>+ Add dispatch partner...</option>
              </select>
              {newCourier !== null && (
                <div className="mt-2 space-y-2">
                  <input
                    type="text"
                    autoFocus
                    maxLength={DISPATCH_PARTNER_LIMIT}
                    value={newCourier.name}
                    onChange={(event) => setNewCourier({ ...newCourier, name: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleAddCourier();
                      }
                      if (event.key === "Escape") setNewCourier(null);
                    }}
                    disabled={addingCourier || saving}
                    placeholder="New partner name"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px] text-gray-900 outline-none transition focus:border-indigo-300"
                  />
                  <input
                    type="url"
                    maxLength={TRACKING_LINK_LIMIT}
                    value={newCourier.trackingUrlPrefix ?? ""}
                    onChange={(event) => setNewCourier({ ...newCourier, trackingUrlPrefix: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleAddCourier();
                      }
                      if (event.key === "Escape") setNewCourier(null);
                    }}
                    disabled={addingCourier || saving}
                    placeholder="Tracking link prefix, e.g. https://www.delhivery.com/track-v2/package/"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px] text-gray-900 outline-none transition focus:border-indigo-300"
                  />
                  <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAddCourier}
                    disabled={addingCourier || saving}
                    className="rounded-xl bg-indigo-600 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {addingCourier ? "Adding..." : "Add"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewCourier(null)}
                    disabled={addingCourier}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-[12px] font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  </div>
                </div>
              )}
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
              {prefixFor(form.dispatchPartner) && (
                <p className="mt-1 text-[11px] text-gray-500">
                  Built from the tracking link prefix saved for {form.dispatchPartner}.
                </p>
              )}
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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-4">
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
        </div>
      )}
    </div>
  );
}
