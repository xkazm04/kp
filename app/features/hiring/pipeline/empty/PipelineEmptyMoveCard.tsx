"use client";

/**
 * One door into the empty board's first lane, as an ACTION CARD.
 *
 * The whole cell is the control. It used to be a heading, a two-line
 * explanation and a small button underneath, which is three reading steps and
 * one small target for a move the operator has to make before anything else can
 * happen. The prose is gone (the title says the move; docs/design/surface-doctrine.md
 * §1) and the button grew until it WAS the card, so there is exactly one
 * interactive element per door and its accessible name is the move itself.
 *
 * WHAT THE CARD CARRIES
 * - its rank in the sequence, as a bare numeral (§3: a count is a numeral);
 * - the traced glyph drawn for that move — the state illustration, which is
 *   what "empty" looks like for this door;
 * - the move's title, and, for a move the operator may skip forever, the
 *   `Optional` chip. That distinction is a chip on the same control, never a
 *   second button or a dimmed card: an optional move is still first-class.
 *
 * THE REACTION. Hover and keyboard focus produce the SAME response, because a
 * keyboard user is owed the same affordance: the cell outlines itself in coral
 * (an INSET border, so the panel's `overflow-hidden` can never clip it the way
 * it can clip an outer ring), takes a wash, lifts the glyph out of its resting
 * opacity and turns the numeral, the arrow and the title coral. Focus adds the
 * app's baseline focus ring on top. Nothing moves: no `hover:-translate-y`, no
 * always-on motion, and every transition drops out under `motion-reduce`.
 *
 * THE GLYPH TRAP, verified in Chromium and worth restating at the render site:
 * a `MotionizedGlyph` behind a `hidden` / `sm:block` toggle (on the svg OR on a
 * wrapper) lays out at full size and paints NOTHING. So the responsive move here
 * is stacking, never display — the card is a `flex-col` at every width and the
 * glyph is a `GLYPH_SIZE.*` box with `shrink-0`, the shape that is proven to
 * draw. Opacity is safe; `hidden` is not.
 */

import { ArrowRight } from "lucide-react";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import { MotionizedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import type { TracedGlyph } from "@/app/_components/glyph/MotionizedGlyph";
import { GLYPH_SIZE } from "@/app/_components/glyph/glyphSizes";
import { STEP_FIRST_ROLE_GLYPH } from "@/app/_components/glyph/glyphs/stepFirstRoleGlyph";
import { PROFILE_ROSTER_GLYPH } from "@/app/_components/glyph/glyphs/profileRosterGlyph";
import { STEP_CHANNELS_GLYPH } from "@/app/_components/glyph/glyphs/stepChannelsGlyph";
import type { EmptyMoveKey } from "./pipelineEmptyMoves";

/**
 * The drawn subject per move. A plain map, resolved at module scope — never a
 * component factory called during render — and the ONLY render site for these
 * three traced modules, which is what `glyphs/glyphsHaveConsumers.test.ts`
 * checks for.
 */
const MOVE_GLYPH: Record<EmptyMoveKey, TracedGlyph> = {
  role: STEP_FIRST_ROLE_GLYPH,
  candidates: PROFILE_ROSTER_GLYPH,
  channels: STEP_CHANNELS_GLYPH,
};

/** Hover and focus-visible say the same thing, so they are written once. */
const REACT_TEXT = "transition-colors group-hover:text-coral group-focus-visible:text-coral motion-reduce:transition-none";

export function PipelineEmptyMoveCard({
  index,
  moveKey,
  title,
  optional,
  optionalLabel,
  onOpen,
}: {
  /** Position in the sequence; the numeral is `index + 1`. */
  index: number;
  moveKey: EmptyMoveKey;
  title: string;
  optional: boolean;
  optionalLabel: string;
  onOpen: () => void;
}) {
  const glyph = MOVE_GLYPH[moveKey];
  return (
    <li className="min-w-0 flex-1 border-stone-200 sm:border-r sm:last:border-r-0">
      <button
        type="button"
        onClick={onOpen}
        className="group focus-ring relative flex h-full w-full flex-col items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-stone-50 focus-visible:bg-stone-50 motion-reduce:transition-none dark:hover:bg-stone-100 dark:focus-visible:bg-stone-100"
      >
        {/* The reaction's outline. Inset and always present, so it is a colour
            change rather than an element appearing, and the panel's clipped
            corners cannot cut it off. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 border-2 border-transparent transition-colors group-hover:border-coral group-focus-visible:border-coral motion-reduce:transition-none"
        />

        <span className="relative flex w-full items-center gap-2">
          <span className={`font-serif text-h2 leading-none nums text-stone-400 ${REACT_TEXT}`}>{index + 1}</span>
          <ArrowRight size={15} aria-hidden className={`ml-auto shrink-0 text-stone-400 ${REACT_TEXT}`} />
        </span>

        <MotionizedGlyph
          data={glyph.data}
          viewBox={glyph.viewBox}
          spread={0.9}
          className={`${GLYPH_SIZE.md} relative shrink-0 opacity-70 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none`}
        />

        <span className="relative flex w-full min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={`min-w-0 text-base font-semibold text-ink ${REACT_TEXT}`}>{title}</span>
          {optional ? <span className={`${CHIP_QUIET} text-meta uppercase`}>{optionalLabel}</span> : null}
        </span>
      </button>
    </li>
  );
}
