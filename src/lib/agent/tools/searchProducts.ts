import "server-only";

import type OpenAI from "openai";
import { z } from "zod";
import productSearch from "@/lib/productSearch.js";
import type { CatalogueProduct, CatalogueVariant } from "@/lib/catalogue";
import { loadCatalogue } from "@/server/modules/products/catalogue";

export const schema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "search_products",
    description: "Search the catalogue by name, catalogue number or spec. Returns orderable variants (no prices).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "e.g. 'beaker 250 ml' or 'OM285-020'" },
        category: { type: "string", description: "Optional category name filter" },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
      required: ["query"],
    },
  },
};

export const argsSchema = z.object({
  query: z.string().trim().min(1).max(120),
  category: z.string().trim().max(80).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

function row(product: CatalogueProduct, variant: CatalogueVariant) {
  return {
    productId: variant.sku,
    name: product.name,
    specs: variant.specsText || undefined,
    packSize: Math.max(1, Number(variant.pack) || 1),
    inStock: variant.inStock !== false,
  };
}

export async function handler(args: z.infer<typeof argsSchema>) {
  const limit = args.limit ?? 10;
  const { searchable } = await loadCatalogue();
  const category = args.category?.toLowerCase();
  const pool = category
    ? searchable.filter((p) => [p.originalProduct.category, ...(p.originalProduct.categories ?? [])].some((c) => c?.toLowerCase().includes(category)))
    : searchable;

  // A match on a specific variant yields that variant; a product-level match yields its variants.
  const rows: ReturnType<typeof row>[] = [];
  for (const match of productSearch.getProductSuggestions(pool, args.query, { limit: 50 })) {
    const product = match.originalProduct as CatalogueProduct;
    const variants = match.matchedVariant ? [match.matchedVariant as CatalogueVariant] : product.variants ?? [];
    for (const variant of variants) rows.push(row(product, variant));
    if (rows.length > limit) break;
  }

  if (rows.length === 0) return { results: [], hasMore: false, message: "No products matched. Try fewer or different words." };
  return { results: rows.slice(0, limit), hasMore: rows.length > limit };
}
