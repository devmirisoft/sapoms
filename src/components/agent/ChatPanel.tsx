"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { SendHorizontal, Trash2, X } from "lucide-react";
import MessageBubble from "./MessageBubble";
import { useAgentChat } from "./useAgentChat";
import { COPY, type Audience } from "./audience";

export default function ChatPanel({ audience, storageKey, currentPage, open, onClose }: {
  audience: Audience;
  storageKey: string;
  currentPage: string;
  open: boolean;
  onClose: () => void;
}) {
  const { messages, isLoading, error, send, updateDraft, addNotice, clear } = useAgentChat(storageKey, currentPage);
  const copy = COPY[audience];
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, isLoading, open]);

  async function submit(text: string) {
    if (!text.trim() || isLoading) return;
    setInput("");
    if (!(await send(text))) setInput(text);
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit(input);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">{copy.title}</h2>
          <p className="text-[11.5px] text-gray-500">{copy.subtitle}</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={clear} disabled={isLoading || messages.length === 0} aria-label="Clear chat"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40">
            <Trash2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={onClose} aria-label="Close assistant"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-2 pt-6 text-center">
            <p className="text-[13.5px] text-gray-600">{copy.intro}</p>
            <div className="flex flex-col items-center gap-2 pt-2">
              {copy.suggestions.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => void submit(suggestion)}
                  className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-[12.5px] text-brand-600 hover:bg-brand-100">
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message, i) => <MessageBubble key={i} message={message} onDraftUpdate={updateDraft} onNotice={addNotice} />)}
        {isLoading && (
          <div className="flex justify-start" aria-label="Assistant is typing">
            <div className="flex gap-1 rounded-2xl rounded-bl-md bg-gray-100 px-3.5 py-3">
              {[0, 150, 300].map((delay) => (
                <span key={delay} className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={(event: FormEvent) => { event.preventDefault(); void submit(input); }} className="border-t border-gray-200 p-3">
        {error && <p role="alert" className="mb-2 text-[12.5px] text-red-600">{error}</p>}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={isLoading}
            maxLength={2000}
            rows={1}
            placeholder={isLoading ? "Waiting for the reply…" : "Type a message"}
            aria-label="Message"
            className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-[13.5px] outline-none [field-sizing:content] focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-gray-50"
          />
          <button type="submit" disabled={isLoading || !input.trim()} aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-40">
            <SendHorizontal className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
