'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { SIDEBAR_CATEGORIES, compactCategoryList, labelFromSlug, matchesCategory, slugify } from '@/lib/categories';
import { mergeCatalogueRecords } from '@/lib/catalogue';
import cataloguePricing from '@/lib/cataloguePricing';

type Variant = { sku: string; specs: Record<string, string>; pack: number; price: number | null; inStock: boolean; images: string[] };
type Product  = { id: string; sku: string; name: string; category: string; categories: string[]; features: string[]; images: string[]; variants?: Variant[] };

// ── Helpers ──────────────────────────────────────────────────
function getImage(p: Product) {
  return (p.images ?? []).find(Boolean) ?? null;
}
// The cheapest pack in paise, from the one pricing function; drives the price sort.
function getLowestPaise(p: Product) {
  return cataloguePricing.cheapestPricing(p)?.packPricePaise ?? null;
}

const PAGE_SIZE = 24;

// ── Product Card ─────────────────────────────────────────────
function ProductCard({ product }: { product: Product }) {
  const img         = getImage(product);
  const cheapest    = cataloguePricing.cheapestPricing(product);
  const inStock     = product.variants?.some(v => v.inStock) ?? false;
  const varCount    = product.variants?.length ?? 0;
  const bullet      = product.features?.[0] ?? '';

  return (
    <Link href={`/Products/${product.sku}`} style={{ textDecoration: 'none', display: 'block', height: '100%' }}>
      <article
        style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8edf3', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', transition: 'box-shadow .2s, transform .2s', overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}
        onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = '0 8px 28px rgba(0,0,0,0.11)'; el.style.transform = 'translateY(-2px)'; }}
        onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)'; el.style.transform = 'translateY(0)'; }}
      >
        <div style={{ position: 'relative', background: '#f8fafc', aspectRatio: '1/1', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {img
            ? <img src={img} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 12 }} loading="lazy" />
            : <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
          }
          {!inStock && <span style={{ position: 'absolute', top: 8, right: 8, background: '#94a3b8', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4 }}>OUT OF STOCK</span>}
        </div>
        <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', flex: 1, gap: 5 }}>
          {product.category && (
            <span style={{ fontSize: 10, fontWeight: 700, color: '#1e40af', background: '#eff6ff', padding: '2px 7px', borderRadius: 4, letterSpacing: '.05em', textTransform: 'uppercase', alignSelf: 'flex-start' }}>
              {product.category}
            </span>
          )}
          <h3 style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: 1.4, margin: 0 }}>{product.name}</h3>
          {bullet && <p style={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.5, margin: 0 }}>{bullet}</p>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 10.5, color: '#94a3b8' }}>SKU: {product.sku}</span>
            {varCount > 1 && <span style={{ fontSize: 10.5, color: '#64748b' }}>{varCount} variants</span>}
          </div>
          <div style={{ marginTop: 'auto', paddingTop: 10 }}>
            {cheapest ? (
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: '#1e3a5f' }}>{cataloguePricing.formatPriceLine(cheapest)}</span>
                {varCount > 1 && <span style={{ fontSize: 10, color: '#64748b' }}>onwards</span>}
              </div>
            ) : (
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 8px' }}>Price on request</p>
            )}
            <div style={{ background: '#6A5ACD', color: '#fff', fontSize: 11, fontWeight: 700, textAlign: 'center', padding: '8px 0', borderRadius: 6, letterSpacing: '.07em' }}>
              VIEW DETAILS
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}

// ── Pagination button ─────────────────────────────────────────
function PBtn({ children, onClick, disabled = false, active = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ minWidth: 40, height: 40, padding: '0 10px', fontSize: 13, borderRadius: 6, border: '1px solid', cursor: disabled ? 'default' : 'pointer', transition: 'all .15s', background: active ? '#1e3a5f' : '#fff', borderColor: active ? '#1e3a5f' : '#e2e8f0', color: active ? '#fff' : disabled ? '#cbd5e1' : '#0f172a', fontWeight: active ? 700 : 400, opacity: disabled ? 0.4 : 1 }}>
      {children}
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────
export default function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (params as any).slug as string;
  const label = labelFromSlug(slug);

  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading]         = useState(true);
  const [sortBy, setSortBy]           = useState('default');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    axios.get('/data/omsonsdata.json')
      .then(res => { setAllProducts(mergeCatalogueRecords(res.data).products as unknown as Product[]); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!label) return [];
    let d = allProducts.filter(p => matchesCategory(compactCategoryList([p.category, ...(p.categories ?? [])]), label));
    if (inStockOnly) d = d.filter(p => p.variants?.some(v => v.inStock) ?? false);
    if (sortBy === 'price_asc')  d = [...d].sort((a, b) => (getLowestPaise(a) ?? Infinity) - (getLowestPaise(b) ?? Infinity));
    if (sortBy === 'price_desc') d = [...d].sort((a, b) => (getLowestPaise(b) ?? 0) - (getLowestPaise(a) ?? 0));
    if (sortBy === 'name_asc')   d = [...d].sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'name_desc')  d = [...d].sort((a, b) => b.name.localeCompare(a.name));
    return d;
  }, [allProducts, label, sortBy, inStockOnly]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const start      = (currentPage - 1) * PAGE_SIZE;
  const displayed  = filtered.slice(start, start + PAGE_SIZE);

  const goTo = (p: number) => { setCurrentPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const pageRange = (): (number | '...')[] => {
    const r: (number | '...')[] = [1];
    const lo = Math.max(2, currentPage - 2), hi = Math.min(totalPages - 1, currentPage + 2);
    if (lo > 2) r.push('...');
    for (let i = lo; i <= hi; i++) r.push(i);
    if (hi < totalPages - 1) r.push('...');
    if (totalPages > 1) r.push(totalPages);
    return r;
  };

  // Related categories (others in SIDEBAR_CATEGORIES, excluding current)
  const otherCats = label ? Object.keys(SIDEBAR_CATEGORIES).filter(l => l !== label).slice(0, 6) : [];

  if (!loading && !label) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, fontFamily: "'DM Sans', sans-serif" }}>
        <p style={{ fontSize: 16, color: '#64748b' }}>Category not found.</p>
        <Link href="/categories" style={{ color: '#6A5ACD', fontWeight: 600, textDecoration: 'none' }}>← Browse all categories</Link>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "'DM Sans', sans-serif" }}>

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ maxWidth: 1360, margin: '0 auto', padding: '14px 28px' }}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
            <Link href="/" style={{ color: '#64748b', textDecoration: 'none' }}>Home</Link>
            <span style={{ margin: '0 6px' }}>/</span>
            <Link href="/categories" style={{ color: '#64748b', textDecoration: 'none' }}>Categories</Link>
            <span style={{ margin: '0 6px' }}>/</span>
            <span style={{ color: '#0f172a', fontWeight: 600 }}>{label ?? slug}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: 0 }}>{label ?? slug}</h1>
              {!loading && <p style={{ fontSize: 12, color: '#94a3b8', margin: '3px 0 0' }}>{filtered.length} product{filtered.length !== 1 ? 's' : ''}</p>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                <input type="checkbox" checked={inStockOnly} onChange={() => { setInStockOnly(v => !v); setCurrentPage(1); }} style={{ accentColor: '#6A5ACD' }} />
                In Stock Only
              </label>
              <select value={sortBy} onChange={e => { setSortBy(e.target.value); setCurrentPage(1); }}
                style={{ fontSize: 13, color: '#0f172a', border: '1px solid #e2e8f0', borderRadius: 7, padding: '8px 12px', cursor: 'pointer', background: '#fff' }}>
                <option value="default">Default</option>
                <option value="name_asc">Name: A → Z</option>
                <option value="name_desc">Name: Z → A</option>
                <option value="price_asc">Price: Low → High</option>
                <option value="price_desc">Price: High → Low</option>
              </select>
              <Link href="/categories" style={{ fontSize: 13, color: '#6A5ACD', fontWeight: 600, textDecoration: 'none', padding: '8px 14px', border: '1px solid #ddd6fe', borderRadius: 7, background: '#f5f3ff' }}>
                ← All Categories
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '28px 28px' }}>

        {loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} style={{ background: '#fff', borderRadius: 10, border: '1px solid #e8edf3', overflow: 'hidden' }}>
                <div style={{ aspectRatio: '1/1', background: '#f1f5f9' }} />
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ height: 12, background: '#f1f5f9', borderRadius: 4 }} />
                  <div style={{ height: 10, background: '#f1f5f9', borderRadius: 4, width: '60%' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && displayed.length > 0 && (
          <>
            <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>
              {start + 1}–{Math.min(start + PAGE_SIZE, filtered.length)} of {filtered.length} products
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
              {displayed.map(p => <ProductCard key={`${p.sku}`} product={p} />)}
            </div>
          </>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 40px', background: '#fff', borderRadius: 12, border: '1px solid #e8edf3' }}>
            <p style={{ fontSize: 16, fontWeight: 600, color: '#475569', margin: '0 0 6px' }}>No products in this category</p>
            <Link href="/categories" style={{ color: '#6A5ACD', fontWeight: 600, textDecoration: 'none' }}>← Browse all categories</Link>
          </div>
        )}

        {!loading && totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 48 }}>
            <PBtn onClick={() => goTo(currentPage - 1)} disabled={currentPage === 1}>‹ Prev</PBtn>
            {pageRange().map((item, idx) =>
              item === '...'
                ? <span key={`e${idx}`} style={{ width: 36, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>…</span>
                : <PBtn key={item} onClick={() => goTo(item as number)} active={currentPage === item}>{item}</PBtn>
            )}
            <PBtn onClick={() => goTo(currentPage + 1)} disabled={currentPage === totalPages}>Next ›</PBtn>
          </div>
        )}

        {/* Related categories */}
        {!loading && otherCats.length > 0 && (
          <div style={{ marginTop: 64, paddingTop: 48, borderTop: '1px solid #e2e8f0' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 16px' }}>Other Categories</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {otherCats.map(l => (
                <Link key={l} href={`/categories/${slugify(l)}`}
                  style={{ padding: '8px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 20, fontSize: 13, fontWeight: 500, color: '#374151', textDecoration: 'none', transition: 'border-color .15s, color .15s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = '#6A5ACD'; (e.currentTarget as HTMLAnchorElement).style.color = '#6A5ACD'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = '#e2e8f0'; (e.currentTarget as HTMLAnchorElement).style.color = '#374151'; }}>
                  {l}
                </Link>
              ))}
              <Link href="/categories"
                style={{ padding: '8px 16px', background: '#6A5ACD', border: '1px solid #6A5ACD', borderRadius: 20, fontSize: 13, fontWeight: 600, color: '#fff', textDecoration: 'none' }}>
                View All →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
