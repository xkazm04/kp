"use client";

import type { CSSProperties, MouseEvent } from "react";
import { ScenePress } from "@/app/_components/kit/scene";
import type { CohortDimension, CohortView } from "../../cohortTypes";
import { FloorGlyph, HazeGlyph, LeadGlyph, SplitGlyph } from "./art/LineupGlyphs";
import { cellKey, type GridCell } from "./lineupGrid";
import { STREET_ROWS, floorClaimOf, type FloorClaimTone } from "./lineupModel";
import type { LineupWords } from "./useLineupWords";

const ENTRY = "lu-dir__floor";

function ClaimGlyph({ tone }: { tone: FloorClaimTone }) {
  if (tone === "clears") return <LeadGlyph />;
  if (tone === "insideNoise") return <HazeGlyph />;
  if (tone === "partitioned") return <SplitGlyph />;
  return <FloorGlyph />;
}

/**
 * The floor directory in the street's left margin, one entry per floor at that floor's height (the tower's
 * entry sits at the foot of the tower row): the dimension's name and its claim in words and in a shape:
 * a lit lamp only when the floor's lead clears, haze when it is ordered but not separated, an empty lot
 * below the floor, two lines that never meet for salary quoted in several currencies. A press walks the
 * floor across every building (column 0 of the street's grid).
 */
export function LineupDirectory({ view, words, active, walking, onLook, onWalk }: {
  view: CohortView;
  words: LineupWords;
  active: GridCell;
  walking: CohortDimension | null;
  onLook: (at: GridCell, via: "focus" | "pointer" | "leave") => void;
  onWalk: (d: CohortDimension, el: HTMLElement) => void;
}) {
  const total = view.members.length;
  return (
    <div className="lu-dir" role="group" aria-label={words.t("directory")}>
      {STREET_ROWS.map((d, row) => {
        const claim = floorClaimOf(view, d);
        const at = { row, col: 0 };
        return (
          <ScenePress
            key={d}
            className={ENTRY}
            data-row={d}
            data-walk={walking === d ? "" : undefined}
            data-claim={claim.tone}
            style={{ "--row": row - 1 } as CSSProperties}
            data-lu-cell={cellKey(at)}
            tabIndex={active.row === row && active.col === 0 ? 0 : -1}
            aria-label={words.t("walkFloor", { floor: words.dim(d), claim: words.claimLong(d), rated: claim.rated, total })}
            onFocus={() => onLook(at, "focus")}
            onPointerEnter={() => onLook(at, "pointer")}
            onPointerLeave={() => onLook(at, "leave")}
            onClick={(e: MouseEvent<HTMLButtonElement>) => onWalk(d, e.currentTarget)}
          >
            <span className="lu-dir__name">{words.dim(d)}</span>
            <span className="lu-dir__claim">
              <ClaimGlyph tone={claim.tone} />
              <span>{words.claimShort(d)}</span>
            </span>
          </ScenePress>
        );
      })}
    </div>
  );
}
