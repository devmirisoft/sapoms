"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, TrendingUp } from "lucide-react";
import { money } from "@/components/fund-requests/FundRequestQueue";

type Row = {
  dealerId: string; name: string; creditDays: number; billNo: string;
  billDate: string; billAmount: number; age: number; dueAmount: number;
};

/** Bill ageing: every unpaid bill with its age against the dealer's credit days. */
export default function AccountantReportsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dealerId, setDealerId] = useState("");

  useEffect(() => {
    fetch("/api/reports/bill-ageing", { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json?.success) throw new Error(json?.message || "Failed to load report");
        setRows(json.data);
      })
      .catch((err) => setError(err?.message || "Failed to load report"))
      .finally(() => setLoading(false));
  }, []);

  const dealers = useMemo(() => Array.from(new Map(rows.map((row) => [row.dealerId, row.name]))), [rows]);
  const shown = dealerId ? rows.filter((row) => row.dealerId === dealerId) : rows;
  const totalDue = shown.reduce((sum, row) => sum + row.dueAmount, 0);
  const downloadHref = `/api/reports/bill-ageing?${new URLSearchParams({ format: "csv", ...(dealerId ? { dealerId } : {}) })}`;

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
                <TrendingUp size={18} />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">Bill Ageing Report</h1>
                <p className="mt-1 text-sm text-gray-500">Unpaid bills by age. Due amount is the unpaid balance once a bill is past its credit days.</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-right shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Total due</p>
              <p className="mt-1 font-mono text-xl font-bold text-red-700">{money(totalDue)}</p>
            </div>
            <select
              value={dealerId}
              onChange={(e) => setDealerId(e.target.value)}
              aria-label="Dealer"
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px] font-semibold text-gray-700"
            >
              <option value="">All dealers</option>
              {dealers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <a href={downloadHref} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-500">
              <Download size={14} />
              Download CSV
            </a>
          </div>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}

        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">Loading report...</div>
        ) : shown.length === 0 ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">No unpaid bills.</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-left text-[13px]">
              <thead className="bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 text-right">Credit Days</th>
                  <th className="px-4 py-3">Bill No.</th>
                  <th className="px-4 py-3">Bill Date</th>
                  <th className="px-4 py-3 text-right">Bill Amount</th>
                  <th className="px-4 py-3 text-right">Age</th>
                  <th className="px-4 py-3 text-right">Due Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shown.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-900">{row.name}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-600">{row.creditDays}</td>
                    <td className="px-4 py-3 font-mono text-brand-600">{row.billNo}</td>
                    <td className="px-4 py-3 text-gray-600">{new Date(row.billDate).toLocaleDateString("en-IN", { timeZone: "UTC" })}</td>
                    <td className="px-4 py-3 text-right font-mono">{money(row.billAmount)}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-600">{row.age}</td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${row.dueAmount > 0 ? "text-red-700" : "text-gray-400"}`}>{money(row.dueAmount)}</td>
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
