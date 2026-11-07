// Ticker's paint — the landing's register, tokenized so it holds in BOTH themes.
//
// The sticker (ink outline + hard offset) marks exactly ONE thing per screen: the answer's
// table. Everything else is calm: hairlines, quiet planes, the kit's chips and buttons.
// Every colour resolves through a token; no literal colour anywhere in this folder.
//
// Faces: Bricolage is loaded app-wide (`--font-bricolage`); Figtree and Caveat come from the
// landing's next/font module, whose variables TickerVariant puts on its own root.

export const FACE_DISPLAY = "font-[family-name:var(--font-bricolage)]";
export const FACE_BODY = "font-[family-name:var(--font-mk-body)]";
export const FACE_HAND = "font-[family-name:var(--font-mk-hand)]";

/** THE answer's frame. The panel inside paints its own PANEL border; the child selector
 *  (class + attribute specificity) strips it, so there is one frame, never two. */
export const STICKER_TABLE =
  "overflow-hidden rounded-xl border-2 border-ink bg-white shadow-[5px_5px_0_var(--color-ink)] dark:rounded-2xl dark:border-stone-300 dark:shadow-pop " +
  "[&>[data-one-panel]]:h-full [&>[data-one-panel]]:rounded-none [&>[data-one-panel]]:border-0 [&>[data-one-panel]]:shadow-none";

/** A pinned view on the side: the panel's own calm PANEL, filling its share of the rail. */
export const PIN_SLOT = "flex min-h-0 flex-1 flex-col [&>[data-one-panel]]:h-full";

/** Arrival — the still form is the element itself (motion-safe only). */
export const ARRIVE = "motion-safe:animate-tab-in";
