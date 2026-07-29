"use client";

// The blank-record panel of Variant B's empty state: the named-or-slotted hire
// header, the 0% progress row, the ledger list, and the template picker /
// start action. Split out of OnboardingEmptyRecord.tsx to keep that file
// under the 200-line cap.

import { useTranslations } from "next-intl";
import { UserPlus } from "lucide-react";
import { Select } from "@/app/_components/Select";
import { BTN_PRIMARY, CARD_PAD, META_LABEL, PANEL, STAT, STAT_LABEL, STAT_VALUE } from "@/app/_components/ui/recipes";
import { OnboardingRecordLedgers } from "./OnboardingRecordLedgers";
import type { PlanTemplate, WaitingHire } from "./OnboardingEmptyFirstDay";

export function OnboardingRecordPanel({
  first,
  starved,
  taskCount,
  questionCount,
  templates,
  templateId,
  onTemplateChange,
  active,
  onStart,
}: {
  first: WaitingHire | undefined;
  starved: boolean;
  taskCount: number;
  questionCount: number;
  templates: PlanTemplate[];
  templateId: string;
  onTemplateChange: (id: string) => void;
  active: PlanTemplate | undefined;
  onStart: (entryId: string) => void;
}) {
  const t = useTranslations("onboarding");
  return (
    <section className={`${PANEL} ${CARD_PAD}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={META_LABEL}>Hire</p>
          {starved ? (
            <div className="mt-1 h-6 w-48 rounded-md border border-dashed border-stone-300 bg-stone-50" aria-hidden />
          ) : (
            <p className="mt-0.5 font-serif text-h2 text-ink">{first!.candidateLabel ?? t("aCandidate")}</p>
          )}
          <p className="mt-1 text-sm text-steel">
            {starved ? "Filled in from the pipeline entry when the run opens." : first!.jobTitle ?? t("aCandidate")}
          </p>
        </div>
        <div className="flex gap-2">
          <div className={`${STAT} min-w-[5.5rem] px-3 py-2`}>
            <span className={STAT_LABEL}>Done</span>
            <span className={`${STAT_VALUE} text-ink`}>0</span>
          </div>
          <div className={`${STAT} min-w-[5.5rem] px-3 py-2`}>
            <span className={STAT_LABEL}>Signed</span>
            <span className={`${STAT_VALUE} text-ink`}>0</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="h-1.5 w-40 overflow-hidden rounded-full bg-stone-100" aria-hidden>
          <span className="block h-full w-0 rounded-full bg-coral" />
        </span>
        <span className="text-meta text-steel">{t("progress", { done: 0, total: taskCount })}</span>
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-meta font-semibold uppercase text-amber-700">
          {t("questionnairePending")}
        </span>
      </div>

      <OnboardingRecordLedgers taskCount={taskCount} questionCount={questionCount} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        {templates.length > 1 ? (
          <label className="flex items-center gap-2 text-sm text-steel">
            {t("withTemplate")}
            <Select
              ariaLabel={t("withTemplate")}
              value={templateId}
              onChange={onTemplateChange}
              size="sm"
              options={templates.map((tpl) => ({ value: tpl.id, label: tpl.name }))}
            />
          </label>
        ) : (
          <span className="text-sm text-steel">
            Stamped from <span className="font-semibold text-ink">{active?.name ?? "the standard template"}</span> — the only
            template so far.
          </span>
        )}
        {starved ? null : (
          <button type="button" onClick={() => onStart(first!.entryId)} className={`${BTN_PRIMARY} h-10 px-4 text-base`}>
            <UserPlus size={15} aria-hidden /> {t("startCta")}
          </button>
        )}
      </div>
    </section>
  );
}
