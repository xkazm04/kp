/**
 * What the verdict banner SAYS, as opposed to what it paints.
 *
 * The banner is `role="img"` — one of ARIA's presentational-children roles — so
 * every descendant is dropped from the accessibility tree and the single
 * `aria-label` is the entire banner to a screen reader. It once carried the
 * score and the band only, which meant that on a multi-variant run the one fact
 * the banner exists to deliver (WHICH CV won) was announced nowhere.
 *
 * The composition lives here, away from the JSX, so it can be exercised over all
 * four framings and every optional part without a renderer — and so the rule
 * that the spoken banner says exactly what the painted one does is written down
 * somewhere a test can read.
 *
 * The parts are the SAME already-localized strings the chips render (no
 * banner-only catalog keys), passed in as a `t` so this module stays pure.
 */
import type { ScoreTone } from "@/app/_lib/format";

/** Tone → the framing sentence printed under the readout AND spoken last. */
export const FRAMING_KEY: Record<ScoreTone, "verdict.framingStrong" | "verdict.framingMid" | "verdict.framingWeak" | "verdict.framingNone"> = {
  strong: "verdict.framingStrong",
  mid: "verdict.framingMid",
  weak: "verdict.framingWeak",
  null: "verdict.framingNone",
};

/**
 * The `report` namespace's translator, narrowed to the keys this module asks
 * for. Narrow ON PURPOSE: next-intl types `t` against the catalog, so widening
 * this to `(key: string)` would make the real translator unassignable AND would
 * let this module invent a key the catalogs do not carry.
 */
export type VerdictAriaKey =
  | "verdict.aria"
  | "verdict.ariaUnscored"
  | "verdict.jobFit"
  | "verdict.winner"
  | (typeof FRAMING_KEY)[ScoreTone];
export type VerdictTranslate = (key: VerdictAriaKey, values?: Record<string, string | number>) => string;

export interface VerdictAriaInput {
  /** 0..100, or null when there was not enough to score. */
  overall: number | null;
  /** The band word, already localized — null on an unscored run. */
  band: string | null;
  jobFit: number | null;
  winnerLabel: string | null;
  tone: ScoreTone;
}

/**
 * Score/band (or the honest "not enough data"), then job fit, then the crowned
 * winner, then the framing — the reading order of the painted banner. Absent
 * parts are dropped rather than spoken as empty, and an unscored run never
 * announces a fabricated band.
 */
export function verdictAriaLabel(t: VerdictTranslate, { overall, band, jobFit, winnerLabel, tone }: VerdictAriaInput): string {
  return [
    overall != null && band != null ? t("verdict.aria", { score: overall, band }) : t("verdict.ariaUnscored"),
    jobFit != null ? t("verdict.jobFit", { score: jobFit }) : null,
    winnerLabel ? t("verdict.winner", { label: winnerLabel }) : null,
    t(FRAMING_KEY[tone]),
  ]
    .filter((part): part is string => !!part)
    .join(". ");
}
