'use client'

import { useProductSearch } from '@/hooks/useProductSearch'
import { Search, Loader2, AlertCircle, ChevronRight, Badge } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

interface ProductSearchProps {
  onSelect?: (product: unknown) => void
  maxResults?: number
  showVariants?: boolean
  category?: string
}

export default function ProductSearch({
  onSelect,
  maxResults = 10,
  showVariants: _showVariants = true,
  category,
}: ProductSearchProps) {
  const { results, isLoading, isError, query, debouncedSearch, clear } =
    useProductSearch({
      debounceMs: 300,
      minChars: 1,
      limit: maxResults,
      category,
    })

  const [focused, setFocused] = useState(false)

  const displayResults = results.slice(0, maxResults)

  const matchTypeColors: Record<string, string> = {
    exact_sku: 'bg-red-100 text-red-700',
    partial_sku: 'bg-orange-100 text-orange-700',
    name: 'bg-blue-100 text-blue-700',
    specs: 'bg-purple-100 text-purple-700',
    semantic: 'bg-green-100 text-green-700',
  }

  const matchTypeLabels: Record<string, string> = {
    exact_sku: 'Exact SKU',
    partial_sku: 'SKU Match',
    name: 'Name',
    specs: 'Specs',
    semantic: 'Semantic',
  }

  return (
    <div className="w-full">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Search by SKU, name, or specs... (e.g., '1/4', 'burette', '25 mL')"
          value={query}
          onChange={(e) => debouncedSearch(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition"
        />
        {query && (
          <button
            onClick={clear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
            aria-label="Clear search"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {focused && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-96 overflow-y-auto">
          {/* Loading */}
          {isLoading && (
            <div className="px-4 py-8 flex items-center justify-center gap-2 text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Searching...
            </div>
          )}

          {/* Error */}
          {isError && (
            <div className="px-4 py-4 flex items-center gap-2 text-red-600 bg-red-50 m-2 rounded">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="text-sm">Search failed. Try again.</span>
            </div>
          )}

          {/* No results */}
          {!isLoading && !isError && displayResults.length === 0 && query && (
            <div className="px-4 py-6 text-center text-gray-500 text-sm">
              No products found for &ldquo;{query}&rdquo;
            </div>
          )}

          {/* Results */}
          {!isLoading &&
            !isError &&
            displayResults.map((result, idx) => {
              const product = result.fullProduct
              const isVariant = result.id !== product.id

              return (
                <button
                  key={`${result.id}-${idx}`}
                  onClick={() => {
                    if (onSelect) onSelect(product)
                  }}
                  className="w-full px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 text-left transition flex items-start justify-between gap-3 group"
                >
                  <div className="flex-1 min-w-0">
                    {/* SKU + Name */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-mono text-xs font-semibold text-brand-600">
                        {result.sku}
                      </span>
                      <Badge
                        className={`text-xs font-medium px-2 py-0.5 rounded ${
                          matchTypeColors[result.matchType] || matchTypeColors.semantic
                        }`}
                      >
                        {matchTypeLabels[result.matchType]}
                      </Badge>
                      {result.relevance > 0 && (
                        <span className="text-xs text-gray-500">({result.relevance}%)</span>
                      )}
                    </div>

                    {/* Product Name */}
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {result.name}
                    </p>

                    {/* Specs */}
                    {product.specsText && (
                      <p className="text-xs text-gray-600 truncate mt-1">
                        {product.specsText}
                      </p>
                    )}

                    {/* Variant indicator */}
                    {isVariant && (
                      <p className="text-xs text-gray-500 mt-1">
                        Variant of: <span className="font-medium">{product.name}</span>
                      </p>
                    )}
                  </div>

                  {/* Chevron */}
                  <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 shrink-0 mt-1" />
                </button>
              )
            })}

          {/* Show more link */}
          {displayResults.length > 0 && results.length > displayResults.length && (
            <Link
              href={`/search?q=${encodeURIComponent(query)}`}
              className="block px-4 py-3 text-center text-sm text-brand-600 hover:bg-brand-50 border-t border-gray-100 font-medium"
            >
              Show all {results.length} results →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
