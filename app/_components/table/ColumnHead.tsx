"use client";

// The shared sortable column header — the `<th>` itself, not a widget you drop
// inside one.
//
// It renders the cell because `aria-sort` belongs ON the header cell, and every
// hand-rolled version in this repo forgot it (the Profiles roster had a working
// sort control whose state was invisible to assistive tech — a screen-reader
// user could operate the sort and never learn the table was sorted). Owning the
// `<th>` makes that impossible to omit: pass a `sortCol` and the attribute is
// correct by construction; omit it and the cell correctly claims nothing.
//
// Pairs with useTableSort (the ordering engine) and ColumnFilter (pass one as
// `children` — use its `trigger="icon"` form there, or the column name gets
// spelled twice, "Candidate ↑ Candidate ▾").
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { ariaSort, type SortState } from "./useTableSort";

export function ColumnHead<C extends string>({
  title,
  sortCol,
  sort,
  onSort,
  align = "left",
  className = "",
  children,
}: {
  title: string;
  /** Omit for a column with no meaningful order (Status, Actions…). */
  sortCol?: C;
  sort: SortState<C>;
  onSort: (col: C) => void;
  /** Numeric columns read right-aligned; the control follows the text. */
  align?: "left" | "right";
  /** Extra classes for the cell (responsive hiding, widths, padding overrides). */
  className?: string;
  /** The column's ColumnFilter, if it has one (use trigger="icon"). */
  children?: React.ReactNode;
}) {
  const t = useTranslations("table");
  const active = sortCol != null && sort.col === sortCol;
  // Direction is shown only on the ACTIVE column: an idle column showing "↑"
  // claims an ordering it isn't imposing. Idle columns get the neutral two-way
  // glyph, so the affordance is still discoverable.
  const SortIcon = !active ? ArrowUpDown : sort.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <th
      scope="col"
      aria-sort={ariaSort(sort, sortCol)}
      className={`pb-2 pr-3 ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <span className={`${META_LABEL} ${active ? "text-coral" : ""}`}>{title}</span>
        {sortCol ? (
          <button
            type="button"
            onClick={() => onSort(sortCol)}
            aria-label={t("sortBy", { column: title })}
            title={t("sortBy", { column: title })}
            className={`focus-ring inline-flex h-6 w-6 items-center justify-center rounded transition-colors ${
              active ? "bg-coral/10 text-coral" : "text-steel hover:bg-stone-100 hover:text-ink"
            }`}
          >
            <SortIcon size={13} className={active ? "" : "opacity-60"} aria-hidden />
          </button>
        ) : null}
        {children}
      </span>
    </th>
  );
}
