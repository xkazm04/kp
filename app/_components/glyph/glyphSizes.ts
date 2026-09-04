/**
 * The size vocabulary for traced /motionize glyphs.
 *
 * Fourteen render sites had each typed their own `h-2x w-2x` pair, and between
 * them they had invented five sizes (80 / 96 / 112 / 128 / 144px) with no rule
 * saying which surface gets which — an empty-state hero at 128 next to another
 * at 144 is not a decision, it is two people guessing. Four steps is the whole
 * scale, named for the surface they belong to rather than for their pixels, so
 * retuning one step retunes every site that made the same choice:
 *
 * | Step | Class | Where |
 * | --- | --- | --- |
 * | `sm` | `h-20 w-20` | An inline aside beside a paragraph — usually `hidden … sm:block`. |
 * | `md` | `h-24 w-24` | A row-leading illustration in a horizontal empty state. |
 * | `lg` | `h-28 w-28` | A boxed or column-leading illustration. |
 * | `xl` | `h-36 w-36` | A centred hero in a `text-center` panel. |
 *
 * Square by construction: a traced glyph's viewBox is its canvas, so a non-square
 * box letterboxes the art rather than cropping it. Written as literal class
 * strings because Tailwind scans source text — a computed `h-${n}` compiles to
 * nothing.
 */
export const GLYPH_SIZE = {
  sm: "h-20 w-20",
  md: "h-24 w-24",
  lg: "h-28 w-28",
  xl: "h-36 w-36",
} as const;

export type GlyphSize = keyof typeof GLYPH_SIZE;

/**
 * The same steps at the `sm:` breakpoint, for a glyph that grows once there is
 * room. Compose with a base step: `${GLYPH_SIZE.md} ${GLYPH_SIZE_SM.lg}`.
 */
export const GLYPH_SIZE_SM: Record<GlyphSize, string> = {
  sm: "sm:h-20 sm:w-20",
  md: "sm:h-24 sm:w-24",
  lg: "sm:h-28 sm:w-28",
  xl: "sm:h-36 sm:w-36",
};
