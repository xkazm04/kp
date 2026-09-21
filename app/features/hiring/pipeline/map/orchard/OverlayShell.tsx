"use client";

// The Orchard's full-screen frame: the grow-from-the-cell transition and the dialog
// a11y (focus trap, scroll lock, Escape) around whatever the overlay renders.

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import type { CellSelection } from "../mapTypes";

const EASE = [0.16, 1, 0.3, 1] as const;
const OPEN_S = 0.32;

/** The clip rectangle the overlay grows out of, expressed as a CSS inset(). */
function insetFromOrigin(origin: CellSelection["origin"]): string | null {
  if (!origin || typeof window === "undefined") return null;
  const top = Math.max(0, Math.round(origin.y));
  const left = Math.max(0, Math.round(origin.x));
  const right = Math.max(0, Math.round(window.innerWidth - origin.x - origin.width));
  const bottom = Math.max(0, Math.round(window.innerHeight - origin.y - origin.height));
  return `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}

export function OverlayShell({
  origin,
  label,
  onClose,
  children,
}: {
  origin: CellSelection["origin"];
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();
  useDialogA11y(ref, onClose, { trap: true, lockScroll: true });
  // Measured once, at mount: the rect is a click-time snapshot and a later
  // resize must not re-derive a stale clip path mid-animation.
  const [startInset] = useState(() => insetFromOrigin(origin));
  const grow = startInset !== null && !reduced;

  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0 : 0.2, ease: "linear" }}
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col bg-paper focus:outline-none"
        initial={grow ? { clipPath: startInset } : { opacity: 0 }}
        animate={grow ? { clipPath: "inset(0px 0px 0px 0px)" } : { opacity: 1 }}
        exit={grow ? { clipPath: startInset } : { opacity: 0 }}
        transition={{ duration: reduced ? 0 : grow ? OPEN_S : 0.18, ease: EASE }}
      >
        {children}
      </motion.div>
    </>
  );
}
