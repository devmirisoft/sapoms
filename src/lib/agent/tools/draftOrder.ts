import "server-only";

import type OpenAI from "openai";
import { z } from "zod";
import type { ToolContext } from "../types";
import { createDraft } from "../drafts";

export const schema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "draft_order",
    description: "Prices a DRAFT order and shows the dealer a confirm card. Does NOT place it: only the dealer's Confirm click does. Prices come from the server.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              productId: { type: "string", description: "Variant productId from search_products" },
              packs: { type: "integer", minimum: 1, description: "Number of packs" },
            },
            required: ["productId", "packs"],
          },
        },
        notes: { type: "string", description: "Optional note for the order" },
        customDiscount: {
          type: "object",
          description: "Only if the dealer asks for an extra discount. Give ONE of: percent (% off the amount after their normal discount) or amount (rupees off).",
          properties: { percent: { type: "number" }, amount: { type: "number" } },
        },
      },
      required: ["items"],
    },
  },
};

export const argsSchema = z.object({
  items: z.array(z.object({
    productId: z.string().trim().min(1).max(80),
    packs: z.number().int().min(1).max(10_000),
  })).min(1).max(50),
  notes: z.string().trim().max(500).optional(),
  customDiscount: z.object({
    percent: z.number().gt(0).lt(100).optional(),
    amount: z.number().gt(0).optional(),
  }).refine((d) => (d.percent === undefined) !== (d.amount === undefined), "Give exactly one of percent or amount").optional(),
});

export async function handler(args: z.infer<typeof argsSchema>, ctx: ToolContext) {
  return createDraft(ctx.dealerId, args.items, args.customDiscount ?? null, args.notes || null);
}
