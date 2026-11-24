export function formatDisplayOrderNumber(value: unknown, orderDate?: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''

  const existing = /^OM\/(\d{2}-\d{2})\/DMS-(.+)$/i.exec(raw)
  const yearRange = existing?.[1] || resolveFinancialYearRange(orderDate)
  const source = existing?.[2] || raw.split('/').pop()?.replace(/^DMS-/i, '') || raw
  const digits = source.replace(/\D/g, '')
  const sequence = (digits ? digits.replace(/^0+(?=\d)/, '') : source).padStart(3, '0')

  return `OM/${yearRange}/DMS-${sequence}`
}

type OrderRef = {
  order_number?: unknown; orderNumber?: unknown
  order_id?: unknown; orderId?: unknown; orderdata_orderid?: unknown; id?: unknown
  order_date?: unknown; orderDate?: unknown; orderdata_datetime?: unknown
}

/**
 * The number an order is known by: its saved order_number. App orders save
 * OM/<financial year>/DMS-<row id>; old PHP orders keep theirs (OM/2026/165) and are
 * shown as OM/<year of their own date>/DMS-165. order_id is only a fallback for rows
 * that don't carry order_number.
 */
export function displayOrderNumber(order: OrderRef | null | undefined) {
  const stored = String(order?.order_number ?? order?.orderNumber ?? '').trim()
  return formatDisplayOrderNumber(
    stored || order?.order_id || order?.orderId || order?.orderdata_orderid || order?.id,
    order?.order_date ?? order?.orderDate ?? order?.orderdata_datetime,
  )
}

/**
 * The Order No. filter as an ILIKE pattern on the number's trailing digits, plus the bare number.
 * The list shows numbers without leading zeros, padded to 3 digits, so match the same way: a padded "002" is complete
 * (order 2 exactly), a bare "2" is a prefix, and "0"/"00" (mid-typing) don't filter.
 */
export function orderNumberSearch(typed: string): { value: string; pattern: string } | null {
  const raw = typed.trim()
  const value = raw.replace(/^0+/, '')
  if (!value) return null
  const exact = value !== raw && raw.length >= 3
  return { value, pattern: value.replace(/[%_\\]/g, '\\$&') + (exact ? '' : '%') }
}

/** Highlights the matched slice of a cell against the active filter text. */
export function highlight(text: string, query: string) {
  if (!query || !text) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    text.slice(0, idx) +
    `<mark class="bg-brand-600 text-white rounded-sm px-0.5">${text.slice(idx, idx + query.length)}</mark>` +
    text.slice(idx + query.length)
  )
}

/** The displayed order number with the Order No. filter highlighted in its sequence part only. */
export function highlightOrderNumber(value: unknown, query: string) {
  return formatDisplayOrderNumber(value).replace(/[^-]*$/, (seq) => highlight(seq, query.trim().replace(/^0+/, '')))
}

const IST_OFFSET_MS = 330 * 60 * 1000

function yearPair(startYear: number) {
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`
}

/** The financial year (April to March, in IST) a moment falls in: "26-27" for 1 Apr 2026 - 31 Mar 2027. */
export function financialYearLabel(date: Date = new Date()) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS)
  return yearPair(ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1)
}

// A date gives its own financial year, so a number never changes once shown. A bare
// year (or an unparseable text holding one) keeps the old "year-year+1" label; nothing
// at all means today.
function resolveFinancialYearRange(orderDate?: unknown) {
  const text = orderDate instanceof Date ? '' : String(orderDate ?? '').trim()
  if (/^\d{4}$/.test(text)) return yearPair(Number(text))
  const parsed = orderDate instanceof Date ? orderDate : text ? new Date(text) : null
  if (parsed && !Number.isNaN(parsed.getTime())) return financialYearLabel(parsed)
  const year = text.match(/\b(20\d{2})\b/)?.[1]
  return year ? yearPair(Number(year)) : financialYearLabel()
}
