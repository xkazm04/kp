// The dwell band's gate, bar scale and row model, as pure functions.
//
// WHY IT IS A MODULE. The band answers three questions that live on different sides
// of the funnel — the KO-gate discards BEFORE the first stage, how long the people
// inside the stages have been sitting, and the offer leg AFTER the last one — and it
// renders nothing when all three are empty, because the funnel band above already
// carries the brief's one „not yet" and a second refusal in the same voice two inches
// below is louder, not more honest. That gate was an inline `&&` chain in the JSX,
// where a `.tsx` cannot be executed by `npm run test:unit`: the rule that decides
// whether a whole band of the briefing appears was covered by nothing.
//
// The bar scale is here for the same reason. It is relative to the LONGEST wait on
// screen (the oldest occupant when the payload names one), with a 2 % floor so the
// shortest wait is still a visible mark rather than an invisible zero-width bar.
//
// The row model (challenge-r05 analytics-metrics/B) is here because it holds the
// three rules the band's honesty rests on, and each is a rule a `.tsx` would hide:
//   - SMALL SAMPLE: below BOTTLENECK_MIN_SAMPLE occupants no median is claimed, only
//     the count and the oldest (the repo's one named floor for a per-stage dwell claim);
//   - NO VERDICT WITHOUT A GOAL SOMEONE SET: the past-cadence count is coloured over /
//     within only against a cadence the TEAM set (`slaDays` on the axis); against the
//     shipped role default it is a neutral surfacing count;
//   - ACTIONABLE: the past-cadence count links to exactly those cards on the board,
//     `?stage=X&quick=aging`, whose predicate is the same aging clock
//     (aging-policy.ts `agingTierAt`, tier !== "none") the server counted with.
import type { StageDef } from "@/app/_lib/pipeline-stages";
import { BOTTLENECK_MIN_SAMPLE } from "@/app/_lib/analytics-bottleneck";

/** Where a row's cadence came from: a value the team set on its axis, or the
 *  shipped default for the column's role. */
export type DwellCadenceSource = "team" | "default";

/** One row of the dwell band. `avgDays` and `count` are the original shape; the rest
 *  is the as-of-now read (app/_lib/db/analytics-stage-dwell.ts) and is optional so a
 *  payload from before it still renders, as the old neutral row. */
export type StageDwell = {
  stage: string;
  avgDays: number;
  count: number;
  /** Median whole days in stage over the current occupants. */
  medianDays?: number | null;
  /** The longest current wait, in whole days. */
  oldestDays?: number;
  /** Occupants at or past the cadence — aging AND stalled, the board's ?quick=aging set. */
  pastCadence?: number;
  /** Of those, the ones past STALLED_MULTIPLE x the cadence. */
  stalled?: number;
  cadenceDays?: number;
  cadenceSource?: DwellCadenceSource;
  /** Whether this column carries a cadence a team may set (cadenceEditable). */
  cadenceEditable?: boolean;
};

/** Does the band have anything at all to report? Any ONE of the three edges is
 *  enough — the KO line alone is a real finding (an ad attracting mostly ineligible
 *  applicants reads as a healthy low-volume channel without it). */
export function dwellBandHasContent(
  stageDwell: readonly StageDwell[],
  koDeclined: number,
  offersExtended: number
): boolean {
  return stageDwell.length > 0 || koDeclined > 0 || offersExtended > 0;
}

/** How many people are waiting across every stage — the band's headline count. */
export function dwellWaiting(stageDwell: readonly StageDwell[]): number {
  return stageDwell.reduce((sum, s) => sum + s.count, 0);
}

/** The figure a row's bar draws: the oldest occupant when the payload names one (the
 *  one who never exits is the pathology a dwell view exists to show), else the mean. */
export function dwellBarDays(s: StageDwell): number {
  return typeof s.oldestDays === "number" ? s.oldestDays : s.avgDays;
}

/** The longest wait on screen, which every bar is scaled against. Never 0, so the
 *  scale cannot divide by zero on an all-same-day corpus. */
export function dwellMaxDays(stageDwell: readonly StageDwell[]): number {
  return Math.max(1, ...stageDwell.map(dwellBarDays));
}

/** A bar's width as a percentage of the longest wait, floored at 2 % so the shortest
 *  stage still draws a mark. */
export function dwellBarPct(avgDays: number, maxDays: number): number {
  return Math.max(2, Math.round((avgDays / maxDays) * 100));
}

/** The board filter for a stage's past-cadence cards, or null when there are none
 *  (a link to an empty list is a promise the board cannot keep). */
export function dwellBoardFilter(stage: string, pastCadence: number): { stage: string; quick: "aging" } | null {
  return pastCadence > 0 ? { stage, quick: "aging" } : null;
}

/** May a team set this column's cadence? Every LIVE column except the one playing
 *  the terminal role (a hire has no clock; the route refuses it too). A column this
 *  axis does not draw has nothing to tune. */
export function cadenceEditable(stage: string, axis: readonly StageDef[]): boolean {
  const def = axis.find((s) => s.id === stage);
  return def != null && def.role !== "terminal";
}

export type DwellTone = "neutral" | "over" | "within";

export type DwellRowModel = {
  /** `thin` below BOTTLENECK_MIN_SAMPLE occupants: no median is claimed. */
  sample: "thin" | "enough";
  count: number;
  /** Null when thin, or when the payload predates the as-of-now read. */
  medianDays: number | null;
  oldestDays: number | null;
  pastCadence: number;
  cadenceDays: number | null;
  cadenceSource: DwellCadenceSource | null;
  tone: DwellTone;
  link: { stage: string; quick: "aging" } | null;
};

/** What one dwell row may claim. */
export function dwellRowModel(s: StageDwell): DwellRowModel {
  const sample = s.count >= BOTTLENECK_MIN_SAMPLE ? "enough" : "thin";
  const pastCadence = typeof s.pastCadence === "number" ? s.pastCadence : 0;
  const cadenceSource = s.cadenceSource ?? null;
  const tone: DwellTone = cadenceSource === "team" ? (pastCadence > 0 ? "over" : "within") : "neutral";
  return {
    sample,
    count: s.count,
    medianDays: sample === "enough" && typeof s.medianDays === "number" ? s.medianDays : null,
    oldestDays: typeof s.oldestDays === "number" ? s.oldestDays : null,
    pastCadence,
    cadenceDays: typeof s.cadenceDays === "number" ? s.cadenceDays : null,
    cadenceSource,
    tone,
    link: dwellBoardFilter(s.stage, pastCadence),
  };
}
