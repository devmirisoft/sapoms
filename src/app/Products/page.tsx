'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { SIDEBAR_CATEGORIES, compactCategoryList } from '@/lib/categories';
import {
  addsNothingBeyond,
  getCatalogueProductDescriptor,
  groupProductsBySection,
  matchesCatalogueQuery,
} from '@/lib/catalogue';
import { loadCatalogueProducts } from '@/lib/catalogueClient';
// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
type Variant = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  specs: Record<string, string>;
  specsText: string;
  pack: number;
  price: number | null;      // rupees
  priceLabel: string;
  inStock: boolean;
  images: string[];
};

type Product = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  category: string;
  categories: string[];
  page: number;
  features: string[];
  descriptionHtml: string;
  images: string[];
  variants?: Variant[];
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function matchesSidebarCat(product: Product, label: string): boolean {
  return matchesSelectedCategory(product, label);
}

function normalizeFilterText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getProductCategoryValues(product: Product): string[] {
  const rawCategories = compactCategoryList([product.category, ...(product.categories ?? [])]);
  const values = new Set<string>();

  for (const category of rawCategories) {
    values.add(category);
    for (const part of category.split(">").map((item) => item.trim()).filter(Boolean)) {
      values.add(part);
    }
  }

  return Array.from(values);
}

function getUrlCategory(searchParams: ReturnType<typeof useSearchParams>): string {
  return (searchParams.get("cat") || searchParams.get("category") || "").trim();
}

function categoryValueMatchesFilter(categoryValue: string, filter: string): boolean {
  const normalizedValue = normalizeFilterText(categoryValue);
  const normalizedFilter = normalizeFilterText(filter);
  if (!normalizedValue || !normalizedFilter) return false;

  return (
    normalizedValue === normalizedFilter ||
    normalizedValue.includes(normalizedFilter)
  );
}

function matchesSelectedCategory(product: Product, label: string): boolean {
  const categoryValues = getProductCategoryValues(product);
  if (categoryValues.some((category) => categoryValueMatchesFilter(category, label))) return true;

  return (SIDEBAR_CATEGORIES[label] ?? []).some((alias) =>
    categoryValues.some((category) => categoryValueMatchesFilter(category, alias)),
  );
}

function countForSidebarCat(products: Product[], label: string): number {
  return products.filter(p => matchesSidebarCat(p, label)).length;
}

function getProductImage(product: Product): string | null {
  return (product.images ?? []).find(img => typeof img === "string" && img.length > 0) ?? null;
}

// Returns prices in paise (×100) so fmt() stays consistent throughout the app.
function getLowestPrice(product: Product): { regular: number | null; sale: number | null } {
  const vs = product.variants ?? [];
  const prices = vs
    .map(v => (typeof v.price === "number" && v.price > 0 ? v.price * 100 : 0))
    .filter(p => p > 0);
  return {
    regular: prices.length ? Math.min(...prices) : null,
    sale:    null,
  };
}

// Pack size is stored directly on each variant in the new JSON.
function getFirstPackSize(product: Product): number {
  return product.variants?.[0]?.pack ?? 1;
}

/** Format paise → ₹ rupees string */
function fmt(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// features is already a plain string array in the new JSON — no HTML parsing needed.
function parseBullets(features: string[]): string[] {
  return features ?? [];
}

const PAGE_SIZE = 24;

// ─────────────────────────────────────────────────────────────
// PRODUCT CARD
// ─────────────────────────────────────────────────────────────
function ProductCard({ product }: { product: Product }) {
  const img = getProductImage(product);
  const { regular, sale } = getLowestPrice(product);
  const displayPrice = sale ?? regular;
  const packSize = displayPrice !== null ? getFirstPackSize(product) : 1;
  const perUnitPrice = displayPrice !== null && packSize > 1
    ? Math.round(displayPrice / packSize)
    : null;

  const variantCount = product.variants?.length ?? 0;
  const leafCat = product.category ?? "";
  const bullet = parseBullets(product.features)[0] ?? "";
  const rawDescriptor = getCatalogueProductDescriptor(product);
  // The descriptor falls back to feature text, which can repeat the bullet line below it.
  const descriptor = addsNothingBeyond(rawDescriptor, bullet) ? "" : rawDescriptor;
  const multiVariant = variantCount > 1;
  const inStock = product.variants?.some(v => v.inStock) ?? false;

  return (
    <Link href={`/Products/${product.sku}`} style={{ textDecoration: "none", display: "block", height: "100%" }}>
      <article
        style={{
          background: "#fff", borderRadius: 10, border: "1px solid #e8edf3",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)", transition: "box-shadow .2s, transform .2s",
          overflow: "hidden", display: "flex", flexDirection: "column", height: "100%",
        }}
        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = "0 8px 28px rgba(0,0,0,0.11)"; el.style.transform = "translateY(-2px)"; }}
        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = "0 1px 3px rgba(0,0,0,0.05)"; el.style.transform = "translateY(0)"; }}
      >
        {/* Image */}
        <div style={{ position: "relative", background: "#f8fafc", aspectRatio: "1/1", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
         {img ? (
  <img
    src={img}
    alt={product.name}
    style={{ width: "100%", height: "100%", objectFit: "contain", padding: "12px" }}
    loading="lazy"
    onError={e => {
      const el = e.currentTarget as HTMLImageElement;
      el.style.display = "none";
      // show the sibling fallback div
      const fallback = el.nextElementSibling as HTMLElement;
      if (fallback) fallback.style.display = "flex";
    }}
  />
) : null}
<div style={{
  display: img ? "none" : "flex",
  flexDirection: "column", alignItems: "center", gap: 8, color: "#cbd5e1"
}}>
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <path d="m21 15-5-5L5 21"/>
  </svg>
  <span style={{ fontSize: 11 }}>No image</span>
</div>
          {sale !== null && (
            <span style={{ position: "absolute", top: 8, left: 8, background: "#ef4444", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4 }}>SALE</span>
          )}
          {!inStock && (
            <span style={{ position: "absolute", top: 8, right: 8, background: "#94a3b8", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4 }}>OUT OF STOCK</span>
          )}
        </div>

        {/* Content */}
        <div style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", flex: 1, gap: 5 }}>
          {leafCat && (
            <span style={{ fontSize: 10, fontWeight: 700, color: "#1e40af", background: "#eff6ff", padding: "2px 7px", borderRadius: 4, letterSpacing: ".05em", textTransform: "uppercase", alignSelf: "flex-start" }}>
              {leafCat}
            </span>
          )}

          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", lineHeight: 1.4, margin: 0 }}>
            {product.name}
          </h3>

          {descriptor && (
            <p style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.45, margin: 0 }}>
              {descriptor}
            </p>
          )}

          {bullet && (
            <p style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.5, margin: 0 }}>
              {bullet}
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13.5, color: "#414244" }} >SKU: {product.sku}</span>
            {multiVariant && <span style={{ fontSize: 13.5, color: "#414244" }}>{variantCount} variants</span>}
          </div>

          {/* Price block */}
          <div style={{ marginTop: "auto", paddingTop: 10 }}>
            {displayPrice !== null ? (
              <div style={{ marginBottom: 8 }}>
                {/* Pack price */}
                {/* <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: "#1e3a5f" }}>{fmt(displayPrice)}</span>
                  {sale !== null && regular !== null && (
                    <span style={{ fontSize: 11, color: "#94a3b8", textDecoration: "line-through" }}>{fmt(regular)}</span>
                  )}
                  {multiVariant && <span style={{ fontSize: 10, color: "#64748b" }}>onwards</span>}
                </div> */}
                {/* Pack size + per unit */}
                {/* <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                  {packSize > 1 && (
                    <span style={{ fontSize: 10.5, color: "#64748b", background: "#f1f5f9", padding: "1px 6px", borderRadius: 4 }}>
                      Pack of {packSize}
                    </span>
                  )}
                  {perUnitPrice !== null && (
                    <span style={{ fontSize: 10.5, color: "#94a3b8" }}>
                      {fmt(perUnitPrice)}/unit
                    </span>
                  )}
                </div> */}
              </div>
            ) : (
              <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 8px" }}>Price on request</p>
            )}
            <div style={{ background: "#6A5ACD", color: "#fff", fontSize: 11, fontWeight: 700, textAlign: "center", padding: "8px 0", borderRadius: 6, letterSpacing: ".07em" }}>
              VIEW DETAILS
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────
// SIDEBAR ROW
// ─────────────────────────────────────────────────────────────
function CategoryRow({ label, count, checked, onChange }: { label: string; count: number; checked: boolean; onChange: () => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ width: 15, height: 15, accentColor: "#1e3a5f", cursor: "pointer", flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: "#1e3a5f", fontWeight: checked ? 700 : 400, flex: 1 }}>{label}</span>
      <span style={{ fontSize: 11.5, color: "#94a3b8" }}>({count})</span>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────
function ProductsContent() {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const category = getUrlCategory(searchParams);

  const [allData, setAllData]             = useState<Product[]>([]);
  const [loading, setLoading]             = useState(true);
  const [currentPage, setCurrentPage]     = useState(1);
  const [sortBy, setSortBy]               = useState("default");
  const [searchQuery, setSearchQuery]     = useState(q);
  const [selectedCats, setSelectedCats]   = useState<string[]>(() => {
    return category ? [category] : [];
  });
  const [inStockOnly, setInStockOnly]     = useState(false);
  const [catExpanded, setCatExpanded]     = useState(true);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchQuery(q);
      setCurrentPage(1);
      setSelectedCats(category ? [category] : []);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [q, category]);

  useEffect(() => {
    loadCatalogueProducts()
      .then((data) => { setAllData(data as Product[]); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let d = [...allData];
    if (searchQuery.trim()) {
      d = d.filter(p => matchesCatalogueQuery(p, searchQuery));
    }
    if (selectedCats.length > 0) d = d.filter(p => selectedCats.some(cat => matchesSelectedCategory(p, cat)));
    if (inStockOnly) d = d.filter(p => p.variants?.some(v => v.inStock) ?? false);
    if (sortBy === "price_asc")  d.sort((a, b) => (getLowestPrice(a).regular ?? Infinity) - (getLowestPrice(b).regular ?? Infinity));
    if (sortBy === "price_desc") d.sort((a, b) => (getLowestPrice(b).regular ?? 0) - (getLowestPrice(a).regular ?? 0));
    if (sortBy === "name_asc")   d.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
    if (sortBy === "name_desc")  d.sort((a, b) => String(b.name ?? "").localeCompare(String(a.name ?? "")));
    return d;
  }, [allData, selectedCats, sortBy, searchQuery, inStockOnly]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const start      = (currentPage - 1) * PAGE_SIZE;
  const displayed  = filtered.slice(start, start + PAGE_SIZE);
  const groupedDisplayed = useMemo(() => groupProductsBySection(displayed), [displayed]);

  const toggle = (cat: string) => {
    setSelectedCats(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
    setCurrentPage(1);
  };
  const goTo = (page: number) => { setCurrentPage(page); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const clear = () => { setSelectedCats([]); setInStockOnly(false); setSearchQuery(""); setCurrentPage(1); };

  const pageRange = (): (number | "...")[] => {
    const r: (number | "...")[] = [1];
    const lo = Math.max(2, currentPage - 2), hi = Math.min(totalPages - 1, currentPage + 2);
    if (lo > 2) r.push("...");
    for (let i = lo; i <= hi; i++) r.push(i);
    if (hi < totalPages - 1) r.push("...");
    if (totalPages > 1) r.push(totalPages);
    return r;
  };

  const activeCount = selectedCats.length + (inStockOnly ? 1 : 0);

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans', sans-serif" }}>

      {/* TOP BAR */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "14px 0" }}>
        <div style={{ maxWidth: 1360, margin: "0 auto", padding: "0 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
              <Link href="/" style={{ color: "#64748b", textDecoration: "none" }}>Home</Link>
              <span style={{ margin: "0 6px" }}>/</span>
              <Link href="/categories" style={{ color: "#64748b", textDecoration: "none" }}>Categories</Link>
              <span style={{ margin: "0 6px" }}>/</span>
              <span style={{ color: "#0f172a" }}>All Products</span>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", margin: 0 }}>All Products</h1>
            {!loading && <p style={{ fontSize: 12, color: "#94a3b8", margin: "2px 0 0" }}>{filtered.length.toLocaleString()} products</p>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", opacity: 0.35, pointerEvents: "none" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0f172a" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
              <input type="text" value={searchQuery} placeholder="Search by name, SKU, category…"
                onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                style={{ fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 7, padding: "8px 12px 8px 32px", width: 240, outline: "none", color: "#0f172a", background: "#f8fafc" }} />
            </div>
            <select value={sortBy} onChange={e => { setSortBy(e.target.value); setCurrentPage(1); }}
              style={{ fontSize: 13, color: "#0f172a", border: "1px solid #e2e8f0", borderRadius: 7, padding: "8px 12px", cursor: "pointer", background: "#fff" }}>
              <option value="default">Default</option>
              <option value="name_asc">Name: A → Z</option>
              <option value="name_desc">Name: Z → A</option>
              <option value="price_asc">Price: Low → High</option>
              <option value="price_desc">Price: High → Low</option>
            </select>
          </div>
        </div>
      </div>

      {/* LAYOUT */}
      <div style={{ maxWidth: 1360, margin: "0 auto", padding: "28px", display: "grid", gridTemplateColumns: "230px 1fr", gap: 28 }}>

        {/* SIDEBAR */}
        <aside style={{ position: "sticky", top: 20, alignSelf: "start" }}>
          <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e8edf3", padding: "16px 14px" }}>
            <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid #f1f5f9" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: ".08em", textTransform: "uppercase", margin: "0 0 8px" }}>Availability</p>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={inStockOnly} onChange={() => { setInStockOnly(v => !v); setCurrentPage(1); }} style={{ width: 15, height: 15, accentColor: "#1e3a5f" }} />
                <span style={{ fontSize: 13, color: "#1e3a5f" }}>In Stock Only</span>
              </label>
            </div>
            <div>
              <div onClick={() => setCatExpanded(v => !v)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", marginBottom: catExpanded ? 4 : 0 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: ".08em", textTransform: "uppercase", margin: 0 }}>Categories</p>
                <span style={{ fontSize: 16, color: "#94a3b8", lineHeight: 1, userSelect: "none" }}>{catExpanded ? "−" : "+"}</span>
              </div>
              {catExpanded && (
                <div style={{ maxHeight: 460, overflowY: "auto" }}>
                  {Object.keys(SIDEBAR_CATEGORIES).map(label => {
                    const count = countForSidebarCat(allData, label);
                    if (count === 0) return null;
                    return <CategoryRow key={label} label={label} count={count} checked={selectedCats.includes(label)} onChange={() => toggle(label)} />;
                  })}
                </div>
              )}
            </div>
          </div>

          {activeCount > 0 && (
            <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e8edf3", padding: 14, marginTop: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: ".08em", textTransform: "uppercase", margin: "0 0 8px" }}>Active Filters</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {selectedCats.map(cat => (
                  <span key={cat} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", background: "#eff6ff", color: "#1e40af", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                    {cat}
                    <button onClick={() => toggle(cat)} style={{ background: "none", border: "none", cursor: "pointer", color: "#1e40af", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                  </span>
                ))}
                {inStockOnly && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", background: "#f0fdf4", color: "#15803d", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                    In Stock<button onClick={() => setInStockOnly(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#15803d", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                  </span>
                )}
              </div>
              <button onClick={clear} style={{ width: "100%", padding: "8px 0", fontSize: 12, fontWeight: 600, border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff", cursor: "pointer", color: "#475569" }}>
                Clear All
              </button>
            </div>
          )}
        </aside>

        {/* PRODUCTS */}
        <main>
          {!loading && (
            <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>
              {filtered.length === 0 ? "No" : `${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length}`} products
              {selectedCats.length > 0 && <span style={{ marginLeft: 6, color: "#1e40af", fontWeight: 600 }}>in: {selectedCats.join(", ")}</span>}
            </p>
          )}

          {loading && <div style={{ textAlign: "center", padding: "80px 0", color: "#94a3b8" }}>Loading products…</div>}

          {!loading && filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: "80px 40px", background: "#fff", borderRadius: 12, border: "1px solid #e8edf3" }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>🔍</div>
              <p style={{ fontSize: 16, fontWeight: 600, color: "#475569", margin: "0 0 6px" }}>No products found</p>
              <p style={{ fontSize: 13, color: "#94a3b8", margin: "0 0 20px" }}>Try adjusting your filters or search term.</p>
              <button onClick={clear} style={{ padding: "10px 28px", background: "#1e3a5f", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Clear Filters</button>
            </div>
          )}

          {!loading && displayed.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
              {groupedDisplayed.map(section => (
                <section key={section.section}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                    <div>
                      <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>{section.section}</h2>
                      <p style={{ fontSize: 12, color: "#94a3b8", margin: "4px 0 0" }}>
                        {section.products.length} product{section.products.length === 1 ? "" : "s"} on this page
                      </p>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
                    {section.products.map(p => <ProductCard key={`${section.section}:${p.id}`} product={p} />)}
                  </div>
                </section>
              ))}
            </div>
          )}

          {!loading && totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 48 }}>
              <PBtn onClick={() => goTo(currentPage - 1)} disabled={currentPage === 1}>‹ Prev</PBtn>
              {pageRange().map((item, idx) =>
                item === "..." ? <span key={`e${idx}`} style={{ width: 36, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>…</span>
                : <PBtn key={item} onClick={() => goTo(item as number)} active={currentPage === item}>{item}</PBtn>
              )}
              <PBtn onClick={() => goTo(currentPage + 1)} disabled={currentPage === totalPages}>Next ›</PBtn>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function PBtn({ children, onClick, disabled = false, active = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      minWidth: 40, height: 40, padding: "0 10px", fontSize: 13, borderRadius: 6, border: "1px solid",
      cursor: disabled ? "default" : "pointer", transition: "all .15s",
      background: active ? "#1e3a5f" : "#fff", borderColor: active ? "#1e3a5f" : "#e2e8f0",
      color: active ? "#fff" : disabled ? "#cbd5e1" : "#0f172a",
      fontWeight: active ? 700 : 400, opacity: disabled ? 0.4 : 1,
    }}>{children}</button>
  );
}

// Add this after the PBtn function
export default function ProductsPage() {
  return (
    <Suspense fallback={<div style={{ textAlign: "center", padding: "80px 0", color: "#94a3b8" }}>Loading…</div>}>
      <ProductsContent />
    </Suspense>
  );
}




