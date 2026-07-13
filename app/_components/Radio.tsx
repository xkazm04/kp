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
  /** Mark the control invalid — the family-wide `invalid` prop (sets aria-invalid
   *  and an error-tone accent). */
  invalid?: boolean;
};

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, hint, className = "", wrapperClassName = "", disabled, invalid = false, ...rest },
  ref
) {
  const dot = (
    <input
      ref={ref}
      type="radio"
      disabled={disabled}
      aria-invalid={invalid || undefined}
      className={`focus-ring h-4 w-4 shrink-0 disabled:opacity-60 ${invalid ? "accent-red-500" : "accent-coral"} ${label ? "mt-0.5" : ""} ${className}`}
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
