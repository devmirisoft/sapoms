// 'use client'

// import { useEffect, useMemo, useState } from 'react'
// import { useRouter, useSearchParams } from 'next/navigation'
// import { AlertCircle, ArrowLeft, CheckCircle, GripVertical, ImagePlus, Loader2, Package, Plus, Trash2, X } from 'lucide-react'

// type ToastState = { text: string; ok: boolean } | null
// type Column = { id: string; title: string; locked?: boolean; kind?: 'catalogue' | 'pack' | 'unitPrice' | 'packPrice' | 'availability' }
// type VariantRow = { id: string; values: Record<string, string>; active: boolean }
// type CategoryValue = string | { name?: string } | null | undefined
// type CategorySourceProduct = { category?: CategoryValue; categories?: CategoryValue[]; product_category?: CategoryValue; product_categories?: CategoryValue[] }

// const defaultCategoryOptions = ['Joints', 'Laboratory Glassware', 'Accessories']

// const defaultColumns: Column[] = [
//   { id: 'catalogueNumber', title: 'Catalogue No.', locked: true, kind: 'catalogue' },
//   { id: 'packSize', title: 'Pack Size', locked: true, kind: 'pack' },
//   { id: 'unitPrice', title: 'Price / Unit', locked: true, kind: 'unitPrice' },
//   { id: 'packPrice', title: 'Price / Pack', locked: true, kind: 'packPrice' },
//   { id: 'availability', title: 'Availability', locked: true, kind: 'availability' },
// ]

// const newId = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`

// const initialVariant = (): VariantRow => ({
//   id: newId(),
//   active: true,
//   values: {
//     catalogueNumber: '',
//     packSize: '1',
//     unitPrice: '',
//     packPrice: '',
//     availability: 'In Stock',
//   },
// })

// function money(value: number) {
//   if (!Number.isFinite(value) || value <= 0) return 'On request'
//   return `Rs. ${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
// }

// function num(value: string) {
//   const parsed = Number(String(value || '').replace(/,/g, '').trim())
//   return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
// }

// function categoryText(value: CategoryValue) {
//   if (!value) return ''
//   if (typeof value === 'string') return value
//   return String(value.name ?? '')
// }

// // Catalogue numbers are always derived from the SKU + the row's position in
// // the table: "<SKU>/<position>". Reordering or adding/removing rows keeps
// // every catalogue number in sync automatically.
// function catalogueNumberFor(sku: string, position: number) {
//   return `${sku.trim() || 'SKU'}/${position}`
// }

// function reorderById<T extends { id: string }>(list: T[], fromId: string | null, toId: string): T[] {
//   if (!fromId || fromId === toId) return list
//   const fromIndex = list.findIndex((item) => item.id === fromId)
//   const toIndex = list.findIndex((item) => item.id === toId)
//   if (fromIndex === -1 || toIndex === -1) return list
//   const next = [...list]
//   const [moved] = next.splice(fromIndex, 1)
//   next.splice(toIndex, 0, moved)
//   return next
// }

// function parseStoredDescription(value: string) {
//   const aboutItems: string[] = []
//   const specRows = new Map<string, Record<string, string>>()
//   const baseParts: string[] = []
//   let mode: 'description' | 'about' | 'specs' = 'description'

//   for (const rawLine of value.split(/\r?\n/)) {
//     const line = rawLine.trim()
//     if (!line) continue
//     const normalized = line.toUpperCase()
//     if (normalized === 'ABOUT THIS ITEM') { mode = 'about'; continue }
//     if (normalized === 'VARIANT SPECIFICATIONS') { mode = 'specs'; continue }

//     if (mode === 'about') {
//       const item = line.replace(/^[-*•\s]+/, '').trim()
//       if (item) aboutItems.push(item)
//       continue
//     }

//     if (mode === 'specs') {
//       const [catalogueNumberPart, specsPart] = line.split(/\s+-\s+/, 2)
//       const catalogueNumber = catalogueNumberPart?.trim()
//       if (!catalogueNumber || !specsPart) continue
//       const specs: Record<string, string> = {}
//       specsPart.split(';').forEach((entry) => {
//         const [key, ...valueParts] = entry.split(':')
//         const specKey = key?.trim()
//         const specValue = valueParts.join(':').trim()
//         if (specKey && specValue) specs[specKey] = specValue
//       })
//       if (Object.keys(specs).length) specRows.set(catalogueNumber, specs)
//       continue
//     }

//     baseParts.push(line)
//   }

//   return { description: baseParts.join('\n'), aboutItems, specRows }
// }
// function rupeesFromPaise(value: unknown) {
//   const parsed = Number(String(value ?? '').trim())
//   return Number.isFinite(parsed) && parsed > 0 ? String(parsed / 100) : ''
// }

// function buildDescription(base: string, bullets: string[], columns: Column[], rows: VariantRow[]) {
//   const parts = [base.trim()].filter(Boolean)
//   const cleanBullets = bullets.map((item) => item.trim()).filter(Boolean)
//   if (cleanBullets.length) parts.push(`ABOUT THIS ITEM\n${cleanBullets.map((item) => `- ${item}`).join('\n')}`)

//   const specColumns = columns.filter((column) => !column.locked && column.title.trim())
//   if (specColumns.length) {
//     const lines = rows.map((row) => {
//       const cat = row.values.catalogueNumber?.trim() || 'Variant'
//       const specs = specColumns
//         .map((column) => `${column.title.trim()}: ${(row.values[column.id] || '').trim()}`)
//         .filter((line) => !line.endsWith(': '))
//       return specs.length ? `${cat} - ${specs.join('; ')}` : ''
//     }).filter(Boolean)
//     if (lines.length) parts.push(`VARIANT SPECIFICATIONS\n${lines.join('\n')}`)
//   }
//   return parts.join('\n\n')
// }

// export default function AddProductPage() {
//   const router = useRouter()
//   const searchParams = useSearchParams()
//   const editingProductId = searchParams.get('id') ?? ''
//   const [loading, setLoading] = useState(false)
//   const [toast, setToast] = useState<ToastState>(null)
//   const [initialLoading, setInitialLoading] = useState(false)

//   const showToast = (text: string, ok: boolean) => {
//     setToast({ text, ok })
//     setTimeout(() => setToast(null), 3500)
//   }

//   const [name, setName] = useState('')
//   const [productCode, setProductCode] = useState('')
//   const [category, setCategory] = useState('Joints')
//   const [customCategory, setCustomCategory] = useState('')
//   const [categoryOptions, setCategoryOptions] = useState<string[]>(defaultCategoryOptions)
//   const [unit, setUnit] = useState('Pcs.')
//   const [description, setDescription] = useState('')
//   const [imageUrl, setImageUrl] = useState('')
//   const [imagePreview, setImagePreview] = useState('')
//   const [aboutInput, setAboutInput] = useState('')
//   const [aboutItems, setAboutItems] = useState<string[]>([])
//   const [columns, setColumns] = useState<Column[]>(defaultColumns)
//   const firstVariant = useMemo(() => initialVariant(), [])
//   const [variants, setVariants] = useState<VariantRow[]>([firstVariant])
//   const [selectedVariantId, setSelectedVariantId] = useState<string | null>(firstVariant.id)
//   const [dragRowId, setDragRowId] = useState<string | null>(null)
//   const [dragOverRowId, setDragOverRowId] = useState<string | null>(null)
//   const [dragColId, setDragColId] = useState<string | null>(null)
//   const [dragOverColId, setDragOverColId] = useState<string | null>(null)

//   const selectedVariant = variants.find((row) => row.id === selectedVariantId) ?? variants[0]
//   const selectedPack = Math.max(1, Math.trunc(num(selectedVariant?.values.packSize || '1')) || 1)
//   const selectedUnitPrice = num(selectedVariant?.values.unitPrice || '')
//   const selectedPackPrice = num(selectedVariant?.values.packPrice || '') || selectedPack * selectedUnitPrice
//   const availability = selectedVariant?.values.availability || 'In Stock'
//   const effectiveCategory = customCategory.trim() || category.trim()

//   // Stable key that only changes when the row *order* or *count* changes
//   // (not when values inside a row change) — used to re-derive catalogue
//   // numbers without looping on our own writes.
//   const variantOrderKey = variants.map((row) => row.id).join('|')

//   // SKU is the single source of truth for every catalogue number: it is
//   // used as the prefix, and the position in the table (which updates as
//   // rows are dragged, added, or removed) supplies the running suffix.
//   useEffect(() => {
//     setVariants((rows) => {
//       let changed = false
//       const next = rows.map((row, index) => {
//         const computed = catalogueNumberFor(productCode, index + 1)
//         if (row.values.catalogueNumber === computed) return row
//         changed = true
//         return { ...row, values: { ...row.values, catalogueNumber: computed } }
//       })
//       return changed ? next : rows
//     })
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [productCode, variantOrderKey])

//   useEffect(() => {
//     let cancelled = false
//     const collect = (items: CategorySourceProduct[]) => {
//       const next = new Set(defaultCategoryOptions)
//       items.forEach((product) => {
//         const values = [product.category, product.product_category, ...(product.categories ?? []), ...(product.product_categories ?? [])]
//         values.forEach((value) => categoryText(value).split('>').map((part) => part.trim()).filter(Boolean).forEach((part) => next.add(part)))
//       })
//       if (!cancelled) setCategoryOptions(Array.from(next).sort((a, b) => a.localeCompare(b)))
//     }

//     Promise.all([
//       fetch('/api/admin/products?page=1&pageSize=1000', { cache: 'no-store' }).then((res) => res.ok ? res.json() : null).catch(() => null),
//       fetch('/data/nested_omsons_products.json', { cache: 'force-cache' }).then((res) => res.ok ? res.json() : []).catch(() => []),
//     ]).then(([adminPayload, cataloguePayload]) => {
//       const adminItems = Array.isArray(adminPayload?.data?.items) ? adminPayload.data.items : Array.isArray(adminPayload?.items) ? adminPayload.items : []
//       const catalogueItems = Array.isArray(cataloguePayload) ? cataloguePayload : []
//       collect([...adminItems, ...catalogueItems])
//     })

//     return () => { cancelled = true }
//   }, [])

//   useEffect(() => {
//     if (!editingProductId) return
//     let cancelled = false
//     setInitialLoading(true)
//     fetch(`/api/admin/products/${encodeURIComponent(editingProductId)}`, { cache: 'no-store', credentials: 'include' })
//       .then(async (res) => {
//         const payload = await res.json()
//         if (!res.ok || !payload?.success) throw new Error(payload?.message || 'Product unavailable')
//         return payload.data
//       })
//       .then((product) => {
//         if (cancelled) return
//         const parsed = parseStoredDescription(product.description || '')
//         const specTitles = new Set<string>()
//         parsed.specRows.forEach((specs) => Object.keys(specs).forEach((key) => specTitles.add(key)))
//         const extraColumns: Column[] = Array.from(specTitles).map((title) => ({ id: `custom_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, title }))
//         const nextColumns = [...defaultColumns, ...extraColumns]
//         const nextRows: VariantRow[] = (product.variants || []).map((variant: any) => {
//           const catalogueNumber = variant.catalogueNumber || variant.sku || ''
//           const specs = parsed.specRows.get(catalogueNumber) || parsed.specRows.get(variant.sku) || {}
//           const values: Record<string, string> = {
//             catalogueNumber,
//             packSize: String(variant.packSize || 1),
//             unitPrice: rupeesFromPaise(variant.unitPricePaise),
//             packPrice: rupeesFromPaise(variant.packPricePaise),
//             availability: variant.active ? 'In Stock' : 'Out of Stock',
//           }
//           extraColumns.forEach((column) => { values[column.id] = specs[column.title] || '' })
//           return { id: variant.id || newId(), active: variant.active !== false, values }
//         })
//         const fallbackRow = initialVariant()
//         setName(product.name || '')
//         setProductCode(product.productCode || '')
//         setCategory(product.category?.name || 'Joints')
//         setCustomCategory('')
//         setUnit(product.variants?.[0]?.unitName || 'Pcs.')
//         setDescription(parsed.description)
//         setImageUrl(product.imageUrl || '')
//         setImagePreview('')
//         setAboutItems(parsed.aboutItems)
//         setAboutInput('')
//         setColumns(nextColumns)
//         setVariants(nextRows.length ? nextRows : [fallbackRow])
//         setSelectedVariantId((nextRows[0] || fallbackRow).id)
//       })
//       .catch((error) => showToast(error instanceof Error ? error.message : 'Failed to load product.', false))
//       .finally(() => { if (!cancelled) setInitialLoading(false) })
//     return () => { cancelled = true }
//   }, [editingProductId])

//   const visibleCategoryBadges = useMemo(() => {
//     const values = [effectiveCategory, ...categoryOptions.filter((item) => item !== effectiveCategory)].filter(Boolean)
//     return values.slice(0, 12)
//   }, [categoryOptions, effectiveCategory])

//   const variantLabels = useMemo(() => variants
//     .map((row) => {
//       const socketColumn = columns.find((column) => column.title.toLowerCase().includes('socket'))
//       return { id: row.id, label: (socketColumn ? row.values[socketColumn.id]?.trim() : '') || row.values.catalogueNumber?.trim() }
//     })
//     .filter((item): item is { id: string; label: string } => Boolean(item.label)), [columns, variants])

//   const resetForm = () => {
//     const next = initialVariant()
//     setName(''); setProductCode(''); setCategory('Joints'); setCustomCategory(''); setUnit('Pcs.'); setDescription(''); setImageUrl(''); setImagePreview('')
//     setAboutInput(''); setAboutItems([]); setColumns(defaultColumns); setVariants([next]); setSelectedVariantId(next.id)
//   }

//   const updateRow = (rowId: string, columnId: string, value: string) => {
//     setVariants((rows) => rows.map((row) => {
//       if (row.id !== rowId) return row
//       const values = { ...row.values, [columnId]: value }
//       if (columnId === 'packSize' || columnId === 'unitPrice') {
//         const packSize = Math.max(1, Math.trunc(num(values.packSize || '1')) || 1)
//         const unitPrice = num(values.unitPrice || '')
//         values.packPrice = unitPrice ? String(packSize * unitPrice) : ''
//       }
//       return { ...row, values }
//     }))
//   }

//   const addAboutItem = () => {
//     const value = aboutInput.trim()
//     if (!value) return
//     setAboutItems((items) => [...items, value])
//     setAboutInput('')
//   }

//   const addColumn = () => {
//     const id = `custom_${Date.now()}`
//     setColumns((items) => [...items, { id, title: 'New Specification' }])
//     setVariants((rows) => rows.map((row) => ({ ...row, values: { ...row.values, [id]: '' } })))
//   }

//   const addVariant = () => {
//     const row = initialVariant()
//     for (const column of columns) row.values[column.id] = row.values[column.id] ?? ''
//     setVariants((rows) => [...rows, row])
//     setSelectedVariantId(row.id)
//   }

//   const removeVariant = (rowId: string) => {
//     setVariants((rows) => {
//       const next = rows.length > 1 ? rows.filter((row) => row.id !== rowId) : rows
//       if (selectedVariantId === rowId) setSelectedVariantId(next[0]?.id ?? null)
//       return next
//     })
//   }

//   // Native drag-and-drop reordering. Feedback starts the instant the row is
//   // grabbed (opacity dip), the drop target is highlighted continuously as
//   // the pointer moves over it, and catalogue numbers re-derive immediately
//   // on drop via the effect above — no separate "renumber" step needed.
//   const reorderVariant = (fromId: string | null, toId: string) => {
//     setVariants((rows) => reorderById(rows, fromId, toId))
//   }

//   // Same pattern for columns: grab the header's handle, drop on the target
//   // header. Locked columns (catalogue, pack, prices, availability) are
//   // reorderable too — only their content/computation is fixed, not position.
//   const reorderColumn = (fromId: string | null, toId: string) => {
//     setColumns((cols) => reorderById(cols, fromId, toId))
//   }

//   const handleImageChange = (file?: File) => {
//     if (!file) return
//     setImagePreview(URL.createObjectURL(file))
//   }

//   const handleSubmit = async (event: React.FormEvent) => {
//     event.preventDefault()
//     if (!name.trim()) return showToast('Product name is required.', false)
//     if (!productCode.trim()) return showToast('SKU / Product Code is required — it prefixes every catalogue number.', false)

//     setLoading(true)
//     try {
//       const res = await fetch(editingProductId ? `/api/admin/products/${encodeURIComponent(editingProductId)}` : '/api/admin/products', {
//         method: editingProductId ? 'PATCH' : 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({
//           name,
//           productCode,
//           imageUrl,
//           categoryName: effectiveCategory,
//           active: true,
//           description: buildDescription(description, aboutItems, columns, variants),
//           variants: variants.map((row) => {
//             const packSize = Math.max(1, Math.trunc(num(row.values.packSize || '1')) || 1)
//             const unitPrice = num(row.values.unitPrice || '')
//             const packPrice = num(row.values.packPrice || '') || packSize * unitPrice
//             const catalogueNumber = row.values.catalogueNumber?.trim()
//             return { id: /^\d+$/.test(row.id) ? row.id : undefined, sku: catalogueNumber, catalogueNumber, unitName: unit || 'Pcs.', packSize, unitPrice, packPrice, active: row.values.availability !== 'Out of Stock' }
//           }),
//         }),
//       })
//       if (!res.ok) throw new Error('Save failed')
//       showToast(editingProductId ? 'Product updated successfully.' : 'Product added successfully.', true)
//       if (editingProductId) router.push('/Pages/products')
//       else resetForm()
//     } catch {
//       showToast(editingProductId ? 'Failed to update product. Please try again.' : 'Failed to add product. Please try again.', false)
//     } finally {
//       setLoading(false)
//     }
//   }

//   return (
//     <>
//       <style>{`
//         *, *::before, *::after { box-sizing: border-box; }
//         .ap-root { min-height: 100vh; background: #f8fafc; color: #0f172a; font-family: Outfit, Inter, system-ui, sans-serif; }
//         .ap-topbar { height: 60px; padding: 0 32px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 14px; position: sticky; top: 0; z-index: 20; }
//         .back-btn, .icon-btn, .small-btn, .btn-submit, .btn-reset { font: inherit; cursor: pointer; }
//         .back-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border: 1px solid #e2e8f0; border-radius: 7px; background: #fff; color: #475569; font-size: 12px; font-weight: 700; transition: background-color 120ms ease, border-color 120ms ease; }
//         .back-btn:active { transform: scale(0.97); }
//         .ap-topbar-title { font-size: 15px; font-weight: 800; }
//         .ap-topbar-sub { font-size: 11.5px; color: #94a3b8; margin-top: 1px; }
//         .ap-body { width: min(1380px, calc(100vw - 48px)); margin: 0 auto; padding: 28px 0 44px; }
//         .ap-heading { display: flex; justify-content: space-between; gap: 20px; align-items: flex-end; margin-bottom: 20px; }
//         .ap-heading h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 0; }
//         .ap-heading p { margin: 4px 0 0; color: #64748b; font-size: 13px; }
//         .product-grid { display: grid; grid-template-columns: 310px minmax(0, 1fr) 290px; gap: 22px; align-items: start; }
//         .panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; }
//         .image-panel { padding: 18px; }
//         .image-box { aspect-ratio: 1; border: 1px dashed #cbd5e1; border-radius: 10px; background: #f8fafc; display: flex; align-items: center; justify-content: center; overflow: hidden; }
//         .image-box img { width: 100%; height: 100%; object-fit: contain; background: #fff; }
//         .upload-placeholder { color: #94a3b8; display: flex; flex-direction: column; align-items: center; gap: 9px; font-size: 12px; font-weight: 600; }
//         .upload-row { display: grid; gap: 9px; margin-top: 14px; }
//         .field { display: flex; flex-direction: column; gap: 6px; }
//         .field-label, .section-title { font-size: 12px; font-weight: 800; color: #334155; text-transform: uppercase; letter-spacing: .06em; }
//         .field-hint { font-size: 11px; color: #94a3b8; font-weight: 600; }
//         .field-input, .field-textarea, .table-input, .column-input { width: 100%; border: 1px solid #dbe3ef; border-radius: 7px; background: #fff; color: #0f172a; outline: none; font: inherit; font-size: 13px; }
//         .field-input { height: 38px; padding: 8px 10px; }
//         .field-textarea { min-height: 86px; resize: vertical; padding: 10px; line-height: 1.45; }
//         .field-input:focus, .field-textarea:focus, .table-input:focus, .column-input:focus { border-color: #6A5ACD; box-shadow: 0 0 0 3px rgba(106,90,205,.12); }
//         .details-panel { padding: 20px; display: grid; gap: 18px; }
//         .badge-row, .variant-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
//         .category-picker { display: grid; gap: 10px; }
//         .category-custom { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); gap: 10px; }
//         .category-badge { border: 1px solid #e2e8f0; background: #f8fafc; color: #475569; border-radius: 6px; padding: 5px 9px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease; }
//         .category-badge:active { transform: scale(0.96); }
//         .category-badge.primary { background: #fefce8; color: #a16207; border-color: #fde68a; }
//         .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
//         .wide { grid-column: 1 / -1; }
//         .about-add { display: grid; grid-template-columns: minmax(0, 1fr) 38px; gap: 8px; }
//         .small-btn, .icon-btn { border: 1px solid #dbe3ef; background: #fff; color: #334155; border-radius: 7px; min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; font-weight: 800; transition: background-color 120ms ease, border-color 120ms ease; }
//         .small-btn:hover, .icon-btn:hover, .back-btn:hover { background: #f8fafc; border-color: #cbd5e1; }
//         .small-btn:active, .icon-btn:active { transform: scale(0.96); }
//         .bullet-list { display: grid; gap: 8px; margin-top: 10px; }
//         .bullet-row { display: grid; grid-template-columns: 18px minmax(0, 1fr) 32px; gap: 8px; align-items: center; }
//         .bullet-dot { color: #6A5ACD; font-weight: 900; text-align: center; }
//         .summary-card { padding: 20px; border: 2px solid #e2e8f0; border-radius: 14px; position: sticky; top: 82px; background: #fff; }
//         .summary-label { margin: 0 0 4px; font-size: 12px; color: #94a3b8; }
//         .summary-price { margin: 0; font-size: 28px; font-weight: 900; }
//         .summary-line { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid #f1f5f9; font-size: 13px; }
//         .summary-line span:first-child { color: #64748b; }
//         .summary-line span:last-child { font-weight: 800; text-align: right; }
//         .stock-ok { color: #16a34a; }
//         .stock-out { color: #dc2626; }
//         .variant-section { margin-top: 24px; }
//         .section-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 12px; }
//         .variant-btn { border: 2px solid #e2e8f0; background: #fff; color: #374151; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: 800; cursor: pointer; transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease; }
//         .variant-btn:active { transform: scale(0.96); }
//         .variant-btn.active { border-color: #6A5ACD; background: #6A5ACD; color: #fff; }
//         .table-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; }
//         table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 900px; }
//         th { padding: 10px 12px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 12px; text-align: left; white-space: nowrap; }
//         td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
//         .table-input { min-width: 120px; height: 34px; padding: 7px 9px; }
//         .column-input { min-width: 130px; height: 30px; padding: 5px 7px; font-weight: 800; }
//         .catalogue-cell { min-width: 120px; height: 34px; display: flex; align-items: center; padding: 0 10px; font-weight: 800; color: #334155; background: #f8fafc; border: 1px solid #e7ecf3; border-radius: 7px; font-variant-numeric: tabular-nums; letter-spacing: .01em; }
//         .drag-col { width: 30px; }
//         .drag-handle-cell { width: 34px; padding: 10px 4px; }
//         .drag-handle { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 7px; color: #94a3b8; cursor: grab; touch-action: none; transition: background-color 120ms ease, color 120ms ease; }
//         .drag-handle:hover { background: #f1f5f9; color: #475569; }
//         .drag-handle:active { cursor: grabbing; }
//         .variant-row { background: #fff; transition: opacity 150ms ease, box-shadow 150ms ease, background-color 150ms ease; }
//         .variant-row.is-dragging { opacity: .45; }
//         .variant-row.is-drag-over td { box-shadow: inset 0 2px 0 0 #6A5ACD; }
//         .col-header { position: relative; transition: opacity 150ms ease, box-shadow 150ms ease; }
//         .col-header-inner { display: flex; align-items: center; gap: 6px; }
//         .col-grip { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex: none; border-radius: 5px; color: #94a3b8; cursor: grab; touch-action: none; transition: background-color 120ms ease, color 120ms ease; }
//         .col-grip:hover { background: #eef1f6; color: #475569; }
//         .col-grip:active { cursor: grabbing; }
//         .col-header.is-dragging { opacity: .5; }
//         .col-header.is-drag-over { box-shadow: inset 2px 0 0 0 #6A5ACD; }
//         .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; padding-top: 18px; border-top: 1px solid #e2e8f0; }
//         .btn-reset { padding: 10px 18px; border: 1px solid #dbe3ef; background: #fff; color: #334155; border-radius: 8px; font-size: 13px; font-weight: 800; }
//         .btn-submit { padding: 10px 22px; border: 1px solid #6A5ACD; background: #6A5ACD; color: #fff; border-radius: 8px; font-size: 13px; font-weight: 900; display: inline-flex; align-items: center; gap: 8px; transition: transform 100ms ease-out; }
//         .btn-submit:active, .btn-reset:active { transform: scale(0.97); }
//         .btn-submit:disabled, .btn-reset:disabled { opacity: .55; cursor: not-allowed; }
//         .toast { position: fixed; right: 24px; bottom: 24px; z-index: 100; padding: 12px 16px; border-radius: 10px; box-shadow: 0 10px 30px rgba(15,23,42,.14); display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 800; }
//         .toast-ok { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
//         .toast-err { background: #fff1f2; color: #be123c; border: 1px solid #fecdd3; }
//         @keyframes spin { to { transform: rotate(360deg); } }
//         @media (max-width: 1080px) { .product-grid { grid-template-columns: 1fr; } .summary-card { position: static; } }
//         @media (max-width: 640px) { .ap-topbar { padding: 0 16px; } .ap-body { width: calc(100vw - 28px); padding-top: 18px; } .ap-heading { align-items: flex-start; flex-direction: column; } .info-grid, .category-custom { grid-template-columns: 1fr; } .wide { grid-column: auto; } }
//         @media (prefers-reduced-motion: reduce) {
//           .back-btn, .icon-btn, .small-btn, .category-badge, .variant-btn, .btn-submit, .btn-reset, .drag-handle, .variant-row, .col-header, .col-grip { transition: none; }
//           .back-btn:active, .icon-btn:active, .small-btn:active, .category-badge:active, .variant-btn:active, .btn-submit:active, .btn-reset:active { transform: none; }
//         }
//       `}</style>

//       <div className="ap-root">
//         {toast && (
//           <div className={`toast ${toast.ok ? 'toast-ok' : 'toast-err'}`}>
//             {toast.ok ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
//             {toast.text}
//           </div>
//         )}

//         <div className="ap-topbar">
//           <button className="back-btn" type="button" onClick={() => router.back()}>
//             <ArrowLeft size={14} /> Back
//           </button>
//           <div>
//             <div className="ap-topbar-title">Product Catalogue</div>
//             <div className="ap-topbar-sub">{editingProductId ? 'Edit existing PostgreSQL product' : 'Add a new product to the system'}</div>
//           </div>
//         </div>

//         <main className="ap-body">
//           <div className="ap-heading">
//             <div>
//               <h1>{editingProductId ? 'Edit Product' : 'Add Product'}</h1>
//               <p>{editingProductId ? 'Update the catalogue entry, variants, pack pricing, and customer-facing summary.' : 'Build the catalogue entry, variants, pack pricing, and customer-facing summary.'}</p>
//             </div>
//           </div>

//           <form onSubmit={handleSubmit}>
//             <div className="product-grid">
//               <aside className="panel image-panel">
//                 <div className="image-box">
//                   {imagePreview || imageUrl ? <img src={imagePreview || imageUrl} alt="Product preview" /> : (
//                     <div className="upload-placeholder"><ImagePlus size={42} /><span>Upload product image</span></div>
//                   )}
//                 </div>
//                 <div className="upload-row">
//                   <label className="field"><span className="field-label">Image Upload</span><input className="field-input" type="file" accept="image/*" onChange={(event) => handleImageChange(event.target.files?.[0])} disabled={loading || initialLoading} /></label>
//                   <label className="field"><span className="field-label">Image URL</span><input className="field-input" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="/images/product.png or https://..." disabled={loading} /></label>
//                 </div>
//               </aside>

//               <section className="panel details-panel">
//                 <div className="category-picker">
//                   <div className="section-title">Product Category</div>
//                   <div className="badge-row" style={{ marginTop: 9 }}>
//                     {visibleCategoryBadges.map((item, index) => <button key={`${item}-${index}`} className={`category-badge ${item === effectiveCategory ? 'primary' : ''}`} type="button" onClick={() => { setCategory(item); setCustomCategory('') }} disabled={loading}>{item}</button>)}
//                   </div>
//                   <div className="category-custom">
//                     <select className="field-input" value={category} onChange={(event) => { setCategory(event.target.value); setCustomCategory('') }} disabled={loading}>
//                       {categoryOptions.map((item) => <option key={item} value={item}>{item}</option>)}
//                     </select>
//                     <input className="field-input" value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} placeholder="Add custom / new category" disabled={loading} />
//                   </div>
//                 </div>

//                 <div className="info-grid">
//                   <label className="field wide"><span className="field-label">Product Name *</span><input className="field-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Interchangeable Joint Adapter" disabled={loading} /></label>
//                   <label className="field">
//                     <span className="field-label">SKU / Product Code *</span>
//                     <input className="field-input" value={productCode} onChange={(event) => setProductCode(event.target.value)} placeholder="e.g. 152" disabled={loading} />
//                     <span className="field-hint">Prefixes every catalogue number below — e.g. {catalogueNumberFor(productCode, 1)}, {catalogueNumberFor(productCode, 2)}...</span>
//                   </label>
//                   <label className="field"><span className="field-label">Selected Category</span><input className="field-input" value={effectiveCategory} readOnly placeholder="Choose or add a category above" /></label>
//                   <label className="field"><span className="field-label">Unit</span><input className="field-input" value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Pcs." disabled={loading} /></label>
//                   <label className="field wide"><span className="field-label">Description</span><textarea className="field-textarea" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Brief product description" disabled={loading} /></label>
//                 </div>

//                 <div>
//                   <div className="section-title">About This Item</div>
//                   <div className="about-add" style={{ marginTop: 9 }}>
//                     <input className="field-input" value={aboutInput} onChange={(event) => setAboutInput(event.target.value)} placeholder="Complies with DIN 12249." disabled={loading} />
//                     <button className="icon-btn" type="button" onClick={addAboutItem} disabled={loading} aria-label="Add item"><Plus size={16} /></button>
//                   </div>
//                   <div className="bullet-list">
//                     {aboutItems.map((item, index) => (
//                       <div className="bullet-row" key={`${item}-${index}`}>
//                         <span className="bullet-dot">&bull;</span>
//                         <input className="field-input" value={item} onChange={(event) => setAboutItems((items) => items.map((old, itemIndex) => itemIndex === index ? event.target.value : old))} disabled={loading} />
//                         <button className="icon-btn" type="button" onClick={() => setAboutItems((items) => items.filter((_, itemIndex) => itemIndex !== index))} disabled={loading} aria-label="Remove item"><X size={14} /></button>
//                       </div>
//                     ))}
//                   </div>
//                 </div>
//               </section>

//               <aside className="summary-card">
//                 <p className="summary-label">{variants.length > 1 ? 'Starting from' : 'Price'}</p>
//                 <p className="summary-price">{money(selectedPackPrice)}</p>
//                 <div style={{ marginTop: 14 }}>
//                   <div className="summary-line"><span>Pack of</span><span>{selectedPack} Pcs.</span></div>
//                   <div className="summary-line"><span>Price per unit</span><span>{money(selectedUnitPrice)}</span></div>
//                   <div className="summary-line"><span>Availability</span><span className={availability === 'Out of Stock' ? 'stock-out' : 'stock-ok'}>{availability}</span></div>
//                   <div className="summary-line"><span>Variants</span><span>{variantLabels.length || 1}</span></div>
//                 </div>
//               </aside>
//             </div>

//             <section className="variant-section">
//               <div className="section-head">
//                 <div>
//                   <div className="section-title">Select Variant</div>
//                   <div className="variant-buttons" style={{ marginTop: 9 }}>
//                     {variantLabels.length ? variantLabels.map((item) => <button key={item.id} type="button" className={`variant-btn ${selectedVariant?.id === item.id ? 'active' : ''}`} onClick={() => setSelectedVariantId(item.id)}>{item.label}</button>) : <span className="category-badge">Add catalogue numbers below</span>}
//                   </div>
//                 </div>
//                 <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
//                   <button className="small-btn" type="button" onClick={addColumn} disabled={loading}><Plus size={14} /> Add Column</button>
//                   <button className="small-btn" type="button" onClick={addVariant} disabled={loading}><Plus size={14} /> Add Variant</button>
//                 </div>
//               </div>

//               <div className="table-wrap">
//                 <table>
//                   <thead>
//                     <tr>
//                       <th className="drag-col" />
//                       {columns.map((column) => (
//                         <th
//                           key={column.id}
//                           onDragEnter={(event) => { event.preventDefault(); if (column.id !== dragColId) setDragOverColId(column.id) }}
//                           onDragOver={(event) => event.preventDefault()}
//                           onDrop={(event) => { event.preventDefault(); reorderColumn(dragColId, column.id); setDragColId(null); setDragOverColId(null) }}
//                           className={`col-header ${column.id === dragColId ? 'is-dragging' : ''} ${column.id === dragOverColId ? 'is-drag-over' : ''}`}
//                         >
//                           <span className="col-header-inner">
//                             <span
//                               className="col-grip"
//                               draggable={!loading}
//                               onDragStart={(event) => { setDragColId(column.id); event.dataTransfer.effectAllowed = 'move' }}
//                               onDragEnd={() => { setDragColId(null); setDragOverColId(null) }}
//                               aria-label={`Drag to reorder ${column.title} column`}
//                             >
//                               <GripVertical size={12} />
//                             </span>
//                             {column.locked ? column.title : <input className="column-input" value={column.title} onChange={(event) => setColumns((items) => items.map((item) => item.id === column.id ? { ...item, title: event.target.value } : item))} disabled={loading} />}
//                           </span>
//                         </th>
//                       ))}
//                       <th />
//                     </tr>
//                   </thead>
//                   <tbody>
//                     {variants.map((row) => (
//                       <tr
//                         key={row.id}
//                         draggable={!loading}
//                         onDragStart={(event) => { setDragRowId(row.id); event.dataTransfer.effectAllowed = 'move' }}
//                         onDragEnter={(event) => { event.preventDefault(); if (row.id !== dragRowId) setDragOverRowId(row.id) }}
//                         onDragOver={(event) => event.preventDefault()}
//                         onDrop={(event) => { event.preventDefault(); reorderVariant(dragRowId, row.id); setDragRowId(null); setDragOverRowId(null) }}
//                         onDragEnd={() => { setDragRowId(null); setDragOverRowId(null) }}
//                         className={`variant-row ${row.id === dragRowId ? 'is-dragging' : ''} ${row.id === dragOverRowId ? 'is-drag-over' : ''}`}
//                       >
//                         <td className="drag-handle-cell">
//                           <span className="drag-handle" aria-label="Drag to reorder variant">
//                             <GripVertical size={15} />
//                           </span>
//                         </td>
//                         {columns.map((column) => (
//                           <td key={column.id}>
//                             {column.kind === 'catalogue' ? (
//                               <div className="catalogue-cell">{row.values.catalogueNumber}</div>
//                             ) : column.kind === 'availability' ? (
//                               <select className="table-input" value={row.values[column.id] || 'In Stock'} onChange={(event) => updateRow(row.id, column.id, event.target.value)} disabled={loading}>
//                                 <option>In Stock</option>
//                                 <option>Out of Stock</option>
//                                 <option>On Request</option>
//                               </select>
//                             ) : (
//                               <input
//                                 className="table-input"
//                                 value={row.values[column.id] || ''}
//                                 onChange={(event) => updateRow(row.id, column.id, event.target.value)}
//                                 placeholder={column.kind === 'pack' ? '10' : column.kind === 'unitPrice' ? '94' : column.kind === 'packPrice' ? '940' : column.title}
//                                 disabled={loading}
//                               />
//                             )}
//                           </td>
//                         ))}
//                         <td><button className="icon-btn" type="button" onClick={() => removeVariant(row.id)} disabled={loading || variants.length === 1} aria-label="Remove variant"><Trash2 size={14} /></button></td>
//                       </tr>
//                     ))}
//                   </tbody>
//                 </table>
//               </div>
//             </section>

//             <div className="actions">
//               <button className="btn-reset" type="button" onClick={resetForm} disabled={loading}>Reset</button>
//               <button className="btn-submit" type="submit" disabled={loading}>{loading ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Saving...</> : <><Package size={15} /> {editingProductId ? 'Update Product' : 'Add Product'}</>}</button>
//             </div>
//           </form>
//         </main>
//       </div>
//     </>
//   )
// }

'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowLeft, CheckCircle, GripVertical, ImagePlus, Loader2, Package, Plus, Trash2, X } from 'lucide-react'

type ToastState = { text: string; ok: boolean } | null
type Column = { id: string; title: string; locked?: boolean; kind?: 'catalogue' | 'pack' | 'unitPrice' | 'packPrice' | 'availability' }
type VariantRow = { id: string; values: Record<string, string>; active: boolean }
type CategoryValue = string | { name?: string } | null | undefined
type CategorySourceProduct = { category?: CategoryValue; categories?: CategoryValue[]; product_category?: CategoryValue; product_categories?: CategoryValue[] }

const defaultCategoryOptions = ['Joints', 'Laboratory Glassware', 'Accessories']

// Suggestions only — the field stays free text so a product saved with an
// odd unit still loads and round-trips unchanged.
const unitOptions = ['Pcs.', 'Set', 'Pair', 'Pack', 'Box', 'Nos.', 'Kg', 'Gm', 'Ltr', 'Ml', 'Mtr']

const defaultColumns: Column[] = [
  { id: 'catalogueNumber', title: 'Catalogue No.', locked: true, kind: 'catalogue' },
  { id: 'packSize', title: 'Pack Size', locked: true, kind: 'pack' },
  { id: 'unitPrice', title: 'Price / Unit', locked: true, kind: 'unitPrice' },
  { id: 'packPrice', title: 'Price / Pack', locked: true, kind: 'packPrice' },
  { id: 'availability', title: 'Availability', locked: true, kind: 'availability' },
]

const newId = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`

const initialVariant = (): VariantRow => ({
  id: newId(),
  active: true,
  values: {
    catalogueNumber: '',
    packSize: '1',
    unitPrice: '',
    packPrice: '',
    availability: 'In Stock',
  },
})

function money(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 'On request'
  return `Rs. ${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function num(value: string) {
  const parsed = Number(String(value || '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

// Price / Pack is always derived — never typed in directly. Whenever pack
// size or unit price changes (editing, loading a product, adding a
// variant, etc.) this is the single place that recomputes it.
function computePackPrice(packSizeValue: string, unitPriceValue: string) {
  const packSize = Math.max(1, Math.trunc(num(packSizeValue || '1')) || 1)
  const unitPrice = num(unitPriceValue || '')
  return unitPrice ? String(packSize * unitPrice) : ''
}

function categoryText(value: CategoryValue) {
  if (!value) return ''
  if (typeof value === 'string') return value
  return String(value.name ?? '')
}

// Catalogue numbers are always derived from the SKU + the row's position in
// the table: "<SKU>/<position>". Reordering or adding/removing rows keeps
// every catalogue number in sync automatically.
function catalogueNumberFor(sku: string, position: number) {
  return `${sku.trim() || 'SKU'}/${position}`
}

function reorderById<T extends { id: string }>(list: T[], fromId: string | null, toId: string): T[] {
  if (!fromId || fromId === toId) return list
  const fromIndex = list.findIndex((item) => item.id === fromId)
  const toIndex = list.findIndex((item) => item.id === toId)
  if (fromIndex === -1 || toIndex === -1) return list
  const next = [...list]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

function parseStoredDescription(value: string) {
  const aboutItems: string[] = []
  const specRows = new Map<string, Record<string, string>>()
  const baseParts: string[] = []
  let mode: 'description' | 'about' | 'specs' = 'description'

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const normalized = line.toUpperCase()
    if (normalized === 'ABOUT THIS ITEM') { mode = 'about'; continue }
    if (normalized === 'VARIANT SPECIFICATIONS') { mode = 'specs'; continue }

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

  return { description: baseParts.join('\n'), aboutItems, specRows }
}
function rupeesFromPaise(value: unknown) {
  const parsed = Number(String(value ?? '').trim())
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed / 100) : ''
}

function buildDescription(base: string, bullets: string[], columns: Column[], rows: VariantRow[]) {
  const parts = [base.trim()].filter(Boolean)
  const cleanBullets = bullets.map((item) => item.trim()).filter(Boolean)
  if (cleanBullets.length) parts.push(`ABOUT THIS ITEM\n${cleanBullets.map((item) => `- ${item}`).join('\n')}`)

  const specColumns = columns.filter((column) => !column.locked && column.title.trim())
  if (specColumns.length) {
    const lines = rows.map((row) => {
      const cat = row.values.catalogueNumber?.trim() || 'Variant'
      const specs = specColumns
        .map((column) => `${column.title.trim()}: ${(row.values[column.id] || '').trim()}`)
        .filter((line) => !line.endsWith(': '))
      return specs.length ? `${cat} - ${specs.join('; ')}` : ''
    }).filter(Boolean)
    if (lines.length) parts.push(`VARIANT SPECIFICATIONS\n${lines.join('\n')}`)
  }
  return parts.join('\n\n')
}

export default function AddProductPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editingProductId = searchParams.get('id') ?? ''
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<ToastState>(null)
  const [initialLoading, setInitialLoading] = useState(false)

  const showToast = (text: string, ok: boolean) => {
    setToast({ text, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const [name, setName] = useState('')
  const [productCode, setProductCode] = useState('')
  const [category, setCategory] = useState('Joints')
  const [customCategory, setCustomCategory] = useState('')
  const [categoryOptions, setCategoryOptions] = useState<string[]>(defaultCategoryOptions)
  const [unit, setUnit] = useState('Pcs.')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [imagePreview, setImagePreview] = useState('')
  const [aboutInput, setAboutInput] = useState('')
  const [aboutItems, setAboutItems] = useState<string[]>([])
  const [columns, setColumns] = useState<Column[]>(defaultColumns)
  const firstVariant = useMemo(() => initialVariant(), [])
  const [variants, setVariants] = useState<VariantRow[]>([firstVariant])
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(firstVariant.id)
  const [dragRowId, setDragRowId] = useState<string | null>(null)
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null)
  const [dragColId, setDragColId] = useState<string | null>(null)
  const [dragOverColId, setDragOverColId] = useState<string | null>(null)

  const selectedVariant = variants.find((row) => row.id === selectedVariantId) ?? variants[0]
  const selectedPack = Math.max(1, Math.trunc(num(selectedVariant?.values.packSize || '1')) || 1)
  const selectedUnitPrice = num(selectedVariant?.values.unitPrice || '')
  const selectedPackPrice = selectedPack * selectedUnitPrice
  const availability = selectedVariant?.values.availability || 'In Stock'
  const effectiveCategory = customCategory.trim() || category.trim()

  // Stable key that only changes when the row *order* or *count* changes
  // (not when values inside a row change) — used to re-derive catalogue
  // numbers without looping on our own writes.
  const variantOrderKey = variants.map((row) => row.id).join('|')

  // SKU is the single source of truth for every catalogue number: it is
  // used as the prefix, and the position in the table (which updates as
  // rows are dragged, added, or removed) supplies the running suffix.
  useEffect(() => {
    setVariants((rows) => {
      let changed = false
      const next = rows.map((row, index) => {
        const computed = catalogueNumberFor(productCode, index + 1)
        if (row.values.catalogueNumber === computed) return row
        changed = true
        return { ...row, values: { ...row.values, catalogueNumber: computed } }
      })
      return changed ? next : rows
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productCode, variantOrderKey])

  useEffect(() => {
    let cancelled = false
    const collect = (items: CategorySourceProduct[]) => {
      const next = new Set(defaultCategoryOptions)
      items.forEach((product) => {
        const values = [product.category, product.product_category, ...(product.categories ?? []), ...(product.product_categories ?? [])]
        values.forEach((value) => categoryText(value).split('>').map((part) => part.trim()).filter(Boolean).forEach((part) => next.add(part)))
      })
      if (!cancelled) setCategoryOptions(Array.from(next).sort((a, b) => a.localeCompare(b)))
    }

    Promise.all([
      fetch('/api/admin/products?page=1&pageSize=1000', { cache: 'no-store' }).then((res) => res.ok ? res.json() : null).catch(() => null),
      fetch('/data/nested_omsons_products.json', { cache: 'force-cache' }).then((res) => res.ok ? res.json() : []).catch(() => []),
    ]).then(([adminPayload, cataloguePayload]) => {
      const adminItems = Array.isArray(adminPayload?.data?.items) ? adminPayload.data.items : Array.isArray(adminPayload?.items) ? adminPayload.items : []
      const catalogueItems = Array.isArray(cataloguePayload) ? cataloguePayload : []
      collect([...adminItems, ...catalogueItems])
    })

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!editingProductId) return
    let cancelled = false
    setInitialLoading(true)
    fetch(`/api/admin/products/${encodeURIComponent(editingProductId)}`, { cache: 'no-store', credentials: 'include' })
      .then(async (res) => {
        const payload = await res.json()
        if (!res.ok || !payload?.success) throw new Error(payload?.message || 'Product unavailable')
        return payload.data
      })
      .then((product) => {
        if (cancelled) return
        const parsed = parseStoredDescription(product.description || '')
        const specTitles = new Set<string>()
        parsed.specRows.forEach((specs) => Object.keys(specs).forEach((key) => specTitles.add(key)))
        const extraColumns: Column[] = Array.from(specTitles).map((title) => ({ id: `custom_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, title }))
        const nextColumns = [...defaultColumns, ...extraColumns]
        const nextRows: VariantRow[] = (product.variants || []).map((variant: any) => {
          const catalogueNumber = variant.catalogueNumber || variant.sku || ''
          const specs = parsed.specRows.get(catalogueNumber) || parsed.specRows.get(variant.sku) || {}
          const packSizeStr = String(variant.packSize || 1)
          const unitPriceStr = rupeesFromPaise(variant.unitPricePaise)
          const values: Record<string, string> = {
            catalogueNumber,
            packSize: packSizeStr,
            unitPrice: unitPriceStr,
            packPrice: computePackPrice(packSizeStr, unitPriceStr),
            availability: variant.active ? 'In Stock' : 'Out of Stock',
          }
          extraColumns.forEach((column) => { values[column.id] = specs[column.title] || '' })
          return { id: variant.id || newId(), active: variant.active !== false, values }
        })
        const fallbackRow = initialVariant()
        setName(product.name || '')
        setProductCode(product.productCode || '')
        setCategory(product.category?.name || 'Joints')
        setCustomCategory('')
        setUnit(product.variants?.[0]?.unitName || 'Pcs.')
        setDescription(parsed.description)
        setImageUrl(product.imageUrl || '')
        setImagePreview('')
        setAboutItems(parsed.aboutItems)
        setAboutInput('')
        setColumns(nextColumns)
        setVariants(nextRows.length ? nextRows : [fallbackRow])
        setSelectedVariantId((nextRows[0] || fallbackRow).id)
      })
      .catch((error) => showToast(error instanceof Error ? error.message : 'Failed to load product.', false))
      .finally(() => { if (!cancelled) setInitialLoading(false) })
    return () => { cancelled = true }
  }, [editingProductId])

  const visibleCategoryBadges = useMemo(() => {
    const values = [effectiveCategory, ...categoryOptions.filter((item) => item !== effectiveCategory)].filter(Boolean)
    return values.slice(0, 12)
  }, [categoryOptions, effectiveCategory])

  const variantLabels = useMemo(() => variants
    .map((row) => {
      const socketColumn = columns.find((column) => column.title.toLowerCase().includes('socket'))
      return { id: row.id, label: (socketColumn ? row.values[socketColumn.id]?.trim() : '') || row.values.catalogueNumber?.trim() }
    })
    .filter((item): item is { id: string; label: string } => Boolean(item.label)), [columns, variants])

  const resetForm = () => {
    const next = initialVariant()
    setName(''); setProductCode(''); setCategory('Joints'); setCustomCategory(''); setUnit('Pcs.'); setDescription(''); setImageUrl(''); setImagePreview('')
    setAboutInput(''); setAboutItems([]); setColumns(defaultColumns); setVariants([next]); setSelectedVariantId(next.id)
  }

  const updateRow = (rowId: string, columnId: string, value: string) => {
    setVariants((rows) => rows.map((row) => {
      if (row.id !== rowId) return row
      const values = { ...row.values, [columnId]: value }
      if (columnId === 'packSize' || columnId === 'unitPrice') {
        values.packPrice = computePackPrice(values.packSize, values.unitPrice)
      }
      return { ...row, values }
    }))
  }

  const addAboutItem = () => {
    const value = aboutInput.trim()
    if (!value) return
    setAboutItems((items) => [...items, value])
    setAboutInput('')
  }

  const addColumn = () => {
    const id = `custom_${Date.now()}`
    setColumns((items) => [...items, { id, title: 'New Specification' }])
    setVariants((rows) => rows.map((row) => ({ ...row, values: { ...row.values, [id]: '' } })))
  }

  const removeColumn = (columnId: string) => {
    setColumns((items) => items.filter((item) => item.id !== columnId))
    setVariants((rows) => rows.map((row) => {
      const values = { ...row.values }
      delete values[columnId]
      return { ...row, values }
    }))
  }

  const addVariant = () => {
    const row = initialVariant()
    for (const column of columns) row.values[column.id] = row.values[column.id] ?? ''
    setVariants((rows) => [...rows, row])
    setSelectedVariantId(row.id)
  }

  const removeVariant = (rowId: string) => {
    setVariants((rows) => {
      const next = rows.length > 1 ? rows.filter((row) => row.id !== rowId) : rows
      if (selectedVariantId === rowId) setSelectedVariantId(next[0]?.id ?? null)
      return next
    })
  }

  // Native drag-and-drop reordering. Feedback starts the instant the row is
  // grabbed (opacity dip), the drop target is highlighted continuously as
  // the pointer moves over it, and catalogue numbers re-derive immediately
  // on drop via the effect above — no separate "renumber" step needed.
  const reorderVariant = (fromId: string | null, toId: string) => {
    setVariants((rows) => reorderById(rows, fromId, toId))
  }

  // Same pattern for columns: grab the header's handle, drop on the target
  // header. Locked columns (catalogue, pack, prices, availability) are
  // reorderable too — only their content/computation is fixed, not position.
  const reorderColumn = (fromId: string | null, toId: string) => {
    setColumns((cols) => reorderById(cols, fromId, toId))
  }

  // Only square (1:1) images are accepted. We read the file's real pixel
  // dimensions off a throwaway <img> before ever setting it as the preview —
  // a mismatched ratio is rejected with a toast and the file input is reset,
  // so a non-square image never makes it into state (and never gets to a
  // "Save" call) in the first place.
  const handleImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const file = input.files?.[0]
    if (!file) return

    const objectUrl = URL.createObjectURL(file)
    const probe = new window.Image()
    probe.onload = () => {
      if (probe.naturalWidth !== probe.naturalHeight) {
        URL.revokeObjectURL(objectUrl)
        input.value = ''
        showToast('Only square (1:1) images can be uploaded — please crop the image to a 1:1 ratio first.', false)
        return
      }
      setImagePreview(objectUrl)
    }
    probe.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      input.value = ''
      showToast('That file could not be read as an image.', false)
    }
    probe.src = objectUrl
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return showToast('Product name is required.', false)
    if (!productCode.trim()) return showToast('SKU / Product Code is required — it prefixes every catalogue number.', false)

    setLoading(true)
    try {
      const res = await fetch(editingProductId ? `/api/admin/products/${encodeURIComponent(editingProductId)}` : '/api/admin/products', {
        method: editingProductId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          productCode,
          imageUrl,
          categoryName: effectiveCategory,
          active: true,
          description: buildDescription(description, aboutItems, columns, variants),
          variants: variants.map((row) => {
            const packSize = Math.max(1, Math.trunc(num(row.values.packSize || '1')) || 1)
            const unitPrice = num(row.values.unitPrice || '')
            const packPrice = packSize * unitPrice
            const catalogueNumber = row.values.catalogueNumber?.trim()
            return { id: /^\d+$/.test(row.id) ? row.id : undefined, sku: catalogueNumber, catalogueNumber, unitName: unit || 'Pcs.', packSize, unitPrice, packPrice, active: row.values.availability !== 'Out of Stock' }
          }),
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      showToast(editingProductId ? 'Product updated successfully.' : 'Product added successfully.', true)
      if (editingProductId) router.push('/Pages/products')
      else resetForm()
    } catch {
      showToast(editingProductId ? 'Failed to update product. Please try again.' : 'Failed to add product. Please try again.', false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }
        .ap-root { min-height: 100vh; background: #f8fafc; color: #0f172a; font-family: Outfit, Inter, system-ui, sans-serif; }
        .ap-topbar { height: 60px; padding: 0 32px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 14px; position: sticky; top: 0; z-index: 20; }
        .back-btn, .icon-btn, .small-btn, .btn-submit, .btn-reset { font: inherit; cursor: pointer; }
        .back-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border: 1px solid #e2e8f0; border-radius: 7px; background: #fff; color: #475569; font-size: 12px; font-weight: 700; transition: background-color 120ms ease, border-color 120ms ease; }
        .back-btn:active { transform: scale(0.97); }
        .ap-topbar-title { font-size: 15px; font-weight: 800; }
        .ap-topbar-sub { font-size: 11.5px; color: #94a3b8; margin-top: 1px; }
        .ap-body { width: min(1840px, calc(100vw - 48px)); margin: 0 auto; padding: 28px 0 44px; }
        .ap-heading { display: flex; justify-content: space-between; gap: 20px; align-items: flex-end; margin-bottom: 20px; }
        .ap-heading h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 0; }
        .ap-heading p { margin: 4px 0 0; color: #64748b; font-size: 13px; }
        .product-grid { display: grid; grid-template-columns: 310px minmax(0, 1fr) 290px; gap: 22px; align-items: start; }
        .panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; }
        .image-panel { padding: 18px; }
        .image-box { aspect-ratio: 1; border: 1px dashed #cbd5e1; border-radius: 10px; background: #f8fafc; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .image-box img { width: 100%; height: 100%; object-fit: contain; background: #fff; }
        .upload-placeholder { color: #94a3b8; display: flex; flex-direction: column; align-items: center; gap: 9px; font-size: 12px; font-weight: 600; }
        .upload-row { display: grid; gap: 9px; margin-top: 14px; }
        .field { display: flex; flex-direction: column; gap: 6px; }
        .field-label, .section-title { font-size: 12px; font-weight: 800; color: #334155; text-transform: uppercase; letter-spacing: .06em; }
        .field-hint { font-size: 11px; color: #94a3b8; font-weight: 600; }
        .field-input, .field-textarea, .table-input, .column-input { width: 100%; border: 1px solid #dbe3ef; border-radius: 7px; background: #fff; color: #0f172a; outline: none; font: inherit; font-size: 13px; }
        .field-input { height: 38px; padding: 8px 10px; }
        .field-textarea { min-height: 86px; resize: vertical; padding: 10px; line-height: 1.45; }
        .field-input:focus, .field-textarea:focus, .table-input:focus, .column-input:focus { border-color: #6A5ACD; box-shadow: 0 0 0 3px rgba(106,90,205,.12); }
        .details-panel { padding: 20px; display: grid; gap: 18px; }
        .badge-row, .variant-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
        .category-picker { display: grid; gap: 10px; }
        .category-custom { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); gap: 10px; }
        .category-badge { border: 1px solid #e2e8f0; background: #f8fafc; color: #475569; border-radius: 6px; padding: 5px 9px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease; }
        .category-badge:active { transform: scale(0.96); }
        .category-badge.primary { background: #fefce8; color: #a16207; border-color: #fde68a; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .wide { grid-column: 1 / -1; }
        .about-add { display: grid; grid-template-columns: minmax(0, 1fr) 38px; gap: 8px; }
        .small-btn, .icon-btn { border: 1px solid #dbe3ef; background: #fff; color: #334155; border-radius: 7px; min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; font-weight: 800; transition: background-color 120ms ease, border-color 120ms ease; }
        .small-btn:hover, .icon-btn:hover, .back-btn:hover { background: #f8fafc; border-color: #cbd5e1; }
        .small-btn:active, .icon-btn:active { transform: scale(0.96); }
        .bullet-list { display: grid; gap: 8px; margin-top: 10px; }
        .bullet-row { display: grid; grid-template-columns: 18px minmax(0, 1fr) 32px; gap: 8px; align-items: center; }
        .bullet-dot { color: #6A5ACD; font-weight: 900; text-align: center; }
        .summary-card { padding: 20px; border: 2px solid #e2e8f0; border-radius: 14px; position: sticky; top: 82px; background: #fff; }
        .summary-label { margin: 0 0 4px; font-size: 12px; color: #94a3b8; }
        .summary-price { margin: 0; font-size: 28px; font-weight: 900; }
        .summary-line { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid #f1f5f9; font-size: 13px; }
        .summary-line span:first-child { color: #64748b; }
        .summary-line span:last-child { font-weight: 800; text-align: right; }
        .stock-ok { color: #16a34a; }
        .stock-out { color: #dc2626; }
        .variant-section { margin-top: 24px; }
        .section-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 12px; }
        .variant-btn { border: 2px solid #e2e8f0; background: #fff; color: #374151; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: 800; cursor: pointer; transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease; }
        .variant-btn:active { transform: scale(0.96); }
        .variant-btn.active { border-color: #6A5ACD; background: #6A5ACD; color: #fff; }
        .table-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 900px; }
        th { padding: 10px 12px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 12px; text-align: left; white-space: nowrap; }
        td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
        .table-input { min-width: 120px; height: 34px; padding: 7px 9px; }
        .column-input { min-width: 130px; height: 30px; padding: 5px 7px; font-weight: 800; }
        .catalogue-cell { min-width: 120px; height: 34px; display: flex; align-items: center; padding: 0 10px; font-weight: 800; color: #334155; background: #f8fafc; border: 1px solid #e7ecf3; border-radius: 7px; font-variant-numeric: tabular-nums; letter-spacing: .01em; }
        .drag-col { width: 30px; }
        .drag-handle-cell { width: 34px; padding: 10px 4px; }
        .drag-handle { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 7px; color: #94a3b8; cursor: grab; touch-action: none; transition: background-color 120ms ease, color 120ms ease; }
        .drag-handle:hover { background: #f1f5f9; color: #475569; }
        .drag-handle:active { cursor: grabbing; }
        .variant-row { background: #fff; transition: opacity 150ms ease, box-shadow 150ms ease, background-color 150ms ease; }
        .variant-row.is-dragging { opacity: .45; }
        .variant-row.is-drag-over td { box-shadow: inset 0 2px 0 0 #6A5ACD; }
        .col-header { position: relative; transition: opacity 150ms ease, box-shadow 150ms ease; }
        .col-header-inner { display: flex; align-items: center; gap: 6px; }
        .col-grip { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex: none; border-radius: 5px; color: #94a3b8; cursor: grab; touch-action: none; transition: background-color 120ms ease, color 120ms ease; }
        .col-grip:hover { background: #eef1f6; color: #475569; }
        .col-grip:active { cursor: grabbing; }
        .col-header.is-dragging { opacity: .5; }
        .col-header.is-drag-over { box-shadow: inset 2px 0 0 0 #6A5ACD; }
        .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; padding-top: 18px; border-top: 1px solid #e2e8f0; }
        .btn-reset { padding: 10px 18px; border: 1px solid #dbe3ef; background: #fff; color: #334155; border-radius: 8px; font-size: 13px; font-weight: 800; }
        .btn-submit { padding: 10px 22px; border: 1px solid #6A5ACD; background: #6A5ACD; color: #fff; border-radius: 8px; font-size: 13px; font-weight: 900; display: inline-flex; align-items: center; gap: 8px; transition: transform 100ms ease-out; }
        .btn-submit:active, .btn-reset:active { transform: scale(0.97); }
        .btn-submit:disabled, .btn-reset:disabled { opacity: .55; cursor: not-allowed; }
        .toast { position: fixed; right: 24px; bottom: 24px; z-index: 100; padding: 12px 16px; border-radius: 10px; box-shadow: 0 10px 30px rgba(15,23,42,.14); display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 800; }
        .toast-ok { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
        .toast-err { background: #fff1f2; color: #be123c; border: 1px solid #fecdd3; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 1080px) { .product-grid { grid-template-columns: 1fr; } .summary-card { position: static; } }
        @media (max-width: 640px) { .ap-topbar { padding: 0 16px; } .ap-body { width: calc(100vw - 28px); padding-top: 18px; } .ap-heading { align-items: flex-start; flex-direction: column; } .info-grid, .category-custom { grid-template-columns: 1fr; } .wide { grid-column: auto; } }
        @media (prefers-reduced-motion: reduce) {
          .back-btn, .icon-btn, .small-btn, .category-badge, .variant-btn, .btn-submit, .btn-reset, .drag-handle, .variant-row, .col-header, .col-grip { transition: none; }
          .back-btn:active, .icon-btn:active, .small-btn:active, .category-badge:active, .variant-btn:active, .btn-submit:active, .btn-reset:active { transform: none; }
        }
      `}</style>

      <div className="ap-root">
        {toast && (
          <div className={`toast ${toast.ok ? 'toast-ok' : 'toast-err'}`}>
            {toast.ok ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
            {toast.text}
          </div>
        )}

        <div className="ap-topbar">
          <button className="back-btn" type="button" onClick={() => router.back()}>
            <ArrowLeft size={14} /> Back
          </button>
          <div>
            <div className="ap-topbar-title">Product Catalogue</div>
            <div className="ap-topbar-sub">{editingProductId ? 'Edit existing PostgreSQL product' : 'Add a new product to the system'}</div>
          </div>
        </div>

        <main className="ap-body">
          <div className="ap-heading">
            <div>
              <h1>{editingProductId ? 'Edit Product' : 'Add Product'}</h1>
              <p>{editingProductId ? 'Update the catalogue entry, variants, pack pricing, and customer-facing summary.' : 'Build the catalogue entry, variants, pack pricing, and customer-facing summary.'}</p>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="product-grid">
              <aside className="panel image-panel">
                <div className="image-box">
                  {imagePreview || imageUrl ? <img src={imagePreview || imageUrl} alt="Product preview" /> : (
                    <div className="upload-placeholder"><ImagePlus size={42} /><span>Upload product image</span></div>
                  )}
                </div>
                <div className="upload-row">
                  <label className="field">
                    <span className="field-label">Image Upload</span>
                    <input className="field-input" type="file" accept="image/*" onChange={handleImageChange} disabled={loading || initialLoading} />
                    <span className="field-hint">Square (1:1) images only — other ratios are rejected on upload.</span>
                  </label>
                  <label className="field"><span className="field-label">Image URL</span><input className="field-input" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="/images/product.png or https://..." disabled={loading} /></label>
                </div>
              </aside>

              <section className="panel details-panel">
                <div className="category-picker">
                  <div className="section-title">Product Category</div>
                  <div className="badge-row" style={{ marginTop: 9 }}>
                    {visibleCategoryBadges.map((item, index) => <button key={`${item}-${index}`} className={`category-badge ${item === effectiveCategory ? 'primary' : ''}`} type="button" onClick={() => { setCategory(item); setCustomCategory('') }} disabled={loading}>{item}</button>)}
                  </div>
                  <div className="category-custom">
                    <select className="field-input" value={category} onChange={(event) => { setCategory(event.target.value); setCustomCategory('') }} disabled={loading}>
                      {categoryOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <input className="field-input" value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} placeholder="Add custom / new category" disabled={loading} />
                  </div>
                </div>

                <div className="info-grid">
                  <label className="field wide"><span className="field-label">Product Name *</span><input className="field-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Interchangeable Joint Adapter" disabled={loading} /></label>
                  <label className="field">
                    <span className="field-label">SKU / Product Code *</span>
                    <input className="field-input" value={productCode} onChange={(event) => setProductCode(event.target.value)} placeholder="e.g. 152" disabled={loading} />
                    <span className="field-hint">Prefixes every catalogue number below — e.g. {catalogueNumberFor(productCode, 1)}, {catalogueNumberFor(productCode, 2)}...</span>
                  </label>
                  <label className="field"><span className="field-label">Selected Category</span><input className="field-input" value={effectiveCategory} readOnly placeholder="Choose or add a category above" /></label>
                  <label className="field">
                    <span className="field-label">Unit</span>
                    <input className="field-input" list="unit-options" value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Pcs." disabled={loading} />
                    <datalist id="unit-options">{unitOptions.map((option) => <option key={option} value={option} />)}</datalist>
                  </label>
                  <label className="field wide"><span className="field-label">Description</span><textarea className="field-textarea" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Brief product description" disabled={loading} /></label>
                </div>

                <div>
                  <div className="section-title">About This Item</div>
                  <div className="about-add" style={{ marginTop: 9 }}>
                    <input className="field-input" value={aboutInput} onChange={(event) => setAboutInput(event.target.value)} placeholder="Complies with DIN 12249." disabled={loading} />
                    <button className="icon-btn" type="button" onClick={addAboutItem} disabled={loading} aria-label="Add item"><Plus size={16} /></button>
                  </div>
                  <div className="bullet-list">
                    {aboutItems.map((item, index) => (
                      <div className="bullet-row" key={`${item}-${index}`}>
                        <span className="bullet-dot">&bull;</span>
                        <input className="field-input" value={item} onChange={(event) => setAboutItems((items) => items.map((old, itemIndex) => itemIndex === index ? event.target.value : old))} disabled={loading} />
                        <button className="icon-btn" type="button" onClick={() => setAboutItems((items) => items.filter((_, itemIndex) => itemIndex !== index))} disabled={loading} aria-label="Remove item"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <aside className="summary-card">
                <p className="summary-label">{variants.length > 1 ? 'Starting from' : 'Price'}</p>
                <p className="summary-price">{money(selectedPackPrice)}</p>
                <div style={{ marginTop: 14 }}>
                  <div className="summary-line"><span>Pack of</span><span>{selectedPack} Pcs.</span></div>
                  <div className="summary-line"><span>Price per unit</span><span>{money(selectedUnitPrice)}</span></div>
                  <div className="summary-line"><span>Availability</span><span className={availability === 'Out of Stock' ? 'stock-out' : 'stock-ok'}>{availability}</span></div>
                  <div className="summary-line"><span>Variants</span><span>{variantLabels.length || 1}</span></div>
                </div>
              </aside>
            </div>

            <section className="variant-section">
              <div className="section-head">
                <div>
                  <div className="section-title">Select Variant</div>
                  <div className="variant-buttons" style={{ marginTop: 9 }}>
                    {variantLabels.length ? variantLabels.map((item) => <button key={item.id} type="button" className={`variant-btn ${selectedVariant?.id === item.id ? 'active' : ''}`} onClick={() => setSelectedVariantId(item.id)}>{item.label}</button>) : <span className="category-badge">Add catalogue numbers below</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button className="small-btn" type="button" onClick={addColumn} disabled={loading}><Plus size={14} /> Add Column</button>
                  <button className="small-btn" type="button" onClick={addVariant} disabled={loading}><Plus size={14} /> Add Variant</button>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="drag-col" />
                      {columns.map((column) => (
                        <th
                          key={column.id}
                          onDragEnter={(event) => { event.preventDefault(); if (column.id !== dragColId) setDragOverColId(column.id) }}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => { event.preventDefault(); reorderColumn(dragColId, column.id); setDragColId(null); setDragOverColId(null) }}
                          className={`col-header ${column.id === dragColId ? 'is-dragging' : ''} ${column.id === dragOverColId ? 'is-drag-over' : ''}`}
                        >
                          <span className="col-header-inner">
                            <span
                              className="col-grip"
                              draggable={!loading}
                              onDragStart={(event) => { setDragColId(column.id); event.dataTransfer.effectAllowed = 'move' }}
                              onDragEnd={() => { setDragColId(null); setDragOverColId(null) }}
                              aria-label={`Drag to reorder ${column.title} column`}
                            >
                              <GripVertical size={12} />
                            </span>
                            {column.locked ? column.title : <>
                              <input className="column-input" value={column.title} onChange={(event) => setColumns((items) => items.map((item) => item.id === column.id ? { ...item, title: event.target.value } : item))} disabled={loading} />
                              <button className="icon-btn" type="button" onClick={() => removeColumn(column.id)} disabled={loading} aria-label={`Remove ${column.title} column`}><X size={13} /></button>
                            </>}
                          </span>
                        </th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {variants.map((row) => (
                      <tr
                        key={row.id}
                        draggable={!loading}
                        onDragStart={(event) => { setDragRowId(row.id); event.dataTransfer.effectAllowed = 'move' }}
                        onDragEnter={(event) => { event.preventDefault(); if (row.id !== dragRowId) setDragOverRowId(row.id) }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => { event.preventDefault(); reorderVariant(dragRowId, row.id); setDragRowId(null); setDragOverRowId(null) }}
                        onDragEnd={() => { setDragRowId(null); setDragOverRowId(null) }}
                        className={`variant-row ${row.id === dragRowId ? 'is-dragging' : ''} ${row.id === dragOverRowId ? 'is-drag-over' : ''}`}
                      >
                        <td className="drag-handle-cell">
                          <span className="drag-handle" aria-label="Drag to reorder variant">
                            <GripVertical size={15} />
                          </span>
                        </td>
                        {columns.map((column) => (
                          <td key={column.id}>
                            {column.kind === 'catalogue' ? (
                              <div className="catalogue-cell">{row.values.catalogueNumber}</div>
                            ) : column.kind === 'packPrice' ? (
                              <div className="catalogue-cell" title="Auto-calculated: Price / Unit × Pack Size">
                                {row.values.packPrice ? money(num(row.values.packPrice)) : 'On request'}
                              </div>
                            ) : column.kind === 'availability' ? (
                              <select className="table-input" value={row.values[column.id] || 'In Stock'} onChange={(event) => updateRow(row.id, column.id, event.target.value)} disabled={loading}>
                                <option>In Stock</option>
                                <option>Out of Stock</option>
                                <option>On Request</option>
                              </select>
                            ) : (
                              <input
                                className="table-input"
                                value={row.values[column.id] || ''}
                                onChange={(event) => updateRow(row.id, column.id, event.target.value)}
                                placeholder={column.kind === 'pack' ? '10' : column.kind === 'unitPrice' ? '94' : column.title}
                                disabled={loading}
                              />
                            )}
                          </td>
                        ))}
                        <td><button className="icon-btn" type="button" onClick={() => removeVariant(row.id)} disabled={loading || variants.length === 1} aria-label="Remove variant"><Trash2 size={14} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="actions">
              <button className="btn-reset" type="button" onClick={resetForm} disabled={loading}>Reset</button>
              <button className="btn-submit" type="submit" disabled={loading}>{loading ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Saving...</> : <><Package size={15} /> {editingProductId ? 'Update Product' : 'Add Product'}</>}</button>
            </div>
          </form>
        </main>
      </div>
    </>
  )
}