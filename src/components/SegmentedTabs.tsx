"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type SegTone = "neutral" | "rose" | "amber" | "emerald";

export type SegItem = {
  value: string;
  label: string;
  /** Optional leading glyph. Size it ~13px so it sits on the text baseline. */
  icon?: ReactNode;
  /** Colour the pill takes while this tab is selected. Defaults to neutral. */
  tone?: SegTone;
  /** Omit or pass null to render no badge (not the same as a count of 0). */
  count?: number | null;
  title?: string;
};

const THUMB: Record<SegTone, string> = {
  neutral: "bg-white border-gray-200",
  rose:    "bg-rose-50 border-rose-200",
  amber:   "bg-amber-50 border-amber-200",
  emerald: "bg-emerald-50 border-emerald-200",
};
const TEXT: Record<SegTone, string> = {
  neutral: "text-gray-900",
  rose:    "text-rose-700",
  amber:   "text-amber-800",
  emerald: "text-emerald-800",
};
const BADGE: Record<SegTone, string> = {
  neutral: "bg-gray-900 text-white",
  rose:    "bg-rose-600 text-white",
  amber:   "bg-amber-500 text-white",
  emerald: "bg-emerald-600 text-white",
};

/**
 * The app's one tab control: a light rail with the selected tab as a pill that
 * slides and resizes between options.
 *
 * The pill is a single absolutely-positioned "thumb" rather than a background
 * toggled per button, because tabs have different widths — so its geometry has
 * to be measured off the live DOM. The rail scrolls sideways rather than
 * wrapping, since a wrapped second row would leave the thumb (which only
 * tracks the X axis) stranded on the wrong line.
 */
export function SegmentedTabs({ items, value, onChange, label, disabled = false, className = "" }: {
  items: SegItem[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** Locks the whole control — the current tab stays legible and selected. */
  disabled?: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  // Badges appear and disappear, which changes a tab's width, so the
  // measurement is keyed on the rendered counts as well as the selection.
  const signature = items.map(item => `${item.value}:${item.label}:${item.count ?? ""}`).join("|");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const active = container.querySelector<HTMLElement>('[data-seg-active="true"]');
      if (active) setThumb({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    // Fonts loading late, or the surrounding layout reflowing, both shift the tabs.
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [value, signature]);

  const activeTone = items.find(item => item.value === value)?.tone ?? "neutral";

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label={label}
      className={`relative inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${disabled ? "opacity-60" : ""} ${className}`}
    >
      {thumb && (
        <span
          aria-hidden="true"
          style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }}
          className={`absolute inset-y-1 left-0 rounded-lg border shadow-sm will-change-transform ${THUMB[activeTone]} transition-[transform,width,background-color,border-color] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none`}
        />
      )}
      {items.map(item => {
        const active = item.value === value;
        const tone = item.tone ?? "neutral";
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            title={item.title}
            data-seg-active={active}
            disabled={disabled}
            onClick={() => onChange(item.value)}
            className={`relative z-10 inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors duration-300 motion-reduce:transition-none disabled:cursor-not-allowed ${
              active ? TEXT[tone] : `text-gray-500 ${disabled ? "" : "hover:text-gray-800"}`
            }`}
          >
            {item.icon}
            {item.label}
            {item.count != null && (
              <span className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums transition-colors duration-300 motion-reduce:transition-none ${
                active ? BADGE[tone] : "bg-gray-200 text-gray-600"
              }`}>
                {item.count.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Same pill as {@link SegmentedTabs}, collapsed into a dropdown for when the
 * option list is long enough to overflow the rail. The trigger *is* the thumb,
 * so it keeps the tone/badge styling; the menu carries its own thumb that
 * slides vertically between options with the same easing as the tab rail.
 *
 * It opens on hover and stays open until the pointer leaves the whole control
 * (trigger + menu), so the menu has to sit inside the hover target.
 */
export function SegmentedDropdown({ items, value, onChange, label, disabled = false, className = "" }: {
  items: SegItem[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [thumb, setThumb] = useState<{ top: number; height: number } | null>(null);
  const selected = items.find(item => item.value === value) ?? items[0];
  const tone = selected?.tone ?? "neutral";

  const signature = items.map(item => `${item.value}:${item.label}:${item.count ?? ""}`).join("|");

  // Same trick as the rail: measure the selected row off the live DOM so the
  // thumb can slide to it. Options are equal-width here, so only Y and height move.
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const measure = () => {
      const active = menu.querySelector<HTMLElement>('[data-seg-active="true"]');
      if (active) setThumb({ top: active.offsetTop, height: active.offsetHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(menu);
    return () => observer.disconnect();
  }, [value, signature, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      onPointerEnter={() => { if (!disabled) setOpen(true); }}
      onPointerLeave={() => setOpen(false)}
      className={`relative inline-block ${className}`}
    >
      <div className={`inline-flex max-w-full items-center rounded-xl border border-gray-200 bg-gray-50 p-1 ${disabled ? "opacity-60" : ""}`}>
        <button
          type="button"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          title={selected?.title}
          disabled={disabled}
          onClick={() => setOpen(prev => !prev)}
          className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold shadow-sm transition-colors duration-300 motion-reduce:transition-none disabled:cursor-not-allowed ${THUMB[tone]} ${TEXT[tone]}`}
        >
          {selected?.icon}
          {selected?.label}
          {selected?.count != null && (
            <span className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums ${BADGE[tone]}`}>
              {selected.count.toLocaleString()}
            </span>
          )}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${open ? "rotate-180" : ""}`}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      <div
        ref={menuRef}
        role="listbox"
        aria-label={label}
        className={`absolute left-0 top-full z-30 mt-1 min-w-full origin-top rounded-xl border border-gray-200 bg-white p-1 shadow-lg transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${
          open ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-95"
        }`}
      >
        {thumb && (
          <span
            aria-hidden="true"
            style={{ transform: `translateY(${thumb.top}px)`, height: thumb.height }}
            className={`absolute inset-x-1 top-0 rounded-lg border shadow-sm will-change-transform ${THUMB[tone]} transition-[transform,height,background-color,border-color] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none`}
          />
        )}
        {items.map(item => {
          const active = item.value === value;
          const itemTone = item.tone ?? "neutral";
          return (
            <button
              key={item.value}
              type="button"
              role="option"
              aria-selected={active}
              title={item.title}
              data-seg-active={active}
              onClick={() => onChange(item.value)}
              className={`relative z-10 flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-[12.5px] font-semibold transition-colors duration-300 motion-reduce:transition-none ${
                active ? TEXT[itemTone] : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {item.icon}
              {item.label}
              {item.count != null && (
                <span className={`ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums transition-colors duration-300 motion-reduce:transition-none ${
                  active ? BADGE[itemTone] : "bg-gray-200 text-gray-600"
                }`}>
                  {item.count.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
