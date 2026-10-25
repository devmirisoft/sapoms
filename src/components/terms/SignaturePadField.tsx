"use client";

import { useEffect, useRef } from "react";
import SignaturePad from "signature_pad";

// A draw-to-sign box. onChange gets a PNG data URL after each stroke, or null when cleared.
// Pass a stable callback (a state setter): a new one re-creates the pad and wipes the drawing.
export function SignaturePadField({ onChange }: { onChange: (image: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The backing store must be the CSS size times the pixel ratio, or strokes land offset and blurry.
    // ponytail: sized once on mount; resizing after drawing would need pad.toData()/fromData() to redraw.
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext("2d")?.scale(ratio, ratio);

    const pad = new SignaturePad(canvas, { penColor: "#0f172a" });
    pad.addEventListener("endStroke", () => onChange(pad.toDataURL()));
    padRef.current = pad;
    return () => pad.off();
  }, [onChange]);

  function clear() {
    padRef.current?.clear();
    onChange(null);
  }

  return (
    <div className="w-full">
      <canvas
        ref={canvasRef}
        aria-label="Draw your signature"
        className="block h-24 w-full touch-none rounded border border-dashed border-slate-400 bg-white"
      />
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span>Sign above</span>
        <button type="button" onClick={clear} className="underline hover:text-slate-700">Clear</button>
      </div>
    </div>
  );
}
