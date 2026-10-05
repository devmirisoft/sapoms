import "server-only";

import type OpenAI from "openai";
import { llm, MODEL } from "./llm";
import type { AgentLog, ChatMessage, Download, DraftSummary, ToolSet } from "./types";

const MAX_ITERATIONS = Number(process.env.AGENT_MAX_TOOL_ITERATIONS) || 6;
const MAX_HISTORY = Number(process.env.AGENT_MAX_HISTORY_MESSAGES) || 20;
const GAVE_UP = "I couldn't complete that. Please rephrase or break it into smaller steps.";
const EMPTY_REPLY = "Sorry, I didn't get an answer for that. Please try rephrasing.";

/** Never throws: every failure becomes a { error } result the model can explain. */
async function executeToolCall<Ctx>(tools: ToolSet<Ctx>, name: string, rawArgs: string, ctx: Ctx): Promise<unknown> {
  const tool = tools.handlers[name];
  if (!tool) return { error: "UNKNOWN_TOOL", message: `There is no tool named ${name}.` };

  let json: unknown;
  try { json = JSON.parse(rawArgs || "{}"); } catch { return { error: "INVALID_ARGS", message: "Arguments were not valid JSON." }; }
  const parsed = tool.argsSchema.safeParse(json);
  if (!parsed.success) return { error: "INVALID_ARGS", details: parsed.error.issues.map((issue) => `${issue.path.join(".") || "args"}: ${issue.message}`) };

  try {
    return await tool.handler(parsed.data, ctx);
  } catch (error) {
    console.error(`[agent] tool ${name} failed`, error);
    return { error: "INTERNAL_ERROR", message: "Something went wrong looking that up." };
  }
}

/** A tool's export link, only if it is a same-origin API path (the model never writes URLs). */
function downloadOf(result: unknown): Download | null {
  const download = result && typeof result === "object" ? (result as { download?: Download }).download : undefined;
  return download && typeof download.url === "string" && download.url.startsWith("/api/") && typeof download.label === "string" ? download : null;
}

export async function runAgent<Ctx>({ messages, systemPrompt, tools, ctx, log }: {
  messages: ChatMessage[];
  systemPrompt: string;
  tools: ToolSet<Ctx>;
  ctx: Ctx;
  log: AgentLog;
}): Promise<{ reply: string; draft?: DraftSummary; downloads: Download[] }> {
  const convo: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages.slice(-MAX_HISTORY),
  ];
  // The newest draft this turn produced; the UI renders it as the confirm card.
  let draft: DraftSummary | undefined;
  const downloads = new Map<string, Download>();
  const done = (reply: string) => ({ reply, draft, downloads: [...downloads.values()] });

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await llm.chat.completions.create({ model: MODEL, messages: convo, tools: tools.schemas, tool_choice: "auto", temperature: 0.2 });
    log.promptTokens += res.usage?.prompt_tokens ?? 0;
    log.completionTokens += res.usage?.completion_tokens ?? 0;

    const message = res.choices[0]?.message;
    const calls = (message?.tool_calls ?? []).filter((call) => call.type === "function");
    // Models like typographic hyphens (OM285‑020) and non-breaking spaces; plain ones keep numbers and names copyable and searchable.
    if (calls.length === 0) return done(message?.content?.replace(/[\u2010-\u2013]/g, "-").replace(/[\u00A0\u2007\u202F]/g, " ").trim() || EMPTY_REPLY);

    // Echo back only standard fields: provider extras (e.g. reasoning) are not portable.
    convo.push({
      role: "assistant",
      content: message?.content ?? null,
      tool_calls: calls.map((call) => ({ id: call.id, type: "function", function: { name: call.function.name, arguments: call.function.arguments } })),
    });
    const results = await Promise.all(calls.map(async (call) => {
      const started = Date.now();
      const result = await executeToolCall(tools, call.function.name, call.function.arguments, ctx);
      const error = result && typeof result === "object" && "error" in result ? String(result.error) : undefined;
      log.toolCalls.push({ name: call.function.name, args: call.function.arguments.slice(0, 500), ms: Date.now() - started, ...(error ? { error } : {}) });
      if (call.function.name === "draft_order" && !error) draft = result as DraftSummary;
      const download = downloadOf(result);
      if (download) downloads.set(download.url, download);
      return { role: "tool" as const, tool_call_id: call.id, content: JSON.stringify(result) };
    }));
    convo.push(...results);
  }

  return done(GAVE_UP);
}
