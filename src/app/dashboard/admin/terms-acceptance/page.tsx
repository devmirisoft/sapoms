"use client";

import { useEffect, useMemo, useState } from "react";
import { SegmentedTabs } from "@/components/SegmentedTabs";

type TermsRow = {
  id: string;
  dealerCode: string | null;
  businessName: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  acceptedAt: string | null;
  createdAt: string;
};

type Tab = "pending" | "accepted" | "all";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function TermsAcceptancePage() {
  const [rows, setRows] = useState<TermsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pending");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/terms-acceptance", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.msg || payload?.message || "Failed to load report.");
        return (payload?.data ?? []) as TermsRow[];
      })
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Something went wrong.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const acceptedCount = rows.filter((row) => row.acceptedAt).length;

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (tab === "accepted" && !row.acceptedAt) return false;
      if (tab === "pending" && row.acceptedAt) return false;
      if (!query) return true;
      return [row.businessName, row.dealerCode, row.phone, row.email, row.city, row.state]
        .some((field) => field?.toLowerCase().includes(query));
    });
  }, [rows, tab, search]);

  return (
    <main className="min-h-screen bg-[#f4f6fa] px-6 py-7 text-[#1f2937]">
      <div className="admin-page-shell">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Terms Acceptance</h1>
          <p className="mt-1 text-sm text-[#667085]">
            Dealers are blocked from the platform until they accept the Terms &amp; Conditions.
            {!loading && !error ? ` ${acceptedCount} of ${rows.length} have accepted.` : ""}
          </p>
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SegmentedTabs
            label="Terms acceptance status"
            value={tab}
            onChange={(next) => setTab(next as Tab)}
            disabled={loading || Boolean(error)}
            items={[
              {
                value: "pending",
                label: "Yet to accept",
                tone: "amber",
                title: "Dealers still blocked by the terms modal",
                count: loading || error ? null : rows.length - acceptedCount,
                icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
              },
              {
                value: "accepted",
                label: "Accepted",
                tone: "emerald",
                title: "Dealers who have accepted the terms",
                count: loading || error ? null : acceptedCount,
                icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M20 6 9 17l-5-5" /></svg>,
              },
              {
                value: "all",
                label: "All dealers",
                tone: "neutral",
                title: "Every active dealer",
                count: loading || error ? null : rows.length,
                icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M17 20v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 20v-2a4 4 0 0 0-3-3.87M16 2.13a4 4 0 0 1 0 7.75" /></svg>,
              },
            ]}
          />

          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, code, phone, city..."
            className="h-9 w-full rounded border border-[#d6dbe4] bg-white px-3 text-sm outline-none focus:border-[#5d7df0] focus:ring-2 focus:ring-[#dfe6ff] sm:w-72"
          />
        </div>

        <div className="overflow-x-auto rounded border border-[#dfe3ec] bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-[#f7f9fc] text-xs uppercase tracking-wide text-[#667085]">
              <tr>
                <th className="px-4 py-3">Dealer</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Accepted on</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[#667085]">Loading...</td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-red-500">{error}</td>
                </tr>
              )}
              {!loading && !error && visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[#667085]">No dealers match this filter.</td>
                </tr>
              )}
              {!loading && !error && visible.map((row) => (
                <tr key={row.id} className="border-t border-[#eef1f6]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[#1f2937]">{row.businessName}</div>
                    <div className="text-xs text-[#667085]">{row.dealerCode || "No code"}</div>
                  </td>
                  <td className="px-4 py-3 text-[#59677a]">
                    <div>{row.phone || "—"}</div>
                    <div className="text-xs text-[#667085]">{row.email || "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-[#59677a]">{[row.city, row.state].filter(Boolean).join(", ") || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                      row.acceptedAt ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                    }`}>
                      {row.acceptedAt ? "Accepted" : "Yet to accept"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#59677a]">{formatDate(row.acceptedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
