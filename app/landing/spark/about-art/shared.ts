/*
 * Shared choreography for the /about step illustrations.
 *
 * Every step art replays when it re-enters the viewport (`once: false`), so
 * scrolling the page up and down keeps it alive. These two constants were
 * duplicated into each of the seven illustrations back when they all lived in
 * one 416-line file.
 */
export const ENTER = { once: false, amount: 0.5 } as const;
export const DRAW = { duration: 1, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] };

/*
 * THE PHASE LIST IS DATA, AND THIS IS WHERE IT LIVES.
 *
 * The literal-array + derived-union idiom the repo uses for every closed
 * vocabulary (`i18n/locales.ts`, `features/shell/tabs.ts`): the order here IS
 * the order /about walks, `AboutCurve` derives both its step rows and its
 * serpentine spine from it, `about-art/index.tsx` keys an exhaustive `Record`
 * off the union, and `MarketingClaims.test.ts` reads it to check that every
 * phase carries copy in all four catalogs.
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
 * section rail, the phone menu and a shared `/about#step-07` link all use.
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
