"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Download, DraftSummary } from "@/lib/agent/types";

export type DraftOutcome = { kind: "placed" | "requested" | "cancelled"; text: string };
export type ChatMessage = { role: "user" | "assistant"; content: string; draft?: DraftSummary; outcome?: DraftOutcome; downloads?: Download[] };

// Mirrors the /api/agent limits: at most 20 messages of 2,000 characters each.
const MAX_SENT = 20;
const MAX_CHARS = 2000;

function isChatMessage(value: unknown): value is ChatMessage {
  const m = value as ChatMessage;
  return Boolean(m) && (m.role === "user" || m.role === "assistant") && typeof m.content === "string";
}

function loadMessages(storageKey: string): ChatMessage[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isChatMessage) : [];
  } catch {
    return [];
  }
}

/** Chat state for one dealer, kept in sessionStorage so a refresh doesn't wipe it. */
export function useAgentChat(storageKey: string, currentPage: string) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(storageKey));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Synchronous guard: a double Enter must not send twice before the re-render disables input.
  const inFlight = useRef(false);

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-50))); } catch { /* storage unavailable */ }
  }, [storageKey, messages]);

  /** Resolves false when the message was not delivered, so the caller can restore the input. */
  const send = useCallback(async (text: string) => {
    const content = text.trim().slice(0, MAX_CHARS);
    if (!content || inFlight.current) return false;
    inFlight.current = true;
    setIsLoading(true);
    setError(null);

    const userMessage: ChatMessage = { role: "user", content };
    // Functional updates throughout: a confirm-card click while this is in flight must not be overwritten.
    setMessages((prev) => [...prev, userMessage]);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        signal: AbortSignal.timeout(75_000),
        body: JSON.stringify({
          // Long assistant replies are clipped so the history always passes the server's limits.
          messages: [...messages, userMessage].slice(-MAX_SENT).map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) })),
          currentPage,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.reply !== "string") throw new Error(data.message || "Something went wrong. Please try again.");
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: data.reply,
        ...(data.draft ? { draft: data.draft } : {}),
        ...(Array.isArray(data.downloads) ? { downloads: data.downloads } : {}),
      }]);
      return true;
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m !== userMessage));
      setError(err instanceof Error && err.name === "TimeoutError" ? "That took too long. Please try again." : err instanceof Error ? err.message : "Something went wrong. Please try again.");
      return false;
    } finally {
      inFlight.current = false;
      setIsLoading(false);
    }
  }, [messages, currentPage]);

  /** Records a confirm-card result (or a re-priced draft) on the message that carries it. */
  const updateDraft = useCallback((draftId: string, patch: Pick<ChatMessage, "draft" | "outcome">) => {
    setMessages((prev) => prev.map((m) => (m.draft?.draftId === draftId ? { ...m, ...patch } : m)));
  }, []);

  /** A short assistant-side note (e.g. "Order placed"), also sent as history so the model knows. */
  const addNotice = useCallback((content: string) => {
    setMessages((prev) => [...prev, { role: "assistant", content }]);
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, isLoading, error, send, updateDraft, addNotice, clear };
}
