"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen } from "lucide-react";
import { fmtDate, money, stageLabel, statusBadge, type FundRequest } from "@/components/fund-requests/FundRequestQueue";

/**
 * History of the wallet credits this workflow produced.
 *
 * A read-only view over the fund requests themselves - the money lives in the
 * existing wallet ledger, and each row links back to the order it paid for
 * rather than restating the amount in a second store.
 */
export default function AccountantFundRecordsPage() {
  const [rows, setRows] = useState<FundRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/dealer-fund-requests", { credentials: "include", cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.message || "Failed to load fund records");
      const all: FundRequest[] = Array.isArray(json.data) ? json.data : [];
      setRows(all.filter((row) => row.status === "FUNDED" || row.status === "COMPLETED"));
    } catch (err: any) {
      setError(err?.message || "Failed to load fund records");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.amount || 0), 0), [rows]);

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
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                <BookOpen size={18} />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">Fund Addition Records</h1>
                <p className="mt-1 text-sm text-gray-500">Wallet funds released through the dealer fund-request workflow.</p>
              </div>
            </div>
          </div>
          <div className="flex items-end gap-3">
            <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-right shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Total added</p>
              <p className="mt-1 font-mono text-xl font-bold text-emerald-700">{money(total)}</p>
            </div>
            <button onClick={() => void load()} className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-100">
              Refresh
            </button>
          </div>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}

        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">Loading fund records...</div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">No funds have been released yet.</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-left text-[13px]">
              <thead className="bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-3">Dealer</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Amount added</th>
                  <th className="px-4 py-3">Request</th>
                  <th className="px-4 py-3">Related order</th>
                  <th className="px-4 py-3">Accountant</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="font-semibold text-gray-900">{row.dealerName || "Dealer"}</span>
                      {row.dealerCode && <span className="ml-2 font-mono text-[12px] text-gray-500">{row.dealerCode}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{row.type === "ADVANCE_ORDER" ? "Advance order" : "Additional funds"}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-700">{money(row.amount)}</td>
                    <td className="px-4 py-3 font-mono text-gray-600">#{row.id}</td>
                    <td className="px-4 py-3">
                      {row.orderId ? (
                        <Link href={`/orders/${row.orderId}`} className="font-mono font-semibold text-indigo-600 hover:underline">
                          {row.orderNumber || row.orderId}
                        </Link>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{row.accountantName || "-"}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtDate(row.fundedAt)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusBadge(row.status)}`}>
                        {stageLabel(row.status, row.rejectedBy)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
