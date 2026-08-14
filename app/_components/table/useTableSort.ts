"use client";

// The ONE column-sort engine for the studio's tables — the missing third of the
// shared table kit. `TablePager` already owns "which slice am I looking at" and
// `ColumnFilter` owns "which rows qualify"; the ordering half had no home, so
// the roster hand-rolled its own comparator + header and every other table
// (Analytics by-role, channel economics, the activity ledger) simply shipped
// without sorting rather than re-derive it.
//
// Deliberately client-side, matching TablePager's contract: the tables using it
// hold their whole result set in memory. A result set that does NOT fit needs a
// server ORDER BY, not this.
//
// The rule this encodes that hand-rolled comparators keep getting wrong: a
// MISSING value is not a small value. `null` cost, an unset hire rate, an
// undefined median all sort to the BOTTOM in both directions — flipping to
// descending must not float "we don't know" to the top of a ranking. See
// compareCells.

import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc";
export type SortState<C extends string> = { col: C; dir: SortDir };

/** What a column contributes to the ordering. Null/undefined = "no value". */
export type SortCell = string | number | boolean | null | undefined;

/** Per-column value extractors — the shape a caller declares its columns with. */
export type SortAccessors<T, C extends string> = Record<C, (row: T) => SortCell>;

const isMissing = (v: SortCell): boolean => v === null || v === undefined || v === "";

/**
 * Compare two cells for `dir`, with missing values pinned last in BOTH
 * directions. Numbers compare numerically, booleans as false < true, and strings
 * through localeCompare with `numeric` on — so "Role 2" sorts before "Role 10"
 * instead of the codepoint order that puts "10" first.
 */
export function compareCells(a: SortCell, b: SortCell, dir: SortDir): number {
  const aMissing = isMissing(a);
  const bMissing = isMissing(b);
  // Pinned before the direction flip is applied — that is the whole point.
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  let cmp: number;
  if (typeof a === "number" && typeof b === "number") cmp = a - b;
  else if (typeof a === "boolean" || typeof b === "boolean") cmp = Number(a) - Number(b);
  else cmp = String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });

  return dir === "desc" ? -cmp : cmp;
}

/**
 * Sort `rows` by the active column. Returns the sorted copy (never mutates the
 * input — callers pass arrays they also render unsorted elsewhere), the current
 * state, and a `toggle` that flips direction on the active column and otherwise
 * moves to the new one.
 *
 * A new column starts DESCENDING when its first row reads as a number and
 * ascending otherwise: "sort by hires" almost always means "most hires first",
 * while "sort by role" means A–Z. Getting this wrong costs the reader a second
 * click on every single column, every time.
 */
export function useTableSort<T, C extends string>(
  rows: readonly T[],
  accessors: SortAccessors<T, C>,
  initial: SortState<C>
): { sorted: T[]; sort: SortState<C>; toggle: (col: C) => void } {
  const [sort, setSort] = useState<SortState<C>>(initial);

  const toggle = (col: C) => {
    setSort((prev) => {
      if (prev.col === col) return { col, dir: prev.dir === "asc" ? "desc" : "asc" };
      const sample = rows.length > 0 ? accessors[col](rows[0]) : null;
      return { col, dir: typeof sample === "number" ? "desc" : "asc" };
    });
  };

  const sorted = useMemo(() => {
    const get = accessors[sort.col];
    if (!get) return [...rows];
    return [...rows].sort((a, b) => compareCells(get(a), get(b), sort.dir));
    // `accessors` is an object literal at most call sites (new identity each
    // render), so it is intentionally NOT a dependency — the column KEY is what
    // selects the extractor, and re-sorting on every render is the bug this
    // memo exists to prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort.col, sort.dir]);

  return { sorted, sort, toggle };
}

/** The `aria-sort` value for a header cell — "none" unless it is the active column. */
export function ariaSort<C extends string>(sort: SortState<C>, col: C | undefined): "ascending" | "descending" | "none" | undefined {
  if (!col) return undefined; // an unsortable column must not claim sortability
  if (sort.col !== col) return "none";
  return sort.dir === "asc" ? "ascending" : "descending";
}
