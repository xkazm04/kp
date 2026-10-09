import type { AbsentReason } from "../../../cohortTypes";

/*
 * The Line-up's small drawn marks, all 16-unit line drawings in `currentColor` (lineup.css paints them
 * per register). Decorative: every mark sits inside a control or beside words that already say what it
 * means, so each svg is aria-hidden.
 */

const REASON_PATHS: Record<AbsentReason, string[]> = {
  // under construction: a crane hook
  pending: ["M5 2.5h7", "M8.5 2.5v6", "M8.5 8.5a2 2 0 1 1-2 2"],
  // not read: a closed eye
  notRead: ["M2.5 7.5c3 3.2 8 3.2 11 0", "M5 10.2 4 12", "M8 11v2", "M11 10.2l1 1.8"],
  // not a technical role: an empty bracket pair crossed out
  notTechnical: ["M5.5 4 3 8l2.5 4", "M10.5 4 13 8l-2.5 4", "M4 13 12 3"],
  // no link: a broken chain
  noLink: ["M6.5 9.5 5 11a2.1 2.1 0 0 1-3-3l1.5-1.5", "M9.5 6.5 11 5a2.1 2.1 0 0 1 3 3l-1.5 1.5", "M7 4.5 6.5 3", "M9.5 12.5 9 11"],
  // another currency: two coins that do not stack
  currencyMismatch: ["M6 8.5a3.2 3.2 0 1 0 0-.01", "M10 7.5a3.2 3.2 0 1 0 0-.01", "M2.5 13.5 13.5 2.5"],
  // no job fit: a target with nothing on it
  noJdFit: ["M8 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z", "M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
  // failed: a cross
  failed: ["M4 4l8 8", "M12 4l-8 8"],
  // blind: a mask
  blind: ["M2.5 6c2-1.5 9-1.5 11 0-.5 4-3 5-5.5 3.5C5.5 11 3 10 2.5 6Z", "M5.5 7.3h1", "M9.5 7.3h1"],
};

const GLYPH = "lu-glyph";

/** Why a floor (or a lot) has no rating, in a shape. */
export function ReasonGlyph({ reason }: { reason: AbsentReason }) {
  return (
    <svg className={GLYPH} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {REASON_PATHS[reason].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** A comment: a small pennant on a pole. */
export function PennantGlyph() {
  return (
    <svg className={`${GLYPH} lu-glyph--pennant`} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 14V2" />
      <path className="lu-glyph__fill" d="M4 2.5 12.5 5 4 7.5Z" />
    </svg>
  );
}

/** A floor's clearing lead: a lamp lit on that floor. */
export function LeadGlyph() {
  return (
    <svg className={`${GLYPH} lu-glyph--lead`} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path className="lu-glyph__fill" d="M8 2.5 9.6 6.1 13.5 6.4 10.5 9 11.4 12.8 8 10.8 4.6 12.8 5.5 9 2.5 6.4 6.4 6.1Z" />
    </svg>
  );
}

/** The overall lead's rooftop marker: a flag on a mast (only ever drawn when the claim clears). */
export function CrownGlyph() {
  return (
    <svg className={`${GLYPH} lu-glyph--crown`} viewBox="0 0 16 22" aria-hidden="true" focusable="false">
      <path d="M5 21V2" />
      <path className="lu-glyph__fill" d="M5 2.5h9l-2.5 3 2.5 3H5Z" />
    </svg>
  );
}

/** The haze: three soft strokes. */
export function HazeGlyph() {
  return (
    <svg className={`${GLYPH} lu-glyph--haze`} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M2 5.5c2-1.2 4-1.2 6 0s4 1.2 6 0" />
      <path d="M2 9c2-1.2 4-1.2 6 0s4 1.2 6 0" />
      <path d="M2 12.5c2-1.2 4-1.2 6 0s4 1.2 6 0" />
    </svg>
  );
}

/** Too few to compare: an empty dashed lot. */
export function FloorGlyph() {
  return (
    <svg className={GLYPH} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path strokeDasharray="2 2" d="M3 3h10v10H3Z" />
    </svg>
  );
}

/** Not comparable: two lines that never meet. */
export function SplitGlyph() {
  return (
    <svg className={GLYPH} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M2.5 5.5h11" />
      <path d="M2.5 10.5h11" />
      <path d="M10 2.5 6 13.5" />
    </svg>
  );
}
