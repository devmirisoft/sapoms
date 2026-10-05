import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { requireAuth, type AuthActor } from "@/server/auth/session";
import { MODEL } from "@/lib/agent/llm";
import { runAgent } from "@/lib/agent/loop";
import { buildInternalPrompt, buildSystemPrompt } from "@/lib/agent/prompt";
import { beginAgentRequest, finishAgentRequest } from "@/lib/agent/rateLimit";
import { dealerTools } from "@/lib/agent/tools";
import { internalTools } from "@/lib/agent/internalTools";
import { buildScope, financialYearStart } from "@/lib/agent/internalScope";
import type { AgentLog, ChatMessage } from "@/lib/agent/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.string().trim().min(1).max(2000) })).min(1).max(20),
  // Goes into the system prompt, so only a plain path is accepted.
  currentPage: z.string().max(200).regex(/^\/[\w\-./%]*$/).catch("/"),
});

function error(status: number, code: string, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ error: code, message }, { status, headers });
}

/** Dealers get the ordering assistant; every other role the read-only reporting one, scoped to what that role sees. */
async function respond(actor: AuthActor, messages: ChatMessage[], currentPage: string, log: AgentLog) {
  if (actor.role === "DEALER" && actor.dealerId) {
    return runAgent({
      messages,
      systemPrompt: buildSystemPrompt({ dealerName: actor.displayName, currentPage }),
      tools: dealerTools,
      ctx: { dealerId: actor.dealerId },
      log,
    });
  }
  const scope = await buildScope(actor);
  const tools = internalTools(scope);
  return runAgent({
    messages,
    systemPrompt: buildInternalPrompt({
      name: actor.displayName,
      roleLabel: scope.roleLabel,
      scopeDescription: scope.description,
      financialYearStart: financialYearStart(),
      currentPage,
      hasTarget: "sales_target" in tools.handlers,
    }),
    tools,
    ctx: scope,
    log,
  });
}

export async function POST(request: NextRequest) {
  let actor: AuthActor;
  try { actor = await requireAuth(); } catch { return error(401, "UNAUTHENTICATED", "Please sign in again."); }
  if (actor.role === "DEALER" && !actor.dealerId) return error(403, "FORBIDDEN", "This account has no dealer profile.");

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error(400, "INVALID_REQUEST", "Messages must be 1-20 items of at most 2,000 characters.");
  // Only plain user/assistant text is accepted, so a client cannot inject system or tool messages.
  const messages = parsed.data.messages.filter((m): m is ChatMessage => m.role === "user" || m.role === "assistant");
  if (messages.at(-1)?.role !== "user") return error(400, "INVALID_REQUEST", "The last message must be from the user.");

  const slot = await beginAgentRequest(actor.userId, actor.dealerId);
  if (!slot.ok) {
    return slot.reason === "busy"
      ? error(409, "BUSY", "I'm still working on your previous message.")
      : error(429, "RATE_LIMITED", "You're sending messages too quickly. Please wait a minute.", { "Retry-After": "60" });
  }

  const started = Date.now();
  const log: AgentLog = { promptTokens: 0, completionTokens: 0, toolCalls: [] };
  try {
    const { reply, draft, downloads } = await respond(actor, messages, parsed.data.currentPage, log);
    return NextResponse.json({ reply, ...(draft ? { draft } : {}), ...(downloads.length ? { downloads } : {}) });
  } catch (err) {
    log.error = err instanceof OpenAI.APIError ? `LLM_${err.status ?? "CONNECTION"}: ${err.message}` : err instanceof Error ? err.message : String(err);
    console.error("[POST /api/agent]", log.error);
    return error(502, "AGENT_UNAVAILABLE", "The assistant is unavailable right now. Please try again in a moment.");
  } finally {
    const entry = { ...log, model: MODEL, latencyMs: Date.now() - started };
    // The agent_requests row is the durable log (and the audit trail of what data was read); dev also gets it on the console.
    if (process.env.NODE_ENV !== "production") {
      console.info(`[agent] request=${slot.id} user=${actor.userId} ${actor.role} ${entry.model} ${entry.latencyMs}ms tokens=${entry.promptTokens}+${entry.completionTokens} tools=${entry.toolCalls.map((t) => `${t.name}${t.error ? `(${t.error})` : ""}`).join(",") || "-"}${entry.error ? ` error=${entry.error}` : ""}`);
    }
    await finishAgentRequest(slot.id, entry).catch((err) => console.error("[POST /api/agent] could not release the user's slot", err));
  }
}
