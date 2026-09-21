"use client";

import { useId, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { POPOVER } from "./ui/recipes";

// A hover/focus label for a control that carries no visible text.
//
// WHY THIS EXISTS. An icon-only control is only honest if its meaning is
// reachable, and `title=""` is not that: it is invisible to touch, it never
// appears on keyboard focus, and its delay is the browser's to choose. This
// renders the same sentence as a real element — on hover AND on focus, dismissed
// by Escape — so a control can drop its caption from the layout without dropping
// the explanation from the product.
//
// It is a LABEL SURFACE, not a popover: no portal, no focus trap, no
// interactive content. The trigger keeps its own accessible name (aria-label);
// the tip is wired as `aria-describedby`, which is the relationship a screen
// reader announces as supplementary rather than as the name itself.
//
// Positioning is CSS only — the tip is absolutely positioned against the
// wrapper, so it costs no measurement pass and cannot desync on scroll. That
// buys one constraint: a tip near the viewport edge is clipped by an
// `overflow-hidden` ancestor, so `side` exists for the caller to point it
// inward. Inside the intake studio the header points its tips DOWN and the
// composer row points them UP.

export type TooltipSide = "top" | "bottom" | "left" | "right";

const SIDE_CLASS: Record<TooltipSide, string> = {
  top: "bottom-full left-1/2 mb-1.5 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-1.5 -translate-x-1/2",
  left: "right-full top-1/2 mr-1.5 -translate-y-1/2",
  right: "left-full top-1/2 ml-1.5 -translate-y-1/2",
};

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
  // Pointer and keyboard are two independent reasons to be open, and closing one
  // must not close the other: a mouse leaving a control the keyboard still holds
  // would otherwise hide a tip whose trigger is focused.
  const shown = useRef({ hover: false, focus: false });
  const sync = () => setOpen(shown.current.hover || shown.current.focus);

  return (
    <span
      className={`relative inline-flex ${className ?? ""}`}
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
      {open ? (
        <span
          id={id}
          role="tooltip"
          className={`${POPOVER} animate-fade-in pointer-events-none absolute z-50 w-max max-w-[16rem] px-2 py-1 text-meta leading-5 text-ink ${SIDE_CLASS[side]}`}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
