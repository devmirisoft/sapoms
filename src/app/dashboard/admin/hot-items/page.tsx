"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { showToast } from "@/components/ui/toast";

// ─── Types ────────────────────────────────────────────────────────────────────

export type HotItem = {
  id: string;
  SKU: string;
  name: string;
  specs: string;
  image: string;
  badge: string;
  active: boolean;
};

type CatalogOption = {
  sku: string;
  name: string;
  displayName: string;
  specs: string;
  image: string;
};

type HotItemsApiData = {
  items?: unknown;
  isDefault?: boolean;
};

type HotItemsApiResponse = {
  success?: boolean;
  message?: string;
  data?: HotItemsApiData;
};

type CatalogueImageSource = {
  images?: unknown;
  Images?: unknown;
};

type CatalogueSpecsSource = {
  specsText?: unknown;
  SpecsText?: unknown;
  specs?: unknown;
  Specs?: unknown;
  specifications?: unknown;
  Specifications?: unknown;
  specification?: unknown;
};

type CatalogueVariantRecord = CatalogueImageSource & {
  sku?: unknown;
  SKU?: unknown;
  name?: unknown;
  Name?: unknown;
} & CatalogueSpecsSource;

type CatalogueProductRecord = CatalogueImageSource & {
  sku?: unknown;
  SKU?: unknown;
  name?: unknown;
  Name?: unknown;
  variants?: unknown;
} & CatalogueSpecsSource;

// ─── API + catalog helpers ───────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV !== "production";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";

  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      return item.trim();
    }
  }

  return "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatSpecObject(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([key, specValue]) => {
      const cleanKey = String(key).trim();
      const cleanValue = String(specValue ?? "").trim();
      if (!cleanKey || !cleanValue) return "";
      return `${cleanKey}: ${cleanValue}`;
    })
    .filter(Boolean)
    .join(" · ");
}

function getSpecs(value: CatalogueSpecsSource): string {
  const candidates = [
    value.specsText,
    value.SpecsText,
    value.specs,
    value.Specs,
    value.specifications,
    value.Specifications,
    value.specification,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" || Array.isArray(candidate)) {
      const text = firstString(candidate);
      if (text) return text;
    }

    if (isPlainObject(candidate)) {
      const formatted = formatSpecObject(candidate);
      if (formatted) return formatted;
    }
  }

  return "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanCatalogueName(name: string, sku: string): string {
  const cleanName = String(name ?? "").trim();
  const cleanSku = String(sku ?? "").trim();

  if (!cleanName || !cleanSku) return cleanName;

  const escapedSku = escapeRegExp(cleanSku);
  const patterns = [
    new RegExp(`\\s*[-–—]\\s*${escapedSku}\\s*$`, "i"),
    new RegExp(`\\s*\\(?\\s*${escapedSku}\\s*\\)?\\s*$`, "i"),
  ];

  for (const pattern of patterns) {
    const next = cleanName.replace(pattern, "").trim();
    if (next && next !== cleanSku) return next;
  }

  return cleanName;
}

async function fetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  endpointLabel = "request"
): Promise<T> {
  const response = await fetch(input, init);
  const responseText = await response.text();
  const preview = responseText.replace(/\s+/g, " ").trim().slice(0, 250);
  const previewSuffix = IS_DEV && preview ? `: ${preview}` : "";

  if (!response.ok) {
    throw new Error(
      `${endpointLabel} failed with HTTP ${response.status}${previewSuffix}`
    );
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw new Error(
      `${endpointLabel} returned invalid JSON${previewSuffix}`
    );
  }
}

function normalizeHotItems(items: unknown): HotItem[] {
  if (!Array.isArray(items)) return [];

  return items
    .map((item, index) => {
      if (!isRecord(item)) return null;

      const sku = String(item.SKU ?? item.sku ?? "").trim();
      const name = String(item.name ?? item.Name ?? "").trim();

      if (!sku || !name) return null;

      return {
        id: String(item.id ?? `${sku}-${index}`),
        SKU: sku,
        name,
        specs: String(item.specs ?? ""),
        image: String(item.image ?? ""),
        badge: String(item.badge ?? "Hot pick"),
        active: item.active !== false,
      } satisfies HotItem;
    })
    .filter((item): item is HotItem => item !== null);
}

async function getHotItems(): Promise<{ items: HotItem[]; isDefault: boolean }> {
  const json = await fetchJson<HotItemsApiResponse>(
    "/api/hot-items",
    { cache: "no-store" },
    "Hot items API"
  );

  if (!json.success) {
    throw new Error(json.message ?? "Could not load hot items");
  }

  return {
    items: normalizeHotItems(json.data?.items),
    isDefault: Boolean(json.data?.isDefault),
  };
}

async function saveHotItems(items: HotItem[]): Promise<HotItem[]> {
  const json = await fetchJson<HotItemsApiResponse>("/api/hot-items", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  }, "Hot items API");

  if (!json.success) throw new Error(json.message ?? "Could not publish hot items");
  return normalizeHotItems(json.data?.items ?? items);
}

function getFirstImage(item: CatalogueImageSource): string {
  return firstString(item.images) || firstString(item.Images);
}

function buildCatalogOptions(products: CatalogueProductRecord[]): CatalogOption[] {
  const seen = new Set<string>();
  const options: CatalogOption[] = [];

  for (const product of products) {
    const productSku = String(product.sku ?? product.SKU ?? "").trim();
    const productName = String(product.name ?? product.Name ?? "").trim();
    const productSpecs = getSpecs(product);
    const productImage = getFirstImage(product);
    const productDisplayName = cleanCatalogueName(productName, productSku);

    if (productSku && productName && !seen.has(productSku.toLowerCase())) {
      seen.add(productSku.toLowerCase());
      options.push({
        sku: productSku,
        name: productName,
        displayName: productDisplayName,
        specs: productSpecs,
        image: productImage,
      });
    }

    const variants = Array.isArray(product.variants)
      ? product.variants.filter(isRecord)
      : [];

    for (const variant of variants) {
      const typedVariant = variant as CatalogueVariantRecord;
      const variantSku = String(typedVariant.sku ?? typedVariant.SKU ?? "").trim();
      const variantName = String(typedVariant.name ?? typedVariant.Name ?? productName).trim();
      const variantSpecs = getSpecs(typedVariant) || productSpecs;
      const variantImage = getFirstImage(typedVariant) || productImage;
      const variantDisplayName = cleanCatalogueName(variantName || productName, variantSku);
      if (!variantSku || seen.has(variantSku.toLowerCase())) continue;
      seen.add(variantSku.toLowerCase());
      options.push({
        sku: variantSku,
        name: variantName || productName,
        displayName: variantDisplayName,
        specs: variantSpecs,
        image: variantImage,
      });
    }
  }

  return options;
}

async function fetchCatalogueProducts(): Promise<CatalogueProductRecord[]> {
  const json = await fetchJson<unknown>(
    "/data/omsons_products_from_excel_with_images.json",
    { cache: "no-store" },
    "Catalogue JSON"
  );

  return Array.isArray(json) ? (json.filter(isRecord) as CatalogueProductRecord[]) : [];
}

// ─── Badge presets ────────────────────────────────────────────────────────────

const BADGE_PRESETS = [
  "🔥 Bestseller", "🔥 Trending", "🔥 Top rated",
  "⚡ Fast moving", "⚡ Popular", "⚡ Hot pick",
  "⭐ Staff pick", "🆕 New arrival", "💰 Best value",
];

// ─── Unique ID ────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

// ─── Empty form ───────────────────────────────────────────────────────────────

const emptyForm = (): Omit<HotItem, "id"> => ({
  SKU: "", name: "", specs: "", image: "", badge: BADGE_PRESETS[0], active: true,
});

// ─── Toast ────────────────────────────────────────────────────────────────────

function useToast() {
  const show = useCallback((msg: string, type: "success" | "error" = "success") => {
    showToast(type, msg);
  }, []);
  return { show };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminHotItemsPage() {
  const router = useRouter();
  const { show } = useToast();

  const [items, setItems] = useState<HotItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [catalog, setCatalog] = useState<CatalogOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [catalogueWarning, setCatalogueWarning] = useState<string | null>(null);
  const [skuDropdownOpen, setSkuDropdownOpen] = useState(false);
  const skuInputRef = useRef<HTMLInputElement | null>(null);
  const skuDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void (async () => {
      try {
        const [hotResult, catalogResult] = await Promise.allSettled([
          getHotItems(),
          fetchCatalogueProducts(),
        ]);

        if (!active || controller.signal.aborted) return;

        if (hotResult.status === "fulfilled") {
          setItems(hotResult.value.items);
        } else {
          setItems([]);
          setLoadError(
            hotResult.reason instanceof Error
              ? hotResult.reason.message
              : "Could not load hot items"
          );
          show(
            hotResult.reason instanceof Error
              ? hotResult.reason.message
              : "Could not load hot items",
            "error"
          );
        }

        if (catalogResult.status === "fulfilled") {
          setCatalog(buildCatalogOptions(catalogResult.value));
          setCatalogueWarning(null);
        } else {
          setCatalog([]);
          setCatalogueWarning(
            catalogResult.reason instanceof Error
              ? catalogResult.reason.message
              : "Catalogue unavailable"
          );
        }
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Could not load hot items";
        setLoadError(message);
        show(message, "error");
      } finally {
        if (active && !controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [show]);

  useEffect(() => {
    if (!skuDropdownOpen) return undefined;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && skuInputRef.current?.contains(target)) return;
      if (target && skuDropdownRef.current?.contains(target)) return;
      setSkuDropdownOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSkuDropdownOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [skuDropdownOpen]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const openAdd = () => {
    setEditId(null);
    setForm(emptyForm());
    setShowForm(true);
  };

  const openEdit = (item: HotItem) => {
    setEditId(item.id);
    setForm({ SKU: item.SKU, name: item.name, specs: item.specs, image: item.image, badge: item.badge, active: item.active });
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditId(null); setForm(emptyForm()); };

  const findCatalogOption = (sku: string) => {
    const needle = sku.trim().toLowerCase();
    if (!needle) return null;
    return catalog.find((option) => option.sku.toLowerCase() === needle) ?? null;
  };

  const findCatalogMatches = (sku: string) => {
    const needle = sku.trim().toLowerCase();
    if (!needle) return [];

    return catalog
      .filter((option) => option.sku.toLowerCase().includes(needle))
      .sort((a, b) => {
        const aStarts = a.sku.toLowerCase().startsWith(needle);
        const bStarts = b.sku.toLowerCase().startsWith(needle);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.sku.localeCompare(b.sku);
      })
      .slice(0, 50);
  };

  const applyCatalogOption = (option: CatalogOption) => {
    setForm((f) => ({
      ...f,
      SKU: option.sku,
      name: option.displayName || option.name,
      specs: option.specs,
      image: option.image || f.image,
    }));
    setSkuDropdownOpen(false);
  };

  const syncCatalogMatch = (sku: string) => {
    const match = findCatalogOption(sku);
    if (match) applyCatalogOption(match);
  };

  const submitForm = () => {
    if (!form.SKU.trim() || !form.name.trim()) { show("SKU and name are required.", "error"); return; }

    let next: HotItem[];
    if (editId) {
      next = items.map(i => i.id === editId ? { ...i, ...form } : i);
      show("Item updated.");
    } else {
      next = [...items, { id: uid(), ...form }];
      show("Item added.");
    }
    setItems(next);
    closeForm();
  };

  const toggleActive = (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, active: !i.active } : i));
  };

  const confirmDelete = () => {
    if (!deleteId) return;
    setItems(prev => prev.filter(i => i.id !== deleteId));
    setDeleteId(null);
    show("Item removed.");
  };

  const persist = async () => {
    setSaving(true);
    try {
      const savedItems = await saveHotItems(items);
      setItems(savedItems);
      setSaved(true);
      show("Changes published to homepage.");
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not publish hot items.", "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Drag-to-reorder ────────────────────────────────────────────────────────

  const onDragStart = (idx: number) => setDragIdx(idx);
  const onDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setOverIdx(idx); };
  const onDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return; }
    const next = [...items];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    setItems(next);
    setDragIdx(null);
    setOverIdx(null);
  };

  const activeCount = items.filter(i => i.active).length;
  const catalogueAvailable = catalog.length > 0 && !catalogueWarning;
  const skuSuggestions = catalogueAvailable ? findCatalogMatches(form.SKU) : [];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes fadeIn  { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
        @keyframes slideIn { from { opacity:0; transform:translateY(16px) scale(.97) } to { opacity:1; transform:translateY(0) scale(1) } }
        @keyframes toastIn { from { opacity:0; transform:translateX(20px) } to { opacity:1; transform:translateX(0) } }
        .card-row { animation: fadeIn .2s ease both; }
        .modal-box { animation: slideIn .22s ease both; }
        .toast-pop { animation: toastIn .22s ease both; }
        .drag-over { outline: 2px dashed #6366f1; outline-offset: 2px; background: #eef2ff; }
        .drag-ghost { opacity: .35; }
      `}</style>

      {/* ── Toast ── */}

      {/* ── Delete Confirm Modal ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backdropFilter: "blur(8px)", background: "rgba(15,23,42,.45)" }}
          onClick={e => { if (e.target === e.currentTarget) setDeleteId(null); }}>
          <div className="modal-box bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="w-10 h-10 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mb-4">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6m5 0V4h4v2" />
              </svg>
            </div>
            <h3 className="text-[15px] font-bold text-gray-900 mb-1">Remove this item?</h3>
            <p className="text-[13px] text-gray-500 mb-5">It will be removed from the Hot Right Now section on the homepage.</p>
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
          onClick={e => { if (e.target === e.currentTarget) closeForm(); }}>
          <div className="modal-box bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-gray-900">
                {editId ? "Edit Hot Item" : "Add Hot Item"}
              </h3>
              <button onClick={closeForm} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 flex flex-col gap-4">
              {/* SKU */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5">
                  SKU <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    ref={skuInputRef}
                    value={form.SKU}
                    onChange={e => {
                      const nextSku = e.target.value;
                      setForm(f => ({ ...f, SKU: nextSku }));
                      setSkuDropdownOpen(Boolean(nextSku.trim()) && catalogueAvailable);
                    }}
                    onFocus={() => {
                      if (form.SKU.trim() && catalogueAvailable) {
                        setSkuDropdownOpen(true);
                      }
                    }}
                    onBlur={e => syncCatalogMatch(e.target.value)}
                    placeholder="e.g. PYC-25-A"
                    className="w-full text-black px-3.5 py-2.5 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all font-mono"
                    autoComplete="off"
                    aria-autocomplete="list"
                    aria-controls="hot-item-catalog-suggestions"
                  />
                  {catalogueAvailable && skuDropdownOpen && skuSuggestions.length > 0 && (
                    <div
                      id="hot-item-catalog-suggestions"
                      ref={skuDropdownRef}
                      className="absolute left-0 right-0 top-full mt-2 z-30 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
                    >
                      <div className="max-h-72 overflow-auto py-1">
                        {skuSuggestions.map((option) => (
                          <button
                            key={option.sku}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              applyCatalogOption(option);
                              skuInputRef.current?.focus();
                            }}
                            className="w-full text-left px-3.5 py-2.5 hover:bg-indigo-50 focus:bg-indigo-50 outline-none transition-colors border-b border-gray-100 last:border-b-0"
                          >
                            <div className="text-[12px] font-semibold text-gray-900 font-mono leading-5">
                              {option.sku}
                              {option.specs ? ` — ${option.specs}` : ""}
                            </div>
                            <div className="mt-0.5 text-[11px] text-gray-500 leading-4">
                              {option.displayName || option.name}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {catalogueAvailable && findCatalogOption(form.SKU) && (
                <button
                    type="button"
                    onClick={() => {
                      const match = findCatalogOption(form.SKU);
                      if (match) applyCatalogOption(match);
                    }}
                    className="mt-2 text-[11px] font-bold text-indigo-600 hover:text-indigo-800"
                  >
                    Use catalog name, specs and image
                  </button>
                )}
                {!catalogueAvailable && (
                  <p className="mt-2 text-[11px] text-amber-700">
                    Catalogue lookup is unavailable right now, so SKU autofill is limited.
                  </p>
                )}
              </div>

              {/* Name */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5">
                  Product name <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Pycnometer Class A 25ml"
                  className="w-full text-black px-3.5 py-2.5 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
                />
              </div>

              {/* Specifications */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5">
                  Specifications
                </label>
                <input
                  value={form.specs}
                  onChange={e => setForm(f => ({ ...f, specs: e.target.value }))}
                  placeholder="e.g. 25 mL"
                  className="w-full text-black px-3.5 py-2.5 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
                />
              </div>

              {/* Image URL */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5">Image URL</label>
                <input
                  value={form.image}
                  onChange={e => setForm(f => ({ ...f, image: e.target.value }))}
                  placeholder="https://…"
                  className="w-full text-black px-3.5 py-2.5 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
                />
                {form.image && (
                  <img src={form.image} alt="preview"
                    className="mt-2 text-black h-16 w-16 object-contain rounded-lg border border-gray-100 bg-gray-50" />
                )}
              </div>

              {/* Badge */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5">Badge</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {BADGE_PRESETS.map(b => (
                    <button key={b} type="button"
                      onClick={() => setForm(f => ({ ...f, badge: b }))}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                        form.badge === b
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-700"
                      }`}>
                      {b}
                    </button>
                  ))}
                </div>
                <input
                  value={form.badge}
                  onChange={e => setForm(f => ({ ...f, badge: e.target.value }))}
                  placeholder="Or type a custom badge…"
                  className="w-full text-black px-3.5 py-2.5 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
                />
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between p-3.5 bg-gray-50 rounded-xl border border-gray-100">
                <div>
                  <p className="text-[13px] font-semibold text-gray-800">Show on homepage</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Toggle visibility without deleting</p>
                </div>
                <button type="button" onClick={() => setForm(f => ({ ...f, active: !f.active }))}
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
        <div className="bg-white border-b border-gray-200 px-6 lg:px-8 py-4 sticky top-0 z-20">
          <div className="admin-page-shell flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button onClick={() => router.back()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-[12.5px] font-medium text-gray-600 hover:bg-gray-100 hover:-translate-x-px transition-all">
                ← Back
              </button>
              <div>
                <h1 className="text-lg font-bold text-gray-900 leading-tight">🔥 Hot Items</h1>
                <p className="text-[12px] text-gray-500">
                  {activeCount} of {items.length} active · drag rows to reorder
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={openAdd}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-[13px] font-semibold hover:bg-indigo-100 transition-colors">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add item
              </button>
              <button onClick={persist} disabled={saving || loading}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all ${
                  saved
                    ? "bg-emerald-500 text-white"
                    : "bg-gray-900 hover:bg-gray-700 text-white disabled:cursor-not-allowed disabled:opacity-50"
                }`}>
                {saving
                  ? "Publishing..."
                  : saved
                  ? <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg> Published!</>
                  : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg> Publish changes</>
                }
              </button>
            </div>
          </div>
        </div>

        <div className="admin-page-shell px-4 lg:px-8 py-8">
          {(loadError || catalogueWarning) && (
            <div
              className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
                loadError
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              <div className="font-semibold">
                {loadError ? "Hot items failed to load" : "Catalogue unavailable"}
              </div>
              <div className="mt-1 text-sm leading-6 opacity-90">
                {loadError ? loadError : catalogueWarning}
              </div>
            </div>
          )}

          <div className="flex flex-col lg:flex-row gap-8">
          {/* ── Items list ── */}
          <div className="flex-1 min-w-0">
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">

              {/* Table head */}
              <div className="grid grid-cols-[28px_56px_1fr_130px_80px_90px] items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
                {["", "", "Product", "Badge", "Status", ""].map((h, i) => (
                  <span key={i} className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">{h}</span>
                ))}
              </div>

              {loading && (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <div className="h-8 w-8 rounded-full border-2 border-gray-200 border-t-indigo-500 animate-spin" />
                  <p className="text-sm text-gray-500">Loading hot items...</p>
                </div>
              )}

              {!loading && loadError && (
                <div className="flex flex-col items-center justify-center py-20 gap-3 px-6 text-center">
                  <span className="text-4xl">⚠️</span>
                  <p className="text-sm font-medium text-red-600">Unable to load hot items.</p>
                  <p className="max-w-md text-sm text-gray-500">{loadError}</p>
                </div>
              )}

              {!loading && !loadError && items.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <span className="text-4xl">🔥</span>
                  <p className="text-sm text-gray-500">No hot items yet. Add your first one.</p>
                </div>
              )}

              {!loading && items.map((item, idx) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => onDragStart(idx)}
                  onDragOver={e => onDragOver(e, idx)}
                  onDrop={() => onDrop(idx)}
                  onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                  className={`card-row grid grid-cols-[28px_56px_1fr_130px_80px_90px] items-center gap-3 px-4 py-3.5 border-b border-gray-100 last:border-0 transition-colors group
                    ${dragIdx === idx ? "drag-ghost" : ""}
                    ${overIdx === idx && dragIdx !== idx ? "drag-over" : "hover:bg-slate-50/60"}
                  `}
                  style={{ animationDelay: `${idx * 0.03}s` }}
                >
                  {/* Drag handle */}
                  <span className="text-gray-300 group-hover:text-gray-400 cursor-grab active:cursor-grabbing select-none text-center">
                    ⠿
                  </span>

                  {/* Image */}
                  <div className="w-12 h-12 rounded-lg bg-gray-50 border border-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0">
                    {item.image
                      ? <img src={item.image} alt={item.name} className="w-full h-full object-contain" />
                      : <span className="text-xl">📦</span>
                    }
                  </div>

                  {/* Name + SKU + Specs */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className={`text-[13px] font-semibold leading-tight truncate ${item.active ? "text-gray-900" : "text-gray-400 line-through"}`}>
                        {item.name}
                      </p>
                      {item.specs && (
                        <span className="shrink-0 text-[11px] text-gray-500 truncate">
                          {item.specs}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 font-mono mt-0.5">{item.SKU}</p>
                  </div>

                  {/* Badge */}
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-600 border border-rose-200 w-fit truncate max-w-full">
                    {item.badge}
                  </span>

                  {/* Active toggle */}
                  <button onClick={() => toggleActive(item.id)}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${item.active ? "bg-indigo-500" : "bg-gray-200"}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${item.active ? "translate-x-5" : ""}`} />
                  </button>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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

            {/* Unsaved changes banner */}
            <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-[12px] text-amber-700 font-medium">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
              </svg>
              Changes are staged until you click <strong className="ml-1">Publish changes</strong>. This saves to the shared homepage database for every dealer.
            </div>
          </div>

          {/* ── Live preview ── */}
          <div className="w-full lg:w-[280px] flex-shrink-0">
            <div className="sticky top-[72px]">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">Live preview</p>
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[13px] font-bold text-gray-800">Hot Right Now</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-200">🔥 Trending</span>
                </div>

                {items.filter(i => i.active).length === 0 && (
                  <p className="text-[12px] text-gray-400 text-center py-6">No active items to preview.</p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  {items.filter(i => i.active).slice(0, 6).map(item => (
                    <div key={item.id}
                      className="rounded-lg border border-gray-100 overflow-hidden bg-gray-50 hover:shadow-sm transition-shadow cursor-pointer">
                      <div className="relative aspect-square flex items-center justify-center p-2">
                        {item.image
                          ? <img src={item.image} alt={item.name} className="w-full h-full object-contain" />
                          : <span className="text-2xl">📦</span>
                        }
                        <span className="absolute top-1 left-1 text-[8px] font-bold px-1 py-0.5 rounded-full bg-rose-500 text-white leading-tight">
                          {item.badge}
                        </span>
                      </div>
                      <div className="px-1.5 pb-1.5">
                        <p className="text-[10px] font-medium text-gray-700 line-clamp-2 leading-tight">{item.name}</p>
                        {item.specs && (
                          <p className="text-[9px] text-gray-500 line-clamp-2 leading-tight mt-0.5">
                            {item.specs}
                          </p>
                        )}
                        <p className="text-[9px] text-rose-500 font-semibold mt-0.5">Shop now →</p>
                      </div>
                    </div>
                  ))}
                </div>

                {items.filter(i => i.active).length > 6 && (
                  <p className="text-[11px] text-gray-400 text-center mt-2">
                    +{items.filter(i => i.active).length - 6} more (homepage shows first 6)
                  </p>
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
