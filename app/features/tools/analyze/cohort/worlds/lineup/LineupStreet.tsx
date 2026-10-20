"use client";

import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import { COHORT_CAP, type CohortDimension, type CohortMember, type CohortView } from "../../cohortTypes";
import { LineupBackdrop, LineupBubble } from "./LineupBackdrop";
import { LineupBuilding } from "./LineupBuilding";
import { LineupDirectory } from "./LineupDirectory";
import { cellKey, moveCell, parseCellKey, type GridCell } from "./lineupGrid";
import { STREET_ROWS, crownOf, floorLeaderOf, hazeOf, shadowArc, tourStops } from "./lineupModel";
import type { LineupWords } from "./useLineupWords";
import { useStreetFlip } from "./useStreetFlip";

/** The towers rise once on arrival (lineup.css `lu-rise`: 700 ms + 22 ms per lot); after this they never replay. */
const RISE_MS = 700 + COHORT_CAP * 22 + 120;

export type StreetProps = {
  view: CohortView;
  street: readonly CohortMember[];
  words: LineupWords;
  active: GridCell;
  look: GridCell | null;
  walking: CohortDimension | null;
  onActive: (at: GridCell) => void;
  onLook: (at: GridCell, via: "focus" | "pointer" | "leave") => void;
  onWalk: (d: CohortDimension, el: HTMLElement, memberId: string | null) => void;
  onOpenReport: (slug: string) => void;
};

/**
 * Level 0's drawing: the floor directory in the margin, then the buildings side by side on one kerb, in
 * street order. One tab stop: the arrows walk the grid (lineupGrid.ts) and focus follows the model.
 * The street's height never depends on the data (rows are fixed, towers grow inside the tower row), so a
 * member that lands while the cohort runs fills its lot without moving anything.
 */
export function LineupStreet(p: StreetProps) {
  const { view, street, words, look } = p;
  const n = street.length;
  const ids = useMemo(() => street.map((m) => m.memberId), [street]);
  const setRef = useStreetFlip(ids);
  // The rise belongs to the arrival only: a return from a floor re-displays the street without replaying it.
  const [risen, setRisen] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setRisen(true), RISE_MS);
    return () => window.clearTimeout(id);
  }, []);
  const crown = crownOf(view);
  const haze = useMemo(() => hazeOf(view), [view]);
  const stops = useMemo(() => tourStops(view), [view]);
  const leads = useMemo(() => {
    const out = new Map<string, Set<CohortDimension>>();
    for (const d of STREET_ROWS) {
      const id = floorLeaderOf(view, d);
      if (id && d !== "fit") out.set(id, new Set([...(out.get(id) ?? []), d]));
    }
    return out;
  }, [view]);

  const lookedAt = look && look.col > 0 ? street[look.col - 1] ?? null : null;
  const lookedDim = look && look.row < STREET_ROWS.length ? STREET_ROWS[look.row] : null;
  const comment = lookedAt && lookedDim ? lookedAt.cells[lookedDim].comment : undefined;
  const arc = lookedAt?.decoyOf ? shadowArc(street, lookedAt.memberId) : null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    const at = parseCellKey(target?.dataset.luCell);
    if (!at) return;
    const next = moveCell(at, e.key, n);
    if (!next) return;
    e.preventDefault();
    p.onActive(next);
    e.currentTarget.querySelector<HTMLElement>(`[data-lu-cell="${cellKey(next)}"]`)?.focus();
  };

  return (
    <div
      className="lu-street"
      style={{ "--n": n } as CSSProperties}
      data-walking={p.walking ?? undefined}
      data-looking={lookedAt ? "" : undefined}
      data-risen={risen ? "" : undefined}
      onKeyDown={onKeyDown}
    >
      <LineupBackdrop n={n} haze={haze} lamp={lookedAt ? look!.col - 1 : null} arc={arc} words={words} />
      <LineupDirectory view={view} words={words} active={p.active} walking={p.walking} onLook={p.onLook} onWalk={(d, el) => p.onWalk(d, el, null)} />
      <div className="lu-lots" role="group" aria-label={words.t("street", { count: n })}>
        {street.map((m, col) => (
          <LineupBuilding
            key={m.memberId}
            m={m}
            col={col}
            words={words}
            active={p.active}
            on={lookedAt?.memberId === m.memberId}
            crown={crown === m.memberId}
            haze={haze?.memberIds.includes(m.memberId) ?? false}
            leads={leads.get(m.memberId) ?? EMPTY}
            stop={stops.get(m.memberId) ?? null}
            walking={p.walking}
            onLook={p.onLook}
            onWalk={p.onWalk}
            onOpenReport={p.onOpenReport}
            setRef={setRef}
          />
        ))}
      </div>
      {comment && look ? <LineupBubble col={look.col - 1} row={look.row} n={n} text={comment} /> : null}
    </div>
  );
}

const EMPTY: ReadonlySet<CohortDimension> = new Set();
