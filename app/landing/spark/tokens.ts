/*
 * Spark design tokens — one sticker-sheet vocabulary shared by the page and
 * its feature-preview modals. Literal hexes on purpose: this is a fixed art
 * direction that must not re-skin with the workspace theme.
 */
export const DISPLAY = "font-[family-name:var(--font-spark-display)]";
export const HAND = "font-[family-name:var(--font-spark-hand)]";

/*
 * Marketing type scale, applied once per page root (SparkHome, AboutHome).
 *
 * Inside it every Tailwind size token below `text-2xl` is ~2px larger than in
 * the workspace: `text-xs` is 14, `text-sm` 16, `text-base` 18, `text-lg` 20,
 * `text-xl` 22. Write the same class names as anywhere else — the shift lives
 * in one `.spark-type` rule in app/globals.css, where the reasoning is. The
 * display sizes (`text-2xl`+) are unchanged.
 */
export const TYPE_SCALE = "spark-type";

/*
 * One notch larger again, for the illustrated cards — the /about step art and
 * the /market data cards, which are miniatures of product UI and so were drawn
 * at product sizes. Nest it on a card container inside TYPE_SCALE: `text-sm`
 * becomes 18, `text-xs` 16, and unlike the page scale the display sizes move
 * too (`text-2xl` 26, `text-4xl` 38) — inside a card those are score dials and
 * salary figures, not section headings. Rule and reasoning: app/globals.css.
 */
export const ART_TYPE_SCALE = "spark-type-art";

export const STICKER = "rounded-2xl border-[3px] border-[#17202a] bg-white shadow-[6px_6px_0_#17202a]";
export const BTN =
  "inline-flex items-center gap-2 rounded-xl border-[3px] border-[#17202a] px-6 py-3 text-base font-bold shadow-[5px_5px_0_#17202a] transition-all hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[3px_3px_0_#17202a]";

export const INK = "#17202a";
export const CREAM = "#fdf8ee";
export const CORAL = "#d65a4a";
export const AMBER = "#caa54c";
export const MOSS = "#526b4f";
export const LIMEWASH = "#dce7d0";
export const STEEL = "#42606f";
