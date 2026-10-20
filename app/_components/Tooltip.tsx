"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { POPOVER } from "./ui/recipes";
import { tooltipPosition, type TooltipSide } from "./tooltip-position";

// A hover/focus label for a control that carries no visible text.
//
// WHY THIS EXISTS. An icon-only control is only honest if its meaning is
// reachable, and `title=""` is not that: it is invisible to touch, it never
// appears on keyboard focus, and its delay is the browser's to choose. This
// renders the same sentence as a real element — on hover AND on focus, dismissed
// by Escape — so a control can drop its caption from the layout without dropping
// the explanation from the product.
//
// It is a LABEL SURFACE, not an interactive popover: no focus trap, no
// interactive content. The trigger keeps its own accessible name (aria-label);
// the tip is wired as `aria-describedby`, which is the relationship a screen
// reader announces as supplementary rather than as the name itself.
//
// The label is portaled to body so a scroll pane cannot clip it. Its measured
// viewport position follows the trigger while scrolling or resizing.
export type { TooltipSide } from "./tooltip-position";

export function Tooltip({
  label,
  side = "top",
  children,
  className,
}: {
  /** The sentence. Plain text: this is a label, never rich content. */
  label: string;
  side?: TooltipSide;
  /** The control being described. Must accept focus (a button, a link, an input). */
  children: ReactElement | ReactNode;
  /** Layout classes for the wrapper (it is `inline-flex` by default). */
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  // Pointer and keyboard are two independent reasons to be open, and closing one
  // must not close the other: a mouse leaving a control the keyboard still holds
  // would otherwise hide a tip whose trigger is focused.
  const shown = useRef({ hover: false, focus: false });
  const sync = () => setOpen(shown.current.hover || shown.current.focus);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const tip = tipRef.current?.getBoundingClientRect();
      if (!trigger || !tip) return;
      setPosition(tooltipPosition(trigger, tip, side, { width: window.innerWidth, height: window.innerHeight }));
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, side, label]);

  return (
    <span
      ref={triggerRef}
      className={`inline-flex ${className ?? ""}`}
      onMouseEnter={() => {
        shown.current.hover = true;
        sync();
      }}
      onMouseLeave={() => {
        shown.current.hover = false;
        sync();
      }}
      onFocus={() => {
        shown.current.focus = true;
        sync();
      }}
      onBlur={() => {
        shown.current.focus = false;
        sync();
      }}
      onKeyDown={(event) => {
        // Escape dismisses the tip without moving focus — the trigger stays where
        // the user put it, which a keyboard user expects of a label they dismissed.
        if (event.key !== "Escape" || !open) return;
        shown.current.focus = false;
        shown.current.hover = false;
        setOpen(false);
      }}
    >
      <span aria-describedby={open ? id : undefined} className="inline-flex">
        {children}
      </span>
      {open && typeof document !== "undefined" ? createPortal(
        <span
          ref={tipRef}
          id={id}
          role="tooltip"
          style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden", maxWidth: "min(16rem, calc(100vw - 1rem))" }}
          className={`${POPOVER} animate-fade-in pointer-events-none fixed z-50 w-max px-2 py-1 text-meta leading-5 text-ink`}
        >
          {label}
        </span>, document.body) : null}
    </span>
  );
}
