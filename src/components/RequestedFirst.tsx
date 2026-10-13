"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Renders a product list with the requested-discount lines first, then the already-rejected lines,
 * then the rest. It mounts in the original order (rejected last), then shuffles (FLIP) so reviewers
 * see which lines moved up. `index` stays the original index.
 */
export function RequestedFirst<T>({
  as = "tbody",
  className,
  items,
  isRequested,
  children,
  rejected,
}: {
  as?: "tbody" | "div";
  className?: string;
  items: T[];
  isRequested: (item: T) => boolean;
  children: (item: T, index: number) => ReactNode;
  rejected?: ReactNode;
}) {
  const node = useRef<HTMLElement | null>(null);
  const tops = useRef(new Map<Element, number>());
  const [sorted, setSorted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSorted(true), 300);
    return () => clearTimeout(timer);
  }, []);

  useLayoutEffect(() => {
    const els = Array.from(node.current?.children ?? []) as HTMLElement[];
    const animate = sorted && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    els.forEach((el) => {
      const from = tops.current.get(el);
      if (animate && from !== undefined && from !== el.offsetTop) {
        el.animate([{ transform: `translateY(${from - el.offsetTop}px)` }, { transform: "translateY(0)" }], {
          duration: 450,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        });
      }
    });
    tops.current = new Map(els.map((el) => [el, el.offsetTop]));
  }, [sorted]);

  // One flat keyed list so React moves (not remounts) the DOM nodes and FLIP can animate them.
  const rows = items.map((item, index) => ({ node: children(item, index), requested: isRequested(item) }));
  const rejectedNode = <Fragment key="__rejected">{rejected}</Fragment>;
  const content = sorted
    ? [...rows.filter((r) => r.requested).map((r) => r.node), rejectedNode, ...rows.filter((r) => !r.requested).map((r) => r.node)]
    : [...rows.map((r) => r.node), rejectedNode];

  return as === "div" ? (
    <div ref={(el) => { node.current = el; }} className={className}>{content}</div>
  ) : (
    <tbody ref={(el) => { node.current = el; }} className={className}>{content}</tbody>
  );
}
