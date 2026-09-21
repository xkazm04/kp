// The pure half of the role's Candidates tab — everything the three variants
// (Ladder / Rungs / Grid) read, derived ONCE and shared, so a layout experiment
// can never change what the surface claims about a candidate.
//
// Nothing here touches React or the DOM: the rank a row wears, the band it falls
// in, the three strengths and two gaps its chips show, and the free-text filter
// are all decisions about DATA, and they are pinned by candidatesModel.test.ts.
// A variant is then only a layout over `LadderRow[]`.

import type { CandRow } from "../JobsTypes";
import { FIT_PROMISING_FLOOR, FIT_STRONG_FLOOR } from "@/app/_lib/fit-thresholds";

/** Score bands the Ladder tints its score cell with. The two floors are the app's shared fit thresholds — a band boundary
 *  invented here would put this surface out of step with every other one. */
export const SCORE_BANDS = ["strong", "mid", "weak", "notEligible"] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export function bandOf(row: { eligible: boolean; score: number }): ScoreBand {
  if (!row.eligible) return "notEligible";
  if (row.score >= FIT_STRONG_FLOOR) return "strong";
  if (row.score >= FIT_PROMISING_FLOOR) return "mid";
  return "weak";
}

/** How many strengths and gaps a compact row shows. Deliberately asymmetric: the
 *  gaps are the decision-relevant half and a long gap list reads as a verdict, so
 *  it stays the shorter of the two. */
export const MAX_STRENGTHS = 3;
export const MAX_GAPS = 2;

export type LadderRow = {
  /** The payload row, kept whole so a variant can reach for anything else. */
  c: CandRow;
  id: string;
  label: string;
  /** 1-based position in the ordered, eligible pool. 0 for a KO-filtered row —
   *  a candidate the ranking excluded has no rank, and printing one would claim
   *  an ordering the engine never made. */
  rank: number;
  /** THE number this row shows: the robust cross-scheme mean when Fair Rank is
   *  on, the candidate's own-weight total otherwise. */
  score: number;
  /** The own-weight total, always — so Fair Rank can state the delta. */
  ownScore: number;
  eligible: boolean;
  early: boolean;
  /** The stage of this candidate's active entry for THIS role, or null. It is
   *  also the modal bridge's gate: a row with a stage has an entry to open. */
  stage: string | null;
  outreachSent: boolean;
  strengths: string[];
  gaps: string[];
  koReasons: string[];
  /** Excluded on ONE reason — the candidates a relaxed must-have on the JD would
   *  rescue. A count of "12 not eligible" cannot say that, and it is the most
   *  actionable fact the KO cohort carries. */
  nearMiss: boolean;
  band: ScoreBand;
};

/** What every variant is handed. The three layouts differ in SHAPE, never in
 *  what they are given — so a fact one of them shows is a fact all of them
 *  could, and none can quietly drop a caveat by being a different file. */
export type VariantProps = {
  /** Eligible rows, ordered and already narrowed by the Pool Fit toggle. */
  rows: LadderRow[];
  /** The KO-filtered cohort. Never mixed into `rows` — see bandOf. */
  notEligible: LadderRow[];
  /** The candidate whose modal is being fetched, for a per-row busy state. */
  opening: string | null;
  onOpen: (c: CandRow) => void;
};

type FairLookup = (id: string) => { own: number; mean: number; delta: number } | undefined;

/**
 * Turn the payload's candidates into the shared row model.
 *
 * `rows` arrives already ordered and already partitioned by the caller, so the
 * rank is the array index: this function decides PRESENTATION facts (which
 * skills fit on a chip strip, which band a score falls in), never ordering.
 */
export function buildLadderRows(
  rows: readonly CandRow[],
  opts: { fair?: FairLookup; early?: (c: CandRow) => boolean } = {},
): LadderRow[] {
  return rows.map((c, i) => {
    const own = c.result.total;
    const score = opts.fair?.(c.candidateId)?.mean ?? own;
    const eligible = c.koPassed;
    const row = {
      c,
      id: c.candidateId || `${c.label}-${i}`,
      label: c.label,
      rank: eligible ? i + 1 : 0,
      score,
      ownScore: own,
      eligible,
      early: opts.early?.(c) ?? false,
      stage: c.inPipeline ?? null,
      outreachSent: c.outreachSent === true,
      strengths: (c.result.matchedSkills ?? []).slice(0, MAX_STRENGTHS),
      gaps: (c.result.missingSkills ?? []).slice(0, MAX_GAPS),
      koReasons: c.koReasons ?? [],
      nearMiss: !eligible && (c.koReasons ?? []).length === 1,
    };
    return { ...row, band: bandOf(row) };
  });
}

/** Near-misses first in the KO cohort — one blocking reason before two, two
 *  before three. The engine's own order inside a tier is preserved (a stable
 *  sort on a stable input), so this only lifts the rescuable candidates. */
export function orderNotEligible(rows: readonly LadderRow[]): LadderRow[] {
  return [...rows].sort((a, b) => a.koReasons.length - b.koReasons.length);
}

/** Group the rows into bands, in SCORE_BANDS order, dropping empty ones — a band
 *  header reading "0" is chrome that can only ever say nothing. Order inside a
 *  band is the order handed in (the engine's / Fair Rank's). */
export function groupByBand(rows: readonly LadderRow[]): { band: ScoreBand; rows: LadderRow[] }[] {
  return SCORE_BANDS.map((band) => ({ band, rows: rows.filter((r) => r.band === band) })).filter(
    (g) => g.rows.length > 0,
  );
}

/** The Ladder's column filters: a free-text name match and an exact stage match
 *  (`""` = no filter on that column). Case- and diacritic-insensitive on the name
 *  so "sarka" finds "Šárka" — the roster's rule, applied here. */
export function filterRows(
  rows: readonly LadderRow[],
  filters: { name?: string; stage?: string },
): LadderRow[] {
  const name = fold(filters.name ?? "");
  const stage = filters.stage ?? "";
  return rows.filter((r) => {
    if (name && !fold(r.label).includes(name)) return false;
    if (stage && (r.stage ?? "") !== stage) return false;
    return true;
  });
}

function fold(value: string): string {
  return value.trim().toLocaleLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/** The distinct stages present in the pool, for the Stage column's option list.
 *  Sorted by first appearance, which is the engine's ranked order — not
 *  alphabetical, which would scramble a funnel into "Hired, Offer, Screened". */
export function stageOptions(rows: readonly LadderRow[]): string[] {
  const seen: string[] = [];
  for (const r of rows) if (r.stage && !seen.includes(r.stage)) seen.push(r.stage);
  return seen;
}

/** A band's share of the whole pool, 0-100, for the Rungs band bar. Returns 0 on
 *  an empty pool rather than NaN — a width of "NaN%" silently paints full. */
export function bandShare(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100);
}
