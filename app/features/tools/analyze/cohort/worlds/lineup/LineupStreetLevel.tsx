"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { usePersistedChoice } from "@/app/features/hiring/pipeline/orbit/usePersistedChoice";
import type { CohortDimension, CohortMember, CohortView } from "../../cohortTypes";
import { LineupHead } from "./LineupHead";
import { LineupReadout } from "./LineupReadout";
import { LineupStreet } from "./LineupStreet";
import { LineupWalk } from "./LineupWalk";
import { cellKey, clampCell, type GridCell } from "./lineupGrid";
import { isStreetOrder, streetOrder } from "./lineupModel";
import type { LineupWords } from "./useLineupWords";

/** A place on the street by WHO, not by lot: a re-order keeps the reader on the same building. */
type Spot = { row: number; memberId: string | null };

const toSpot = (c: GridCell, street: readonly CohortMember[]): Spot => ({ row: c.row, memberId: c.col > 0 ? street[c.col - 1]?.memberId ?? null : null });
function toCell(s: Spot, street: readonly CohortMember[]): GridCell {
  const col = s.memberId ? street.findIndex((m) => m.memberId === s.memberId) + 1 : 0;
  return clampCell({ row: s.row, col: s.memberId && col === 0 ? 1 : col }, street.length);
}

/**
 * Level 0, the street: the headline, the street beside its directory board, the walk-through. It owns
 * what is being read: `active` is the street's one tab stop (roving), `focused` the last place focus
 * landed on (it stays on the board after Tab leaves the street, so the board's own buttons are
 * reachable), `hover` a pointer reading that wins while it lasts. All three are kept by member, so the
 * order toggle walks the buildings and the reader stays with theirs. The order is a per-browser pick.
 */
export function LineupStreetLevel({ view, words, walking, onWalk, onOpenReport }: {
  view: CohortView;
  words: LineupWords;
  walking: CohortDimension | null;
  onWalk: (d: CohortDimension, el: HTMLElement, memberId: string | null) => void;
  onOpenReport: (slug: string) => void;
}) {
  const [order, setOrder] = usePersistedChoice("kp-analyze-lineup-order", isStreetOrder, "fit");
  const street = useMemo(() => streetOrder(view.members, order), [view.members, order]);
  const [active, setActive] = useState<Spot>(() => ({ row: 0, memberId: null }));
  const [focused, setFocused] = useState<Spot | null>(null);
  const [hover, setHover] = useState<Spot | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const onLook = useCallback(
    (at: GridCell, via: "focus" | "pointer" | "leave") => {
      const spot = toSpot(at, street);
      if (via === "focus") {
        setActive(spot);
        setFocused(spot);
      } else if (via === "pointer") setHover(spot);
      else setHover((h) => (h && h.row === spot.row && h.memberId === spot.memberId ? null : h));
    },
    [street],
  );

  const onStop = (memberId: string) => {
    const at = toCell({ row: 0, memberId }, street);
    setActive({ row: 0, memberId });
    root.current?.querySelector<HTMLElement>(`[data-lu-cell="${cellKey(at)}"]`)?.focus();
  };

  // The first tab stop is the first building's tower (the directory entry when the street is empty).
  const activeCell = active.memberId === null && active.row === 0 && street.length > 0 && !focused ? { row: 0, col: 1 } : toCell(active, street);
  const lookSpot = hover ?? focused;
  const look = lookSpot ? toCell(lookSpot, street) : null;

  return (
    <div ref={root} className="lu-l0">
      <LineupHead view={view} words={words} order={order} onOrder={setOrder} />
      <div className="lu-scene">
        <LineupStreet
          view={view}
          street={street}
          words={words}
          active={activeCell}
          look={look}
          walking={walking}
          onActive={(c) => setActive(toSpot(c, street))}
          onLook={onLook}
          onWalk={onWalk}
          onOpenReport={onOpenReport}
        />
        <LineupReadout view={view} street={street} words={words} look={look} onWalk={onWalk} onOpenReport={onOpenReport} />
      </div>
      <LineupWalk view={view} words={words} onStop={onStop} />
    </div>
  );
}
