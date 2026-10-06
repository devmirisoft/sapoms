"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_TERMS_BLOCKS, TermsDocument, type TermsBlock } from "@/components/terms/TermsDocument";

interface TermsModalProps {
  userId?: string;
  userName?: string;
  onAccepted: (acceptedAt: string) => void;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

async function postTermsAcceptance() {
  const send = () =>
    fetch("/api/terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      cache: "no-store",
    });

  let response = await send();
  if (response.status !== 401) return response;

  const refreshed = await refreshSession();
  if (!refreshed) return response;

  response = await send();
  return response;
}

export default function TermsModal({
  userId = "",
  userName = "Dealer",
  onAccepted,
}: TermsModalProps) {
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [isChecked, setIsChecked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<TermsBlock[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/terms/content", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setBlocks(Array.isArray(payload?.data) ? payload.data : DEFAULT_TERMS_BLOCKS))
      .catch(() => setBlocks(DEFAULT_TERMS_BLOCKS));
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !blocks) return;

    const handleScroll = () => {
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
      if (atBottom) setHasScrolledToBottom(true);
    };

    el.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => el.removeEventListener("scroll", handleScroll);
  }, [blocks]);

  const canAccept = hasScrolledToBottom && isChecked;

  async function handleAccept() {
    if (!canAccept) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await postTermsAcceptance();
      const payload = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(payload?.msg || payload?.message || "Failed to save agreement.");
      }

      onAccepted(String(payload?.data?.acceptedAt || new Date().toISOString()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/90 backdrop-blur-sm">
      <div className="relative mx-4 flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-8 pb-5 pt-8">
          <div className="mb-1 flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-900">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </span>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Terms &amp; Conditions</h1>
          </div>
          <p className="ml-12 text-sm text-slate-500">Dealer access is blocked until you read and accept the full document.</p>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-8 py-6 text-sm leading-relaxed text-slate-700">
          {blocks ? <TermsDocument blocks={blocks} /> : <p className="text-slate-400">Loading terms...</p>}

          {!hasScrolledToBottom && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-600">
              <svg className="h-4 w-4 shrink-0 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              Scroll to the bottom to enable acceptance
            </div>
          )}
        </div>

        <div className="space-y-4 border-t border-slate-100 bg-slate-50 px-8 py-5">
          <label
            className={`group flex cursor-pointer select-none items-start gap-3 ${!hasScrolledToBottom ? "pointer-events-none opacity-40" : ""}`}
          >
            <div className="relative mt-0.5">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(event) => setIsChecked(event.target.checked)}
                disabled={!hasScrolledToBottom}
                className="sr-only"
              />
              <div
                className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-all duration-150 ${
                  isChecked
                    ? "border-slate-900 bg-slate-900"
                    : "border-slate-300 bg-white group-hover:border-slate-400"
                }`}
              >
                {isChecked && (
                  <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </div>
            <span className="text-sm leading-snug text-slate-700">
              I have read, understood, and agree to the Terms &amp; Conditions above.
            </span>
          </label>

          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-500">{error}</p>}

          <button
            onClick={handleAccept}
            disabled={!canAccept || isSubmitting}
            className={`w-full rounded-xl py-3 text-sm font-semibold tracking-wide transition-all duration-200 ${
              canAccept && !isSubmitting
                ? "bg-slate-900 text-white shadow-sm hover:bg-slate-700 active:scale-[0.98]"
                : "cursor-not-allowed bg-slate-200 text-slate-400"
            }`}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Saving your agreement...
              </span>
            ) : (
              "I Accept - Continue"
            )}
          </button>

          <p className="text-center text-xs text-slate-400">
            Accepting as <span className="font-medium text-slate-600">{userName}</span>
            {userId ? (
              <>
                {" "}- ID: <span className="font-mono">{userId}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>
    </div>
  );
}
