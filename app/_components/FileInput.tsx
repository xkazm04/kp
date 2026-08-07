"use client";

import { forwardRef } from "react";
import { Upload, type LucideIcon } from "lucide-react";

// Dual-theme file picker. A native <input type="file"> can't be styled (its
// button is OS-drawn and ignores the theme), so this hides the input and turns a
// label into the visible trigger — a token-styled button that re-skins in Spark
// Dark like every other control. The label keeps the native click-to-open and
// keyboard behavior; a focus-within ring mirrors the app's coral focus ring so
// keyboard users still see focus. The ref forwards to the input so callers that
// open the dialog programmatically (drop zones) can still do so.

export type FileInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
  buttonLabel?: React.ReactNode;
  icon?: LucideIcon | null;
  /** Classes for the visible trigger button. */
  buttonClassName?: string;
};

export const FileInput = forwardRef<HTMLInputElement, FileInputProps>(function FileInput(
  { buttonLabel = "Choose file", icon = Upload, buttonClassName = "", className = "", disabled, ...rest },
  ref
) {
  const Icon = icon;
  return (
    <label
      className={`inline-flex items-center gap-2 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-ink transition-colors hover:border-coral/40 focus-within:outline-none focus-within:[box-shadow:0_0_0_2px_var(--color-paper),0_0_0_4px_var(--color-coral)] ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      } ${buttonClassName}`}
    >
      {Icon ? <Icon size={15} aria-hidden /> : null}
      {buttonLabel}
      <input ref={ref} type="file" disabled={disabled} className={`sr-only ${className}`} {...rest} />
    </label>
  );
});
