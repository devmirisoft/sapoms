import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import type { AgentLog } from "./types";

// Longer than the route's maxDuration, so only a turn whose function died mid-way is ever stale.
const STALE_MS = 90_000;
const limitPerMinute = () => Number(process.env.AGENT_RATE_LIMIT_PER_MIN) || 15;

/**
 * Claims the user's single in-flight slot. Both checks live in Postgres, so they hold
 * across every serverless instance: the unique in_flight_user_id makes a second
 * concurrent turn fail to insert, and the rate limit counts this user's recent rows.
 */
export async function beginAgentRequest(userId: bigint, dealerId?: bigint): Promise<{ ok: true; id: bigint } | { ok: false; reason: "busy" | "rate_limited" }> {
  const now = Date.now();
  await prisma.agentRequest.updateMany({
    where: { inFlightUserId: userId, startedAt: { lt: new Date(now - STALE_MS) } },
    data: { inFlightUserId: null, finishedAt: new Date(), error: "STALE" },
  });

  const recent = await prisma.agentRequest.count({ where: { userId, startedAt: { gte: new Date(now - 60_000) } } });
  if (recent >= limitPerMinute()) return { ok: false, reason: "rate_limited" };

  try {
    const row = await prisma.agentRequest.create({ data: { userId, dealerId: dealerId ?? null, inFlightUserId: userId }, select: { id: true } });
    return { ok: true, id: row.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false, reason: "busy" };
    throw error;
  }
}

/** Releases the slot and records the turn's log on the same row. */
export async function finishAgentRequest(id: bigint, entry: AgentLog & { model: string; latencyMs: number }) {
  await prisma.agentRequest.update({
    where: { id },
    data: {
      inFlightUserId: null,
      finishedAt: new Date(),
      model: entry.model,
      latencyMs: entry.latencyMs,
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
      toolCalls: entry.toolCalls,
      error: entry.error?.slice(0, 500) ?? null,
    },
  });
}
