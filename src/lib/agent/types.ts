import "server-only";

import type OpenAI from "openai";
import type { z } from "zod";

/** Server-side context injected into every dealer tool. Never comes from the model. */
export type ToolContext = { dealerId: bigint };

export type Tool<Ctx> = {
  schema: OpenAI.Chat.ChatCompletionTool;
  argsSchema: z.ZodType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each tool narrows its own args after zod parsing
  handler: (args: any, ctx: Ctx) => Promise<unknown>;
};

/** The tools one kind of user gets: schemas sent to the model, handlers by name. */
export type ToolSet<Ctx> = { schemas: OpenAI.Chat.ChatCompletionTool[]; handlers: Record<string, Tool<Ctx>> };

export function toolSet<Ctx>(tools: Tool<Ctx>[]): ToolSet<Ctx> {
  return {
    schemas: tools.map((tool) => tool.schema),
    handlers: Object.fromEntries(tools.map((tool) => [(tool.schema as OpenAI.Chat.ChatCompletionFunctionTool).function.name, tool])),
  };
}

/** A server-built, same-origin export link a report tool offers (rendered as a button). */
export type Download = { label: string; url: string };

/** What a tool returns when it can't do the job; the model explains it to the user. */
export type ToolError = { error: string; message?: string };

/** The only message shapes the client may send: plain user/assistant text. */
export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ToolCallLog = { name: string; args: string; ms: number; error?: string };

/** A priced draft as the dealer sees it on the confirm card. All amounts in rupees, all computed server-side. */
export type DraftSummary = {
  draftId: string;
  expiresAt: string;
  items: Array<{ productId: string; name: string; packs: number; packSize: number; packPrice: number; lineTotal: number }>;
  subtotal: number;
  discountPercent: number;
  discount: number;
  slabDiscountPercent: number;
  slabDiscount: number;
  total: number;
  /** Present when the dealer asked for an extra discount: Confirm sends it for approval instead of ordering. */
  customDiscount?: { asked: string; totalPercent: number; extraDiscount: number; totalIfApproved: number; approvers: string };
  warnings: string[];
};

/** Filled in by the loop as it runs, so the route can record it even if the turn fails. */
export type AgentLog = { promptTokens: number; completionTokens: number; toolCalls: ToolCallLog[]; error?: string };
