import type { AbsentMark, Knot } from "./loomModel";

/**
 * One crossing's knot, drawn (decorative: the press around it carries the accessible name). A rated
 * knot is a wrapped bead whose height and dye carry the tier and whose numeral is the rating; an
 * absent one is no knot at all, only the reason's small mark where the thread passed behind; a
 * still-spinning one is the bead's outline, unfilled, in the place it will land. A rare note hangs
 * as a paper tag on the knot's shoulder. `bind` is the row's claim on this knot: a selvedge stitch
 * (a lead that clears) or a loose float (within the noise).
 */
export function LoomKnot({ knot, bind }: { knot: Knot; bind: "stitch" | "float" | null }) {
  if (knot.kind === "absent") {
    return (
      <span className="lm-knot" data-tier={knot.mark === "spinning" ? "spinning" : "absent"} aria-hidden>
        {knot.mark === "spinning" ? null : <AbsentGlyph mark={knot.mark} />}
      </span>
    );
  }
  return (
    <span className="lm-knot" data-tier={knot.tier} data-bind={bind ?? undefined} aria-hidden>
      <span className="lm-knot__n">{knot.rating}</span>
      {knot.comment ? <span className="lm-knot__tag" /> : null}
    </span>
  );
}

/** The reason's mark at a crossing the thread passed behind: cut, not read, not applicable, kept apart. */
function AbsentGlyph({ mark }: { mark: Exclude<AbsentMark, "spinning"> }) {
  return (
    <svg className="lm-absent" data-mark={mark} viewBox="0 0 16 16" width="16" height="16" aria-hidden focusable="false">
      {mark === "cut" ? <path d="M4 4l8 8M12 4l-8 8" /> : null}
      {mark === "unread" ? <circle cx="8" cy="8" r="5" className="lm-absent__dash" /> : null}
      {mark === "na" ? (
        <>
          <circle cx="8" cy="8" r="5" />
          <path d="M4.5 11.5l7-7" />
        </>
      ) : null}
      {mark === "apart" ? (
        <>
          <rect x="2.5" y="4.5" width="5" height="7" rx="1" />
          <rect x="8.5" y="4.5" width="5" height="7" rx="1" />
        </>
      ) : null}
    </svg>
  );
}
