"use client";

import { forwardRef } from "react";

// Canonical multi-line input — the dual-theme wrapper over a native <textarea>,
// the sibling of TextInput. Same token-resolved base (card-white fill, ink text,
// steel placeholder, coral caret, shared focus ring) so it's correct in both
// themes; adds vertical resize and a comfortable reading leading. Height comes
// from `rows` or a `min-h-*` in className.

export type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  sizeVariant?: "sm" | "md";
  invalid?: boolean;
};

const BASE =
  "focus-ring w-full resize-y rounded-md border bg-white p-3 text-ink placeholder:text-steel caret-coral transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className = "", sizeVariant = "md", invalid = false, ...rest },
  ref
) {
  // Own the text size so a caller's `text-sm` (e.g. a monospace body) wins over
  // the base without an `!important` fight (Tailwind orders text-* by scale).
  const size = sizeVariant === "sm" ? "text-sm leading-5" : "text-base leading-6";
  // Coral hover-border matches the Select/FileInput affordance so sibling controls
  // in one form row respond identically to the cursor.
  const border = invalid ? "border-red-400" : "border-stone-200 hover:border-coral/40";
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={`${BASE} ${size} ${border} ${className}`} {...rest} />;
});
