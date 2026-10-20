"use client";

import type { ChangeEvent } from "react";
import { inputClass, type FieldSize } from "./fields";
import "./kit.css";

/**
 * @catalog A kit text field: 40px (md) or 32px (sm), the label as its accessible name, `invalid` draws the error border (aria-invalid), an optional tip.
 */
export function TextField({
  label, value, onChange, size = "md", invalid = false, placeholder, disabled, maxLength, tip, className,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  size?: FieldSize;
  invalid?: boolean;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  /** A sentence about the value (e.g. that renaming moves nothing underneath), shown as the kit tip. */
  tip?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      className={inputClass(size, className)}
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      data-tip={tip}
      data-role="kit-input"
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}

export type FieldOption = { value: string; label: string; disabled?: boolean };

/**
 * @catalog A kit select: the native control (its menu follows the register's color-scheme), 40px or 32px, the label as its accessible name, `invalid` draws the error border.
 */
export function SelectField({
  label, value, options, onChange, size = "md", invalid = false, disabled, className,
}: {
  label: string;
  value: string;
  options: readonly FieldOption[];
  onChange: (next: string) => void;
  size?: FieldSize;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      className={inputClass(size, className)}
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={value}
      disabled={disabled}
      data-role="kit-select"
      onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
