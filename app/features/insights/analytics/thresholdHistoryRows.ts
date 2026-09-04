// The floor-over-time strip's row model, as pure functions.
//
// WHY IT IS A MODULE. The strip printed an unknown floor as `0`: `t("historyApply",
// { previous: p.previous ?? 0, next: p.next ?? 0 })`. Both fields are nullable — the
// FIRST sealed apply has no prior floor to name, and a record written before the
// band was captured has neither — so the very first change in a workspace's history
// read as "0 → 40": a fabricated prior floor, in the one strip whose whole claim is
// that it is backed by a tamper-evident seal, and in the sr-only list that is the
// non-sighted reader's ONLY access to the plot. The plot beside it already did the
// honest thing and skipped nulls (`plottable`), so the same payload was drawn as
// "unknown" and read out as "zero" on one screen.
//
// Kept free of React and next-intl (like calibrationVerdict.ts) so the rule is
// pinned by an executing test rather than by grepping a .tsx.

/** One sealed apply of the auto-reject floor, as the history route returns it. */
export type ThresholdHistoryPoint = {
  seq: number;
  contentHash: string;
  at: string;
  approvedBy: string | null;
  direction: "lower" | "raise" | null;
  previous: number | null;
  next: number | null;
  band: { lo: number; hi: number } | null;
  n: number | null;
  advanceRatePct: number | null;
  roleFamily: string | null;
};

/** What an unmeasured floor renders as. An em dash, not a zero: the tab's own answer
 *  for a number that does not exist (the stat cluster renders "—" for a window with
 *  no hires). Not a catalog key — it is a typographic placeholder, identical in all
 *  four locales, and the sentence around it is already translated. */
export const UNKNOWN_FLOOR = "—";

/** A floor value for interpolation into a translated sentence: the number when it is
 *  known, the dash when it is not. `0` is a LEGITIMATE floor (accept everything), so
 *  it must keep printing as 0 — which is exactly why `?? 0` was unsalvageable. */
export function floorLabel(value: number | null): number | string {
  return value == null ? UNKNOWN_FLOOR : value;
}

/** The ICU values for `historyApply` / `historyPoint`. */
export function historyRowValues(point: ThresholdHistoryPoint): {
  previous: number | string;
  next: number | string;
  at: string;
} {
  return { previous: floorLabel(point.previous), next: floorLabel(point.next), at: stripDate(point.at) };
}

/** The date the strip prints beside an apply: the ISO day, or the raw string when the
 *  record carries something shorter than one. */
export function stripDate(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

/** Oldest → newest, for the plot and the sr-only list; the record list keeps the
 *  store's newest-first order. Never mutates the caller's array. */
export function chronological(history: readonly ThresholdHistoryPoint[]): ThresholdHistoryPoint[] {
  return [...history].reverse();
}
