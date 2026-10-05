/*
 * Structural data the site renders but never translates: the brand spelling and
 * the arrow / play glyphs the prototype sets beside its labels (always
 * aria-hidden). Held as constants, not JSX text, so the landing's i18n lint (no
 * literal JSX text in app/landing) stays clean without disables; the same
 * pattern as app/landing/spark/Wordmark.tsx.
 */
export const BRAND = { name: "KandiDate", initial: "K", pre: "Kandi", accent: "D", post: "ate" } as const;

export const GLYPH = {
  prev: "←",
  next: "→",
  up: "↑",
  down: "↓",
  play: "▶",
  look: "↘"
} as const;
