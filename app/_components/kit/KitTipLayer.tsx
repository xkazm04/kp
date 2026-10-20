"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { tooltipPosition } from "@/app/_components/tooltip-position";

/**
 * ONE tip for a whole kit surface (kit.js showTip): any element inside `root` that carries
 * `data-tip` shows its sentence on hover AND on focus, never through `title=`. Delegated, so a
 * windowed table's rows carry an attribute instead of a component each. Portaled to body: the
 * workspace's tab panel animates a transform, which would otherwise trap a fixed element.
 */
export function KitTipLayer({ root }: { root: RefObject<HTMLElement | null> }) {
  const [tip, setTip] = useState<{ text: string; el: HTMLElement } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const find = (t: EventTarget | null) => (t instanceof Element ? (t.closest("[data-tip]") as HTMLElement | null) : null);
    const show = (e: Event) => {
      const el = find(e.target);
      const text = el?.getAttribute("data-tip");
      if (el && text) setTip({ text, el });
      else if (e.type === "focusin") setTip(null);
    };
    const hide = (e: Event) => {
      if (find(e.target)) setTip(null);
    };
    const clear = () => setTip(null);
    host.addEventListener("mouseover", show);
    host.addEventListener("mouseout", hide);
    host.addEventListener("focusin", show);
    host.addEventListener("focusout", clear);
    window.addEventListener("scroll", clear, { passive: true, capture: true });
    return () => {
      host.removeEventListener("mouseover", show);
      host.removeEventListener("mouseout", hide);
      host.removeEventListener("focusin", show);
      host.removeEventListener("focusout", clear);
      window.removeEventListener("scroll", clear, { capture: true });
    };
  }, [root]);

  useEffect(() => {
    if (!tip || !tipRef.current) return;
    const r = tip.el.getBoundingClientRect();
    const size = tipRef.current.getBoundingClientRect();
    setPos(tooltipPosition(r, size, "top", { width: window.innerWidth, height: window.innerHeight }));
  }, [tip]);

  if (typeof document === "undefined" || !tip) return null;
  return createPortal(
    <div ref={tipRef} role="tooltip" className={`k-tip${pos ? " is-on" : ""}`} style={{ left: pos?.left ?? 0, top: pos?.top ?? 0 }}>
      {tip.text}
    </div>,
    document.body,
  );
}
