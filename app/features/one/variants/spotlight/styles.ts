// Spotlight's paint — the landing's sticker register, tokenized so it holds in BOTH themes.
//
// The sticker (ink outline + hard offset) marks exactly ONE thing per screen: the answer's
// hero view on the stage. Everything else is the calm kit surface. The hero is drawn by the
// panel frame itself (PANEL), so the sticker classes are `!`-important overrides on that one
// surface — never a frame wrapped around a frame. Studio Light: ink outline + hard ink
// offset; Spark Dark: a cream (ink) outline + the deep `shadow-pop` offset, because the dark
// register already draws every PANEL in stone-300 with an offset, so only the outline colour
// can single the hero out.
//
// Faces: Bricolage is app-wide (`--font-bricolage`); Figtree (body) and Caveat (the one hand
// note) come from the landing's next/font module, whose variables the variant root carries.

export const FACE_DISPLAY = "font-[family-name:var(--font-bricolage)]";
export const FACE_BODY = "font-[family-name:var(--font-mk-body)]";
export const FACE_HAND = "font-[family-name:var(--font-mk-hand)]";

/** The hero view: the panel's own surface redrawn as the sticker. */
export const HERO_STICKER =
  "rounded-xl! border-2! border-ink! shadow-[6px_6px_0_var(--color-ink)]! dark:rounded-2xl! dark:shadow-pop!";

/** Arrival of a new answer — the still form is the element itself (motion-safe only). */
export const ARRIVE = "motion-safe:animate-tab-in";
