"use client";

import type { ReactNode } from "react";
import { Download } from "lucide-react";
import OrderConfirmCard from "./OrderConfirmCard";
import type { ChatMessage } from "./useAgentChat";

/** **bold** spans; everything else stays text, so model output can never inject HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
const numeric = (cell: string) => /^[-−]?\s*₹?\s*[\d,.]+%?$/.test(cell);

/** A pipe table (reports): first row is the header, the |---| row is skipped. */
function Table({ rows }: { rows: string[] }) {
  const [head, ...body] = rows.filter((row) => !/^\|?\s*:?-{2,}/.test(row.trim())).map(cells);
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr>{head.map((cell, i) => <th key={i} className={`border-b border-gray-300 px-1.5 py-1 font-semibold ${i > 0 && body.every((r) => numeric(r[i] ?? "")) ? "text-right" : "text-left"}`}>{inline(cell)}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="border-b border-gray-200 last:border-0">
              {head.map((_, i) => <td key={i} className={`px-1.5 py-1 align-top ${numeric(row[i] ?? "") ? "whitespace-nowrap text-right" : ""}`}>{inline(row[i] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The small markdown subset the assistant is told to use: paragraphs, bullet and numbered lists, bold, pipe tables. */
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[] | null = null;
  const flush = () => {
    if (table) {
      blocks.push(<Table key={blocks.length} rows={table} />);
      table = null;
    }
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{inline(item)}</li>);
    blocks.push(list.ordered
      ? <ol key={blocks.length} className="ml-5 list-decimal space-y-0.5">{items}</ol>
      : <ul key={blocks.length} className="ml-5 list-disc space-y-0.5">{items}</ul>);
    list = null;
  };

  for (const line of text.split("\n")) {
    if (line.trim().startsWith("|")) {
      if (list) flush();
      table ??= [];
      table.push(line);
      continue;
    }
    if (table) flush();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push(item[1]);
      continue;
    }
    flush();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) blocks.push(<p key={blocks.length} className="font-semibold">{inline(heading[1])}</p>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="space-y-1.5">{blocks}</div>;
}

export default function MessageBubble({ message, onDraftUpdate, onNotice }: {
  message: ChatMessage;
  onDraftUpdate: (draftId: string, patch: Pick<ChatMessage, "draft" | "outcome">) => void;
  onNotice: (text: string) => void;
}) {
  const isUser = message.role === "user";
  const draft = message.draft;
  return (
    <div className="space-y-2">
      <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[85%] break-words rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed ${
            isUser ? "whitespace-pre-wrap rounded-br-md bg-brand-600 text-white" : "rounded-bl-md bg-gray-100 text-gray-800"
          }`}
        >
          {isUser ? message.content : <Markdown text={message.content} />}
        </div>
      </div>
      {draft && (
        <OrderConfirmCard draft={draft} outcome={message.outcome} onUpdate={(patch) => onDraftUpdate(draft.draftId, patch)} onNotice={onNotice} />
      )}
      {/* Report exports the server attached; only same-origin API paths are ever rendered. */}
      {message.downloads?.filter((d) => d.url.startsWith("/api/")).map((d) => (
        <a key={d.url} href={d.url} download
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-brand-600 hover:bg-brand-50">
          <Download className="h-3.5 w-3.5" /> {d.label}
        </a>
      ))}
    </div>
  );
}
