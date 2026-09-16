"use client";

import React, { useRef, useState } from "react";

export const toDisplay = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

export const toIso = (text: string) => {
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(text.trim());
  if (!m) return "";
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  // round-trip rejects 31/02/2026 and friends
  return date.toISOString().slice(0, 10) === iso ? iso : "";
};

type Props = Omit<React.ComponentProps<"input">, "value" | "onChange"> & {
  value?: string;
  onChange?: (event: { target: { value: string } }) => void;
};

/** Drop-in for <input type="date"> that always shows dd/mm/yyyy. Value stays yyyy-mm-dd. */
export default function DateInput({ value = "", onChange, className, min, max, type = "date", ...rest }: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => toDisplay(value));
  const [lastValue, setLastValue] = useState(value);

  if (lastValue !== value) {
    setLastValue(value);
    setText(toDisplay(value));
  }

  const emit = (iso: string) => onChange?.({ target: { value: iso } });

  // lets shared field wrappers pass their `type` through unchanged
  if (type !== "date") {
    return <input {...rest} type={type} value={value} onChange={onChange} min={min} max={max} className={className} />;
  }

  return (
    <span className="relative block w-full">
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        placeholder={rest.placeholder ?? "dd/mm/yyyy"}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const iso = toIso(event.target.value);
          if (iso || !event.target.value.trim()) emit(iso);
        }}
        onBlur={() => setText(toDisplay(value))}
        className={className}
        style={{ paddingRight: 32 }}
      />
      <input
        ref={picker}
        type="date"
        value={value}
        min={min}
        max={max}
        tabIndex={-1}
        aria-hidden
        onChange={(event) => emit(event.target.value)}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Open calendar"
        disabled={rest.disabled}
        onClick={() => picker.current?.showPicker?.()}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 11h18" />
        </svg>
      </button>
    </span>
  );
}
