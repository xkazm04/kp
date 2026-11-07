// Spark's paint — the landing's sticker register expressed through tokens and the finish
// hooks (finish.css); no literal colour in this folder.

/** THE featured surface: the insight card's wrapper. Its outline is the drawn 2px line in
 *  both themes (the table keeps the hairline — one sticker per screen); the tilt itself is
 *  a motion pose (./motion.ts CARD_TILT), so it can settle into place. */
export const CARD_STICKER = "origin-bottom-left [--one-surface-border:2px] [&_[data-role=one-panel-title]]:font-bold [&_[data-role=one-insight]]:gap-3 [&>section>div:first-child]:min-h-11";

/** A chip as a small sticker: drawn outline, a 2px hard offset that presses flat. */
export const CHIP_STICKER =
  "border-2! border-ink! bg-white! font-medium hover:bg-stone-50! shadow-[2px_2px_0_var(--color-ink)] transition-[transform,box-shadow,background-color]! hover:-translate-y-px hover:shadow-[3px_3px_0_var(--color-ink)] active:translate-y-0.5 active:shadow-none motion-reduce:hover:translate-y-0 dark:border-stone-300! dark:bg-stone-50! dark:shadow-sticker-xs";

/** The user's own words: limewash highlighter ("your words" — the one place limewash sits). */
export const HIGHLIGHT = "rounded-sm bg-limewash px-1.5 py-0.5 text-ink";

/** The side table, tightened: two 18px lines a row (the row-h hook is the floor; the content
 *  sets the height), a shorter head. Selectors reach the core frame's own row markup. */
export const TABLE_TIGHT =
  "[&_[data-role=one-panel-title]]:font-bold [&>div:first-child]:min-h-11 [&_[data-row]]:py-0.5 [&_[data-row]_.leading-5]:leading-[18px]";

/** While a consent card is open: the card drops its suggestion (the act in front is the
 *  card's) and its spread gives way — but folds to its one-line strip (the frame's own
 *  container query) instead of vanishing on a short viewport, so the space a 1280x800
 *  screen has left still carries the answer's shape. (Split's ASKING_TRIM hides it.) */
export const SPARK_TRIM =
  "[&_[data-role=one-insight]]:gap-2 [&_[data-role=one-insight]]:py-2.5 [&_[data-insight=suggest]]:hidden [&_[data-insight=spread]]:min-h-12 [&_[data-insight=spread]]:overflow-hidden";
