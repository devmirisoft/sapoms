"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "@/components/ui/toast";
import { buildCatalogOptions, fetchCatalogueProducts, fetchJson, type CatalogOption } from "@/lib/catalogOptions";
import { MAX_SALE_PERCENT, todayIST, type SaleItem, type TodaysSale } from "@/lib/todaysSale";

// Same flow as Hot Items: stage edits locally, then "Publish changes" saves them
// for every dealer. The homepage shows the list only on the chosen sale date.

type SaleApiResponse = { success?: boolean; message?: string; data?: TodaysSale & { live?: boolean } };

const PERCENT_PRESETS = [5, 10, 15, 20, 25];

const uid = () => Math.random().toString(36).slice(2, 9);

const emptyForm = (): Omit<SaleItem, "id"> => ({
  SKU: "", name: "", specs: "", image: "", discountPercent: 10, active: true,
});

async function callSaleApi(init?: RequestInit): Promise<TodaysSale> {
  const json = await fetchJson<SaleApiResponse>("/api/todays-sale", { cache: "no-store", ...init }, "Today's sale API");
  if (!json.success || !json.data) throw new Error(json.message ?? "Could not load today's sale");
  return { saleDate: json.data.saleDate, items: json.data.items ?? [] };
}

export default function AdminTodaysSalePage() {
  const router = useRouter();
  const today = todayIST();

  const [items, setItems] = useState<SaleItem[]>([]);
  const [saleDate, setSaleDate] = useState(today);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogOption[]>([]);
  const [skuDropdownOpen, setSkuDropdownOpen] = useState(false);
  const skuBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([callSaleApi(), fetchCatalogueProducts()]).then(([saleResult, catalogResult]) => {
      if (!active) return;
      if (saleResult.status === "fulfilled") {
        setItems(saleResult.value.items);
        // An old (expired) date is useless as a default; start from today.
        setSaleDate(saleResult.value.saleDate >= today ? saleResult.value.saleDate : today);
      } else {
        const message = saleResult.reason instanceof Error ? saleResult.reason.message : "Could not load today's sale";
        setLoadError(message);
        showToast("error", message);
      }
      if (catalogResult.status === "fulfilled") setCatalog(buildCatalogOptions(catalogResult.value));
      setLoading(false);
    });
    return () => { active = false; };
  }, [today]);

  useEffect(() => {
    if (!skuDropdownOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!skuBoxRef.current?.contains(event.target as Node)) setSkuDropdownOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setSkuDropdownOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [skuDropdownOpen]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const openAdd = () => { setEditId(null); setForm(emptyForm()); setShowForm(true); };
  const openEdit = (item: SaleItem) => {
    setEditId(item.id);
    setForm({ SKU: item.SKU, name: item.name, specs: item.specs, image: item.image, discountPercent: item.discountPercent, active: item.active });
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditId(null); setForm(emptyForm()); };

  const needle = form.SKU.trim().toLowerCase();
  const skuSuggestions = needle
    ? catalog
      .filter((option) => option.sku.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.sku.toLowerCase().startsWith(needle)) - Number(a.sku.toLowerCase().startsWith(needle)) || a.sku.localeCompare(b.sku))
      .slice(0, 50)
    : [];

  const applyCatalogOption = (option: CatalogOption) => {
    setForm((f) => ({ ...f, SKU: option.sku, name: option.displayName || option.name, specs: option.specs, image: option.image || f.image }));
    setSkuDropdownOpen(false);
  };

  const submitForm = () => {
    if (!form.SKU.trim() || !form.name.trim()) { showToast("error", "SKU and name are required."); return; }
    if (!Number.isInteger(form.discountPercent) || form.discountPercent < 1 || form.discountPercent > MAX_SALE_PERCENT) {
      showToast("error", `Discount must be a whole number from 1 to ${MAX_SALE_PERCENT}%.`);
      return;
    }
    const duplicate = items.some((i) => i.id !== editId && i.SKU.toLowerCase() === form.SKU.trim().toLowerCase());
    if (duplicate) { showToast("error", "That SKU is already in the sale."); return; }
    setItems(editId ? items.map((i) => (i.id === editId ? { ...i, ...form } : i)) : [...items, { id: uid(), ...form }]);
    showToast("success", editId ? "Item updated." : "Item added.");
    closeForm();
  };

  const toggleActive = (id: string) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, active: !i.active } : i)));

  const confirmDelete = () => {
    setItems((prev) => prev.filter((i) => i.id !== deleteId));
    setDeleteId(null);
    showToast("success", "Item removed.");
  };

  const persist = async () => {
    setSaving(true);
    try {
      const sale = await callSaleApi({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ saleDate, items }) });
      setItems(sale.items);
      setSaved(true);
      showToast("success", "Today's sale published to homepage.");
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Could not publish today's sale.");
    } finally {
      setSaving(false);
    }
  };

  const onDrop = (idx: number) => {
    if (dragIdx !== null && dragIdx !== idx) {
      const next = [...items];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      setItems(next);
    }
    setDragIdx(null);
    setOverIdx(null);
  };

  const activeItems = items.filter((i) => i.active);
  const status = saleDate === today
    ? { label: "Live today", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" }
    : saleDate > today
      ? { label: "Scheduled", cls: "bg-sky-50 text-sky-700 border-sky-200" }
      : { label: "Expired — pick a new date", cls: "bg-amber-50 text-amber-800 border-amber-200" };

  const inputCls = "w-full text-black px-3.5 py-2.5 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all";
  const labelCls = "text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes fadeIn  { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
        @keyframes slideIn { from { opacity:0; transform:translateY(16px) scale(.97) } to { opacity:1; transform:translateY(0) scale(1) } }
        .card-row { animation: fadeIn .2s ease both; }
        .modal-box { animation: slideIn .22s ease both; }
        .drag-over { outline: 2px dashed #6366f1; outline-offset: 2px; background: #eef2ff; }
        .drag-ghost { opacity: .35; }
      `}</style>

      {/* ── Delete Confirm Modal ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backdropFilter: "blur(8px)", background: "rgba(15,23,42,.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setDeleteId(null); }}>
          <div className="modal-box bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-[15px] font-bold text-gray-900 mb-1">Remove this item?</h3>
            <p className="text-[13px] text-gray-500 mb-5">It will be removed from the Today&apos;s Sale section on the homepage.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteId(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={confirmDelete}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-[13px] font-semibold transition-colors">
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit Modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backdropFilter: "blur(8px)", background: "rgba(15,23,42,.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) closeForm(); }}>
          <div className="modal-box bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-gray-900">{editId ? "Edit Sale Item" : "Add Sale Item"}</h3>
              <button onClick={closeForm} aria-label="Close" className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 flex flex-col gap-4">
              {/* SKU */}
              <div>
                <label className={labelCls}>SKU <span className="text-red-500">*</span></label>
                <div className="relative" ref={skuBoxRef}>
                  <input
                    value={form.SKU}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, SKU: e.target.value }));
                      setSkuDropdownOpen(Boolean(e.target.value.trim()));
                    }}
                    onFocus={() => setSkuDropdownOpen(Boolean(form.SKU.trim()))}
                    placeholder="e.g. PYC-25-A"
                    className={`${inputCls} font-mono`}
                    autoComplete="off"
                  />
                  {skuDropdownOpen && skuSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-2 z-30 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
                      <div className="max-h-72 overflow-auto py-1">
                        {skuSuggestions.map((option) => (
                          <button
                            key={option.sku}
                            type="button"
                            onMouseDown={(event) => { event.preventDefault(); applyCatalogOption(option); }}
                            className="w-full text-left px-3.5 py-2.5 hover:bg-indigo-50 outline-none transition-colors border-b border-gray-100 last:border-b-0"
                          >
                            <div className="text-[12px] font-semibold text-gray-900 font-mono leading-5">
                              {option.sku}{option.specs ? ` — ${option.specs}` : ""}
                            </div>
                            <div className="mt-0.5 text-[11px] text-gray-500 leading-4">{option.displayName || option.name}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {catalog.length === 0 && !loading && (
                  <p className="mt-2 text-[11px] text-amber-700">Catalogue lookup is unavailable right now, so SKU autofill is off.</p>
                )}
              </div>

              <div>
                <label className={labelCls}>Product name <span className="text-red-500">*</span></label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
              </div>

              <div>
                <label className={labelCls}>Specifications</label>
                <input value={form.specs} onChange={(e) => setForm((f) => ({ ...f, specs: e.target.value }))} placeholder="e.g. 25 mL" className={inputCls} />
              </div>

              <div>
                <label className={labelCls}>Image URL</label>
                <input value={form.image} onChange={(e) => setForm((f) => ({ ...f, image: e.target.value }))} placeholder="https://…" className={inputCls} />
                {form.image && (
                  <img src={form.image} alt="preview" className="mt-2 h-16 w-16 object-contain rounded-lg border border-gray-100 bg-gray-50" />
                )}
              </div>

              {/* Discount */}
              <div>
                <label className={labelCls}>Discount % <span className="text-red-500">*</span></label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {PERCENT_PRESETS.map((p) => (
                    <button key={p} type="button"
                      onClick={() => setForm((f) => ({ ...f, discountPercent: p }))}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                        form.discountPercent === p
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-700"
                      }`}>
                      {p}%
                    </button>
                  ))}
                </div>
                <input
                  type="number" min={1} max={MAX_SALE_PERCENT} step={1}
                  value={Number.isFinite(form.discountPercent) ? form.discountPercent : ""}
                  onChange={(e) => setForm((f) => ({ ...f, discountPercent: e.target.valueAsNumber }))}
                  className={inputCls}
                />
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between p-3.5 bg-gray-50 rounded-xl border border-gray-100">
                <div>
                  <p className="text-[13px] font-semibold text-gray-800">Show on homepage</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Toggle visibility without deleting</p>
                </div>
                <button type="button" role="switch" aria-checked={form.active} onClick={() => setForm((f) => ({ ...f, active: !f.active }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${form.active ? "bg-indigo-500" : "bg-gray-300"}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.active ? "translate-x-5" : ""}`} />
                </button>
              </div>
            </div>

            <div className="px-6 pb-6 flex gap-2">
              <button onClick={closeForm}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={submitForm}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[13px] font-semibold transition-colors">
                {editId ? "Save changes" : "Add item"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main layout ── */}
      <div className="min-h-screen bg-[#f8fafc]" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 lg:px-8 py-4 sticky top-[72px] z-20">
          <div className="admin-page-shell flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button onClick={() => router.back()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-[12.5px] font-medium text-gray-600 hover:bg-gray-100 transition-all">
                ← Back
              </button>
              <div>
                <h1 className="text-lg font-bold text-gray-900 leading-tight">🏷️ Today&apos;s Sale</h1>
                <p className="text-[12px] text-gray-500">{activeItems.length} of {items.length} active · drag rows to reorder</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[12px] font-semibold text-gray-600">
                Sale date
                <input type="date" value={saleDate} min={today} onChange={(e) => setSaleDate(e.target.value)}
                  className="px-2.5 py-1.5 text-[13px] text-black border border-gray-200 rounded-lg outline-none focus:border-indigo-400" />
              </label>
              <span className={`px-2.5 py-1 rounded-full border text-[11px] font-bold ${status.cls}`}>{status.label}</span>
              <button onClick={openAdd}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-[13px] font-semibold hover:bg-indigo-100 transition-colors">
                + Add item
              </button>
              <button onClick={persist} disabled={saving || loading || !saleDate || saleDate < today}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all ${
                  saved ? "bg-emerald-500 text-white" : "bg-gray-900 hover:bg-gray-700 text-white disabled:cursor-not-allowed disabled:opacity-50"
                }`}>
                {saving ? "Publishing..." : saved ? "Published!" : "Publish changes →"}
              </button>
            </div>
          </div>
        </div>

        <div className="admin-page-shell px-4 lg:px-8 py-8">
          {loadError && (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
              <div className="font-semibold">Today&apos;s sale failed to load</div>
              <div className="mt-1 opacity-90">{loadError}</div>
            </div>
          )}

          <div className="flex flex-col lg:flex-row gap-8">
            {/* ── Items list ── */}
            <div className="flex-1 min-w-0">
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="grid grid-cols-[28px_56px_1fr_80px_80px_90px] items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
                  {["", "", "Product", "Off", "Status", ""].map((h, i) => (
                    <span key={i} className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">{h}</span>
                  ))}
                </div>

                {loading && (
                  <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <div className="h-8 w-8 rounded-full border-2 border-gray-200 border-t-indigo-500 animate-spin" />
                    <p className="text-sm text-gray-500">Loading today&apos;s sale...</p>
                  </div>
                )}

                {!loading && !loadError && items.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <span className="text-4xl">🏷️</span>
                    <p className="text-sm text-gray-500">No sale items yet. Add your first one.</p>
                  </div>
                )}

                {!loading && items.map((item, idx) => (
                  <div
                    key={item.id}
                    draggable
                    onDragStart={() => setDragIdx(idx)}
                    onDragOver={(e) => { e.preventDefault(); setOverIdx(idx); }}
                    onDrop={() => onDrop(idx)}
                    onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                    className={`card-row grid grid-cols-[28px_56px_1fr_80px_80px_90px] items-center gap-3 px-4 py-3.5 border-b border-gray-100 last:border-0 transition-colors group
                      ${dragIdx === idx ? "drag-ghost" : ""}
                      ${overIdx === idx && dragIdx !== idx ? "drag-over" : "hover:bg-slate-50/60"}`}
                    style={{ animationDelay: `${idx * 0.03}s` }}
                  >
                    <span className="text-gray-300 group-hover:text-gray-400 cursor-grab active:cursor-grabbing select-none text-center">⠿</span>

                    <div className="w-12 h-12 rounded-lg bg-gray-50 border border-gray-100 overflow-hidden flex items-center justify-center">
                      {item.image ? <img src={item.image} alt={item.name} className="w-full h-full object-contain" /> : <span className="text-xl">📦</span>}
                    </div>

                    <div className="min-w-0">
                      <p className={`text-[13px] font-semibold leading-tight truncate ${item.active ? "text-gray-900" : "text-gray-400 line-through"}`}>
                        {item.name}
                        {item.specs && <span className="ml-2 text-[11px] font-normal text-gray-500">{item.specs}</span>}
                      </p>
                      <p className="text-[11px] text-gray-400 font-mono mt-0.5">{item.SKU}</p>
                    </div>

                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 w-fit">
                      -{item.discountPercent}%
                    </span>

                    <button role="switch" aria-checked={item.active} aria-label="Show on homepage" onClick={() => toggleActive(item.id)}
                      className={`relative w-11 h-6 rounded-full transition-colors ${item.active ? "bg-indigo-500" : "bg-gray-200"}`}>
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${item.active ? "translate-x-5" : ""}`} />
                    </button>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(item)} title="Edit"
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button onClick={() => setDeleteId(item.id)} title="Remove"
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6m5 0V4h4v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-[12px] text-amber-700 font-medium">
                Changes are staged until you click <strong>Publish changes</strong>. The homepage shows this sale only on the sale date
                (IST); the % off is shown as a badge and does not change order pricing.
              </div>
            </div>

            {/* ── Live preview ── */}
            <div className="w-full lg:w-[280px] flex-shrink-0">
              <div className="sticky top-[72px]">
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">Live preview</p>
                <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
                  <p className="text-[13px] font-bold text-gray-800 mb-3">Today&apos;s Sale</p>
                  {activeItems.length === 0 && <p className="text-[12px] text-gray-400 text-center py-6">No active items to preview.</p>}
                  <div className="grid grid-cols-2 gap-2">
                    {activeItems.slice(0, 6).map((item) => (
                      <div key={item.id} className="rounded-lg border border-gray-100 overflow-hidden bg-gray-50">
                        <div className="relative aspect-square flex items-center justify-center p-2">
                          {item.image ? <img src={item.image} alt={item.name} className="w-full h-full object-contain" /> : <span className="text-2xl">📦</span>}
                          <span className="absolute top-1 left-1 text-[8px] font-bold px-1 py-0.5 rounded-full bg-emerald-600 text-white leading-tight">
                            -{item.discountPercent}% OFF
                          </span>
                        </div>
                        <p className="px-1.5 pb-1.5 text-[10px] font-medium text-gray-700 line-clamp-2 leading-tight">{item.name}</p>
                      </div>
                    ))}
                  </div>
                  {activeItems.length > 6 && (
                    <p className="text-[11px] text-gray-400 text-center mt-2">+{activeItems.length - 6} more (homepage shows first 6)</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
