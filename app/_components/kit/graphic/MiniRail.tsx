"use client";

import type { CSSProperties } from "react";
import { stepFill } from "./railModel";
import "./graphic.css";

export type MiniRailStep = {
  id: string;
  label: string;
  reached: number;
  of: number;
  /** Why nobody could reach this step: a hatched bar, and the reason in its tip. */
  absent?: string;
};

/**
 * @catalog A reach drawn inside a list row's meta track: one small bar per step, filled reached / of, hatched when the step could have nobody; the whole row of bars is one image whose name reads every step.
 *
 * The winner's .k-minirail (graphic.css, already ported with the layer). A row-sized sibling of
 * StageRail for a list of groups (the Journeys Roles section), so every row is drawn on the same
 * steps and a column of rows reads as one chart. `words` is the accessible name and the tip of each
 * bar; the numbers are the caller's, already formatted.
 */
export function MiniRail({ steps, words }: { steps: readonly MiniRailStep[]; words: (s: MiniRailStep) => string }) {
  const name = steps.map(words).join(", ");
  return (
    <span className="k-minirail" style={{ "--n": steps.length } as CSSProperties} role="img" aria-label={name} data-part="mini-rail">
      {steps.map((s) => (
        <i
          key={s.id}
          className={s.absent ? "is-absent" : undefined}
          style={{ "--p": stepFill(s).toFixed(3) } as CSSProperties}
          data-tip={words(s)}
        />
      ))}
    </span>
  );
}
