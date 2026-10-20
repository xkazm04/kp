"use client";

import type { MouseEvent } from "react";
import { KitIcon } from "./icons";
import "./kit.css";
import "./menu.css";

/**
 * @catalog A select mode's checkbox (20px, hung in the mark track): checked / mixed / clear; a click never reaches the row under it. The label is its accessible name.
 */
export function SelectBox({ checked, label, onToggle, disabled }: {
  checked: boolean | "mixed";
  label: string;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      className="k-check"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      data-role="kit-select-box"
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {checked === true ? (
        <KitIcon name="check" />
      ) : checked === "mixed" ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden>
          <path d="M4 8h8" />
        </svg>
      ) : null}
    </button>
  );
}
