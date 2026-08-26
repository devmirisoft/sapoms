"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import moment from "moment";
import { Loader2, RefreshCw, Search, Wallet, X } from "lucide-react";
import { isAuthenticated } from "@/lib/accountantauth";

// ─── Types ────────────────────────────────────────────────────────────────────
type SettlementApplication = {
  id: string;
  billId: string;
  orderNumber: string;
  amount: number;
  note: string;
  appliedAt: string | null;
  appliedByName: string;
};

type Settlement = {
  id: string;
  dealerId: string;
  dealerName: string;
  dealerCode: string;
  status: string;
  originalAmount: number;
  remainingAmount: number;
  appliedAmount: number;
  note: string;
  openedAt: string | null;
  closedAt: string | null;
  applications: SettlementApplication[];
};

type SettlementBill = {
  id: string;
  orderId: string;
  orderNumber: string;
  billDate: string | null;
  billAmount: number;
  paidAmount: number;
  dueAmount: number;
};

type StatusFilter = "OPEN" | "SETTLED" | "VOID" | "ALL";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const money = (value: number) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const day = (value: string | null) => (value ? moment(value).format("DD MMM YYYY") : "—");

function statusChip(status: string) {
  const tone =
    status === "open" ? "bg-amber-50 text-amber-700 border-amber-200"
    : status === "settled" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-gray-100 text-gray-500 border-gray-200";
  return `inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${tone}`;
}

/* Each apply needs its own idempotency key so a double-click cannot settle the
   same money twice, while a genuine second payment still goes through. */
function newIdempotencyKey() {
  return `settle-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function SettlePage() {
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [summary, setSummary] = useState({ openCount: 0, openAmount: 0 });
  const [status, setStatus] = useState<StatusFilter>("OPEN");
  const [search, setSearch] = useState("");

  const [active, setActive] = useState<Settlement | null>(null);
  const [bills, setBills] = useState<SettlementBill[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [billId, setBillId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    void (async () => {
      if (!(await isAuthenticated())) {
        router.replace("/auth/accountant-login");
        return;
      }
      setReady(true);
    })();
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (status !== "ALL") params.set("status", status);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/settlements?${params.toString()}`, { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Unable to load settlements.");
      setSettlements(data.settlements ?? []);
      setSummary(data.summary ?? { openCount: 0, openAmount: 0 });
    } catch (err: any) {
      setError(err?.message || "Unable to load settlements.");
      setSettlements([]);
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const openDetail = useCallback(async (settlement: Settlement) => {
    setActive(settlement);
    setBills([]);
    setBillId("");
    setAmount("");
    setNote("");
    setFormError("");
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/settlements/${settlement.id}`, { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Unable to load settlement.");
      setActive(data.settlement);
      setBills(data.bills ?? []);
    } catch (err: any) {
      setFormError(err?.message || "Unable to load settlement.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const selectedBill = useMemo(() => bills.find((bill) => bill.id === billId) ?? null, [bills, billId]);

  /* The accountant can never apply more than the settlement has left, nor more
     than the chosen invoice still owes. */
  const maxApplicable = useMemo(() => {
    if (!active) return 0;
    if (!selectedBill) return active.remainingAmount;
    return Math.min(active.remainingAmount, selectedBill.dueAmount);
  }, [active, selectedBill]);

  const submit = useCallback(async () => {
    if (!active) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setFormError("Enter a valid amount.");
      return;
    }
    if (!billId) {
      setFormError("Select the order or invoice to settle against.");
      return;
    }
    if (value > maxApplicable) {
      setFormError(`You can apply at most ${money(maxApplicable)} here.`);
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const res = await fetch(`/api/settlements/${active.id}/apply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "idempotency-key": newIdempotencyKey() },
        body: JSON.stringify({ billId, amount: value, note: note.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Unable to apply settlement.");
      setActive(data.settlement);
      setAmount("");
      setNote("");
      setBillId("");
      await load();
      if (data.settlement?.status === "settled") setActive(null);
      else await openDetail(data.settlement);
    } catch (err: any) {
      setFormError(err?.message || "Unable to apply settlement.");
    } finally {
      setSaving(false);
    }
  }, [active, amount, billId, note, maxApplicable, load, openDetail]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Wallet className="w-5 h-5 text-indigo-600" />
            Wallet Settlements
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Balances left over when a dealer moved from advance to credit. Apply them against that dealer&apos;s invoices.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-amber-700">Open settlements</div>
          <div className="text-xl font-semibold text-amber-900 mt-0.5">{summary.openCount}</div>
        </div>
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-indigo-700">Unsettled amount</div>
          <div className="text-xl font-semibold text-indigo-900 mt-0.5">{money(summary.openAmount)}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search dealer name or code"
            className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="OPEN">Open</option>
          <option value="SETTLED">Settled</option>
          <option value="VOID">Void</option>
          <option value="ALL">All</option>
        </select>
      </div>

      {error && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Dealer</th>
                <th className="px-4 py-2.5 text-left font-medium">Dealer ID</th>
                <th className="px-4 py-2.5 text-right font-medium">Prev. wallet</th>
                <th className="px-4 py-2.5 text-right font-medium">Settled</th>
                <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 text-left font-medium">Opened</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin inline" />
                  </td>
                </tr>
              ) : settlements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">
                    No settlements to show.
                  </td>
                </tr>
              ) : (
                settlements.map((settlement) => (
                  <tr key={settlement.id} className="hover:bg-gray-50/70">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{settlement.dealerName || "—"}</div>
                      {settlement.dealerCode && (
                        <div className="text-[11px] text-gray-400">{settlement.dealerCode}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{settlement.dealerId}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{money(settlement.originalAmount)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{money(settlement.appliedAmount)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{money(settlement.remainingAmount)}</td>
                    <td className="px-4 py-3">
                      <span className={statusChip(settlement.status)}>{settlement.status}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{day(settlement.openedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void openDetail(settlement)}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                      >
                        {settlement.status === "open" ? "Settle" : "View"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Settle drawer */}
      {active && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
          <div className="w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-5 py-3.5">
              <div>
                <div className="font-semibold text-gray-900">{active.dealerName || "Dealer"}</div>
                <div className="text-[11px] text-gray-400">
                  Dealer ID {active.dealerId}
                  {active.dealerCode ? ` · ${active.dealerCode}` : ""}
                </div>
              </div>
              <button type="button" onClick={() => setActive(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Balances */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400">Prev. wallet</div>
                  <div className="text-sm font-semibold text-gray-900 mt-0.5">{money(active.originalAmount)}</div>
                </div>
                <div className="rounded-lg border border-gray-200 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-gray-400">Settled</div>
                  <div className="text-sm font-semibold text-gray-900 mt-0.5">{money(active.appliedAmount)}</div>
                </div>
                <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-indigo-600">Settle balance</div>
                  <div className="text-sm font-semibold text-indigo-900 mt-0.5">{money(active.remainingAmount)}</div>
                </div>
              </div>

              {detailLoading ? (
                <div className="py-8 text-center text-gray-400">
                  <Loader2 className="w-5 h-5 animate-spin inline" />
                </div>
              ) : (
                <>
                  {active.status === "open" && (
                    <div className="rounded-xl border border-gray-200 p-4 space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Apply to an invoice</div>

                      {bills.length === 0 ? (
                        <p className="text-sm text-gray-400">
                          This dealer has no outstanding invoices to settle against right now.
                        </p>
                      ) : (
                        <>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                              Order / Invoice
                            </label>
                            <select
                              value={billId}
                              onChange={(e) => {
                                setBillId(e.target.value);
                                setFormError("");
                              }}
                              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                              <option value="">Select an invoice…</option>
                              {bills.map((bill) => (
                                <option key={bill.id} value={bill.id}>
                                  {bill.orderNumber} · {day(bill.billDate)} · due {money(bill.dueAmount)}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                                Amount
                              </label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={amount}
                                  onChange={(e) => {
                                    setAmount(e.target.value);
                                    setFormError("");
                                  }}
                                  placeholder="0.00"
                                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                                <button
                                  type="button"
                                  onClick={() => setAmount(String(maxApplicable))}
                                  disabled={maxApplicable <= 0}
                                  className="whitespace-nowrap rounded-lg border border-gray-200 px-2.5 py-2 text-[11px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                                >
                                  Max
                                </button>
                              </div>
                              <span className="text-[11px] text-gray-400">Up to {money(maxApplicable)}</span>
                            </div>

                            <div className="flex flex-col gap-1.5">
                              <label className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                                Note <span className="text-gray-300">(optional)</span>
                              </label>
                              <input
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="Reference or remark"
                                className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>
                          </div>

                          {formError && (
                            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                              {formError}
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => void submit()}
                            disabled={saving || !billId || !amount}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                          >
                            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            {saving ? "Applying…" : "Apply settlement"}
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* History */}
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                      Settlement history
                    </div>
                    {active.applications.length === 0 ? (
                      <p className="text-sm text-gray-400">Nothing settled yet.</p>
                    ) : (
                      <div className="rounded-xl border border-gray-200 overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium">Invoice</th>
                              <th className="px-3 py-2 text-right font-medium">Amount</th>
                              <th className="px-3 py-2 text-left font-medium">By</th>
                              <th className="px-3 py-2 text-left font-medium">On</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {active.applications.map((application) => (
                              <tr key={application.id}>
                                <td className="px-3 py-2 text-gray-900">{application.orderNumber || "—"}</td>
                                <td className="px-3 py-2 text-right text-gray-700">{money(application.amount)}</td>
                                <td className="px-3 py-2 text-gray-500">{application.appliedByName || "—"}</td>
                                <td className="px-3 py-2 text-gray-500">{day(application.appliedAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
