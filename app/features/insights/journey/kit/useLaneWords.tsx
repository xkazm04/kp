"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { Mark } from "@/app/_components/kit";
import type { ShapeKind } from "@/app/_components/kit";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import type { KitCell } from "./journeyKitSteps";
import type { LaneRow } from "./journeyKitModel";
import { normalizeAbsenceKey } from "../journeyLayout";
import { useStepLabel } from "./useStepLabel";

/** A reached shape's provenance in words: the same catalog sentences the Broadsheet's marks used. */
export const SHAPE_WORD: Partial<Record<ShapeKind, "mark.observed" | "mark.labelOnly" | "mark.testRun">> = {
  solid: "mark.observed",
  half: "mark.labelOnly",
  ring: "mark.testRun",
};

/**
 * The words the lanes carry: each tile's tip (its step, what proves it and how well, or why nothing
 * does) and each row's status mark. Hover AND focus, and the row's reading pane repeats every fact.
 */
export function useLaneWords() {
  const t = useTranslations("journey");
  type Key = Parameters<typeof t>[0];
  const { date } = useDateFormat();
  const label = useStepLabel();

  /** A journey with no event at all: the reason the record gives, or "never recorded". */
  const emptyWords = useCallback(
    (l: LaneRow): { reasoned: boolean; text: string } => {
      const phase = l.column.phases.screening;
      const key = phase && !phase.present ? normalizeAbsenceKey(phase.absenceReasonKey) : null;
      if (key && t.has(key as Key)) return { reasoned: true, text: `${t("absence.nothingHappened")} · ${t(key as Key)}` };
      return { reasoned: false, text: t("absence.neverRecorded") };
    },
    [t]
  );

  const cellTip = useCallback(
    (c: KitCell): string => {
      const name = label(c.step);
      switch (c.reason) {
        case "reached": {
          const word = SHAPE_WORD[c.shape];
          const base = `${name}: ${t("kit.cellReached", { count: c.events.length, date: date(c.events[0].occurredAt) })}`;
          return `${base}${word ? `. ${t(word)}` : ""}${c.machine ? `, ${t("kit.cellMachine")}` : ""}`;
        }
        case "hidden": return `${name}: ${t("kit.cellHidden")}`;
        case "absent": return `${name}: ${c.absenceKey ? t(c.absenceKey as Key) : t("absence.neverRecorded")}`;
        case "skipped": return `${name}: ${t("rail.skipped")}`;
        case "notReached": return `${name}: ${t("rail.neverReached")}`;
      }
    },
    [t, date, label]
  );

  const statusMark = useCallback(
    (l: LaneRow) => {
      switch (l.status) {
        case "needs": return <Mark kind="needs" tip={t("kit.markNeeds")} />;
        case "hired": return <Mark kind="ok" tip={t("cohort.outcome.hired")} />;
        case "rejected": return <Mark kind="fail" tip={t("cohort.outcome.rejected")} />;
        case "withdrawn": return <Mark kind="bounce" tip={t("cohort.outcome.withdrawn")} />;
        case "rematched": return <Mark kind="recovered" tip={t("cohort.outcome.rematched")} />;
        case "stalled": return <Mark kind="wait" tip={t("cohort.outcome.stalled")} />;
        case "open": return <Mark kind="wait" tip={t("kit.markOpen", { stage: l.column.stage })} />;
        case "empty": {
          const e = emptyWords(l);
          return <Mark kind={e.reasoned ? "unknown" : "caution"} tip={e.text} />;
        }
      }
    },
    [t, emptyWords]
  );

  return { cellTip, statusMark, emptyWords, label };
}
