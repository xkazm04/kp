"use client";

import type { CSSProperties } from "react";
import { HazeGlyph, PennantGlyph } from "./art/LineupGlyphs";
import { STREET_ROWS, type Haze, type shadowArc } from "./lineupModel";
import type { LineupWords } from "./useLineupWords";

type Arc = NonNullable<ReturnType<typeof shadowArc>>;

/**
 * What the street stands in, drawn behind and over the buildings and hidden from assistive tech (every
 * fact here is also in the headline or in a cell's name): the sky, the kerb, one invisible band per floor
 * (the corridor's start, measured when a floor is walked), the haze over the top towers when the order
 * is not a lead, the street lamp under the building being read, the shadow's arc from a decoy's
 * dominator, and the comment's lit sign.
 */
export function LineupBackdrop({ n, haze, lamp, arc, words }: { n: number; haze: Haze | null; lamp: number | null; arc: Arc | null; words: LineupWords }) {
  return (
    <div className="lu-back" aria-hidden="true">
      {STREET_ROWS.map((d, row) => (
        <span key={d} className="lu-band" data-lu-band={d} style={{ "--row": row - 1 } as CSSProperties} />
      ))}
      <span className="lu-kerb" />
      {lamp != null ? <span className="lu-lamp" style={{ "--col": lamp } as CSSProperties} /> : null}
      {haze ? (
        <span className="lu-haze" style={{ "--lo": haze.lo, "--hi": haze.hi } as CSSProperties}>
          <span className="lu-haze__label">
            <HazeGlyph />
            <span>{words.t("haze", { count: haze.memberIds.length })}</span>
          </span>
        </span>
      ) : null}
      {arc ? (
        <svg className="lu-arc" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" focusable="false">
          <path d={`M${arc.x1} ${100 - arc.y1} Q${(arc.x1 + arc.x2) / 2} ${Math.min(100 - arc.y1, 100 - arc.y2) - 22} ${arc.x2} ${100 - arc.y2}`} />
        </svg>
      ) : null}
    </div>
  );
}

/** A comment, lit on the building being read: a small hanging sign beside the floor that carries it. */
export function LineupBubble({ col, row, n, text }: { col: number; row: number; n: number; text: string }) {
  return (
    <p className="lu-bubble" aria-hidden="true" data-side={col >= n / 2 ? "left" : "right"} style={{ "--col": col, "--row": row - 1 } as CSSProperties}>
      <PennantGlyph />
      <span>{text}</span>
    </p>
  );
}
