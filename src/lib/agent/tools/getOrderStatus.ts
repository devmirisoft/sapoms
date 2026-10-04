import "server-only";

import type OpenAI from "openai";
import { z } from "zod";
import type { ToolContext } from "../types";
import { findOrderDetails } from "../orders";

export const schema: OpenAI.Chat.ChatCompletionTool = {
  type: "function",
  function: {
    name: "get_order_status",
    description: "Status, items, dispatch and tracking for one of this dealer's orders. Accepts the full order number (OM/26-27/DMS-029) or its last part (DMS-029 or 29).",
    parameters: {
      type: "object",
      properties: { orderId: { type: "string" } },
      required: ["orderId"],
    },
  },
};

export const argsSchema = z.object({ orderId: z.string().trim().min(1).max(60) });

export async function handler(args: z.infer<typeof argsSchema>, ctx: ToolContext) {
  // Always scoped to the session dealer: another dealer's order is simply "not found".
  return findOrderDetails({ dealerId: ctx.dealerId }, args.orderId);
}
