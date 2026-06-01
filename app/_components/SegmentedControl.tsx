"use client";

import { useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";

export type SegmentedOption<T extends string> = { value: T; label: ReactNode };

// Single-select segmented toggle with full radiogroup semantics. Renders the
// app's row-of-bordered-buttons look, but is operable and announced for
// keyboard + screen-reader users: the wrapper is a role=radiogroup with an
// aria-label, each option is a role=radio with aria-checked, and focus roves
// (the selected option is the only tab stop; arrow / Home / End keys move the
// selection and focus together). The active state rides the shared-layout
// `bg-ink` pill that defines the app's segmented-control motion standard and
// snaps to its end state under the OS "reduce motion" preference. Extracted so
// every single-select toggle shares this behavior instead of re-deriving it.
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** Accessible name for the group, announced as the radiogroup's label. */
  label: string;
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Layout classes for the radiogroup container (defaults to a wrapping flex row). */
  className?: string;
}) {
  const reduced = useReducedMotion();
  const groupId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // The selected option is the sole tab stop; fall back to the first option so
  // the group is always reachable even if `value` matches nothing.
  const selectedIndex = options.findIndex((o) => o.value === value);
  const focusIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const move = (next: number) => {
    const count = options.length;
    if (count === 0) return;
    const idx = ((next % count) + count) % count;
    onChange(options[idx].value);
    refs.current[idx]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        move(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        move(index - 1);
        break;
      case "Home":
        event.preventDefault();
        move(0);
        break;
      case "End":
        event.preventDefault();
        move(options.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div role="radiogroup" aria-label={label} className={className ?? "flex flex-wrap gap-2"}>
      {options.map((opt, index) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`focus-ring relative rounded-md border px-3 py-1.5 text-base transition-colors ${
              selected ? "border-ink text-white" : "border-stone-200 text-ink hover:bg-paper"
            }`}
          >
            {selected ? (
              <motion.span
                layoutId={`seg-${groupId}`}
                className="absolute inset-0 z-0 rounded-md bg-ink"
                transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
              />
            ) : null}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
