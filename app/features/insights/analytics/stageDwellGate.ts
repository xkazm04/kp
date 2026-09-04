// The dwell band's gate and bar scale, as pure functions.
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
// screen (no org sets a per-stage dwell goal), with a 2 % floor so the shortest wait
// is still a visible mark rather than an invisible zero-width bar.

export type StageDwell = { stage: string; avgDays: number; count: number };

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

/** The longest wait on screen, which every bar is scaled against. Never 0, so the
 *  scale cannot divide by zero on an all-same-day corpus. */
export function dwellMaxDays(stageDwell: readonly StageDwell[]): number {
  return Math.max(1, ...stageDwell.map((s) => s.avgDays));
}

/** A bar's width as a percentage of the longest wait, floored at 2 % so the shortest
 *  stage still draws a mark. */
export function dwellBarPct(avgDays: number, maxDays: number): number {
  return Math.max(2, Math.round((avgDays / maxDays) * 100));
}
