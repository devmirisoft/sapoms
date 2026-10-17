'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { SIDEBAR_CATEGORIES, compactCategoryList, matchesCategory } from '@/lib/categories';
import { mergeCatalogueRecords } from '@/lib/catalogue';
import cataloguePricing from '@/lib/cataloguePricing';

type Variant = { inStock: boolean; images: string[]; price: number | null; pack: number };
type Product = { sku: string; name: string; category?: string; categories: string[]; images: string[]; variants?: Variant[] };

function fmt(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const CATEGORY_ICONS: Record<string, string> = {
  "Adapters": "🔧", "Distillation": "⚗️", "Flasks": "🧪", "Bottles": "🍶",
  "Burettes": "💧", "Pipettes": "🔬", "Funnels": "📐", "Cylinders": "🧫",
  "Beakers": "🥃", "Tubes": "🧬", "Condensers": "❄️", "Columns": "📊",
  "Viscometers": "🌡️", "Crucibles": "🔥", "Desiccators": "💨", "Joints & Stopcocks": "⚙️",
  "Dishes": "🫙", "Extraction": "⚗️", "Kjeldahl": "🔬", "Hydrometers": "📏",
  "Thermometers": "🌡️", "Hygrometers": "💧", "Rubberware": "🔩", "Plasticware": "🧴",
  "Metalware": "🔩", "Brushes": "🖌️", "Lab Instruments": "🔭", "Education": "📚",
  "Filters": "🔘", "Liquid Handling": "💉",
};

export default function CategoriesPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/data/omsonsdata.json')
      .then(res => { setProducts(mergeCatalogueRecords(res.data).products as unknown as Product[]); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const categoryData = Object.keys(SIDEBAR_CATEGORIES).map(label => {
    const matching = products.filter(p => matchesCategory(compactCategoryList([p.category, ...(p.categories ?? [])]), label));
    const image = matching.flatMap(p => p.images ?? []).find(Boolean) ?? null;
    const lowestPaise = matching
      .map(p => cataloguePricing.cheapestPricing(p)?.packPricePaise ?? 0)
      .filter(p => p > 0);
    const minPrice = lowestPaise.length ? Math.min(...lowestPaise) : null;
    return { label, count: matching.length, image, minPrice };
  }).filter(c => c.count > 0);

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: "'DM Sans', sans-serif" }}>

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ maxWidth: 1360, margin: '0 auto', padding: '14px 28px' }}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
            <Link href="/" style={{ color: '#64748b', textDecoration: 'none' }}>Home</Link>
            <span style={{ margin: '0 6px' }}>/</span>
            <span style={{ color: '#0f172a' }}>Categories</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: 0 }}>Browse by Category</h1>
              {!loading && (
                <p style={{ fontSize: 13, color: '#94a3b8', margin: '3px 0 0' }}>
                  {categoryData.length} categories · {products.length} products
                </p>
              )}
            </div>
            <Link href="/Products"
              style={{ fontSize: 13, fontWeight: 600, color: '#6A5ACD', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: '8px 16px', textDecoration: 'none' }}>
              View All Products →
            </Link>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '32px 28px' }}>
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 20 }}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf3', overflow: 'hidden', height: 240 }}>
                <div style={{ height: 150, background: '#f1f5f9', animation: 'pulse 1.5s infinite' }} />
                <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ height: 14, background: '#f1f5f9', borderRadius: 4, width: '60%' }} />
                  <div style={{ height: 12, background: '#f1f5f9', borderRadius: 4, width: '40%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 20 }}>
            {categoryData.map(({ label, count, image, minPrice }) => (
              <Link key={label} href={`/Products?cat=${encodeURIComponent(label)}`} style={{ textDecoration: 'none' }}>
                <div
                  style={{ background: '#fff', borderRadius: 14, border: '1px solid #e8edf3', overflow: 'hidden', transition: 'box-shadow .2s, transform .2s', cursor: 'pointer' }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = '0 10px 32px rgba(106,90,205,0.13)'; el.style.transform = 'translateY(-3px)'; }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.boxShadow = 'none'; el.style.transform = 'translateY(0)'; }}
                >
                  {/* Thumbnail */}
                  <div style={{ height: 150, background: 'linear-gradient(135deg, #f0f4ff 0%, #faf5ff 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
                    {image ? (
                      <img src={image} alt={label} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 16 }} loading="lazy"
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <span style={{ fontSize: 48 }}>{CATEGORY_ICONS[label] ?? '🧪'}</span>
                    )}
                    <div style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(255,255,255,0.92)', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: '#6A5ACD' }}>
                      {count}
                    </div>
                  </div>

                  {/* Info */}
                  <div style={{ padding: '14px 16px 16px' }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: '0 0 4px', lineHeight: 1.3 }}>{label}</h3>
                    <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 8px' }}>{count} product{count !== 1 ? 's' : ''}</p>
                    {minPrice !== null && (
                      <p style={{ fontSize: 12, color: '#6A5ACD', fontWeight: 600, margin: 0 }}>
                        From {fmt(minPrice)}
                      </p>
                    )}
                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: '#6A5ACD' }}>
                      Browse
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }`}</style>
    </div>
  );
}
