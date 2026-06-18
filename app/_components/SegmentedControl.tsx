"use client";

import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { resolveSegmentedSelection } from "./segmented-control-selection";

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
//
// Unmatched `value` is a DEVELOPER ERROR, not a supported empty state (see the
// contract in segmented-control-selection.ts): when `value` matches no option the
// group announces nothing selected and the pill is hidden, and we warn in
// non-production so the bug surfaces. Callers needing a real empty state must add
// an explicit option rather than passing an out-of-range value.
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
  // the group stays keyboard-reachable even if `value` matches nothing.
  const { focusIndex, hasSelection } = resolveSegmentedSelection(options, value);

  // An unmatched value is a caller bug (see the doc comment + the selection-helper
  // contract): it leaves the group announcing nothing selected. Surface it in dev
  // so it doesn't ship as a silent empty radiogroup; production renders the
  // graceful unselected state without console noise. In an effect, not in render,
  // to keep render side-effect-free and avoid warning on every re-render.
  useEffect(() => {
    if (hasSelection || process.env.NODE_ENV === "production") return;
    console.warn(
      `SegmentedControl "${label}": value ${JSON.stringify(value)} matches none of its options — ` +
        "the group will announce nothing selected."
    );
  }, [hasSelection, value, label]);

  const move = (next: number) => {
    const count = options.length;
    if (count === 0) return;
    const idx = ((next % count) + count) % count;
    onChange(options[idx].value);
    refs.current[idx]?.focus();
  };

  const DIRECTIONAL = new Set(["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    // No current selection (an off-taxonomy `value` — a dev error): the fallback tab
    // stop is option 0 but nothing is aria-checked. A relative move(index±1) from here
    // would SKIP option 0 and silently commit option 1, announced as a change the user
    // didn't intend. So the first directional key explicitly selects option 0; once a
    // value matches, hasSelection is true and movement below is normal radiogroup APG.
    if (!hasSelection && DIRECTIONAL.has(event.key)) {
      event.preventDefault();
      move(0);
      return;
    }
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
