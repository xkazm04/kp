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

  /** The status in words: the mark's tip, and the pane's Status value beside the mark. */
  const statusWord = useCallback(
    (l: LaneRow): string => {
      switch (l.status) {
        case "needs": return t("kit.markNeeds");
        case "hired": return t("cohort.outcome.hired");
        case "rejected": return t("cohort.outcome.rejected");
        case "withdrawn": return t("cohort.outcome.withdrawn");
        case "rematched": return t("cohort.outcome.rematched");
        case "stalled": return t("cohort.outcome.stalled");
        case "open": return t("kit.markOpen", { stage: l.column.stage });
        case "empty": return emptyWords(l).text;
      }
    },
    [t, emptyWords]
  );

  const statusMark = useCallback(
    (l: LaneRow) => {
      const kind = ({ needs: "needs", hired: "ok", rejected: "fail", withdrawn: "bounce", rematched: "recovered", stalled: "wait", open: "wait" } as const)[l.status as Exclude<LaneRow["status"], "empty">];
      if (l.status === "empty") return <Mark kind={emptyWords(l).reasoned ? "unknown" : "caution"} tip={statusWord(l)} />;
      return <Mark kind={kind} tip={statusWord(l)} />;
    },
    [emptyWords, statusWord]
  );

  return { cellTip, statusMark, statusWord, emptyWords, label };
}
