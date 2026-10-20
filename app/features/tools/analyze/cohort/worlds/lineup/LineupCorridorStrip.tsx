"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import { ABSENT } from "@/app/_components/kit";
import { ScenePress } from "@/app/_components/kit/scene";
import type { CohortDimension, CohortMember, CohortView } from "../../cohortTypes";
import { LeadGlyph, PennantGlyph, ReasonGlyph } from "./art/LineupGlyphs";
import { floorLeaderOf, litShare } from "./lineupModel";
import type { LineupWords } from "./useLineupWords";

const DOOR = "lu-door";
const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

/** Two letters for a door too narrow for a name (the full name is the door's accessible name and the foot line). */
function initials(label: string): string {
  const parts = label.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : label.slice(0, 2);
}

/**
 * The floor you walked into, kept as the corridor's first wall: one door per building in street order,
 * each door's windows lit to that member's rating on THIS floor (or boarded with its reason), the
 * clearing lead's lamp, a comment's pennant. A door press follows that member through the dimension page
 * (press again to stop). Arrow keys walk the doors; they stay inside the strip, so they never take the stairs.
 */
export function LineupCorridorStrip({ view, street, dimension, focus, words, onFocusMember }: {
  view: CohortView;
  street: readonly CohortMember[];
  dimension: CohortDimension;
  focus: string | null;
  words: LineupWords;
  onFocusMember: (memberId: string | null) => void;
}) {
  const leader = floorLeaderOf(view, dimension);
  const followed = street.find((m) => m.memberId === focus) ?? null;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!NAV_KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const doors = [...e.currentTarget.querySelectorAll<HTMLElement>(".lu-door")];
    const at = doors.indexOf(e.target as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const next = e.key === "Home" ? 0 : e.key === "End" ? doors.length - 1 : Math.max(0, Math.min(doors.length - 1, at + (e.key === "ArrowRight" ? 1 : -1)));
    doors[next]?.focus();
  };
  return (
    <div className="lu-corridor">
      <div className="lu-corridor__doors" role="group" aria-label={words.t("level.corridor", { floor: words.dim(dimension) })} data-lu-strip="" style={{ "--n": street.length } as CSSProperties} onKeyDown={onKeyDown}>
        {street.map((m) => {
          const cell = m.cells[dimension];
          const share = litShare(cell);
          return (
            <ScenePress
              key={m.memberId}
              className={DOOR}
              aria-pressed={focus === m.memberId}
              aria-label={words.t("level.door", { name: m.label, value: words.value(cell) })}
              data-lot={cell.rating == null ? (cell.absentReason === "pending" ? "building" : "boarded") : "rated"}
              data-decoy={m.decoyOf ? "" : undefined}
              style={{ "--lit": share ?? 0 } as CSSProperties}
              onClick={() => onFocusMember(focus === m.memberId ? null : m.memberId)}
            >
              <span className="lu-door__n" aria-hidden="true">
                {cell.rating ?? ABSENT}
                {leader === m.memberId ? <LeadGlyph /> : null}
              </span>
              <span className="lu-door__win" aria-hidden="true">
                {cell.rating == null ? <ReasonGlyph reason={cell.absentReason ?? "notRead"} /> : null}
                {cell.comment ? <PennantGlyph /> : null}
              </span>
              <span className="lu-door__who" aria-hidden="true">
                {initials(m.label)}
              </span>
            </ScenePress>
          );
        })}
      </div>
      <p className="lu-corridor__foot" aria-live="polite">
        {followed ? words.t("level.focusOne", { name: followed.label, value: words.value(followed.cells[dimension]) }) : words.t("level.focusNone")}
      </p>
    </div>
  );
}
