"use client";

// The "blank dossier" ledger list of Variant B's empty state (Checklist /
// Questionnaire / Signatures, each showing what it will hold and its starting
// count). Split out of OnboardingEmptyRecord.tsx to keep that file under the
// 200-line cap.

import { FileSignature, ListChecks, MessageSquareText } from "lucide-react";
import { useTranslations } from "next-intl";
import { CHIP_QUIET, PANEL_SUNKEN } from "@/app/_components/ui/recipes";

// One ledger of the record: what it holds, and how many entries it opens with.
function LedgerRow({
  icon: Icon,
  name,
  count,
  holds,
}: {
  icon: typeof ListChecks;
  name: string;
  count: string;
  holds: string;
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      <Icon size={16} className="mt-0.5 shrink-0 text-steel" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
          {name}
          <span className={CHIP_QUIET}>{count}</span>
        </p>
        <p className="text-sm text-steel">{holds}</p>
      </div>
    </li>
  );
}

export function OnboardingRecordLedgers({ taskCount, questionCount }: { taskCount: number; questionCount: number }) {
  const t = useTranslations("onboarding");
  return (
    <ul className={`mt-4 divide-y divide-stone-200 ${PANEL_SUNKEN} px-4`} role="list">
      <LedgerRow
        icon={ListChecks}
        name={t("checklist")}
        count={t("progress", { done: 0, total: taskCount })}
        holds="Every task from the template, each stamped with who ticked it and when."
      />
      <LedgerRow
        icon={MessageSquareText}
        name={t("questionnaire")}
        count={`0 / ${questionCount}`}
        holds={t("questionnaireNote")}
      />
      <LedgerRow
        icon={FileSignature}
        name={t("signatures")}
        count="0 requested"
        holds={t("signSeamNote")}
      />
    </ul>
  );
}
