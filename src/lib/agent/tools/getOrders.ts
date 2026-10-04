import "server-only";

import type OpenAI from "openai";
import { z } from "zod";
import type { ToolContext } from "../types";
import { listOrders, ORDER_STATUS_FILTERS, orderFilters } from "../orders";

export const schema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_orders",
    description: "This dealer's orders, newest first. Optional status and date range (YYYY-MM-DD, India time).",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: [...ORDER_STATUS_FILTERS] },
        fromDate: { type: "string", description: "YYYY-MM-DD" },
        toDate: { type: "string", description: "YYYY-MM-DD, inclusive" },
        limit: { type: "integer", minimum: 1, maximum: 10 },
      },
    },
  },
};

export const argsSchema = z.object({
  status: z.enum(ORDER_STATUS_FILTERS).optional(),
  fromDate: z.iso.date().optional(),
  toDate: z.iso.date().optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

export async function handler(args: z.infer<typeof argsSchema>, ctx: ToolContext) {
  return listOrders({ dealerId: ctx.dealerId, ...orderFilters(args) }, args.limit ?? 10);
}
