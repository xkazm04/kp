// The Orchard's pure layout: which band a ticket hangs in, which salary branch it
// grows on, and where the two corner callouts go. No React — unit-testable.

import { scoreTone } from "@/app/_lib/format";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { boardScoreOf } from "../mapAvatar";

/** Score bands, top row first. `scoreTone`'s own 75/50 cutoffs — restated as an
 *  ordered tuple because the layout needs a ROW ORDER, which a Record has not. */
export const BAND_ORDER = ["strong", "mid", "weak"] as const;
export type ScoreBand = (typeof BAND_ORDER)[number];

/** Round bucket widths, in whatever currency the band is in. The floor is picked
 *  from the magnitude (see `salaryBranches`), so a 60k CZK band and a 4k EUR band
 *  both get sensible columns. */
const NICE_STEPS = [100, 250, 500, 1000, 2500, 5000, 10000, 15000, 20000, 25000, 50000, 100000] as const;
const MAX_BRANCHES = 6;
/** A bucket narrower than 1/12 of the top salary is noise, not a column. */
const MAGNITUDE_DIVISOR = 12;

export type BranchPoint = { id: string; midpoint: number };

export type SalaryBranch = {
  /** Bucket floor / ceiling; the bucket is [lo, hi). */
  lo: number;
  hi: number;
  /** Member ids, in the order they arrived (the caller sorts by score first). */
  ids: string[];
};

export type BranchFit = "inside" | "above" | "below";

/** Which score band a ticket hangs in. A null score never reaches the tree (it
 *  goes to the unscored bay), so the "null" tone folds into weak defensively. */
export function bandOf(score: number | null | undefined): ScoreBand {
  const tone = scoreTone(score);
  return tone === "null" ? "weak" : tone;
}

/**
 * Salary branches, ascending. Take the SMALLEST round step at or above the
 * magnitude floor whose buckets hold the midpoints in at most MAX_BRANCHES
 * non-empty columns, then drop the empty ones.
 *
 * Counting NON-EMPTY buckets rather than the index span matters: a cell with two
 * clusters 60k apart would otherwise be forced to a wide step and lose the
 * separation that is the whole point of the column. Pure and deterministic.
 */
export function salaryBranches(points: readonly BranchPoint[]): SalaryBranch[] {
  if (points.length === 0) return [];
  const top = Math.max(...points.map((p) => p.midpoint));
  const floor = NICE_STEPS.filter((s) => s <= top / MAGNITUDE_DIVISOR).at(-1) ?? NICE_STEPS[0];
  const steps = NICE_STEPS.filter((s) => s >= floor);
  const step =
    steps.find((s) => new Set(points.map((p) => Math.floor(p.midpoint / s))).size <= MAX_BRANCHES) ??
    NICE_STEPS[NICE_STEPS.length - 1];

  const byBucket = new Map<number, string[]>();
  for (const p of points) {
    const key = Math.floor(p.midpoint / step);
    const bucket = byBucket.get(key);
    if (bucket) bucket.push(p.id);
    else byBucket.set(key, [p.id]);
  }
  return [...byBucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, ids]) => ({ lo: key * step, hi: (key + 1) * step, ids }));
}

/** Where a branch sits against the role's own band. `null` = the ranking carried
 *  no band, so there is nothing honest to say. */
export function branchFit(branch: SalaryBranch, roleBand: [number, number] | null): BranchFit | null {
  if (!roleBand) return null;
  const [lo, hi] = roleBand;
  if (branch.lo <= hi && branch.hi >= lo) return "inside";
  return branch.lo > hi ? "above" : "below";
}

export type BandCounts = Record<ScoreBand | "unscored", number>;

export function countBands(entries: readonly Entry[]): BandCounts {
  const counts: BandCounts = { weak: 0, mid: 0, strong: 0, unscored: 0 };
  for (const e of entries) {
    const tone = scoreTone(boardScoreOf(e));
    counts[tone === "null" ? "unscored" : tone] += 1;
  }
  return counts;
}

/** One rendered row of the orchard: a score band plus, per branch, the tickets of
 *  that branch that fall in it (already score-descending). Empty bands are dropped. */
export type BandRow = { band: ScoreBand; cells: Entry[][]; total: number };

export function buildRows(branches: readonly SalaryBranch[], byId: ReadonlyMap<string, Entry>): BandRow[] {
  const rows: BandRow[] = [];
  for (const band of BAND_ORDER) {
    const cells = branches.map((b) =>
      b.ids.flatMap((id) => {
        const e = byId.get(id);
        return e && bandOf(boardScoreOf(e)) === band ? [e] : [];
      }),
    );
    const total = cells.reduce((n, c) => n + c.length, 0);
    if (total > 0) rows.push({ band, cells, total });
  }
  return rows;
}

/** The two corner callouts, on the TOP rendered band only, and only when its
 *  left-most and right-most occupied cells are different cells (-1 = none). */
export function cornerCallouts(rows: readonly BandRow[]): { gemsAt: number; prosAt: number } {
  const occupied = (rows[0]?.cells ?? []).flatMap((c, i) => (c.length > 0 ? [i] : []));
  if (occupied.length < 2) return { gemsAt: -1, prosAt: -1 };
  return { gemsAt: occupied[0], prosAt: occupied[occupied.length - 1] };
}
