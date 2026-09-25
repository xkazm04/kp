"use client";

// One row: a sentence, its mark, and its date.
//
// PROVENANCE LIVES IN THE MARK. The contest panel's bar, and the owner's pick:
// a reader must be able to tell an observed row from a generated one, and a
// name-only match from a certain one, WITHOUT consulting the legend. Four
// independent axes, four independent signals, none of them colour alone:
//
//   who acted        a filled disc (human) / filled square (machine) /
//                    hollow dashed diamond (kp does not know)
//   observed?        upright with a solid left rule, vs italic with a dotted
//                    left rule and a faint hatch
//   name-only match  a leading `≈` and a wavy amber underline
//   silence before   its own strip above the row, never a shrug
//
// AND IT IS TWO LINES TALL, AT MOST. The sentence is clamped by `rowTextClass`
// and the date sets beside it, so a row is the sentence and its date and no
// dead field under them — see JOURNEY_ROW_MAX for why the bound has to be at
// the cell rather than at the grid. The full sentence stays in the DOM (it is
// the button's accessible name) and the fact card prints it unclamped.
//
// AND NONE OF IT IS HOVER-ONLY. Every mark has a `sr-only` sentence from the
// catalog beside it, so the button's accessible name reads "Candidate applied.
// A human did this. Matched by name alone — may be a different person." on a
// screen reader and on a touch device, where `title=` does not exist.

import { memo } from "react";
import { useTranslations } from "next-intl";
import type { JourneyEvent, JourneyOrigin } from "@/app/_lib/journey/types";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { ACTOR_GLYPH, ACTOR_MARK_KEY, provenanceKeys, rowFrameClass, rowProvenance, rowTextClass } from "./journeyMarks";
import { useJourneySentence } from "./useJourneySentence";

export type JourneyRowProps = {
  event: JourneyEvent;
  origin: JourneyOrigin | undefined;
  /** Whole days the record went quiet before this row. Renders its own strip. */
  silenceDays?: number;
  /** Row height in px, excluding the silence strip. */
  height: number;
  silenceHeight: number;
  selected: boolean;
  onSelect: (eventId: string) => void;
};

function JourneyRowImpl({
  event,
  origin,
  silenceDays,
  height,
  silenceHeight,
  selected,
  onSelect,
}: JourneyRowProps) {
  const t = useTranslations("journey");
  const sentence = useJourneySentence();
  const { date } = useDateFormat();
  const p = rowProvenance(event, origin);

  return (
    <>
      {silenceDays !== undefined ? (
        // Silence is a ROW, never an absence of one. "9 days, nothing recorded"
        // is a statement about the ledger; a blank gap would be a statement
        // about the candidate, and they are different facts.
        <div
          className="flex shrink-0 items-center gap-2 px-2 text-xs italic text-steel"
          style={{ height: silenceHeight }}
        >
          <span className="h-0 flex-1 border-t border-dotted border-stone-300" aria-hidden="true" />
          <span>{t("silence", { days: silenceDays })}</span>
          <span className="h-0 flex-1 border-t border-dotted border-stone-300" aria-hidden="true" />
        </div>
      ) : null}
      <button
        type="button"
        data-jr-measure=""
        data-jr-event={event.id}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(event.id)}
        style={{ height }}
        className={`focus-ring flex w-full shrink-0 items-start gap-2 overflow-hidden border-b border-stone-200 px-2 py-1.5 text-left transition-colors hover:bg-stone-100 ${rowFrameClass(
          p
        )} ${selected ? "bg-coral/10" : ""}`}
      >
        <span className={`${ACTOR_GLYPH[p.actor]} mt-1.5`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className={rowTextClass(p)}>
            {p.labelOnly ? <span aria-hidden="true">≈ </span> : null}
            {sentence(event)}
          </span>
          <span className="sr-only">
            {` — ${t(ACTOR_MARK_KEY[p.actor])}`}
            {provenanceKeys(p).map((key) => ` — ${t(key)}`).join("")}
          </span>
        </span>
        <time dateTime={event.occurredAt} className="nums mt-px shrink-0 text-xs text-steel">
          {date(event.occurredAt)}
        </time>
      </button>
    </>
  );
}

/** 99 columns x ~13 rows is ~1,300 of these. Memoised on value props so a
 *  selection change repaints one row rather than the board. */
export const JourneyRow = memo(JourneyRowImpl);
