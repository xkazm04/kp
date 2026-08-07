"use client";

import { forwardRef } from "react";

// Dual-theme radio — the single-choice sibling of Checkbox. Native
// <input type="radio"> with the coral accent (correct in both themes via
// accent-color/color-scheme) plus an optional label + hint. Group radios the
// native way: give them a shared `name`. Native semantics keep arrow-key group
// navigation and screen-reader announcement for free.

export type RadioProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  wrapperClassName?: string;
};

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, hint, className = "", wrapperClassName = "", disabled, ...rest },
  ref
) {
  const dot = (
    <input
      ref={ref}
      type="radio"
      disabled={disabled}
      className={`focus-ring h-4 w-4 shrink-0 accent-coral disabled:opacity-60 ${label ? "mt-0.5" : ""} ${className}`}
      {...rest}
    />
  );
  if (!label && !hint) return dot;
  return (
    <label className={`flex items-start gap-2 ${disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"} ${wrapperClassName}`}>
      {dot}
      <span className="min-w-0">
        {label ? <span className="block text-sm font-medium text-ink">{label}</span> : null}
        {hint ? <span className="block text-sm text-steel">{hint}</span> : null}
      </span>
    </label>
  );
});
