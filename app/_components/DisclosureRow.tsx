"use client";

import { ChevronRight } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

// Shared accessible disclosure row for expandable tables. The summary row is a
// keyboard-operable button (role=button, tabIndex, Enter/Space, focus ring,
// aria-expanded) with a leading chevron that rotates on open; the detail row
// spans all columns and mounts with a fade-in. Reused so every expandable table
// in the workspace inherits the same a11y + motion behavior.
export function DisclosureRow({
  isOpen,
  onToggle,
  colSpan,
  detail,
  label,
  children,
}: {
  isOpen: boolean;
  onToggle: () => void;
  /** Total number of columns in the table (including the chevron column) so the detail row spans the full width. */
  colSpan: number;
  detail: ReactNode;
  /** Accessible name for the toggle row (e.g. the row's title). */
  label?: string;
  /** The summary cells (<td>…</td>) rendered after the chevron column. */
  children: ReactNode;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggle();
    }
  };

  return (
    <>
      <tr
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-label={label}
        onClick={onToggle}
        onKeyDown={onKeyDown}
        className="focus-ring cursor-pointer hover:bg-paper/60"
      >
        <td className="w-8 pl-3 align-middle text-steel">
          <ChevronRight
            size={15}
            aria-hidden
            className={`transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
          />
        </td>
        {children}
      </tr>
      {isOpen ? (
        <tr className="bg-paper/40">
          <td colSpan={colSpan} className="px-4 py-4">
            <div className="animate-fade-in">{detail}</div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
