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

import { useLocale } from "next-intl";
import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc";
export type SortState<C extends string> = { col: C; dir: SortDir };

/** What a column contributes to the ordering. Null/undefined = "no value". */
export type SortCell = string | number | boolean | null | undefined;

/** Per-column value extractors — the shape a caller declares its columns with. */
export type SortAccessors<T, C extends string> = Record<C, (row: T) => SortCell>;

const isMissing = (v: SortCell): boolean => v === null || v === undefined || v === "";

// One collator per locale, built once. `localeCompare(…, opts)` constructs a
// fresh collator on EVERY call, and a 200-row sort is ~1500 calls — but the real
// reason this is a map keyed by locale is the argument it makes impossible to
// forget: the collation locale is a parameter, never the ambient default.
const COLLATORS = new Map<string, Intl.Collator>();
function collatorFor(locale: string | undefined): Intl.Collator {
  const key = locale ?? "";
  let c = COLLATORS.get(key);
  if (!c) {
    c = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    COLLATORS.set(key, c);
  }
  return c;
}

/**
 * Compare two cells for `dir`, with missing values pinned last in BOTH
 * directions. Numbers compare numerically, booleans as false < true, and strings
 * through a collator with `numeric` on — so "Role 2" sorts before "Role 10"
 * instead of the codepoint order that puts "10" first.
 *
 * `locale` is the READER's locale (useTableSort threads next-intl's active one
 * in). Omitting it falls back to the runtime default, which is the bug this
 * parameter exists to close: the runtime default is the SERVER's locale during
 * SSR (`en-US` under Node) and the BROWSER's afterwards, neither of which is the
 * language the app is being read in. Czech collation is not a cosmetic
 * difference — `š`/`č`/`ř`/`ž` are their own letters there, so under `en` a
 * roster orders "Švec, Sýkora, Tesař" where a Czech reader expects "Sýkora,
 * Švec, Tesař", and the two orders disagree across hydration.
 */
export function compareCells(a: SortCell, b: SortCell, dir: SortDir, locale?: string): number {
  const aMissing = isMissing(a);
  const bMissing = isMissing(b);
  // Pinned before the direction flip is applied — that is the whole point.
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  let cmp: number;
  if (typeof a === "number" && typeof b === "number") cmp = a - b;
  else if (typeof a === "boolean" || typeof b === "boolean") cmp = Number(a) - Number(b);
  else cmp = collatorFor(locale).compare(String(a), String(b));

  return dir === "desc" ? -cmp : cmp;
}

/**
 * The direction a column starts in when the reader first sorts by it: DESCENDING
 * for a numeric column ("sort by hires" means "most hires first"), ascending
 * otherwise ("sort by role" means A–Z).
 *
 * It samples the first row that actually HAS a value rather than row 0, because a
 * missing cell has no type to read: an Economics board whose top channel has no
 * spend entered (`null`) sampled `null`, decided "not a number", and opened the
 * Spend column cheapest-first — the exact opposite of what the click meant, on a
 * column where the reader is looking for the biggest number.
 */
export function initialDir<T>(rows: readonly T[], get: (row: T) => SortCell): SortDir {
  for (const row of rows) {
    const sample = get(row);
    if (isMissing(sample)) continue;
    return typeof sample === "number" ? "desc" : "asc";
  }
  return "asc";
}

/**
 * Sort `rows` by the active column. Returns the sorted copy (never mutates the
 * input — callers pass arrays they also render unsorted elsewhere), the current
 * state, and a `toggle` that flips direction on the active column and otherwise
 * moves to the new one.
 *
 * A new column starts DESCENDING when it reads as numeric and ascending
 * otherwise (see initialDir): "sort by hires" almost always means "most hires
 * first", while "sort by role" means A–Z. Getting this wrong costs the reader a
 * second click on every single column, every time.
 */
export function useTableSort<T, C extends string>(
  rows: readonly T[],
  accessors: SortAccessors<T, C>,
  initial: SortState<C>
): { sorted: T[]; sort: SortState<C>; toggle: (col: C) => void } {
  const [sort, setSort] = useState<SortState<C>>(initial);
  // The READER's locale, not the runtime's — see compareCells.
  const locale = useLocale();

  const toggle = (col: C) => {
    setSort((prev) => {
      if (prev.col === col) return { col, dir: prev.dir === "asc" ? "desc" : "asc" };
      return { col, dir: initialDir(rows, accessors[col]) };
    });
  };

  const sorted = useMemo(() => {
    const get = accessors[sort.col];
    if (!get) return [...rows];
    return [...rows].sort((a, b) => compareCells(get(a), get(b), sort.dir, locale));
    // `accessors` is an object literal at most call sites (new identity each
    // render), so it is intentionally NOT a dependency — the column KEY is what
    // selects the extractor, and re-sorting on every render is the bug this
    // memo exists to prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort.col, sort.dir, locale]);

  return { sorted, sort, toggle };
}

/** The `aria-sort` value for a header cell — "none" unless it is the active column. */
export function ariaSort<C extends string>(sort: SortState<C>, col: C | undefined): "ascending" | "descending" | "none" | undefined {
  if (!col) return undefined; // an unsortable column must not claim sortability
  if (sort.col !== col) return "none";
  return sort.dir === "asc" ? "ascending" : "descending";
}
