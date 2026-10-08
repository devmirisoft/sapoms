'use client'

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FaMagnifyingGlass } from "react-icons/fa6";
import { SIDEBAR_CATEGORIES, compactCategoryList, matchesCategory } from "@/lib/categories";
import { useCatalogueProducts } from "@/hooks/useCatalogueProducts";
import productSearch from "@/lib/productSearch.js";
import type { CatalogueProduct } from "@/lib/catalogue";

const { DEFAULT_SUGGESTION_LIMIT, getSearchQueryInfo, normalizeProductForSearch } = productSearch;

type HeaderSearchMatch = {
  productName: string;
  catalogueNumber: string;
  categoryName: string;
  previewText: string;
  image: string;
  route: string;
  originalProduct: CatalogueProduct;
};

type HeaderSearchControlProps = {
  selectedCategory: string;
  onCategoryChange: (value: string) => void;
  onSubmitSearch: (query: string) => void;
  onSelectSuggestion: (suggestion: HeaderSearchMatch) => void;
};

function categoryMatchesSelection(product: CatalogueProduct, selectedCategory: string): boolean {
  if (!selectedCategory || selectedCategory === "all") return true;

  return matchesCategory(compactCategoryList([product.category, ...(product.categories ?? [])]), selectedCategory);
}

export default function HeaderSearchControl({
  selectedCategory,
  onCategoryChange,
  onSubmitSearch,
  onSelectSuggestion,
}: HeaderSearchControlProps) {
  const { products, loading, error } = useCatalogueProducts();
  const listboxId = useId();
  const helperId = `${listboxId}-helper`;
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [usedKeyboardNavigation, setUsedKeyboardNavigation] = useState(false);

  const normalizedCatalogue = useMemo(
    () => products.map((product) => normalizeProductForSearch(product)) as never[],
    [products]
  );

  const queryInfo = useMemo(() => getSearchQueryInfo(query), [query]);

  const suggestions = useMemo(() => {
    if (queryInfo.meaningfulCharacterCount < 2) return [];

    const scopedProducts = selectedCategory === "all"
      ? normalizedCatalogue
      : normalizedCatalogue.filter((product) =>
          categoryMatchesSelection((product as { originalProduct: CatalogueProduct }).originalProduct, selectedCategory)
        );

    return productSearch.getProductSuggestions(scopedProducts, queryInfo.normalizedQuery, {
      limit: DEFAULT_SUGGESTION_LIMIT,
    }) as HeaderSearchMatch[];
  }, [normalizedCatalogue, queryInfo.meaningfulCharacterCount, queryInfo.normalizedQuery, selectedCategory]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!searchRef.current?.contains(event.target as Node)) {
        setIsFocused(false);
        setActiveIndex(-1);
        setUsedKeyboardNavigation(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const isOpen =
    isFocused &&
    queryInfo.meaningfulCharacterCount >= 2 &&
    (loading || suggestions.length > 0 || Boolean(queryInfo.normalizedQuery));
  const activeSuggestionId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;
  const showNoMatches = !loading && !error && queryInfo.meaningfulCharacterCount >= 2 && suggestions.length === 0;

  const commitSearch = () => {
    if (!queryInfo.normalizedQuery) return;
    setIsFocused(false);
    setActiveIndex(-1);
    setUsedKeyboardNavigation(false);
    onSubmitSearch(queryInfo.normalizedQuery);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setIsFocused(false);
      setActiveIndex(-1);
      setUsedKeyboardNavigation(false);
      return;
    }

    if (event.key === "ArrowDown") {
      if (!suggestions.length) return;
      event.preventDefault();
      setIsFocused(true);
      setUsedKeyboardNavigation(true);
      setActiveIndex((currentIndex) => Math.min(currentIndex + 1, suggestions.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      if (!suggestions.length) return;
      event.preventDefault();
      setIsFocused(true);
      setUsedKeyboardNavigation(true);
      setActiveIndex((currentIndex) => Math.max(currentIndex - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      if (usedKeyboardNavigation && activeIndex >= 0 && suggestions[activeIndex]) {
        onSelectSuggestion(suggestions[activeIndex]);
        setIsFocused(false);
        setActiveIndex(-1);
        setUsedKeyboardNavigation(false);
        return;
      }

      commitSearch();
    }
  };

  return (
    <div ref={searchRef} className="flex flex-1 h-10 rounded-md overflow-visible relative">
      <select
        className={`bg-[#f3f3f3] text-black text-sm px-2 border-r border-gray-300 rounded-l-md focus:ring-1 focus:ring-yellow-400 focus:border-yellow-400 ${
          selectedCategory === "all" ? "w-16" : "w-32"
        }`}
        value={selectedCategory}
        onChange={(event) => onCategoryChange(event.target.value)}
        suppressHydrationWarning
        aria-label="Filter header suggestions by category"
      >
        <option value="all">All</option>
        {Object.keys(SIDEBAR_CATEGORIES)
          .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
          .map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
      </select>

      <form
        className="flex flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          commitSearch();
        }}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={activeSuggestionId}
          aria-describedby={queryInfo.hasOverflowKeywords ? helperId : undefined}
          placeholder="Search by name, SKU, category, or specs..."
          className="flex-1 px-3 text-black text-sm outline-none bg-white"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
            setUsedKeyboardNavigation(false);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setIsFocused(true);
            if (queryInfo.meaningfulCharacterCount >= 2) {
              setActiveIndex(-1);
            }
          }}
          autoComplete="off"
          suppressHydrationWarning
        />

        <button
          type="submit"
          className="bg-[#E5E7EB] hover:bg-[#bbbcbe] px-4 flex items-center justify-center rounded-r-md duration-300"
          suppressHydrationWarning
          aria-label="Open full search results"
        >
          <FaMagnifyingGlass className="text-black font-bold" />
        </button>
      </form>

      {queryInfo.hasOverflowKeywords && (
        <div
          id={helperId}
          className="absolute left-2 top-[calc(100%+6px)] z-[10000] rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 shadow-sm"
        >
          Only the first 3 keywords will be used.
        </div>
      )}

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Product suggestions"
          style={{
            position: "absolute",
            top: "calc(100% + 28px)",
            left: 0,
            right: 0,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
            zIndex: 9999,
            overflow: "hidden",
            maxHeight: "min(32rem, 70vh)",
            overflowY: "auto",
          }}
        >
          {loading && (
            <div className="px-4 py-3 text-sm text-slate-600">Loading products...</div>
          )}

          {!loading && error && (
            <div className="px-4 py-3 text-sm text-red-700">Suggestions are unavailable right now.</div>
          )}

          {!loading &&
            !error &&
            suggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.route}-${suggestion.catalogueNumber}`}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelectSuggestion(suggestion);
                  setIsFocused(false);
                  setActiveIndex(-1);
                  setUsedKeyboardNavigation(false);
                }}
                className="flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-b-0"
                style={{ background: activeIndex === index ? "#f8fafc" : "#fff" }}
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                  {suggestion.image ? (
                    <img
                      src={suggestion.image}
                      alt={suggestion.productName}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <FaMagnifyingGlass className="text-slate-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">{suggestion.productName}</div>
                  <div className="mt-1 text-xs font-medium text-brand-600">{suggestion.catalogueNumber}</div>
                  {suggestion.previewText && (
                    <div className="mt-1 line-clamp-2 text-xs text-slate-600">{suggestion.previewText}</div>
                  )}
                  {suggestion.categoryName && (
                    <div className="mt-1 text-[11px] uppercase tracking-[0.08em] text-slate-500">
                      {suggestion.categoryName}
                    </div>
                  )}
                </div>
              </button>
            ))}

          {showNoMatches && (
            <div className="px-4 py-3 text-sm text-slate-600">No matching products</div>
          )}
        </div>
      )}
    </div>
  );
}
