"use client";

import type { CSSProperties, FocusEvent, PointerEvent } from "react";
import { ScenePress } from "@/app/_components/kit/scene";
import type { CohortCell, CohortMember } from "../../cohortTypes";
import { SEGMENTS, litSegments, stripState, travel } from "./consoleModel";
import type { ConsoleWords } from "./useConsoleWords";

/** The roving-focus props every pressable part of the desk takes from the grid. */
export type DeskPress = {
  tabIndex: number;
  "data-pos": string;
  onFocus: (e: FocusEvent<HTMLButtonElement>) => void;
  onPointerEnter: (e: PointerEvent<HTMLButtonElement>) => void;
};

type CellProps = {
  member: CohortMember;
  cell: CohortCell;
  words: ConsoleWords;
  lead: boolean;
  muted: boolean;
  press: DeskPress;
  onPress: (el: HTMLElement) => void;
};

/** rated | absent (capped, with a reason) | pending (the analysis has not landed: unlit, uncapped). */
function cellState(m: CohortMember, c: CohortCell): "rated" | "absent" | "pending" {
  if (c.rating != null && c.tier !== "absent") return "rated";
  return c.absentReason === "pending" || stripState(m) === "pending" ? "pending" : "absent";
}

/** The glyphs a meter prints without a rating: an absent value is a dash (its reason is in the name), a pending one an ellipsis. */
const ABSENT_MARK = "—";
const PENDING_MARK = "…";

function readingOf(state: "rated" | "absent" | "pending", c: CohortCell): string {
  if (state === "rated") return String(c.rating);
  return state === "pending" ? PENDING_MARK : ABSENT_MARK;
}

/**
 * One meter on a bus: ten segments lit to the rating in the tier's colour, the number beside it.
 * A rated 0 lights nothing and still prints 0; an absent cell is CAPPED (dashed, a cap across the
 * top, "—"); a pending one is unlit and uncapped ("…"). A band, when the cell carries one, is a
 * bracket beside the segments; a rare comment is a small folded note in the corner whose words
 * are the meter's accessible name and the readout's, never a hover-only tip.
 */
export function ConsoleMeter({ member, cell, words, lead, muted, press, onPress }: CellProps) {
  const state = cellState(member, cell);
  const lit = litSegments(state === "rated" ? cell.rating : null) ?? 0;
  const band = state === "rated" && cell.band ? { bottom: `${travel(cell.band.lo) * 100}%`, height: `${(travel(cell.band.hi) - travel(cell.band.lo)) * 100}%` } : null;
  return (
    <ScenePress
      {...press}
      className="cx-cell cx-cell--meter"
      data-state={state}
      data-tier={cell.tier}
      data-bus={cell.dimension}
      data-lead={lead || undefined}
      data-muted={muted || undefined}
      data-decoy={member.decoyOf ? "" : undefined}
      aria-label={lead ? `${words.cellName(member, cell)} ${words.t("cell.lead")}` : words.cellName(member, cell)}
      onClick={(e) => onPress(e.currentTarget)}
    >
      <span className="cx-meter" aria-hidden>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <i key={i} className="cx-seg" data-lit={i < lit || undefined} style={{ "--i": i } as CSSProperties} />
        ))}
        {band ? <i className="cx-band" style={band} /> : null}
      </span>
      <span className="cx-num k-nums" aria-hidden>
        {readingOf(state, cell)}
      </span>
      {cell.comment ? <i className="cx-note" aria-hidden /> : null}
    </ScenePress>
  );
}

/**
 * The channel fader: overall fit. The knob sits at the rating and carries its number; the band is
 * a tinted zone on the slot; a channel in the overall noise group sits in the amber haze that runs
 * across every strip at the same height (the bands overlap: the order is not a finding). A crown
 * lamp lights on the knob ONLY when the overall claim clears for this channel. Absent fit: no knob,
 * a dashed slot and a cap; pending: a hollow knob parked at the foot.
 */
export function ConsoleFader({ member, cell, words, lead, muted, press, onPress, noise }: CellProps & { noise: { lo: number; hi: number; inside: boolean } | null }) {
  const state = cellState(member, cell);
  const at = state === "rated" && cell.rating != null ? travel(cell.rating) : 0;
  const band = state === "rated" && cell.band ? { bottom: `${travel(cell.band.lo) * 100}%`, height: `${(travel(cell.band.hi) - travel(cell.band.lo)) * 100}%` } : null;
  const haze = noise ? { bottom: `${travel(noise.lo) * 100}%`, height: `${(travel(noise.hi) - travel(noise.lo)) * 100}%` } : null;
  const name = [words.cellName(member, cell), lead ? words.t("cell.lead") : "", noise?.inside ? words.t("noise", { lo: noise.lo, hi: noise.hi }) : ""].filter(Boolean).join(" ");
  return (
    <ScenePress
      {...press}
      className="cx-cell cx-cell--fader"
      data-state={state}
      data-tier={cell.tier}
      data-bus="fit"
      data-lead={lead || undefined}
      data-muted={muted || undefined}
      data-noise={noise?.inside || undefined}
      data-decoy={member.decoyOf ? "" : undefined}
      aria-label={name}
      onClick={(e) => onPress(e.currentTarget)}
    >
      <span className="cx-fader" aria-hidden>
        {haze ? <i className="cx-haze" data-inside={noise?.inside || undefined} style={haze} /> : null}
        <i className="cx-slot" />
        {band ? <i className="cx-band cx-band--fader" style={band} /> : null}
        {state === "absent" ? <i className="cx-cap cx-cap--fader" /> : null}
        {state !== "absent" ? (
          <span className="cx-knob k-nums" style={{ bottom: `${at * 100}%` }}>
            {lead ? <i className="cx-crown" /> : null}
            {readingOf(state, cell)}
          </span>
        ) : (
          <span className="cx-knob-none k-nums">{readingOf(state, cell)}</span>
        )}
      </span>
      {cell.comment ? <i className="cx-note" aria-hidden /> : null}
    </ScenePress>
  );
}
