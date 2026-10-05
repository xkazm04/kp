/*
 * The /about phase list and its anchor ids (see below).
 */

/*
 * THE PHASE LIST IS DATA, AND THIS IS WHERE IT LIVES.
 *
 * The literal-array + derived-union idiom the repo uses for every closed
 * vocabulary (`i18n/locales.ts`, `features/shell/tabs.ts`): the order here IS
 * the order /about walks: `app/landing/site/about/steps.ts` re-exports it as
 * STEP_KEYS and keys its per-step paint off the union, AboutPage/AboutLine draw
 * one station per entry, `app/about/page.tsx` builds the JSON-LD HowTo from it,
 * and `MarketingClaims.test.ts` reads it to check that every phase carries copy
 * in all four catalogs. (The old AboutCurve and about-art/*Art.tsx it once fed
 * were retired on 2026-09-30; this module stays as the list's home.)
 *
 * `assignment` was missing until 2026-08-28. The landing's `#proof` band leads
 * with the work sample — it is the product's headline differentiator — and the
 * page that claims to walk "the whole pipeline" stepped straight from Screen to
 * Interview, so the one phase a visitor came to understand was the one phase
 * the timeline did not draw. It sits after `screen` because that is where the
 * case goes out (`aboutPage.steps.screen` used to carry a trailing sentence
 * about it) and before `interview` because the interview is grounded in what
 * the submission showed.
 */
export const ABOUT_STEP_KEYS = [
  "design",
  "source",
  "intake",
  "screen",
  "assignment",
  "interview",
  "offer",
  "hired"
] as const;

export type AboutStepKey = (typeof ABOUT_STEP_KEYS)[number];

/*
 * The step's anchor id — stable, page-order-based, and the SAME string the
 * About stepper, the JSON-LD HowTo and a shared `/about#step-07` link all use.
 * Deliberately not the phase key: the number is what the page shows on the
 * node and in the eyebrow, so `#step-07` is the id a reader can predict.
 */
export function aboutStepId(index: number): string {
  return `step-${String(index + 1).padStart(2, "0")}`;
}

/*
 * The rail's label for a step: "01 Design", "03 Příjem".
 *
 * DERIVED from the eyebrow the step already carries ("Step 01 · Design",
 * "Krok 03 · Příjem") rather than a second set of catalog keys — a nav entry
 * and the heading it jumps to must not be able to disagree, and eight keys × 4
 * locales of duplicated copy is exactly how they would. The number is taken
 * from the page order rather than parsed out of the string, so a locale that
 * mistypes it in the eyebrow (MarketingClaims.test.ts already fails on that)
 * still gets a correctly numbered rail. A locale that drops the separator
 * falls back to the whole eyebrow rather than to an empty label.
 */
export function aboutStepRailLabel(eyebrow: string, index: number): string {
  const short = eyebrow.includes("·") ? eyebrow.slice(eyebrow.lastIndexOf("·") + 1).trim() : "";
  const n = String(index + 1).padStart(2, "0");
  return short ? `${n} ${short}` : eyebrow.trim();
}
