"use client";

import { forwardRef } from "react";

// Canonical text input — the dual-theme wrapper over a native <input>. A bare
// <input> across the app carried ad-hoc class strings, and several set no bg/text
// at all, so in Spark Dark they rendered a transparent field with an OS-blue
// caret and washed-out placeholder. This bakes the theme-correct base once — the
// card-white fill, ink text, steel placeholder, coral caret, and the shared focus
// ring — resolved through tokens so both themes are right by construction.
//
// Sizing is a `sizeVariant` (md default), and any extra layout/utility classes
// (a leading-icon `pl-9`, `font-mono`, `capitalize`, `max-w-*`) pass through
// className. `invalid` flips the border to the error tone.

export type TextInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  sizeVariant?: "sm" | "md";
  invalid?: boolean;
};

const BASE =
  "focus-ring w-full rounded-md border bg-white text-ink placeholder:text-steel caret-coral transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className = "", sizeVariant = "md", invalid = false, ...rest },
  ref
) {
  const size = sizeVariant === "sm" ? "h-9 px-2.5 text-sm" : "h-10 px-3 text-base";
  // Coral hover-border matches the Select/FileInput affordance so sibling controls
  // in one form row respond identically to the cursor.
  const border = invalid ? "border-red-400" : "border-stone-200 hover:border-coral/40";
  return <input ref={ref} aria-invalid={invalid || undefined} className={`${BASE} ${size} ${border} ${className}`} {...rest} />;
});
