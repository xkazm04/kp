// Greet's paint — the landing's sticker register, tokenized so it holds in BOTH themes.
//
// Studio Light: an ink outline with a hard ink offset (the landing's sticker cards).
// Spark Dark: the drawn stone-300 outline + the deep `shadow-pop` offset the dark register
// already defines (an ink — i.e. cream — offset on the ink canvas would read as a glow).
// Every colour resolves through a token; no literal colour anywhere in this folder.
//
// The faces: Bricolage is loaded app-wide (`--font-bricolage`, app/layout.tsx); Figtree and
// Caveat come from the landing's next/font module, whose variables GreetVariant puts on its
// own root (the landing CSS is never imported).

export const FACE_DISPLAY = "font-[family-name:var(--font-bricolage)]";
export const FACE_BODY = "font-[family-name:var(--font-mk-body)]";
export const FACE_HAND = "font-[family-name:var(--font-mk-hand)]";

/** A sticker card: ink outline + hard offset. */
export const STICKER =
  "rounded-xl border-2 border-ink bg-white shadow-[5px_5px_0_var(--color-ink)] dark:rounded-2xl dark:border-stone-300 dark:shadow-pop";

/** The smaller sticker for the user's own words. */
export const STICKER_SAY =
  "rounded-xl border-2 border-ink bg-limewash shadow-[3px_3px_0_var(--color-ink)] dark:rounded-2xl dark:border-stone-300 dark:shadow-sticker-sm";

/** The view in front: the same sticker drawn in coral, plus a written "in front" tag
 *  (never colour alone). A full string, not an override, so no two border colours race. */
export const STICKER_FRONT =
  "rounded-xl border-2 border-coral bg-white shadow-[5px_5px_0_var(--color-coral)] dark:rounded-2xl dark:shadow-pop";

/** A view inside a sticker: the kit Section's top margin belongs to a page, not a card. */
export const PANEL_IN_CARD = "p-4 sm:p-5 [&_.k-section]:mt-0";

/** Arrival — the still form is the element itself (motion-safe only). */
export const ARRIVE = "motion-safe:animate-tab-in";
