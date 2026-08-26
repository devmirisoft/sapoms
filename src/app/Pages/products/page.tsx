'use client'

import { Suspense, useState, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { Pencil, Trash2, Download, Search, Package, AlertTriangle, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { compactCategoryList, matchesCategory } from '@/lib/categories'
import {
  type CatalogueProduct,
  type CatalogueVariant,
} from '@/lib/catalogue'
import productSearch from '@/lib/productSearch.js'

const { getSearchQueryInfo, normalizeCatalogueNumber, searchProducts } = productSearch

type ProductData = {
  product_id: string
  product_name: string
  product_image: string
  product_code: string
  catalogue_number: string
  product_description: string
  about_items: string[]
  variant_specs: string
  product_unit: string
  pack_size: string
  unit_price: string
  pack_price: string
  product_category: string
  product_categories: string[]
  availability: 'In Stock' | 'Out of Stock' | 'On Request'
  admin_product_id?: string
}

type ProductResponse = {
  data: ProductData[]
  count: number
  last_page: number
}

type AdminCatalogueVariant = CatalogueVariant & {
  catalogueNumber?: string
  packPrice?: number
  unitName?: string
  availability?: 'In Stock' | 'Out of Stock' | 'On Request'
  specSummary?: string
}

type AdminCatalogueProduct = CatalogueProduct & {
  adminProductId?: string
  productCode?: string
  baseDescription?: string
  aboutItems?: string[]
}

const ITEMS_PER_PAGE = 10

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return ''
}

function priceToString(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return String(value)
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : ''
}

function money(value: string): string {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount) || amount <= 0) return 'On request'
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function parseStoredDescription(value: string) {
  const aboutItems: string[] = []
  const specRows = new Map<string, Record<string, string>>()
  const baseParts: string[] = []
  let mode: 'description' | 'about' | 'specs' = 'description'

  for (const rawLine of String(value || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const normalized = line.toUpperCase()

    if (normalized === 'ABOUT THIS ITEM') {
      mode = 'about'
      continue
    }
    if (normalized === 'VARIANT SPECIFICATIONS') {
      mode = 'specs'
      continue
    }

    if (mode === 'about') {
      const item = line.replace(/^[-*•\s]+/, '').trim()
      if (item) aboutItems.push(item)
      continue
    }

    if (mode === 'specs') {
      const [catalogueNumberPart, specsPart] = line.split(/\s+-\s+/, 2)
      const catalogueNumber = catalogueNumberPart?.trim()
      if (!catalogueNumber || !specsPart) continue

      const specs: Record<string, string> = {}
      specsPart.split(';').forEach((entry) => {
        const [key, ...valueParts] = entry.split(':')
        const specKey = key?.trim()
        const specValue = valueParts.join(':').trim()
        if (specKey && specValue) specs[specKey] = specValue
      })
      if (Object.keys(specs).length) specRows.set(catalogueNumber, specs)
      continue
    }

    baseParts.push(line)
  }

  return { description: baseParts.join(' '), aboutItems, specRows }
}

function formatVariantSpecs(specs?: Record<string, string>): string {
  if (!specs) return ''
  return Object.entries(specs)
    .filter(([key, value]) => key.trim() && String(value).trim())
    .map(([key, value]) => `${key}: ${value}`)
    .join(' • ')
}

function getVariantImage(product: CatalogueProduct, variant?: CatalogueVariant): string {
  return firstNonEmpty(...(variant?.images ?? []), ...(product.images ?? []))
}

function getVariantPackSize(variant?: AdminCatalogueVariant): string {
  const pack = Number(variant?.pack)
  return Number.isFinite(pack) && pack > 0 ? String(pack) : '1'
}

function mapCatalogueProductToRows(
  product: AdminCatalogueProduct,
  matchingVariants?: Array<AdminCatalogueVariant | undefined>
): ProductData[] {
  const variants = matchingVariants?.length
    ? matchingVariants
    : product.variants?.length
      ? (product.variants as AdminCatalogueVariant[])
      : [undefined]

  const productSku = firstNonEmpty(product.sku, product.id)
  const productCategory = firstNonEmpty(product.category, product.categories?.[0], 'Uncategorized')
  const productCategories = compactCategoryList([product.category, ...(product.categories ?? [])])

  return variants.map((variant, index) => {
    const catalogueNumber = firstNonEmpty(variant?.catalogueNumber, variant?.sku, variant?.id)
    const unitPrice = priceToString(variant?.price)
    const packSize = getVariantPackSize(variant)
    const computedPackPrice = Number(unitPrice || 0) * Number(packSize || 1)
    const packPrice = priceToString(variant?.packPrice) || priceToString(computedPackPrice)
    const availability = variant?.availability
      || (variant?.inStock === false ? 'Out of Stock' : 'In Stock')

    return {
      product_id: `${product.adminProductId || product.id || productSku}-${variant?.id || catalogueNumber || index}`,
      product_name: firstNonEmpty(product.name, variant?.name, catalogueNumber, 'Unnamed product'),
      product_image: getVariantImage(product, variant),
      product_code: firstNonEmpty(product.productCode, productSku),
      catalogue_number: catalogueNumber,
      product_description: product.baseDescription || '',
      about_items: product.aboutItems || [],
      variant_specs: variant?.specSummary || '',
      product_unit: firstNonEmpty(variant?.unitName, 'Pcs.'),
      pack_size: packSize,
      unit_price: unitPrice,
      pack_price: packPrice,
      product_category: productCategory,
      product_categories: productCategories,
      availability,
      admin_product_id: product.adminProductId,
    }
  })
}

function filterCatalogueProducts(
  products: AdminCatalogueProduct[],
  search: string,
  selectedCategory: string
): ProductData[] {
  const categoryMatches = (product: AdminCatalogueProduct) => {
    if (selectedCategory === 'all') return true
    return matchesCategory(compactCategoryList([product.category, ...(product.categories ?? [])]), selectedCategory)
  }

  if (!search.trim()) {
    return products.filter(categoryMatches).flatMap((product) => mapCatalogueProductToRows(product))
  }

  const queryInfo = getSearchQueryInfo(search)
  const catalogueQuery = normalizeCatalogueNumber(queryInfo.normalizedQuery)

  const searched = searchProducts(products, queryInfo.normalizedQuery) as Array<{
    originalProduct: AdminCatalogueProduct
    matchedVariant?: AdminCatalogueVariant | null
    normalizedCatalogueNumber?: string
  }>

  return searched
    .filter((result) => categoryMatches(result.originalProduct))
    .flatMap((result) => {
      const variant = result.matchedVariant ?? undefined
      const variantCatalogue = normalizeCatalogueNumber(variant?.catalogueNumber ?? variant?.sku ?? variant?.id ?? '')
      const isVariantCatalogueMatch = Boolean(
        variant && catalogueQuery && variantCatalogue && variantCatalogue.includes(catalogueQuery)
      )

      return mapCatalogueProductToRows(
        result.originalProduct,
        isVariantCatalogueMatch ? [variant] : undefined
      )
    })
}

function normalizeCategory(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function productMatchesCategory(product: ProductData, selectedCategory: string): boolean {
  if (selectedCategory === 'all') return true

  const target = normalizeCategory(selectedCategory)
  const productValues = [
    product.product_code,
    product.catalogue_number,
    product.product_name,
    product.product_description,
    product.variant_specs,
    product.product_unit,
  ]
    .map(normalizeCategory)
    .filter(Boolean)

  return (
    matchesCategory(compactCategoryList([product.product_category, ...(product.product_categories ?? [])]), selectedCategory) ||
    productValues.some((value) => value === target || value.includes(target) || target.includes(value))
  )
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * Shared motion + material language for this page (see /apple-design):
 * - Feedback lives on press (active:scale), never waits for release.
 * - Reduced motion drops the scale/slide and keeps a plain opacity cross-fade.
 * - Translucent chrome (topbar) lets content scroll underneath it.
 */
const PRESS = 'transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100'

function ProductListContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlQuery = searchParams.get("q") ?? ""
  const urlCategory = searchParams.get("cat") ?? "all"

  const [page,          setPage]          = useState(1)
  const [search,        setSearch]        = useState("")
  const [searchInput,   setSearchInput]   = useState("")
  const [selectedCategory, setSelectedCategory] = useState(urlCategory)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [columnFilters, setColumnFilters] = useState({
    catalogueNo: "",
    name: "",
    description: "",
    category: "",
    unitPrice: "",
    packSize: "",
  })
  const [toastMsg,      setToastMsg]      = useState<{ text: string; ok: boolean } | null>(null)
  const [modalClosing,  setModalClosing]  = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToastMsg(null), 3200)
    return () => clearTimeout(t)
  }, [toastMsg])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchInput(urlQuery)
      setSearch(urlQuery)
      setPage(1)
      setSelectedCategory(urlCategory)
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [urlQuery, urlCategory])

  const { data: response, isLoading, isError, refetch } = useQuery<ProductResponse>({
    queryKey: ['products', page, search, selectedCategory],
    queryFn: async () => {
      const res = await fetch('/api/admin/products?page=1&pageSize=1000', { cache: 'no-store' })
      if (!res.ok) throw new Error('Products unavailable')
      const json = await res.json()
      const adminItems = Array.isArray(json.data?.items)
        ? json.data.items
        : Array.isArray(json.items)
          ? json.items
          : Array.isArray(json.data)
            ? json.data
            : []
      const catalogueProducts: AdminCatalogueProduct[] = adminItems.map((product: any) => {
        const parsedDescription = parseStoredDescription(product.description || '')

        return {
          id: product.id,
          adminProductId: product.id,
          productCode: product.productCode || '',
          sku: product.productCode || product.id,
          name: product.name,
          descriptionHtml: parsedDescription.description,
          baseDescription: parsedDescription.description,
          aboutItems: parsedDescription.aboutItems,
          images: product.imageUrl ? [product.imageUrl] : [],
          category: product.category?.name || '',
          categories: product.category?.name ? [product.category.name] : [],
          variants: (product.variants ?? []).map((variant: any) => {
            const catalogueNumber = variant.catalogueNumber || variant.sku || ''
            return {
              id: variant.id,
              sku: variant.sku || variant.catalogueNumber || variant.id,
              catalogueNumber,
              name: catalogueNumber || product.name,
              pack: Number(variant.packSize || 1),
              price: Number(variant.unitPricePaise || 0) / 100,
              packPrice: Number(variant.packPricePaise || 0) / 100,
              unitName: variant.unitName || 'Pcs.',
              availability: product.active && variant.active ? 'In Stock' : 'Out of Stock',
              inStock: Boolean(product.active && variant.active),
              active: variant.active,
              specSummary: formatVariantSpecs(
                parsedDescription.specRows.get(catalogueNumber)
                || parsedDescription.specRows.get(variant.sku)
              ),
              images: product.imageUrl ? [product.imageUrl] : [],
            } as AdminCatalogueVariant
          }),
        }
      })
      const filteredProducts = filterCatalogueProducts(catalogueProducts, search, selectedCategory)
      const start = (page - 1) * ITEMS_PER_PAGE
      const pagedProducts = filteredProducts.slice(start, start + ITEMS_PER_PAGE)

      return {
        data: pagedProducts,
        count: filteredProducts.length,
        last_page: Math.max(1, Math.ceil(filteredProducts.length / ITEMS_PER_PAGE)),
      }
    },
    staleTime: 5 * 60 * 1000,
  })

  const data: ProductData[] = useMemo(() => response?.data ?? [], [response?.data])
  const filteredData = useMemo(
    () => data.filter((product) => productMatchesCategory(product, selectedCategory)),
    [data, selectedCategory]
  )
  const visibleData = useMemo(() => {
    const f = {
      catalogueNo: columnFilters.catalogueNo.trim().toLowerCase(),
      name: columnFilters.name.trim().toLowerCase(),
      description: columnFilters.description.trim().toLowerCase(),
      category: columnFilters.category.trim().toLowerCase(),
      unitPrice: columnFilters.unitPrice.trim().toLowerCase(),
      packSize: columnFilters.packSize.trim().toLowerCase(),
    }
    if (!f.catalogueNo && !f.name && !f.description && !f.category && !f.unitPrice && !f.packSize) return filteredData
    return filteredData.filter((p) =>
      (!f.catalogueNo || p.catalogue_number.toLowerCase().includes(f.catalogueNo)) &&
      (!f.name || p.product_name.toLowerCase().includes(f.name)) &&
      (!f.description || p.product_description.toLowerCase().includes(f.description)) &&
      (!f.category || p.product_category.toLowerCase().includes(f.category)) &&
      (!f.unitPrice || p.unit_price.toLowerCase().includes(f.unitPrice)) &&
      (!f.packSize || p.pack_size.toLowerCase().includes(f.packSize))
    )
  }, [filteredData, columnFilters])
  const total      = response?.count ?? 0
  const totalPages = response?.last_page || Math.max(1, Math.ceil(total / ITEMS_PER_PAGE))

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setSearch(searchInput) }, 400)
    return () => clearTimeout(t)
  }, [searchInput])

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) throw new Error("Delete failed")
      setToastMsg({ text: "Deleted successfully", ok: true })
      refetch()
    } catch {
      setToastMsg({ text: "Failed to delete product", ok: false })
    } finally {
      closeDeleteModal()
    }
  }

  // Let the sheet play its exit motion before it leaves the tree, and make it
  // interruptible: a second call (e.g. re-opening) simply resets the flag.
  const closeDeleteModal = () => {
    setModalClosing(true)
    window.setTimeout(() => {
      setDeleteConfirm(null)
      setModalClosing(false)
    }, 180)
  }

  const handleDownloadExcel = () => {
    if (!filteredData.length) return

    const headers = [
      'S.No.',
      'Product Code',
      'Product Name',
      'Category',
      'Catalogue No.',
      'Pack Size',
      'Unit Price',
      'Pack Price',
      'Unit',
      'Availability',
      'Description',
      'About This Item',
      'Variant Specifications',
    ]

    const rows = filteredData.map((p, i) => [
      (page - 1) * ITEMS_PER_PAGE + i + 1,
      p.product_code,
      p.product_name,
      p.product_category,
      p.catalogue_number,
      p.pack_size,
      p.unit_price,
      p.pack_price,
      p.product_unit,
      p.availability,
      p.product_description,
      p.about_items.join(' | '),
      p.variant_specs,
    ])

    const csv = [headers, ...rows]
      .map((row) => row.map(csvCell).join(','))
      .join('\n')

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: 'products.csv',
    })
    a.click()
    URL.revokeObjectURL(url)
  }

  function pageNumbers(): (number | "…")[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const pages: (number | "…")[] = [1]
    if (page > 3)              pages.push("…")
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
    if (page < totalPages - 2) pages.push("…")
    pages.push(totalPages)
    return pages
  }

  const handlePageChange = (p: number) => {
    if (p < 1 || p > totalPages) return
    setPage(p)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const startIndex = (page - 1) * ITEMS_PER_PAGE + 1
  const endIndex   = Math.min(page * ITEMS_PER_PAGE, total)

  return (
    <div
      className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f] antialiased"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif" }}
    >
      <style>{`
        @keyframes toastIn { from { transform: translateY(12px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        @keyframes toastOut { from { transform: translateY(0); opacity: 1 } to { transform: translateY(12px); opacity: 0 } }
        @keyframes scrimIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes sheetIn { from { transform: scale(0.94) translateY(6px); opacity: 0 } to { transform: scale(1) translateY(0); opacity: 1 } }
        @keyframes sheetOut { from { transform: scale(1) translateY(0); opacity: 1 } to { transform: scale(0.96) translateY(4px); opacity: 0 } }
        @keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
        @media (prefers-reduced-motion: reduce) {
          .motion-toast, .motion-scrim, .motion-sheet { animation-duration: 120ms !important; animation-name: fade !important; transform: none !important; }
        }
        @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
      `}</style>

      {/* ── Toast ── */}
      {toastMsg && (
        <div
          className={`motion-toast fixed bottom-6 right-6 z-[100] flex items-center gap-2 px-4 py-3 rounded-2xl text-[13px] font-medium backdrop-blur-xl border ${
            toastMsg.ok
              ? "bg-[#f0fdf6]/90 text-[#0d6b3f] border-[#bdf0d3]"
              : "bg-[#fff1f1]/90 text-[#c02b3a] border-[#f9c9cd]"
          }`}
          style={{ animation: "toastIn 320ms cubic-bezier(0.22,1,0.36,1)", boxShadow: '0 8px 30px rgba(0,0,0,0.12)' }}
        >
          {toastMsg.ok
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5"/></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
          }
          {toastMsg.text}
        </div>
      )}

      {/* ── Delete sheet — dims and pushes the page back, exits along the same path it entered ── */}
      {deleteConfirm && (
        <div
          className="motion-scrim fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[6px]"
          style={{ animation: `${modalClosing ? 'scrimIn' : 'scrimIn'} 200ms ease ${modalClosing ? 'reverse' : ''} forwards` }}
          onClick={closeDeleteModal}
        >
          <div
            className="motion-sheet bg-white/95 backdrop-blur-xl rounded-[20px] p-7 w-[360px] border border-black/5"
            style={{
              animation: `${modalClosing ? 'sheetOut' : 'sheetIn'} 220ms cubic-bezier(0.22,1,0.36,1) forwards`,
              boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="w-11 h-11 rounded-full bg-[#fff1f1] flex items-center justify-center mb-4">
              <AlertTriangle size={20} color="#ff3b30" />
            </div>
            <div className="text-[17px] font-semibold text-[#1d1d1f] mb-1.5 tracking-[-0.01em]">Delete product?</div>
            <div className="text-[13px] text-[#6e6e73] leading-relaxed mb-6">
              This cant be undone — the product and all of its data will be removed permanently.
            </div>
            <div className="flex gap-2.5 justify-end">
              <button
                onClick={closeDeleteModal}
                className={`${PRESS} px-[18px] py-[9px] rounded-full border border-[#e5e5ea] bg-white text-[13px] font-medium text-[#1d1d1f] cursor-pointer hover:bg-[#f5f5f7]`}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className={`${PRESS} px-[18px] py-[9px] rounded-full border-none bg-[#ff3b30] text-[13px] font-semibold text-white cursor-pointer hover:bg-[#e0352b]`}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Topbar — translucent material, content scrolls underneath ── */}
      <div
        className="px-8 h-16 flex items-center justify-between gap-4 sticky top-0 z-20 border-b border-black/[0.06]"
        style={{ background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(20px) saturate(180%)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className={`${PRESS} inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#e5e5ea] bg-white/70 text-[12.5px] font-medium text-[#1d1d1f] cursor-pointer hover:bg-white`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
            Back
          </button>
          <div className="w-px h-6 bg-black/[0.08]" />
          <div>
            <div className="text-[15px] font-semibold text-[#1d1d1f] tracking-[-0.01em]">Product Catalogue</div>
            {!isLoading && total > 0 && (
              <div className="text-[11.5px] text-[#86868b] mt-px">{total.toLocaleString()} products</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
        
          
        </div>
      </div>

      <div className="px-8 py-7 max-w-[1840px] mx-auto">

        {/* ── Search bar stands in for the page title ── */}
        <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
          <div className="relative w-full max-w-[440px]">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#98989d] pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search product code, catalogue no. or name…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="pl-[42px] pr-[16px] py-[12px] border border-[#e5e5ea] rounded-full text-[16px] font-semibold bg-white text-[#1d1d1f] w-full outline-none transition-shadow duration-150 placeholder:text-[#98989d] placeholder:font-normal focus:border-[#0071e3] focus:shadow-[0_0_0_4px_rgba(0,113,227,0.12)]"
              style={{ fontFamily: "inherit", letterSpacing: '-0.01em' }}
            /> 
          </div>
           <div className="flex items-center gap-2">
             <button
            onClick={() => router.push('/Pages/products/addproducts')}
            className={`${PRESS} inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border-none bg-[#0071e3] text-[12.5px] font-semibold text-white cursor-pointer whitespace-nowrap hover:bg-[#0077ed]`}
          >
            <Plus size={14} />
            Add Product
          </button>
          <button
            onClick={handleDownloadExcel}
            disabled={!filteredData.length}
            className={`${PRESS} inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[#e5e5ea] bg-white/70 text-[12.5px] font-medium text-[#1d1d1f] cursor-pointer whitespace-nowrap hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100`}
          >
            <Download size={14} />
            Export CSV
          </button>
          </div>
        </div>

        {/* ── Stats row ── */}
        {!isLoading && (
          <div className="flex gap-2.5 mb-6 flex-wrap">
            {[
              { dot: "#0071e3", label: "Total Products", value: total.toLocaleString() },
              { dot: "#34c759", label: "This Page",      value: visibleData.length },
              { dot: "#ff9f0a", label: "Page",           value: `${page} / ${totalPages}` },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-2 px-4 py-[9px] bg-white border border-black/[0.05] rounded-full text-[12.5px] text-[#3a3a3c] font-medium" style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.dot }} />
                {s.label}
                <span className="font-semibold text-[13px] text-[#1d1d1f]" style={{ fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace" }}>{s.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Error ── */}
        {isError && (
          <div className="flex items-center gap-2 mb-4 px-4 py-3 bg-[#fff1f1] border border-[#f9c9cd] rounded-2xl text-[13px] text-[#c02b3a]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
            Failed to load products. Please try again.
          </div>
        )}

        {/* ── Table card ── */}
        <div className="bg-white border border-black/[0.05] rounded-[22px] overflow-hidden" style={{ boxShadow: '0 2px 20px rgba(0,0,0,0.04)' }}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead className="bg-[#fafafc] border-b border-black/[0.05]">
                <tr>
                  <th className="px-4 py-[13px] text-left text-[10.5px] font-semibold uppercase text-[#86868b] whitespace-nowrap pl-[22px]" style={{ letterSpacing: '0.06em' }}>#</th>
                  <th className="px-4 py-[13px] text-left text-[10.5px] font-semibold uppercase text-[#86868b] whitespace-nowrap" style={{ letterSpacing: '0.06em' }}>Image</th>
                  {[
                    { key: 'catalogueNo', label: 'Catalogue No.' },
                    { key: 'name', label: 'Name' },
                    { key: 'description', label: 'Description' },
                    { key: 'category', label: 'Category' },
                    { key: 'unitPrice', label: 'Unit Price' },
                    { key: 'packSize', label: 'Pack Size' },
                  ].map((col) => (
                    <th key={col.key} className="px-4 py-[9px] text-left whitespace-nowrap">
                      <input
                        type="text"
                        placeholder={col.label}
                        value={(columnFilters as Record<string, string>)[col.key]}
                        onChange={(e) => setColumnFilters((f) => ({ ...f, [col.key]: e.target.value }))}
                        className="w-full bg-white border border-[#e5e5ea] rounded-[8px] px-2.5 py-[6px] text-[11px] font-medium text-[#3a3a3c] outline-none transition-colors placeholder:text-[#98989d] placeholder:font-semibold placeholder:uppercase placeholder:text-[10.5px] focus:border-[#0071e3] focus:shadow-[0_0_0_3px_rgba(0,113,227,0.12)]"
                        style={{ letterSpacing: '0.02em' }}
                      />
                    </th>
                  ))}
                  <th className="px-4 py-[13px] text-left text-[10.5px] font-semibold uppercase text-[#86868b] whitespace-nowrap pr-[22px]" style={{ letterSpacing: '0.06em' }}>Actions</th>
                </tr>
              </thead>
              <tbody>

                {/* Shimmer rows */}
                {isLoading && Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                  <tr key={i} className="border-b border-black/[0.04]">
                    {[40, 44, 100, 160, 240, 100, 90, 70, 120].map((w, j) => (
                      <td key={j} className="px-4 py-[14px] first:pl-[22px] last:pr-[22px]">
                        <div
                          className="h-[14px] rounded-full"
                          style={{
                            width: w,
                            background: 'linear-gradient(90deg,#f0f0f3 25%,#e5e5ea 50%,#f0f0f3 75%)',
                            backgroundSize: '200% 100%',
                            animation: 'shimmer 1.5s infinite',
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}

                {/* Empty state */}
                {!isLoading && visibleData.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-5 py-[60px] text-center">
                      <Package size={36} className="mx-auto mb-3 text-[#c7c7cc]" />
                      <div className="text-[13.5px] text-[#98989d] font-medium">No products found</div>
                      <div className="text-[12px] text-[#c7c7cc] mt-1">
                        {search ? `No results for "${search}"` : 'Your catalogue is empty'}
                      </div>
                    </td>
                  </tr>
                )}

                {/* Data rows — one row per catalogue variant */}
                {!isLoading && visibleData.map((product, i) => (
                  <tr key={product.product_id} className="border-b border-black/[0.04] last:border-b-0 transition-colors duration-150 hover:bg-[#fafafc] align-top">

                    <td className="pl-[22px] pr-4 py-[14px]">
                      <span className="text-[11px] text-[#98989d]" style={{ fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace" }}>
                        {startIndex + i}
                      </span>
                    </td>

                    <td className="px-4 py-[12px]">
                      <div className="w-10 h-10 flex-shrink-0 rounded-[10px] border border-black/[0.06] bg-[#fafafc] overflow-hidden flex items-center justify-center">
                        {product.product_image ? (
                          <img src={product.product_image} alt={product.product_name} className="w-full h-full object-contain bg-white" />
                        ) : (
                          <Package size={16} className="text-[#c7c7cc]" />
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-[14px]">
                      <span className="text-[11px] font-medium bg-[#f5f5f7] text-[#3a3a3c] px-[9px] py-[3px] rounded-full border border-black/[0.06] whitespace-nowrap" style={{ fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace" }}>
                        {product.catalogue_number || '—'}
                      </span>
                    </td>

                    <td className="px-4 py-[12px] min-w-[200px]">
                      <div className="text-[13px] font-semibold text-[#1d1d1f] leading-snug">{product.product_name || '—'}</div>
                    </td>

                    <td className="px-4 py-[12px] min-w-[260px]">
                      <div className="text-[11.5px] text-[#6e6e73] leading-relaxed line-clamp-2 max-w-[360px]">
                        {product.product_description || '—'}
                      </div>
                    </td>

                    <td className="px-4 py-[14px]">
                      <span className="text-[11px] font-semibold bg-[#fffbea] text-[#9a6b00] border border-[#f5e6a8] px-[9px] py-[3px] rounded-full whitespace-nowrap">
                        {product.product_category || 'Uncategorized'}
                      </span>
                    </td>

                    <td className="px-4 py-[14px]">
                      <span className="text-[12px] font-semibold text-[#1d1d1f] whitespace-nowrap" style={{ fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace" }}>
                        {money(product.unit_price)}
                      </span>
                    </td>

                    <td className="px-4 py-[14px]">
                      <span className="text-[12px] font-semibold text-[#3a3a3c] whitespace-nowrap" style={{ fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace" }}>
                        {product.pack_size ? `${product.pack_size} pcs` : '—'}
                      </span>
                    </td>

                    <td className="pr-[22px] pl-4 py-[14px]">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => product.admin_product_id
                            ? router.push(`/Pages/products/addproducts?id=${encodeURIComponent(product.admin_product_id)}`)
                            : setToastMsg({ text: 'Only PostgreSQL products can be edited here', ok: false })}
                          className={`${PRESS} inline-flex items-center gap-1 px-[11px] py-1.5 rounded-full text-[12px] font-medium bg-[#fafafc] text-[#3a3a3c] border border-black/[0.06] cursor-pointer hover:bg-[#eef6ff] hover:text-[#0071e3]`}
                        >
                          <Pencil size={12} />
                          Edit
                        </button>
                        <button
                          onClick={() => product.admin_product_id
                            ? setDeleteConfirm(product.admin_product_id)
                            : setToastMsg({ text: 'Only PostgreSQL products can be deleted here', ok: false })}
                          className={`${PRESS} inline-flex items-center gap-1 px-[11px] py-1.5 rounded-full text-[12px] font-medium bg-white text-[#6e6e73] border border-black/[0.06] cursor-pointer hover:bg-[#fff1f1] hover:text-[#c02b3a]`}
                        >
                          <Trash2 size={12} />
                          Delete
                        </button>
                      </div>
                    </td>

                  </tr>
                ))}

              </tbody>
            </table>
          </div>

          {/* ── Pagination ── */}
          <div className="flex items-center justify-between px-[22px] py-[14px] border-t border-black/[0.05] flex-wrap gap-3">
            <div className="text-[12px] text-[#98989d]">
              {visibleData.length > 0 ? (
                <>Showing <strong className="text-[#3a3a3c] font-semibold">{startIndex}–{endIndex}</strong> of <strong className="text-[#3a3a3c] font-semibold">{total.toLocaleString()}</strong> products</>
              ) : "No results"}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
                className={`${PRESS} min-w-[34px] h-[34px] px-2 rounded-full border border-[#e5e5ea] bg-white text-[13px] font-medium text-[#3a3a3c] cursor-pointer inline-flex items-center justify-center gap-1 hover:bg-[#fafafc] disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100`}
              >
                <ChevronLeft size={14} /> Prev
              </button>

              {pageNumbers().map((p, idx) =>
                p === "…"
                  ? <span key={`e${idx}`} className="px-1 text-[#98989d] text-[14px]">…</span>
                  : <button
                      key={p}
                      onClick={() => handlePageChange(p as number)}
                      className={`${PRESS} min-w-[34px] h-[34px] px-2 rounded-full border text-[13px] font-medium inline-flex items-center justify-center cursor-pointer ${
                        p === page
                          ? "bg-[#0071e3] border-[#0071e3] text-white font-semibold"
                          : "bg-white border-[#e5e5ea] text-[#3a3a3c] hover:bg-[#fafafc]"
                      }`}
                    >
                      {p}
                    </button>
              )}

              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page === totalPages}
                className={`${PRESS} min-w-[34px] h-[34px] px-2 rounded-full border border-[#e5e5ea] bg-white text-[13px] font-medium text-[#3a3a3c] cursor-pointer inline-flex items-center justify-center gap-1 hover:bg-[#fafafc] disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100`}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

export default function ProductListPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f5f5f7]" />}>
      <ProductListContent />
    </Suspense>
  )
}