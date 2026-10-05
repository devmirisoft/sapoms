import "server-only";

import type OpenAI from "openai";
import { z } from "zod";
import type { ToolContext } from "../types";
import { dealerDiscountPercent, findCatalogueItem, priceVariant } from "@/server/modules/products/catalogue";

export const schema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_product_details",
    description: "Specs, pack size, stock and this dealer's price for a productId from search_products. Quantities are ordered in packs.",
    parameters: {
      type: "object",
      properties: { productId: { type: "string" } },
      required: ["productId"],
    },
  },
};

export const argsSchema = z.object({ productId: z.string().trim().min(1).max(80) });

/** Without a dealer (internal users) it quotes the list price only. */
export async function handler(args: z.infer<typeof argsSchema>, ctx: Partial<ToolContext>) {
  const entry = await findCatalogueItem(args.productId);
  if (!entry) return { error: "PRODUCT_NOT_FOUND", message: `No product with id ${args.productId}. Use search_products.` };
  const { product, variant } = entry;

  // A product-level id: list its variants so the user can pick one to order.
  if (!variant) {
    const variants = product.variants ?? [];
    return {
      name: product.name,
      category: product.category,
      variants: variants.slice(0, 10).map((v) => ({ productId: v.sku, specs: v.specsText, packSize: Math.max(1, Number(v.pack) || 1), inStock: v.inStock !== false })),
      hasMore: variants.length > 10,
      note: "Pick a variant productId for price and ordering.",
    };
  }

  const pricing = priceVariant(product, variant, ctx.dealerId ? await dealerDiscountPercent(ctx.dealerId) : 0);
  return {
    productId: variant.sku,
    name: product.name,
    category: product.category,
    specs: variant.specsText || undefined,
    inStock: variant.inStock !== false,
    ...(!pricing
      ? { packSize: Math.max(1, Number(variant.pack) || 1), price: null, note: "No catalogue price; cannot be ordered here." }
      : ctx.dealerId
        ? { packSize: pricing.packSize, listPricePerPack: pricing.listPricePerPack, discountPercent: pricing.discountPercent, netPricePerPack: pricing.netPricePerPack }
        : { packSize: pricing.packSize, listPricePerPack: pricing.listPricePerPack }),
  };
}
