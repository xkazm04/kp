// Pure band taxonomy for ScoreDial, extracted so the score→band mapping is
// unit-testable under `node --test` and the .tsx can localize the labels.

// bug-ui-scan-2026-07-09 (analysis-result-panels #3): the five verdict-band words
// (and the dial's aria-label) were hardcoded English on a bilingual report. The
// band CUTOFFS live here (locale-independent); the LABELS now resolve through
// `messages.report.scoreBands.*` in the component. `as const` keeps each `key` a
// literal so next-intl's `t()` accepts it (the repo's template-literal-key rule).
export const SCORE_BANDS = [
  { from: 0, to: 40, key: "scoreBands.early" },
  { from: 40, to: 55, key: "scoreBands.developing" },
  { from: 55, to: 70, key: "scoreBands.solid" },
  { from: 70, to: 85, key: "scoreBands.strong" },
  { from: 85, to: 100, key: "scoreBands.excellent" },
] as const;

export type ScoreBand = (typeof SCORE_BANDS)[number];

/** The index into {@link SCORE_BANDS} a 0..100 score falls in (upper-bound inclusive). */
export function scoreBandIndex(score: number): number {
  if (score <= 40) return 0;
  if (score <= 55) return 1;
  if (score <= 70) return 2;
  if (score <= 85) return 3;
  return 4;
}
