// Per-column (per-role) distribution stats for the Fit Matrix (MAT2). Pure + no
// JSX so the math is unit-testable in isolation; MatrixShared renders the result.
// Turns "find the green cell" into a portfolio read — is a role deep-benched or a
// one-lucky-hit?

import { median } from "@/app/_lib/stats";
import { FIT_PROMISING_FLOOR, FIT_STRONG_FLOOR } from "@/app/_lib/fit-thresholds";

// The diverging score scale the grid paints, the histogram buckets and the legend
// rows all read. Ordered low → high; `min` is the inclusive floor of each band,
// `label` the legend string, `cellClass`/`fill` the Tailwind classes for the grid
// cell and the histogram bar.
//
// ONE SCALE WITH THE REST OF THE APP (challenge 2026-09-22 matrix-grid/A). The two
// tier edges are NOT this file's numbers: they are FIT_PROMISING_FLOOR and
// FIT_STRONG_FLOOR from app/_lib/fit-thresholds.ts, which test_fit_threshold_sync.py
// binds to matching.py::fit_tier_for — the scale focus mode's FitTierBadge, the
// rediscovery gate and the Candidates "Pool fit" filter already read. The grid used
// to keep a private 45/60/72/85 scale, so a (candidate, role) at 70-71 was a strong
// badge in focus mode and an unstarred, uncounted, "no strong fit" cell one segment
// over. Only the two cosmetic edges (40 inside partial, 85 inside strong) are local.
//
// This REVERSES the direction the previous revision chose on purpose. Its comment
// (skill-matrix-coverage #3) derived the min-fit floors FROM the bands, because the
// old inline [0, 55, 70] landed mid-band and "≥70" kept rows the grid painted
// non-strong. That defect was real, and it is still impossible here — but by the
// other construction: the tier floors now OPEN bands, so every floor is a band edge
// by definition (pinned: matrixStats.test.ts "every tier boundary opens a band").
// Deriving the floors from a private scale fixed the grid's internal consistency at
// the cost of disagreeing with every other match surface; deriving the scale from
// the shared floors keeps both.
const PARTIAL_SPLIT = 40; // cosmetic: separates "poor" from "near-promising" inside partial
const TOP_BAND = 85; // cosmetic: the deepest moss inside strong
const lbl = (lo: number, next: number) => `${lo}–${next - 1}`;

export const MATRIX_BANDS = [
  { min: 0, label: `<${PARTIAL_SPLIT}`, cellClass: "bg-coral/15 text-coral", fill: "bg-coral/40" },
  { min: PARTIAL_SPLIT, label: lbl(PARTIAL_SPLIT, FIT_PROMISING_FLOOR), cellClass: "bg-amber-100 text-amber-700", fill: "bg-amber-300" },
  { min: FIT_PROMISING_FLOOR, label: lbl(FIT_PROMISING_FLOOR, FIT_STRONG_FLOOR), cellClass: "bg-moss/20 text-moss", fill: "bg-moss/40" },
  { min: FIT_STRONG_FLOOR, label: lbl(FIT_STRONG_FLOOR, TOP_BAND), cellClass: "bg-moss/40 text-ink", fill: "bg-moss/60" },
  { min: TOP_BAND, label: `${TOP_BAND}+`, cellClass: "bg-moss/70 text-white", fill: "bg-moss/80" },
] as const;

// "Strong" fit boundary — the shared strong floor, which is also band 3's floor.
export const STRONG_THRESHOLD = FIT_STRONG_FLOOR;

// Min-fit filter offered floors: "off", the promising floor and the strong floor —
// the same two numbers the rediscovery gate and the "Pool fit" filter use, and both
// band edges by construction above (so the skill-matrix-coverage #3 mid-band defect
// cannot return).
export const MIN_FIT_FLOORS = [0, FIT_PROMISING_FLOOR, FIT_STRONG_FLOOR] as const;
// Histogram bucket edges = every band floor except the first (0).
const BAND_EDGES = MATRIX_BANDS.slice(1).map((b) => b.min); // 5 buckets, one per legend band

export type ColumnStat = {
  count: number; // scored (non-blocked) cells in the column
  best: number | null;
  median: number | null;
  strong: number; // count with score >= STRONG_THRESHOLD
  buckets: [number, number, number, number, number]; // counts per legend band
};

/** Distribution stats for one column's non-blocked scores (any order). An empty
 *  column (every cell blocked) reports zeros + null best/median, so the UI can
 *  render an honest "no fits" rather than NaN. */
export function columnStats(scores: number[]): ColumnStat {
  const buckets: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  if (scores.length === 0) {
    return { count: 0, best: null, median: null, strong: 0, buckets };
  }
  let strong = 0;
  for (const s of scores) {
    if (s >= STRONG_THRESHOLD) strong += 1;
    // band index = how many edges the score clears
    let b = 0;
    while (b < BAND_EDGES.length && s >= BAND_EDGES[b]) b += 1;
    buckets[b] += 1;
  }
  const sorted = [...scores].sort((a, b) => a - b);
  // The median is the shared one (app/_lib/stats.ts — non-finite dropped, even counts
  // averaged, empty ⇒ null); the FLOOR is this surface's own. Floor (not round) the
  // even-count midpoint so a band-straddling pair like [69, 70] reports 69, never
  // rounding UP to 70 and falsely crossing STRONG_THRESHOLD when only half the pool is
  // strong. Odd counts are already integers, so the floor is a no-op there.
  const mid = median(scores);
  return {
    count: scores.length,
    best: sorted[sorted.length - 1],
    median: mid === null ? null : Math.floor(mid),
    strong,
    buckets,
  };
}

/** The stat for a column with nothing scored in it. A module-level constant, not a
 *  literal at the render site: it crosses the memoized ColumnStats boundary, and a fresh
 *  `{ … }` per render would defeat the memo for exactly the columns that need it least. */
export const EMPTY_COLUMN_STAT: ColumnStat = { count: 0, best: null, median: null, strong: 0, buckets: [0, 0, 0, 0, 0] };

/** Titles of the visible roles with NO strong fit in the pool — the coverage banner's
 *  "source for these" list. A role is covered when any non-blocked score in its column
 *  reaches STRONG_THRESHOLD (the shared strong floor, so a 70 covers a role here exactly
 *  as it earns a strong badge in focus mode). A column absent from `colScores`, or
 *  holding only blocked cells, is uncovered. Pure, so the banner's most consequential
 *  claim is unit-tested rather than living inline in the hook. */
export function uncoveredRoles(
  cols: readonly { p: { title: string }; i: number }[],
  colScores: Readonly<Record<number, readonly number[]>>,
): string[] {
  const out: string[] = [];
  for (const { p, i } of cols) {
    if (!(colScores[i] ?? []).some((s) => s >= STRONG_THRESHOLD)) out.push(p.title);
  }
  return out;
}
