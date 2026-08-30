"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Wallet } from "lucide-react";
import {
  ApprovalTrail,
  ItemsTable,
  fmtDate,
  money,
  stageLabel,
  statusBadge,
  type FundRequest,
} from "@/components/fund-requests/FundRequestQueue";

/**
 * Accountant queue: requests that cleared both RSM and Staff.
 *
 * Adding the funds is the accountant's only action - approval never moves
 * money, and for an advance order the wallet credit and the automatic order
 * placement happen together server-side.
 */
export default function AccountantFundRequestsPage() {
  const [requests, setRequests] = useState<FundRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/dealer-fund-requests", { credentials: "include", cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.message || "Failed to load fund requests");
      const rows: FundRequest[] = Array.isArray(json.data) ? json.data : [];
      // Only what is still awaiting money; the funded history lives on the
      // Fund Addition Records page.
      setRequests(rows.filter((row) => row.status === "STAFF_APPROVED"));
    } catch (err: any) {
      setError(err?.message || "Failed to load fund requests");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const fund = async (request: FundRequest) => {
    setUpdating(request.id);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/dealer-fund-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "fund", note: (notes[request.id] || "").trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.message || "Failed to add funds");
      setNotice(json?.data?.placedOrderNumber
        ? `Funds added and order ${json.data.placedOrderNumber} placed.`
        : "Funds added to the dealer wallet.");
      setNotes((current) => ({ ...current, [request.id]: "" }));
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to add funds");
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-6" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>
      <div className="mx-auto max-w-[1840px] space-y-5">
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/dashboard/accountant" className="mb-3 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-100">
              <ArrowLeft size={14} />
              Back to dashboard
            </Link>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <Wallet size={18} />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">Advance Order Fund Requests</h1>
                <p className="mt-1 text-sm text-gray-500">
                  Approved by RSM and Staff, awaiting funds. Adding funds credits the dealer wallet and places the order automatically.
                </p>
              </div>
            </div>
          </div>
          <button onClick={() => void load()} className="w-fit rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-100">
            Refresh
          </button>
        </div>

        {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</div>}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}

        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">Loading fund requests...</div>
        ) : requests.length === 0 ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">No requests are awaiting funds.</div>
        ) : (
          <div className="space-y-4">
            {requests.map((request) => {
              const isOpen = expanded === request.id;
              return (
                <div key={request.id} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <div className="flex flex-col gap-4 border-b border-gray-100 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[16px] font-bold text-gray-900">{request.dealerName || "Dealer"}</h2>
                        {request.dealerCode && <span className="font-mono text-[12px] text-gray-500">{request.dealerCode}</span>}
                        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusBadge(request.status)}`}>
                          {stageLabel(request.status, request.rejectedBy)}
                        </span>
                        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700">
                          {request.type === "ADVANCE_ORDER" ? "Advance order" : "Additional funds"}
                        </span>
                      </div>
                      <p className="mt-1 text-[12px] text-gray-500">Raised {fmtDate(request.createdAt)}</p>
                      {request.dealerNote && <p className="mt-2 text-[13px] text-gray-600">Dealer note: {request.dealerNote}</p>}
                    </div>
                    <div className="grid shrink-0 grid-cols-3 gap-3 text-right">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">To add</p>
                        <p className="mt-0.5 font-mono text-[15px] font-bold text-emerald-700">{money(request.amount)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Wallet</p>
                        <p className="mt-0.5 font-mono text-[15px] font-bold text-gray-900">{money(request.walletBalance)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Order</p>
                        <p className="mt-0.5 font-mono text-[15px] font-bold text-gray-900">
                          {request.orderAmount === null ? "-" : money(request.orderAmount)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 px-5 py-4">
                    <ApprovalTrail request={request} />

                    {request.type === "ADVANCE_ORDER" && (
                      <div className="rounded-xl border border-gray-200">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : request.id)}
                          className="flex w-full items-center justify-between px-4 py-2.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          <span>Order details ({request.items.length} {request.items.length === 1 ? "line" : "lines"})</span>
                          <span className="text-gray-400">{isOpen ? "Hide" : "View"}</span>
                        </button>
                        {isOpen && <ItemsTable items={request.items} />}
                      </div>
                    )}

                    <div className="flex flex-col gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:items-center">
                      <input
                        value={notes[request.id] || ""}
                        onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                        placeholder="Reference / note (optional)"
                        className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-indigo-300"
                      />
                      <button
                        type="button"
                        disabled={updating === request.id}
                        onClick={() => void fund(request)}
                        className="rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {updating === request.id ? "Adding funds..." : `Add ${money(request.amount)} to wallet`}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
