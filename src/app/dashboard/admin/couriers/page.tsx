"use client";

import { useCallback, useEffect, useState } from "react";
import { showToast } from "@/components/ui/toast";
import { DISPATCH_PARTNER_LIMIT, TRACKING_LINK_LIMIT } from "@/lib/orderDispatch";

type Courier = {
  id: string;
  name: string;
  trackingUrlPrefix: string | null;
  isActive: boolean;
  position: number;
};

const API = "/api/admin/couriers";

export default function CouriersPage() {
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(API, { credentials: "include", cache: "no-store" });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.success) throw new Error(json?.message ?? "Failed to load couriers");
      setCouriers(json.data as Courier[]);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Failed to load couriers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Every mutation refetches: the list is a handful of rows, so keeping a local
  // optimistic copy in sync would cost more than the round trip.
  const mutate = async (init: RequestInit & { url?: string }, successMessage: string) => {
    setSaving(true);
    try {
      const { url, ...request } = init;
      const response = await fetch(url ?? API, {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        ...request,
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.success) throw new Error(json?.message ?? "Request failed");
      showToast("success", successMessage);
      await load();
      return true;
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Request failed");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    const added = await mutate(
      {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), trackingUrlPrefix: prefix.trim(), position: couriers.length }),
      },
      "Courier added.",
    );
    if (added) {
      setName("");
      setPrefix("");
    }
  };

  const handleRename = async (courier: Courier) => {
    const next = window.prompt("Courier name", courier.name);
    if (next === null || !next.trim() || next.trim() === courier.name) return;
    await mutate({ method: "PATCH", body: JSON.stringify({ id: courier.id, name: next.trim() }) }, "Courier renamed.");
  };

  // The tracking number is appended to this, so the order form can build the
  // full link once staff type the number.
  const handleEditPrefix = async (courier: Courier) => {
    const next = window.prompt(
      `Tracking link prefix for ${courier.name} (the tracking number is appended to it). Leave blank to clear.`,
      courier.trackingUrlPrefix ?? "",
    );
    if (next === null || next.trim() === (courier.trackingUrlPrefix ?? "")) return;
    await mutate(
      { method: "PATCH", body: JSON.stringify({ id: courier.id, trackingUrlPrefix: next.trim() }) },
      "Tracking link prefix saved.",
    );
  };

  const handleToggle = (courier: Courier) =>
    mutate(
      { method: "PATCH", body: JSON.stringify({ id: courier.id, isActive: !courier.isActive }) },
      courier.isActive ? "Courier hidden from the dropdown." : "Courier shown in the dropdown.",
    );

  const handleDelete = async (courier: Courier) => {
    if (!window.confirm(`Delete "${courier.name}"? Orders already dispatched with it keep the name.`)) return;
    await mutate({ url: `${API}?id=${encodeURIComponent(courier.id)}`, method: "DELETE" }, "Courier deleted.");
  };

  return (
    <div className="min-h-screen bg-[#f4f6fa] px-4 py-7 text-[#344155]">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-lg font-semibold text-gray-900">Courier Services</h1>
        <p className="mt-1 text-sm text-gray-500">
          These couriers fill the &quot;Dispatched By&quot; dropdown on the order details page.
        </p>

        <form onSubmit={handleAdd} className="mt-5 flex flex-wrap gap-3">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={DISPATCH_PARTNER_LIMIT}
            placeholder="Courier name"
            className="h-10 w-48 rounded-lg border border-[#d6dbe4] bg-white px-3 text-sm outline-none focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#dfe6ff]"
          />
          <input
            type="url"
            value={prefix}
            onChange={(event) => setPrefix(event.target.value)}
            maxLength={TRACKING_LINK_LIMIT}
            placeholder="Tracking link prefix, e.g. https://www.delhivery.com/track-v2/package/"
            className="h-10 min-w-[16rem] flex-1 rounded-lg border border-[#d6dbe4] bg-white px-3 text-sm outline-none focus:border-[#1d4ed8] focus:ring-2 focus:ring-[#dfe6ff]"
          />
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="rounded-lg bg-[#1d4ed8] px-5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            Add Courier
          </button>
        </form>

        <div className="mt-5 divide-y divide-[#eef0f5] rounded-xl border border-[#dfe3ec] bg-white">
          {loading ? (
            <p className="px-4 py-6 text-sm text-gray-500">Loading couriers...</p>
          ) : !couriers.length ? (
            <p className="px-4 py-6 text-sm text-gray-500">No couriers yet. Add one above.</p>
          ) : (
            couriers.map((courier) => (
              <div key={courier.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-[8rem] flex-1 text-sm font-medium text-gray-900">
                  {courier.name}
                  <span className="mt-0.5 block truncate text-[11px] font-normal text-gray-500">
                    {courier.trackingUrlPrefix ?? "No tracking link prefix"}
                  </span>
                </span>
                <span
                  className={courier.isActive
                    ? "rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700"
                    : "rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-semibold text-gray-500"}
                >
                  {courier.isActive ? "Active" : "Hidden"}
                </span>
                <button type="button" onClick={() => handleRename(courier)} disabled={saving} className="text-[12px] font-semibold text-[#1d4ed8] hover:underline disabled:opacity-50">
                  Rename
                </button>
                <button type="button" onClick={() => handleEditPrefix(courier)} disabled={saving} className="text-[12px] font-semibold text-[#1d4ed8] hover:underline disabled:opacity-50">
                  Tracking Prefix
                </button>
                <button type="button" onClick={() => handleToggle(courier)} disabled={saving} className="text-[12px] font-semibold text-[#405064] hover:underline disabled:opacity-50">
                  {courier.isActive ? "Hide" : "Show"}
                </button>
                <button type="button" onClick={() => handleDelete(courier)} disabled={saving} className="text-[12px] font-semibold text-[#c0392b] hover:underline disabled:opacity-50">
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
