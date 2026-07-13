"use client";

import { forwardRef } from "react";

// Dual-theme checkbox. A native <input type="checkbox"> tinted with the coral
// accent (accent-color follows color-scheme, so the box + tick read correctly in
// both themes) wrapped with an optional label + hint. Native semantics are kept
// on purpose — the browser gives free keyboard + a11y that a div-based box would
// have to re-earn. Pass just the input props for a bare box, or label/hint for
// the standard "checkbox + explanation" row.

export type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  /** Wrapper classes when a label/hint is present. */
  wrapperClassName?: string;
  /** Mark the control invalid — the family-wide `invalid` prop (sets aria-invalid
   *  and an error-tone accent). */
  invalid?: boolean;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, className = "", wrapperClassName = "", disabled, invalid = false, ...rest },
  ref
) {
  const box = (
    <input
      ref={ref}
      type="checkbox"
      disabled={disabled}
      aria-invalid={invalid || undefined}
      className={`focus-ring h-4 w-4 shrink-0 disabled:opacity-60 ${invalid ? "accent-red-500" : "accent-coral"} ${label ? "mt-0.5" : ""} ${className}`}
      {...rest}
    />
  );
  if (!label && !hint) return box;
  return (
    <label className={`flex items-start gap-2 ${disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"} ${wrapperClassName}`}>
      {box}
      <span className="min-w-0">
        {label ? <span className="block text-sm font-medium text-ink">{label}</span> : null}
        {hint ? <span className="block text-sm text-steel">{hint}</span> : null}
      </span>
    </label>
  );
});
