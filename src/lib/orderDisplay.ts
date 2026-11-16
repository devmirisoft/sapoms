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

/**
 * The Order No. filter as an ILIKE pattern on ltrim(legacy_php_id, '0'), plus the bare number for the exact-id match.
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

function resolveFinancialYearRange(orderDate?: unknown) {
  const yearMatch = String(orderDate ?? '').match(/\b(20\d{2})\b/)
  const year = Number(yearMatch ? yearMatch[1] : new Date().getFullYear())
  return `${String(year).slice(-2)}-${String(year + 1).slice(-2)}`
}
