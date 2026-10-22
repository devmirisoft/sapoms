"use client";

import { useEffect, useMemo, useState } from "react";
import { SegmentedTabs } from "@/components/SegmentedTabs";
import TermsEditor from "@/components/terms/TermsEditor";
import { TermsDocument, type TermsBlock } from "@/components/terms/TermsDocument";

type TermsRow = {
  id: string;
  dealerCode: string | null;
  businessName: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  acceptedAt: string | null;
  active: boolean;
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
  const [docDealer, setDocDealer] = useState<TermsRow | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  async function toggleActive(row: TermsRow) {
    const active = !row.active;
    if (!active && !window.confirm(`Hide the Terms & Conditions document from ${row.businessName}? They won't be asked to accept it.`)) return;
    setToggling(row.id);
    try {
      const response = await fetch(`/api/admin/dealers/${encodeURIComponent(row.id)}/terms`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.msg || payload?.message || "Failed to update document status.");
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item, active } : item)));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to update document status.");
    } finally {
      setToggling(null);
    }
  }

  async function setAllActive(active: boolean) {
    const message = active
      ? "Show the Terms & Conditions document to every dealer? Dealers who haven't accepted will be blocked until they do."
      : "Hide the Terms & Conditions document from every dealer? None of them will be asked to accept it.";
    if (!window.confirm(message)) return;
    setToggling("all");
    try {
      const response = await fetch("/api/admin/terms-acceptance", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.msg || payload?.message || "Failed to update document status.");
      setRows((current) => current.map((item) => ({ ...item, active })));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to update document status.");
    } finally {
      setToggling(null);
    }
  }

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
  // Dealers with the document off are never blocked, so they aren't "yet to accept".
  const pendingCount = rows.filter((row) => !row.acceptedAt && row.active).length;

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (tab === "accepted" && !row.acceptedAt) return false;
      if (tab === "pending" && (row.acceptedAt || !row.active)) return false;
      if (!query) return true;
      return [row.businessName, row.dealerCode, row.phone, row.email, row.city, row.state]
        .some((field) => field?.toLowerCase().includes(query));
    });
  }, [rows, tab, search]);

  return (
    <main className="min-h-screen bg-[#f4f6fa] px-6 py-7 text-[#1f2937]">
      <div className="admin-page-shell">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Terms Acceptance</h1>
            <p className="mt-1 text-sm text-[#667085]">
              Dealers are blocked from the platform until they accept the Terms &amp; Conditions.
              {!loading && !error ? ` ${acceptedCount} of ${rows.length} have accepted.` : ""}
            </p>
          </div>
          {!loading && !error && rows.length > 0 && (
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => setAllActive(true)}
                disabled={toggling !== null}
                className="h-9 rounded border border-emerald-200 bg-white px-4 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              >
                Activate all
              </button>
              <button
                type="button"
                onClick={() => setAllActive(false)}
                disabled={toggling !== null}
                className="h-9 rounded border border-red-200 bg-white px-4 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {toggling === "all" ? "Saving..." : "Deactivate all"}
              </button>
            </div>
          )}
        </div>

        <details className="mb-6 rounded border border-[#dfe3ec] bg-white shadow-sm">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Edit Terms &amp; Conditions content</summary>
          <div className="border-t border-[#eef1f6] p-4">
            <TermsEditor />
          </div>
        </details>

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
                count: loading || error ? null : pendingCount,
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
                <th className="px-4 py-3">Document</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#667085]">Loading...</td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-red-500">{error}</td>
                </tr>
              )}
              {!loading && !error && visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#667085]">No dealers match this filter.</td>
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
                    {!row.active && (
                      <span className="ml-1.5 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">Document off</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#59677a]">{formatDate(row.acceptedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setDocDealer(row)}
                        className="h-8 rounded border border-[#d6dbe4] bg-white px-3 text-xs font-medium text-[#344054] hover:bg-[#f7f9fc]"
                      >
                        Document
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleActive(row)}
                        disabled={toggling !== null}
                        title={row.active ? "Hide the document from this dealer" : "Show the document to this dealer"}
                        className={`h-8 rounded border px-3 text-xs font-medium disabled:opacity-50 ${
                          row.active
                            ? "border-red-200 bg-white text-red-600 hover:bg-red-50"
                            : "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
                        }`}
                      >
                        {toggling === row.id ? "Saving..." : row.active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {docDealer && <DealerDocumentModal dealer={docDealer} onClose={() => setDocDealer(null)} />}
    </main>
  );
}

// Preview of one dealer's T&C (their own, or the template if none), with an edit mode.
function DealerDocumentModal({ dealer, onClose }: { dealer: TermsRow; onClose: () => void }) {
  const url = `/api/admin/dealers/${encodeURIComponent(dealer.id)}/terms`;
  const [blocks, setBlocks] = useState<TermsBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (editing) return;
    let cancelled = false;
    fetch(url, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.msg || payload?.message || "Failed to load document.");
        if (!cancelled) setBlocks(Array.isArray(payload?.data) ? payload.data : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load document.");
      });
    return () => {
      cancelled = true;
    };
  }, [url, editing]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${dealer.businessName} terms document`}
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded bg-white shadow-xl ${editing ? "max-w-6xl" : "max-w-3xl"}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#eef1f6] px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">{editing ? "Edit document" : "Terms & Conditions"}</h2>
            <p className="text-xs text-[#667085]">{dealer.businessName}{dealer.dealerCode ? ` · ${dealer.dealerCode}` : ""}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded px-2 py-1 text-lg text-[#667085] hover:bg-[#f7f9fc]">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {editing ? (
            <TermsEditor url={url} />
          ) : error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : blocks ? (
            <div className="space-y-3 text-sm leading-relaxed text-slate-700">
              <TermsDocument blocks={blocks} />
            </div>
          ) : (
            <p className="text-sm text-[#667085]">Loading document...</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#eef1f6] px-5 py-3">
          {editing ? (
            <button type="button" onClick={() => { setBlocks(null); setEditing(false); }} className="h-9 rounded border border-[#d6dbe4] bg-white px-4 text-sm font-medium text-[#344054] hover:bg-[#f7f9fc]">
              Back to preview
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={!blocks}
              className="h-9 rounded bg-[#1f2937] px-4 text-sm font-medium text-white hover:bg-[#374151] disabled:opacity-50"
            >
              Edit document
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
