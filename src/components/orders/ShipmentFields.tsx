"use client";

import { useEffect, useState } from "react";
import {
  DISPATCH_PARTNER_LIMIT,
  DISPATCH_PARTNERS,
  TRACKING_LINK_LIMIT,
  TRACKING_NUMBER_LIMIT,
  buildTrackingLink,
  normalizeDispatchTrackingInput,
  shipmentLabel,
  type DispatchTrackingInfo,
} from "@/lib/orderDispatch";

export type ShipmentForm = {
  dispatchPartner: string;
  trackingNumber: string;
  trackingLink: string;
};

export const EMPTY_SHIPMENT_FORM: ShipmentForm = { dispatchPartner: "", trackingNumber: "", trackingLink: "" };

export function toShipmentForm(value: DispatchTrackingInfo | null | undefined): ShipmentForm {
  return {
    dispatchPartner: value?.dispatchPartner ?? "",
    trackingNumber: value?.trackingNumber ?? "",
    trackingLink: value?.trackingLink ?? "",
  };
}

const ADD_COURIER = "__add_courier__";
const NEW_SHIPMENT = "__new_shipment__";

type CourierOption = { name: string; trackingUrlPrefix: string | null };

// Couriers are admin-managed (/dashboard/admin/couriers). The hardcoded list
// stays only as the fallback when that fetch fails, so dispatch is never
// blocked by an unreachable courier list.
function useCourierOptions() {
  const [couriers, setCouriers] = useState<CourierOption[]>(() =>
    DISPATCH_PARTNERS.map((name) => ({ name, trackingUrlPrefix: null })),
  );

  useEffect(() => {
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
  }, []);

  const addCourier = (courier: CourierOption) =>
    setCouriers((previous) =>
      previous.some((option) => option.name === courier.name) ? previous : [...previous, courier]);

  return [couriers, addCourier] as const;
}

const inputClass = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-900 outline-none transition focus:border-brand-300";

// Courier, tracking number and tracking link for one shipment. Shared by the
// Dispatch Details card and the dispatch forms that create a shipment inline.
export function ShipmentFields({ value, onChange, disabled, onError, idPrefix = "shipment" }: {
  value: ShipmentForm;
  onChange: (next: ShipmentForm) => void;
  disabled?: boolean;
  onError: (message: string) => void;
  idPrefix?: string;
}) {
  const [courierOptions, addCourierOption] = useCourierOptions();
  // null = not adding; an object = the name/prefix being typed inline.
  const [newCourier, setNewCourier] = useState<CourierOption | null>(null);
  const [addingCourier, setAddingCourier] = useState(false);

  const prefixFor = (partner: string) =>
    courierOptions.find((option) => option.name === partner)?.trackingUrlPrefix ?? null;

  // Joining the courier's saved prefix to the tracking number is the whole
  // point of storing the prefix, so it rewrites the link whenever either side
  // changes. Selecting a courier shows its bare prefix until a number is typed;
  // a courier with no prefix leaves a hand-typed link alone.
  const withLink = (next: ShipmentForm, prefix: string | null) => {
    const link = buildTrackingLink(prefix, next.trackingNumber) ?? prefix;
    return link ? { ...next, trackingLink: link } : next;
  };

  const applyPartner = (partner: string, prefix?: string | null) => {
    onChange(withLink({ ...value, dispatchPartner: partner }, prefix === undefined ? prefixFor(partner) : prefix));
    onError("");
  };

  const handleAddCourier = async () => {
    const name = (newCourier?.name ?? "").trim();
    const trackingUrlPrefix = (newCourier?.trackingUrlPrefix ?? "").trim() || null;
    if (!name) {
      onError("Courier name is required.");
      return;
    }

    setAddingCourier(true);
    onError("");
    try {
      const response = await fetch("/api/couriers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, trackingUrlPrefix }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.success) {
        onError(json?.message || "Failed to add courier.");
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
      onError("Failed to add courier.");
    } finally {
      setAddingCourier(false);
    }
  };

  const handleChange = (field: keyof ShipmentForm, next: string) => {
    if (field === "trackingLink") onChange({ ...value, trackingLink: next });
    else onChange(withLink({ ...value, [field]: next }, prefixFor(field === "dispatchPartner" ? next : value.dispatchPartner)));
    onError("");
  };

  const courierKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleAddCourier();
    }
    if (event.key === "Escape") setNewCourier(null);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      <div>
        <label htmlFor={`${idPrefix}-partner`} className="mb-1.5 block text-[12px] font-semibold text-gray-700">Dispatched By <span className="text-rose-600">*</span></label>
        <select
          id={`${idPrefix}-partner`}
          value={value.dispatchPartner}
          onChange={(event) => {
            if (event.target.value === ADD_COURIER) {
              setNewCourier({ name: "", trackingUrlPrefix: "" });
              return;
            }
            applyPartner(event.target.value);
          }}
          disabled={disabled}
          className={inputClass}
        >
          <option value="">Select dispatch partner</option>
          {/* A courier saved earlier but since removed still shows, so
              editing another field cannot silently blank it. */}
          {(value.dispatchPartner && !courierOptions.some((option) => option.name === value.dispatchPartner)
            ? [{ name: value.dispatchPartner, trackingUrlPrefix: null }, ...courierOptions]
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
              onKeyDown={courierKeyDown}
              disabled={addingCourier || disabled}
              placeholder="New partner name"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px] text-gray-900 outline-none transition focus:border-brand-300"
            />
            <input
              type="url"
              maxLength={TRACKING_LINK_LIMIT}
              value={newCourier.trackingUrlPrefix ?? ""}
              onChange={(event) => setNewCourier({ ...newCourier, trackingUrlPrefix: event.target.value })}
              onKeyDown={courierKeyDown}
              disabled={addingCourier || disabled}
              placeholder="Tracking link prefix, e.g. https://www.delhivery.com/track-v2/package/"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-[13px] text-gray-900 outline-none transition focus:border-brand-300"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAddCourier}
                disabled={addingCourier || disabled}
                className="rounded-xl bg-brand-600 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
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
        <label htmlFor={`${idPrefix}-number`} className="mb-1.5 block text-[12px] font-semibold text-gray-700">Tracking Number</label>
        <input
          id={`${idPrefix}-number`}
          type="text"
          maxLength={TRACKING_NUMBER_LIMIT}
          value={value.trackingNumber}
          onChange={(event) => handleChange("trackingNumber", event.target.value)}
          disabled={disabled}
          placeholder="AWB123456789"
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-link`} className="mb-1.5 block text-[12px] font-semibold text-gray-700">Tracking Link</label>
        <input
          id={`${idPrefix}-link`}
          type="url"
          maxLength={TRACKING_LINK_LIMIT}
          value={value.trackingLink}
          onChange={(event) => handleChange("trackingLink", event.target.value)}
          disabled={disabled}
          placeholder="https://..."
          className={inputClass}
        />
        {prefixFor(value.dispatchPartner) && (
          <p className="mt-1 text-[11px] text-gray-500">
            Built from the tracking link prefix saved for {value.dispatchPartner}.
          </p>
        )}
      </div>
    </div>
  );
}

// Which shipment a dispatch goes out with: "" (none chosen), an existing
// shipment id, or a new shipment typed inline.
export type ShipmentPick = { shipmentId: string; form: ShipmentForm };

export const EMPTY_SHIPMENT_PICK: ShipmentPick = { shipmentId: "", form: EMPTY_SHIPMENT_FORM };

// Request body fields for the picked shipment, or an error message.
export function shipmentPickPayload(pick: ShipmentPick):
  | { ok: true; value: { shipmentId: string } | Omit<DispatchTrackingInfo, "id" | "dock"> }
  | { ok: false; message: string } {
  if (!pick.shipmentId) return { ok: false, message: "Select the shipment this dispatch went with." };
  if (pick.shipmentId !== NEW_SHIPMENT) return { ok: true, value: { shipmentId: pick.shipmentId } };
  const validated = normalizeDispatchTrackingInput(pick.form);
  if (!validated.ok) return validated;
  const { dispatchPartner, trackingNumber, trackingLink } = validated.value;
  return { ok: true, value: { dispatchPartner, trackingNumber, trackingLink } };
}

export function ShipmentPicker({ shipments, value, onChange, disabled, onError }: {
  shipments: DispatchTrackingInfo[];
  value: ShipmentPick;
  onChange: (next: ShipmentPick) => void;
  disabled?: boolean;
  onError: (message: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="dispatch-shipment" className="mb-1.5 block text-[12px] font-semibold text-slate-700">
          Shipment <span className="text-rose-600">*</span>
        </label>
        <select
          id="dispatch-shipment"
          value={value.shipmentId}
          onChange={(event) => {
            onChange({ ...value, shipmentId: event.target.value });
            onError("");
          }}
          disabled={disabled}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13px] text-slate-900 outline-none focus:border-brand-300"
        >
          <option value="">Select shipment</option>
          {shipments.map((shipment, index) => shipment.id && (
            <option key={shipment.id} value={shipment.id}>Shipment {index + 1}: {shipmentLabel(shipment)}</option>
          ))}
          <option value={NEW_SHIPMENT}>+ New shipment...</option>
        </select>
      </div>
      {value.shipmentId === NEW_SHIPMENT && (
        <ShipmentFields
          idPrefix="new-shipment"
          value={value.form}
          onChange={(form) => onChange({ ...value, form })}
          disabled={disabled}
          onError={onError}
        />
      )}
    </div>
  );
}
