"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Gift, Search, RefreshCw, Plus, Minus, Loader2,
  Trophy, Star, Users, X, Check,
} from "lucide-react";
import { showToast } from "@/components/ui/toast";

const ADMIN_DEALERS_URL = "/api/admin/dealers";

type Dealer = {
  Dealer_Id: string;
  Dealer_Name: string;
  Dealer_Email: string;
  Dealer_Number: string;
  Dealer_Dealercode: string;
  reward_points?: number;
};


function AdjustModal({
  dealer,
  onClose,
  onSave,
}: {
  dealer: Dealer;
  onClose: () => void;
  onSave: (dealerId: string, delta: number, note: string) => Promise<void>;
}) {
  const [mode,   setMode]   = useState<"add" | "subtract">("add");
  const [amount, setAmount] = useState("");
  const [note,   setNote]   = useState("");
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(amount, 10);
    if (!n || n <= 0) { setErr("Enter a valid positive number"); return; }
    setBusy(true);
    try {
      await onSave(dealer.Dealer_Id, mode === "add" ? n : -n, note);
      onClose();
    } catch (e: any) {
      setErr(e.message || "Failed to update points");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(6px)" }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
              <Gift size={15} className="text-amber-600"/>
            </div>
            <div>
              <h2 className="text-[14.5px] font-bold text-gray-900">Adjust Points</h2>
              <p className="text-[11.5px] text-gray-400 mt-0.5 truncate max-w-[180px]">{dealer.Dealer_Name}</p>
            </div>
          </div>
          <button onClick={onClose} disabled={busy}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors disabled:opacity-40">
            <X size={15}/>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Current points */}
          <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
            <span className="text-[12px] text-gray-500">Current points</span>
            <span className="text-[16px] font-bold text-gray-900 font-mono">
              {(dealer.reward_points ?? 0).toLocaleString()}
            </span>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-2">
            {(["add", "subtract"] as const).map(m => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold border transition-all ${
                  mode === m
                    ? m === "add"
                      ? "bg-emerald-500 text-white border-emerald-500"
                      : "bg-red-500 text-white border-red-500"
                    : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
                }`}>
                {m === "add" ? <Plus size={13}/> : <Minus size={13}/>}
                {m === "add" ? "Add" : "Subtract"}
              </button>
            ))}
          </div>

          {/* Amount */}
          <div>
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5">Points</label>
            <input
              type="number" min="1" value={amount}
              onChange={e => { setAmount(e.target.value); setErr(""); }}
              placeholder="e.g. 100"
              className="w-full px-3.5 py-2.5 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          {/* Note */}
          <div>
            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5">Note (optional)</label>
            <input
              type="text" value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. Seasonal bonus"
              className="w-full px-3.5 py-2.5 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          {err && <p className="text-[11.5px] text-red-500">{err}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={busy}
              className="flex-1 py-2.5 border border-gray-200 rounded-xl text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={busy}
              className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[13px] font-semibold disabled:opacity-60 transition-colors flex items-center justify-center gap-2">
              {busy ? <Loader2 size={13} className="animate-spin"/> : <Check size={13}/>}
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function RewardsPage() {
  const [dealers,    setDealers]    = useState<Dealer[]>([]);
  const [filtered,   setFiltered]   = useState<Dealer[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,     setSearch]     = useState("");
  const [adjusting,  setAdjusting]  = useState<Dealer | null>(null);

  // Points are stored locally (per session) until a real rewards API is available
  const [pointsMap, setPointsMap] = useState<Record<string, number>>({});


  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const res  = await fetch(`${ADMIN_DEALERS_URL}?page=1&limit=100`, { credentials: "include" });
      const json = await res.json();
      const list: Dealer[] = (json.data || json || []).map((d: Dealer) => ({
        ...d,
        reward_points: 0,
      }));
      setDealers(list);
      setFiltered(list);
    } catch {
      showToast("error", "Failed to load dealers");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(
      dealers.filter(d =>
        d.Dealer_Name?.toLowerCase().includes(q) ||
        d.Dealer_Email?.toLowerCase().includes(q) ||
        d.Dealer_Dealercode?.toLowerCase().includes(q)
      )
    );
  }, [search, dealers]);

  const handleAdjust = async (dealerId: string, delta: number, note: string) => {
    setPointsMap(prev => ({
      ...prev,
      [dealerId]: Math.max(0, (prev[dealerId] ?? 0) + delta),
    }));
    const dealer = dealers.find(d => d.Dealer_Id === dealerId);
    showToast(
      "success",
      `${delta > 0 ? "+" : ""}${delta} pts ${delta > 0 ? "added to" : "removed from"} ${dealer?.Dealer_Name ?? "dealer"}`
        + (note ? ` · ${note}` : "")
    );
  };

  const dealersWithPoints = filtered.map(d => ({
    ...d,
    reward_points: pointsMap[d.Dealer_Id] ?? 0,
  }));

  const totalPoints   = Object.values(pointsMap).reduce((s, v) => s + v, 0);
  const topDealers    = [...dealersWithPoints].sort((a, b) => (b.reward_points ?? 0) - (a.reward_points ?? 0)).slice(0, 3);
  const activeRewards = Object.values(pointsMap).filter(v => v > 0).length;

  return (
    <div className="px-6 py-6 admin-page-shell" style={{ fontFamily: "'DM Sans', sans-serif" }}>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-gray-900 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500 flex items-center justify-center">
              <Gift size={15} className="text-white"/>
            </div>
            Dealer Rewards
          </h1>
          <p className="text-[13px] text-gray-400 mt-1">Manage loyalty points for dealer accounts</p>
        </div>
        <button
          onClick={() => load(true)} disabled={refreshing}
          className="w-9 h-9 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center text-gray-500 hover:text-gray-800 transition-all disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""}/>
        </button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: "Total Dealers",    value: dealers.length,  icon: <Users size={14}/>,  color: "text-indigo-600", bg: "bg-indigo-50" },
          { label: "Active Rewards",   value: activeRewards,   icon: <Star size={14}/>,   color: "text-amber-600",  bg: "bg-amber-50"  },
          { label: "Points Issued",    value: totalPoints.toLocaleString(), icon: <Trophy size={14}/>, color: "text-emerald-600", bg: "bg-emerald-50" },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${s.bg} ${s.color}`}>{s.icon}</div>
            <div>
              <div className="text-[10.5px] font-semibold text-gray-400 uppercase tracking-wider">{s.label}</div>
              <div className="text-[20px] font-bold text-gray-900 leading-none mt-0.5">{loading ? "…" : s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Top 3 leaderboard */}
      {topDealers.some(d => (d.reward_points ?? 0) > 0) && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-4 mb-5">
          <div className="text-[11px] font-bold text-amber-700 uppercase tracking-widest mb-3 flex items-center gap-1.5">
            <Trophy size={12}/> Top Earners
          </div>
          <div className="flex gap-3 flex-wrap">
            {topDealers.map((d, i) => (
              <div key={d.Dealer_Id} className="flex items-center gap-2.5 bg-white rounded-xl px-3 py-2 border border-amber-100 shadow-sm">
                <span className="text-[13px] font-bold text-amber-500">#{i + 1}</span>
                <div>
                  <div className="text-[12.5px] font-semibold text-gray-900">{d.Dealer_Name}</div>
                  <div className="text-[11px] text-amber-600 font-mono font-bold">{(d.reward_points ?? 0).toLocaleString()} pts</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email or dealer code…"
          className="w-full pl-9 pr-4 py-2.5 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white"
        />
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
            <Loader2 size={24} className="animate-spin text-amber-400"/>
            <span className="text-[13px]">Loading dealers…</span>
          </div>
        ) : dealersWithPoints.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center">
              <Users size={24} className="text-gray-300"/>
            </div>
            <p className="text-[13px] text-gray-400 font-medium">No dealers found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {["#", "Dealer", "Code", "Contact", "Points", "Tier", "Actions"].map(h => (
                    <th key={h} className="px-5 py-3.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {dealersWithPoints.map((d, idx) => {
                  const pts  = d.reward_points ?? 0;
                  const tier = pts >= 5000 ? { label: "Platinum", cls: "bg-purple-50 border-purple-200 text-purple-700" }
                             : pts >= 2000 ? { label: "Gold",     cls: "bg-amber-50 border-amber-200 text-amber-700"   }
                             : pts >= 500  ? { label: "Silver",   cls: "bg-gray-100 border-gray-300 text-gray-600"     }
                             :               { label: "Bronze",   cls: "bg-orange-50 border-orange-200 text-orange-600" };
                  return (
                    <tr key={d.Dealer_Id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-4 text-[12px] text-gray-400 font-mono">{String(idx + 1).padStart(2, "0")}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0">
                            {d.Dealer_Name?.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2) || "DL"}
                          </div>
                          <div>
                            <div className="text-[13px] font-semibold text-gray-900">{d.Dealer_Name}</div>
                            <div className="text-[11px] text-gray-400">{d.Dealer_Email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="font-mono text-[11.5px] text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                          {d.Dealer_Dealercode || "—"}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-[12.5px] text-gray-600">{d.Dealer_Number || "—"}</td>
                      <td className="px-5 py-4">
                        <span className="font-mono text-[14px] font-bold text-gray-900">{pts.toLocaleString()}</span>
                        <span className="text-[10.5px] text-gray-400 ml-1">pts</span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border ${tier.cls}`}>
                          <Star size={9} className="fill-current"/>
                          {tier.label}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <button
                          onClick={() => setAdjusting(d)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-semibold bg-white border border-gray-200 hover:border-amber-300 hover:bg-amber-50 text-gray-600 hover:text-amber-700 rounded-lg transition-all shadow-sm"
                        >
                          <Gift size={11}/> Adjust
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {adjusting && (
        <AdjustModal
          dealer={{ ...adjusting, reward_points: pointsMap[adjusting.Dealer_Id] ?? 0 }}
          onClose={() => setAdjusting(null)}
          onSave={handleAdjust}
        />
      )}

    </div>
  );
}
