"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Wallet } from "lucide-react";
import { ItemsTable, fmtDate, money, type FundRequest } from "@/components/fund-requests/FundRequestQueue";

/**
 * The dealer's own view of their fund requests.
 *
 * Shows where a request has reached and, on a rejection, which stage stopped
 * it and why - the reviewers' internal routing stays out of it.
 */
function dealerBadge(status: FundRequest["status"]) {
  if (status === "COMPLETED" || status === "FUNDED") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "REJECTED") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

/** The four checkpoints a dealer actually cares about. */
function Progress({ request }: { request: FundRequest }) {
  const order: FundRequest["status"][] = ["REQUESTED", "RSM_APPROVED", "STAFF_APPROVED", "COMPLETED"];
  const labels = ["Requested", "RSM approved", "Staff approved", request.type === "ADVANCE_ORDER" ? "Order placed" : "Funds added"];
  const rejected = request.status === "REJECTED";
  // FUNDED sits between STAFF_APPROVED and COMPLETED; treat it as the last
  // step being in progress rather than inventing a fifth pip.
  const reached = rejected ? -1 : order.indexOf(request.status === "FUNDED" ? "STAFF_APPROVED" : request.status);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {labels.map((label, index) => {
        const done = !rejected && index <= reached;
        return (
          <span
            key={label}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
              done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-gray-200 bg-gray-50 text-gray-400"
            }`}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

export default function DealerFundRequestsPage() {
  const [requests, setRequests] = useState<FundRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/dealer-fund-requests", { credentials: "include", cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.message || "Failed to load your fund requests");
      setRequests(Array.isArray(json.data) ? json.data : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load your fund requests");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-6" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>
      <div className="mx-auto max-w-[1200px] space-y-5">
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/dashboard/dealer" className="mb-3 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-100">
              <ArrowLeft size={14} />
              Back to dashboard
            </Link>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <Wallet size={18} />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">My Fund Requests</h1>
                <p className="mt-1 text-sm text-gray-500">Wallet funds you have requested, and where each request has reached.</p>
              </div>
            </div>
          </div>
          <button onClick={() => void load()} className="w-fit rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-100">
            Refresh
          </button>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}

        {loading ? (
          <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">Loading your fund requests...</div>
        ) : requests.length === 0 ? (
          <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">You have not raised any fund requests.</div>
        ) : (
          <div className="space-y-4">
            {requests.map((request) => {
              const isOpen = expanded === request.id;
              const rejectionNote = request.rejectedBy === "RSM" ? request.rsmNote : request.rejectedBy === "STAFF" ? request.staffNote : null;
              return (
                <div key={request.id} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <div className="flex flex-col gap-4 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${dealerBadge(request.status)}`}>
                          {request.dealerStatusLabel}
                        </span>
                        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700">
                          {request.type === "ADVANCE_ORDER" ? "Advance order" : "Additional funds"}
                        </span>
                      </div>
                      <p className="mt-2 text-[12px] text-gray-500">Raised {fmtDate(request.createdAt)}</p>
                    </div>
                    <div className="grid shrink-0 grid-cols-2 gap-4 text-right sm:grid-cols-3">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Requested</p>
                        <p className="mt-0.5 font-mono text-[15px] font-bold text-emerald-700">{money(request.amount)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Wallet then</p>
                        <p className="mt-0.5 font-mono text-[15px] font-bold text-gray-900">{money(request.walletBalance)}</p>
                      </div>
                      {request.orderAmount !== null && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Order</p>
                          <p className="mt-0.5 font-mono text-[15px] font-bold text-gray-900">{money(request.orderAmount)}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3 px-5 py-4">
                    <Progress request={request} />

                    {request.status === "REJECTED" && (
                      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                        <p className="text-[13px] font-semibold text-red-800">{request.dealerStatusLabel}</p>
                        {rejectionNote && <p className="mt-1 text-[13px] text-red-700">{rejectionNote}</p>}
                      </div>
                    )}

                    {request.orderNumber && (
                      <p className="text-[13px] text-emerald-700">
                        Order placed:{" "}
                        <Link href={`/orders/${request.orderId}`} className="font-mono font-semibold text-indigo-600 hover:underline">
                          {request.orderNumber}
                        </Link>
                      </p>
                    )}

                    {request.type === "ADVANCE_ORDER" && request.items.length > 0 && (
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
