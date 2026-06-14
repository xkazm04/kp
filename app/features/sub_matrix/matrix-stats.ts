// Per-column (per-role) distribution stats for the Fit Matrix (MAT2). Pure + no
// JSX so the math is unit-testable in isolation; MatrixShared renders the result.
// Turns "find the green cell" into a portfolio read — is a role deep-benched or a
// one-lucky-hit?

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
  const mid = Math.floor(sorted.length / 2);
  // Floor (not round) the even-count midpoint so a band-straddling pair like [71, 72] reports
  // 71, never rounding UP to 72 and falsely crossing STRONG_THRESHOLD when only half the pool
  // is strong. The "median averages the two middles" test (exact integer) is unaffected.
  const median =
    sorted.length % 2 === 0 ? Math.floor((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
  return {
    count: scores.length,
    best: sorted[sorted.length - 1],
    median,
    strong,
    buckets,
  };
}
