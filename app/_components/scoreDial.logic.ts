// Pure band taxonomy for ScoreDial, extracted so the score→band mapping is
// unit-testable under `node --test` and the .tsx can localize the labels.

// bug-ui-scan-2026-07-09 (analysis-result-panels #3): the five verdict-band words
// (and the dial's aria-label) were hardcoded English on a bilingual report. The
// band CUTOFFS live here (locale-independent); the LABELS now resolve through
// `messages.report.scoreBands.*` in the component. `as const` keeps each `key` a
// literal so next-intl's `t()` accepts it (the repo's template-literal-key rule).
//
// Named VERDICT_BANDS, not SCORE_BANDS: the pipeline board exports its own
// `SCORE_BANDS` (`app/features/hiring/pipeline/pipelineBoardFilters.ts`) and it is
// a DIFFERENT vocabulary — four filter buckets ("strong"/"mid"/"weak"/"unscored")
// keyed off `scoreTone`'s 50/75 split, not these five 40/55/70/85 verdict words.
// Two unrelated modules exporting one name is how a reviewer reads a call site
// wrong; the two are now distinguishable at the import.
export const VERDICT_BANDS = [
  { from: 0, to: 40, key: "scoreBands.early" },
  { from: 40, to: 55, key: "scoreBands.developing" },
  { from: 55, to: 70, key: "scoreBands.solid" },
  { from: 70, to: 85, key: "scoreBands.strong" },
  { from: 85, to: 100, key: "scoreBands.excellent" },
] as const;

export type ScoreBand = (typeof VERDICT_BANDS)[number];

/**
 * The index into {@link VERDICT_BANDS} a 0..100 score falls in (upper-bound
 * inclusive, so 40 is still "early").
 *
 * DERIVED from the table rather than re-stating it. The cutoffs used to appear
 * twice in this one file — once as `to:` values the dial draws its arc segments
 * from, once as a hand-written `if` ladder — with nothing asserting the two
 * agreed. Editing one and not the other would have moved the arc without moving
 * the word (or the reverse), which is the exact failure mode a verdict readout
 * cannot have. There is one table now, and `scoreDial.logic.test.ts` pins that
 * this function is a pure function OF it.
 */
export function scoreBandIndex(score: number): number {
  const i = VERDICT_BANDS.findIndex((band) => score <= band.to);
  // Above the last cutoff (or a non-finite score the caller did not clamp) lands
  // in the top band, matching the ladder this replaced.
  return i === -1 ? VERDICT_BANDS.length - 1 : i;
}
