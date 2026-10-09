import type { CriterionStatus } from "../../cohortTypes";

/**
 * A criterion's status as a SHAPE first and a colour second, so it reads in both registers and
 * without colour: meets = a full disc, partial = a half disc, misses = a cross, unknown = a dashed
 * ring (not read is drawn as empty, never as a miss), pending = a dotted dash (not landed yet).
 * Decorative: the cell carrying it holds the accessible name.
 */
export function MatrixGlyph({ status }: { status: CriterionStatus | "pending" }) {
  return (
    <svg className="mx-glyph" viewBox="0 0 20 20" aria-hidden data-status={status}>
      {status === "meets" ? (
        <circle cx="10" cy="10" r="6.5" className="mx-glyph__fill" />
      ) : status === "partial" ? (
        <>
          <circle cx="10" cy="10" r="6" className="mx-glyph__ring" />
          <path d="M10 4a6 6 0 0 0 0 12Z" className="mx-glyph__fill" />
        </>
      ) : status === "misses" ? (
        <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" className="mx-glyph__cross" />
      ) : status === "unknown" ? (
        <circle cx="10" cy="10" r="5" className="mx-glyph__ring mx-glyph__ring--dashed" />
      ) : (
        <path d="M5 10h10" className="mx-glyph__pending" />
      )}
    </svg>
  );
}
