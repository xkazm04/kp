"use client";

// The interview-prep modal's header block: provenance badge + done count,
// fallback/stale notices, the scenario line, and the ambient coverage meter.
// Split out of ScheduleInterviewPrepModal.tsx to keep the modal file under the
// 200-line cap.

import { AlertTriangle, History } from "lucide-react";
import { Meter } from "@/app/_components/Meter";
import { PrepSourceBadge } from "@/app/_components/Badge";
import type { useTranslations } from "next-intl";
import type { Prep } from "./scheduleInterviewPrepTypes";

export function PrepHeader({
  prep,
  fallback,
  stale,
  jdEditedLabel,
  generate,
  generating,
  totalItems,
  doneItems,
  t,
}: {
  prep: Prep;
  fallback: boolean;
  stale: boolean;
  jdEditedLabel: string;
  generate: () => void;
  generating: boolean;
  totalItems: number;
  doneItems: number;
  t: ReturnType<typeof useTranslations<"scheduleTab.prep">>;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        {/* Provenance: AI-tailored vs deterministic template fallback. */}
        <PrepSourceBadge source={prep.source} />
        <span className="nums shrink-0 rounded-md bg-paper px-2 py-1 text-sm font-semibold text-coral">{t("doneCount", { done: doneItems, total: totalItems })}</span>
      </div>
      {fallback ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-800">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            {t("fallbackNote")}{" "}
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="font-semibold underline underline-offset-2 hover:text-amber-900 disabled:opacity-50"
            >
              {generating ? t("regenerating") : t("regenerateWithAi")}
            </button>
          </span>
        </div>
      ) : null}
      {stale ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-800">
          <History size={15} className="mt-0.5 shrink-0" />
          <span>
            {t("jdEditedSince", { date: jdEditedLabel })}{" "}
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="font-semibold underline underline-offset-2 hover:text-amber-900 disabled:opacity-50"
            >
              {generating ? t("regenerating") : t("regenerate")}
            </button>
          </span>
        </div>
      ) : null}
      <p className="text-base text-ink">{prep.scenario}</p>
      {/* Ambient coverage bar: fills moss (score-strong) as topics/signals check off,
          so the interviewer can read progress without breaking eye contact. */}
      <Meter
        value={totalItems ? (doneItems / totalItems) * 100 : 0}
        tone="strong"
        aria-label={t("coverageAria", { done: doneItems, total: totalItems })}
      />
    </div>
  );
}
