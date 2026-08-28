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
