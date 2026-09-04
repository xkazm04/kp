// Per-column (per-role) distribution stats for the Fit Matrix (MAT2). Pure + no
// JSX so the math is unit-testable in isolation; MatrixShared renders the result.
// Turns "find the green cell" into a portfolio read — is a role deep-benched or a
// one-lucky-hit?

import { median } from "@/app/_lib/stats";

// Single source of truth for the diverging score scale (45/60/72/85 edges). The
// grid cell color (cellClass), the histogram fill (BAND_FILL), the legend rows,
// and the histogram bucket edges are all derived from this one ordered table, so
// re-banding the heatmap is a one-place edit and the legend can never claim an
// edge the grid doesn't actually use. Ordered low → high; `min` is the inclusive
// floor of each band. `label` is the legend string. `cellClass`/`fill` are the
// Tailwind classes for the grid cell and the histogram bar respectively.
export const MATRIX_BANDS = [
  { min: 0, label: "<45", cellClass: "bg-coral/15 text-coral", fill: "bg-coral/40" },
  { min: 45, label: "45–59", cellClass: "bg-amber-100 text-amber-700", fill: "bg-amber-300" },
  { min: 60, label: "60–71", cellClass: "bg-moss/20 text-moss", fill: "bg-moss/40" },
  { min: 72, label: "72–84", cellClass: "bg-moss/40 text-ink", fill: "bg-moss/60" },
  { min: 85, label: "85+", cellClass: "bg-moss/70 text-white", fill: "bg-moss/80" },
] as const;

// "Strong" fit boundary — the moss threshold cellClass uses (band index 3's floor).
export const STRONG_THRESHOLD = MATRIX_BANDS[3].min; // 72

// Min-fit filter offered floors, DERIVED from the bands so they line up with the
// heatmap the recruiter reads (skill-matrix-coverage #3): "off" (0), the amber
// floor (45, the first non-coral band), and "strong" (72, STRONG_THRESHOLD). The
// old inline [0, 55, 70] landed mid-band, so "≥70" survived rows the grid renders
// non-strong and unstarred. Re-banding MATRIX_BANDS now updates these too.
export const MIN_FIT_FLOORS = [0, MATRIX_BANDS[1].min, STRONG_THRESHOLD] as const; // [0, 45, 72]
// Histogram bucket edges = every band floor except the first (0): 45, 60, 72, 85.
const BAND_EDGES = MATRIX_BANDS.slice(1).map((b) => b.min); // 5 buckets: <45, 45–59, 60–71, 72–84, 85+

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
  // even-count midpoint so a band-straddling pair like [71, 72] reports 71, never
  // rounding UP to 72 and falsely crossing STRONG_THRESHOLD when only half the pool is
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
