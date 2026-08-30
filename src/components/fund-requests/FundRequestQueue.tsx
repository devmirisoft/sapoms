"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Wallet } from "lucide-react";
import { SegmentedTabs } from "@/components/SegmentedTabs";

/**
 * The approval queue for dealer fund requests.
 *
 * RSM and Staff review the same records at different stages, so both routes
 * render this one component: the API decides what each actor may see and act
 * on, and the stage only changes the wording and which note column is shown.
 */

export type FundRequestItem = {
  productName: string;
  catNo: string;
  quantityPacks: number;
  packSize: number;
  totalPieces: number;
  unitPrice: number;
  discountPercent: number;
  finalAmount: number;
};

export type FundRequest = {
  id: string;
  dealerId: string;
  dealerName?: string | null;
  dealerCode?: string | null;
  type: "ADVANCE_ORDER" | "ADDITIONAL_FUNDS";
  status: "REQUESTED" | "RSM_APPROVED" | "STAFF_APPROVED" | "FUNDED" | "COMPLETED" | "REJECTED";
  dealerStatusLabel: string;
  amount: number;
  walletBalance: number;
  orderAmount: number | null;
  orderId: string | null;
  orderNumber: string | null;
  dealerNote: string | null;
  items: FundRequestItem[];
  rsmReviewedByName: string | null;
  rsmReviewedAt: string | null;
  rsmNote: string | null;
  staffReviewedByName: string | null;
  staffReviewedAt: string | null;
  staffNote: string | null;
  accountantName: string | null;
  accountantNote: string | null;
  fundedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  createdAt: string;
};

type TabKey = "mine" | "pending" | "approved" | "rejected";

const TABS: { key: TabKey; label: string; tone?: "neutral" | "rose" | "amber" | "emerald" }[] = [
  { key: "mine", label: "My Approvals" },
  { key: "pending", label: "Pending", tone: "amber" },
  { key: "approved", label: "Approved", tone: "emerald" },
  { key: "rejected", label: "Rejected", tone: "rose" },
];

export function money(value: number | null | undefined) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function statusBadge(status: FundRequest["status"]) {
  if (status === "COMPLETED" || status === "FUNDED") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "REJECTED") return "border-red-200 bg-red-50 text-red-700";
  if (status === "STAFF_APPROVED") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function stageLabel(status: FundRequest["status"], rejectedBy?: string | null) {
  switch (status) {
    case "REQUESTED": return "Awaiting RSM";
    case "RSM_APPROVED": return "Awaiting Staff";
    case "STAFF_APPROVED": return "With Accountant";
    case "FUNDED": return "Funds Added";
    case "COMPLETED": return "Completed";
    case "REJECTED": return rejectedBy ? `Rejected by ${rejectedBy}` : "Rejected";
    default: return status;
  }
}

export function fmtDate(value: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleString("en-IN");
}

/** The item table a reviewer opens to see exactly what the dealer ordered. */
export function ItemsTable({ items }: { items: FundRequestItem[] }) {
  if (!items.length) return <p className="px-5 py-3 text-[13px] text-gray-500">No order lines on this request.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-[12.5px]">
        <thead className="bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-500">
          <tr>
            <th className="px-4 py-2">Product</th>
            <th className="px-4 py-2">Cat No.</th>
            <th className="px-4 py-2 text-right">Packs</th>
            <th className="px-4 py-2 text-right">Pack size</th>
            <th className="px-4 py-2 text-right">Pieces</th>
            <th className="px-4 py-2 text-right">Unit price</th>
            <th className="px-4 py-2 text-right">Disc %</th>
            <th className="px-4 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item, index) => (
            <tr key={`${item.catNo}-${index}`}>
              <td className="px-4 py-2 font-medium text-gray-900">{item.productName}</td>
              <td className="px-4 py-2 font-mono text-gray-600">{item.catNo}</td>
              <td className="px-4 py-2 text-right font-mono">{item.quantityPacks}</td>
              <td className="px-4 py-2 text-right font-mono">{item.packSize}</td>
              <td className="px-4 py-2 text-right font-mono">{item.totalPieces}</td>
              <td className="px-4 py-2 text-right font-mono">{money(item.unitPrice)}</td>
              <td className="px-4 py-2 text-right font-mono">{item.discountPercent}%</td>
              <td className="px-4 py-2 text-right font-mono font-semibold text-gray-900">{money(item.finalAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The approval trail, shown wherever a request is displayed. */
export function ApprovalTrail({ request }: { request: FundRequest }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">RSM</p>
        {request.rsmReviewedByName ? (
          <>
            <p className="mt-0.5 text-[13px] font-semibold text-gray-900">
              {request.rejectedBy === "RSM" ? "Rejected by" : "Approved by"} {request.rsmReviewedByName}
            </p>
            <p className="text-[11px] text-gray-500">{fmtDate(request.rsmReviewedAt)}</p>
            {request.rsmNote && <p className="mt-1 text-[12px] text-gray-600">{request.rsmNote}</p>}
          </>
        ) : (
          <p className="mt-0.5 text-[13px] text-gray-500">Awaiting review</p>
        )}
      </div>
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Staff</p>
        {request.staffReviewedByName ? (
          <>
            <p className="mt-0.5 text-[13px] font-semibold text-gray-900">
              {request.rejectedBy === "STAFF" ? "Rejected by" : "Approved by"} {request.staffReviewedByName}
            </p>
            <p className="text-[11px] text-gray-500">{fmtDate(request.staffReviewedAt)}</p>
            {request.staffNote && <p className="mt-1 text-[12px] text-gray-600">{request.staffNote}</p>}
          </>
        ) : (
          <p className="mt-0.5 text-[13px] text-gray-500">Awaiting review</p>
        )}
      </div>
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Accountant</p>
        {request.accountantName ? (
          <>
            <p className="mt-0.5 text-[13px] font-semibold text-gray-900">Funded by {request.accountantName}</p>
            <p className="text-[11px] text-gray-500">{fmtDate(request.fundedAt)}</p>
            {request.accountantNote && <p className="mt-1 text-[12px] text-gray-600">{request.accountantNote}</p>}
          </>
        ) : (
          <p className="mt-0.5 text-[13px] text-gray-500">Not yet funded</p>
        )}
      </div>
    </div>
  );
}

export default function FundRequestQueue({ stage, backHref }: { stage: "rsm" | "staff"; backHref: string }) {
  const [requests, setRequests] = useState<FundRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("mine");
  const [updating, setUpdating] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/dealer-fund-requests?tab=${tab}`, { credentials: "include", cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.message || "Failed to load fund requests");
      setRequests(Array.isArray(json.data) ? json.data : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load fund requests");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, action: "approve" | "reject") => {
    const note = (notes[id] || "").trim();
    if (action === "reject" && !note) {
      setError("A rejection note is required so the dealer knows what to change.");
      return;
    }
    setUpdating(id);
    setError("");
    try {
      const res = await fetch(`/api/dealer-fund-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, note }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.message || "Failed to update request");
      setNotes((current) => ({ ...current, [id]: "" }));
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to update request");
    } finally {
      setUpdating(null);
    }
  };

  // The API already filtered to the tab; the counts here describe what is on
  // screen rather than issuing four more queries.
  const actionable = useMemo(
    () => requests.filter((r) => (stage === "rsm" ? r.status === "REQUESTED" : r.status === "RSM_APPROVED")),
    [requests, stage],
  );

  const heading = stage === "rsm" ? "Fund Requests" : "Fund Requests";
  const blurb = stage === "rsm"
    ? "Advance dealers requesting wallet funds. Your approval sends the request on to Staff."
    : "Requests already cleared by the RSM. Your approval sends them to the Accountant to release the funds.";

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-6" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>
      <div className="mx-auto max-w-[1840px] space-y-5">
        <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href={backHref} className="mb-3 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-100">
              <ArrowLeft size={14} />
              Back to dashboard
            </Link>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <Wallet size={18} />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">{heading}</h1>
                <p className="mt-1 text-sm text-gray-500">{blurb}</p>
              </div>
            </div>
          </div>
          <button onClick={() => void load()} className="w-fit rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-100">
            Refresh
          </button>
        </div>

        <SegmentedTabs
          label="Fund request status"
          value={tab}
          onChange={(next) => setTab(next as TabKey)}
          items={TABS.map((item) => ({
            value: item.key,
            label: item.label,
            tone: item.tone,
            // Each tab is its own fetch, so only the open one has a known count.
            count: tab === item.key && !loading ? requests.length : null,
          }))}
        />

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}

        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">Loading fund requests...</div>
        ) : requests.length === 0 ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">No fund requests in this view.</div>
        ) : (
          <div className="space-y-4">
            {requests.map((request) => {
              const canAct = actionable.some((r) => r.id === request.id);
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
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Requested</p>
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

                    {request.orderNumber && (
                      <p className="text-[13px] text-emerald-700">
                        Order placed: <span className="font-mono font-semibold">{request.orderNumber}</span>
                      </p>
                    )}

                    {canAct && (
                      <div className="flex flex-col gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:items-center">
                        <input
                          value={notes[request.id] || ""}
                          onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                          placeholder="Note (required to reject)"
                          className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-indigo-300"
                        />
                        <button
                          type="button"
                          disabled={updating === request.id}
                          onClick={() => void act(request.id, "approve")}
                          className="rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {updating === request.id ? "Working..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          disabled={updating === request.id}
                          onClick={() => void act(request.id, "reject")}
                          className="rounded-xl border border-red-200 bg-white px-4 py-2 text-[13px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Reject
                        </button>
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
