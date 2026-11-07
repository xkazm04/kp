// The refined finish's paint — calm editorial. Every colour resolves through a token; the
// hooks (radius, outline, shadow, faces) are set in finish.css `[data-finish="refined"]`.
//
// One display face, used once: the reply line (`--one-display-font` = the theme's serif:
// Fraunces in Studio Light, Bricolage in Spark Dark). Everything else is the body face —
// there is no hand-lettered note in this finish.

export const FACE_DISPLAY = "font-[family-name:var(--one-display-font)]";

/** The reply: the screen's one display line, set like a pull-quote — medium weight, not black. */
export const REPLY = `${FACE_DISPLAY} max-w-[34rem] text-display font-medium leading-[1.12] tracking-tight text-balance`;

/** The composer: a hairline field on the surface, the soft panel shadow, the coral ring on focus. */
export const COMPOSER =
  "flex items-center gap-2 rounded-[var(--one-radius)] border border-stone-300 bg-white p-1 pl-2 shadow-panel transition-shadow focus-within:border-coral focus-within:ring-2 focus-within:ring-coral/30 dark:border-2";

/** Hide a panel's session chrome on a view the host draws on its own (the first beat). */
export const NO_CHROME = "[&>div:first-child_button]:hidden!";

/**
 * The insight card, set quieter. Selectors reach the core's `data-insight` parts:
 *  - the stacked bar is a hairline-thin rule (6px), not a slab;
 *  - the spread is a SMALL chart: slim columns centred in their bins (max 2rem), so the
 *    card still grows into the column's height without growing ochre slabs;
 *  - the facts sit on a hairline, the figure line in ink, the subline steel;
 *  - panel links stay steel — coral is the act's colour, not a link's.
 */
export const INSIGHT_SET = [
  "[&_[data-insight=shape]>div]:h-1.5",
  "[&_[data-insight=spread]_li>span:nth-child(2)]:items-center",
  "[&_[data-insight=spread]_li>span:nth-child(2)>span]:max-w-8",
  "[&_[data-insight=spread]_li>span:nth-child(2)>span]:rounded-t-md",
  "[&_[data-insight=spread]_li>span:last-child]:border-stone-200",
  "[&_[data-insight=facts]]:border-t [&_[data-insight=facts]]:border-stone-200 [&_[data-insight=facts]]:pt-3",
  "[&_[data-role=one-console-link]]:text-steel! [&_[data-role=one-console-link]:hover]:text-ink!",
].join(" ");

/** While a consent card is open the act in front is the card's: the insight drops its
 *  suggestion and its spread gives way — it folds into the one-line strip (the core's
 *  size-container fold) instead of leaving a blank band. On a ≤ 56rem-tall viewport
 *  (1280x800) there is no room for even the strip beside the consent card: the spread goes
 *  and the card stops growing (SHORT_STILL on the card + its cell), so it never shows a
 *  half-clipped strip or a blank band inside the surface. */
export const ASKING_TRIM =
  "[&_[data-insight=suggest]]:hidden [&_[data-insight=spread]]:min-h-7 [&_[data-insight=spread]]:overflow-hidden [@media(max-height:56rem)]:[&_[data-insight=spread]]:hidden";
export const SHORT_STILL = "[@media(max-height:56rem)]:flex-none!";

/**
 * The side's tables, set quieter and a touch tighter:
 *  - rows lose the coral lead stroke (every decision row carried it, so it said nothing;
 *    the marks and the ⚠ age still say which row needs you) and 2px of vertical padding;
 *  - the Console link is steel;
 *  - under reduced motion a row is ALWAYS at rest, in CSS. useReducedMotion seeds `false`
 *    per hook instance, so a freshly mounted table's first render hands its rows the
 *    stagger's `initial` (opacity 0) before the preference arrives; motion.ts's reduced
 *    rowStagger now animates them to rest, and this line keeps the still form true even
 *    if that JS path regresses (rows frozen as ghosts was the round-3 baseline's defect).
 */
export const TABLE_SET = [
  "[&_[data-row]]:shadow-none",
  "[&_[data-row]]:py-0.5",
  "motion-reduce:[&_[data-row]]:opacity-100! motion-reduce:[&_[data-row]]:transform-none!",
  "[&_[data-role=one-console-link]]:text-steel! [&_[data-role=one-console-link]:hover]:text-ink!",
].join(" ");
