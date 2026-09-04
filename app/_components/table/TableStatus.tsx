"use client";

// The sr-only live region every sortable / filterable table in the studio owes
// its reader.
//
// THE GAP: sorting a table REORDERS it and filtering SHRINKS it, and both happen
// entirely in the visual channel. `TablePager` was the only member of the table
// kit with an `aria-live` at all (its range line), so a screen-reader user could
// press the sort button on the Archetypes roster, hear "Sort by Candidate", and
// receive no confirmation that anything happened — the rows below simply were a
// different set of rows, silently. Picking a filter option was worse: the menu
// closes, the table shrinks from 174 rows to 3, and nothing is announced.
//
// It is a REGION, not a hook that speaks: the sentence is derived from the state
// the table already holds, so it cannot drift out of step with what is rendered
// (a `speak()` call can be forgotten on one of three filter setters — this
// cannot). Re-rendering with different text is what makes a live region fire.
//
// aria-atomic because the sentence is one fact in two clauses: without it a
// reader that hears only the changed clause gets "descending" with no column.

import { useTranslations } from "next-intl";
import type { SortDir } from "./useTableSort";

export function TableStatus({
  columnTitle,
  dir,
  matched,
  filtered = false,
}: {
  /** The ACTIVE sort column's localized title. Omit on a table with no sort. */
  columnTitle?: string;
  /** The active sort direction. Ignored when `columnTitle` is absent. */
  dir?: SortDir;
  /** Rows that survived the filters — the whole result set, never a page slice. */
  matched?: number;
  /**
   * Whether any filter is actually applied. An unfiltered table saying "174 rows
   * match" is noise on every render; the count is only news once something was
   * asked of it.
   */
  filtered?: boolean;
}) {
  const t = useTranslations("table.status");
  const parts: string[] = [];
  if (columnTitle) parts.push(t(dir === "desc" ? "sortedDesc" : "sortedAsc", { column: columnTitle }));
  if (filtered && matched != null) parts.push(t("matched", { count: matched }));
  return (
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {parts.join(" ")}
    </p>
  );
}
