"use client";

import { useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { Mark } from "@/app/_components/kit";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import type { JourneyOrigin } from "@/app/_lib/journey/types";
import { useJourneySentence } from "../useJourneySentence";
import { EventMark, textClass } from "./JourneyKitEventMark";
import { JourneyKitFact, PHASE_KEY } from "./JourneyKitFact";
import type { TrailRow } from "./journeyKitPaneModel";

/**
 * A journey's trail in the pane: each missing phase with its reason, every event in order with its
 * provenance in the mark and the type, and the gaps in place: a silence of 7+ days, a clock jump
 * of a year or more, and the silence up to today for a journey still under way. A row unfolds its
 * record (JourneyKitFact) under it.
 */
export function JourneyKitTrail({ rows, entryId, origin }: { rows: readonly TrailRow[]; entryId: string; origin: JourneyOrigin }) {
  const t = useTranslations("journey");
  type Key = Parameters<typeof t>[0];
  const sentence = useJourneySentence();
  const { date } = useDateFormat();
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));
  const onKey = (id: string) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    e.stopPropagation();
    toggle(id);
  };

  return (
    <div className="jk-trail" data-role="journey-kit-trail">
      {rows.map((r) => {
        if (r.kind === "phase") {
          return (
            <div key={r.key} className="k-mini k-measure k-gap">
              <div className="k-row__mark"><Mark kind={r.reasonKey ? "unknown" : "caution"} /></div>
              <div className="k-row__name">
                {t("kit.phaseAbsent", { phase: t(PHASE_KEY[r.phase]), reason: r.reasonKey ? t(r.reasonKey as Key) : t("absence.neverRecorded") })}
              </div>
            </div>
          );
        }
        if (r.kind === "silence" || r.kind === "jump") {
          return (
            <div key={r.key} className={`k-mini k-measure k-gap${r.kind === "jump" ? " jk-jump" : ""}`}>
              <div className="k-row__mark">{r.kind === "jump" ? <Mark kind="caution" /> : null}</div>
              <div className="k-row__name">
                {r.kind === "jump" ? t("kit.clockJump", { years: r.years }) : r.untilToday ? t("kit.silenceToday", { days: r.days }) : t("silence", { days: r.days })}
              </div>
            </div>
          );
        }
        const e = r.event;
        const unfolded = open === e.id;
        return (
          <div key={r.key}>
            <div
              className={`k-mini k-measure jk-trail__row${unfolded ? " is-selected" : ""}`}
              role="button"
              tabIndex={0}
              aria-expanded={unfolded}
              data-tip={t("kit.openRow")}
              onClick={() => toggle(e.id)}
              onKeyDown={onKey(e.id)}
            >
              <div className="k-row__mark"><EventMark event={e} origin={origin} /></div>
              <div className={`k-row__name ${textClass(e, origin)}`}>
                {e.confidence === "label-only" ? "≈ " : null}
                {sentence(e)}
              </div>
              <div className="k-row__time">{date(e.occurredAt)}</div>
            </div>
            {unfolded ? <JourneyKitFact key={e.id} event={e} entryId={entryId} origin={origin} /> : null}
          </div>
        );
      })}
    </div>
  );
}
