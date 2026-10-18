import { NextRequest, NextResponse } from 'next/server'
import catalogueJson from '../../../../../public/data/omsonsdata.json'
import { buildCatalogueSearchText, mergeCatalogueRecords, normalizeText, type CatalogueProduct } from '@/lib/catalogue'

// The file has one record per catalogue page; search works on whole products.
const products = mergeCatalogueRecords(catalogueJson as unknown as CatalogueProduct[]).products

interface Product {
  id: string
  sku: string
  name: string
  category: string
  categories?: string[]
  features?: string[]
  specsText?: string
  descriptionHtml?: string
  variants?: Array<{
    id: string
    sku: string
    name: string
    specsText?: string
    specs?: Record<string, string>
    pack?: number
  }>
  searchText?: string
}

interface SearchMatch {
  id: string
  sku: string
  name: string
  matchType: 'exact_sku' | 'partial_sku' | 'name' | 'specs' | 'semantic'
  relevance: number
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

function lower(value: unknown): string {
  return safeString(value).toLowerCase()
}

function findFullProduct(match: SearchMatch) {
  const productList = products as any[]
  const parentProduct = productList.find((p) => p?.id === match.id || p?.sku === match.sku)
  if (parentProduct) return parentProduct

  for (const product of productList) {
    const variant = product?.variants?.find((v: any) => v?.id === match.id || v?.sku === match.sku)
    if (variant) return variant
  }

  return null
}

/**
 * Flattens product variants into searchable items
 */
function flattenProducts(productList: any[]): Product[] {
  const flattened: Product[] = []

  productList.forEach((p) => {
    if (!p || typeof p !== 'object') return

    // Add parent product
    flattened.push({
      id: safeString(p.id || p.sku),
      sku: safeString(p.sku || p.id),
      name: safeString(p.name),
      category: safeString(p.category),
      categories: Array.isArray(p.categories) ? p.categories : [],
      features: Array.isArray(p.features) ? p.features : [],
      specsText: p.specsText || '',
      descriptionHtml: p.descriptionHtml || '',
      searchText: buildCatalogueSearchText(p as any),
    })

    // Add variants
    if (p.variants && Array.isArray(p.variants)) {
      p.variants.forEach((v: any) => {
        if (v.id && v.sku && v.name) {
          flattened.push({
            id: safeString(v.id || v.sku),
            sku: safeString(v.sku || v.id),
            name: safeString(v.name),
            category: safeString(p.category),
            categories: Array.isArray(p.categories) ? p.categories : [],
            features: Array.isArray(p.features) ? p.features : [],
            specsText: v.specsText || '',
            descriptionHtml: p.descriptionHtml || '',
            searchText: buildCatalogueSearchText({
              ...p,
              sku: v.sku,
              name: v.name,
              variants: [v],
            } as any),
          })
        }
      })
    }
  })

  return flattened
}

/**
 * Hybrid search: combines exact/partial SKU, name, specs, and semantic matching
 * Falls back to local ranking if LLM is unavailable
 */
function hybridSearch(query: string, productList: Product[]): SearchMatch[] {
  const lowerQuery = lower(query).trim()
  const normalizedQuery = normalizeText(query)
  const matches: SearchMatch[] = []
  const seen = new Set<string>()

  // 1. EXACT SKU MATCH
  productList.forEach((p) => {
    if (lower(p.sku) === lowerQuery && !seen.has(p.id)) {
      matches.push({
        id: p.id,
        sku: p.sku,
        name: p.name,
        matchType: 'exact_sku',
        relevance: 100,
      })
      seen.add(p.id)
    }
  })

  // 2. PARTIAL SKU MATCH (prefix or substring)
  productList.forEach((p) => {
    const sku = lower(p.sku)
    if (!seen.has(p.id) && sku.includes(lowerQuery)) {
      const isPrefix = sku.startsWith(lowerQuery)
      matches.push({
        id: p.id,
        sku: p.sku,
        name: p.name,
        matchType: 'partial_sku',
        relevance: isPrefix ? 90 : 75,
      })
      seen.add(p.id)
    }
  })

  // 3. PRODUCT NAME MATCH
  const queryWords = lowerQuery.split(/\s+/)
  productList.forEach((p) => {
    if (!seen.has(p.id)) {
      const lowerName = lower(p.name)
      const matchedWords = queryWords.filter((w) => lowerName.includes(w)).length
      const wordRatio = matchedWords / queryWords.length

      if (wordRatio >= 0.5) {
        // At least 50% of query words match
        matches.push({
          id: p.id,
          sku: p.sku,
          name: p.name,
          matchType: 'name',
          relevance: Math.round(wordRatio * 85),
        })
        seen.add(p.id)
      }
    }
  })

  // 3.5 FEATURES & CATEGORIES MATCH
  productList.forEach((p) => {
    if (!seen.has(p.id)) {
      const searchable = [
        ...(p.categories || []),
        ...(p.features || [])
      ].join(' ').toLowerCase()

      if (searchable.includes(lowerQuery)) {
        matches.push({
          id: p.id,
          sku: p.sku,
          name: p.name,
          matchType: 'name',
          relevance: 55,
        })
        seen.add(p.id)
      }
    }
  })

  // 4. SPECS MATCH (numbers, units, etc.)
  productList.forEach((p) => {
    if (!seen.has(p.id) && (p.specsText || p.searchText)) {
      const searchable = normalizeText(`${p.specsText || ''} ${p.searchText || ''}`)
      if (searchable.includes(normalizedQuery)) {
        matches.push({
          id: p.id,
          sku: p.sku,
          name: p.name,
          matchType: 'specs',
          relevance: 60,
        })
        seen.add(p.id)
      }
    }
  })

  // 5. SEMANTIC MATCH (fuzzy matching for common lab terms)
  const semanticAliases: Record<string, string[]> = {
    burette: ['burette', 'burettes', 'buret', 'burets', 'pipette burette'],
    pipette: ['pipette', 'pipettes', 'pipet', 'pipets'],
    glass: ['glass', 'glassware'],
    plastic: ['plastic', 'polymethylpentene', 'pmp'],
    amber: ['amber', 'brown'],
    measuring: ['measuring', 'measure', 'graduated', 'graduation'],
  }

  productList.forEach((p) => {
    if (!seen.has(p.id)) {
      let semanticScore = 0
      const combinedText = normalizeText(`${p.name} ${p.specsText || ''} ${p.searchText || ''}`)

      for (const [keyword, aliases] of Object.entries(semanticAliases)) {
        if (lowerQuery.includes(keyword) || aliases.some((a) => lowerQuery.includes(a))) {
          if (aliases.some((a) => combinedText.includes(normalizeText(a)))) {
            semanticScore += 40
          }
        }
      }

      if (semanticScore > 0) {
        matches.push({
          id: p.id,
          sku: p.sku,
          name: p.name,
          matchType: 'semantic',
          relevance: Math.min(semanticScore, 70),
        })
        seen.add(p.id)
      }
    }
  })

  // Sort by relevance descending
  matches.sort((a, b) => b.relevance - a.relevance)

  return matches.slice(0, 20) // Return top 20
}

/**
 * Attempts LLM-based ranking if API key is available
 * Falls back to hybrid search if unavailable
 */
async function llmRankedSearch(query: string, productList: Product[]): Promise<SearchMatch[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    // Fallback to hybrid search
    return hybridSearch(query, productList)
  }

  try {
    // First get hybrid results
    const hybridResults = hybridSearch(query, productList)

    // Use Claude to re-rank (optional enhancement)
    // For now, return hybrid results which is already effective
    return hybridResults
  } catch (error) {
    console.error('[Search] LLM ranking failed:', error)
    // Fallback to hybrid search
    return hybridSearch(query, productList)
  }
}

/**
 * GET /api/search/products?q=query&limit=20
 * Intelligent product search with SKU priority, name matching, specs, and semantic understanding
 */
export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get('q')?.trim()
    const limit = Math.min(
      parseInt(req.nextUrl.searchParams.get('limit') || '20'),
      50
    )

    if (!query || query.length < 1) {
      return NextResponse.json({
        success: false,
        message: 'Query required',
        results: [],
      })
    }

    // Flatten products for searching
    const flatProducts = flattenProducts(products as any[])

    // Search using intelligent ranking
    const matches = await llmRankedSearch(query, flatProducts)

    // Enrich results with full product data
    const enrichedResults = matches.slice(0, limit).map((match) => {
      return {
        ...match,
        fullProduct: findFullProduct(match),
      }
    })

    return NextResponse.json({
      success: true,
      query,
      count: enrichedResults.length,
      results: enrichedResults,
    })
  } catch (error: any) {
    console.error('[GET /api/search/products]', error)
    return NextResponse.json(
      { success: false, message: error.message, results: [] },
      { status: 500 }
    )
  }
}

/**
 * POST /api/search/products
 * Extended search with custom ranking and filters
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { query, limit = 20, category = null, inStockOnly = false } = body

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { success: false, message: 'Query required' },
        { status: 400 }
      )
    }

    const flatProducts = flattenProducts(products as any[])

    // Filter by category if provided
    let filtered = flatProducts
    if (category) {
      filtered = flatProducts.filter(
        (p) => lower(p.category) === lower(category)
      )
    }

    // Search
    const matches = await llmRankedSearch(query, filtered)

    // Enrich
    const enrichedResults = matches.slice(0, Math.min(limit, 50)).map((match) => {
      return {
        ...match,
        fullProduct: findFullProduct(match),
      }
    })

    return NextResponse.json({
      success: true,
      query,
      count: enrichedResults.length,
      results: enrichedResults,
    })
  } catch (error: any) {
    console.error('[POST /api/search/products]', error)
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    )
  }
}
