"use client";

// The "ready to onboard" section of OnboardingTab: hired candidates without a
// run yet, plus the template picker used when starting one. Split out of
// OnboardingTab.tsx to keep the tab file under the 200-line cap.

import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import type { HiredCandidate, Template } from "./onboardingTabTypes";

export function OnboardingReadyList({
  toOnboard,
  templates,
  templateId,
  onTemplateChange,
  onStart,
}: {
  toOnboard: HiredCandidate[];
  templates: Template[];
  templateId: string;
  onTemplateChange: (id: string) => void;
  onStart: (entryId: string) => void;
}) {
  const t = useTranslations("onboarding");
  return (
    <section>
      <p className="text-meta uppercase tracking-wide text-steel">{t("readyTitle")}</p>
      {toOnboard.length > 0 && templates.length > 0 ? (
        <label className="mt-2 flex flex-wrap items-center gap-2 text-sm text-steel">
          {t("withTemplate")}
          <Select
            ariaLabel={t("withTemplate")}
            value={templateId}
            onChange={onTemplateChange}
            size="sm"
            options={templates.map((tpl) => ({ value: tpl.id, label: tpl.name }))}
          />
        </label>
      ) : null}
      {toOnboard.length === 0 ? (
        <p className="mt-2 rounded-md border border-dashed border-stone-300 p-3 text-sm text-steel">{t("readyEmpty")}</p>
      ) : (
        <ul className="mt-2 space-y-2" role="list">
          {toOnboard.map((h) => (
            <li key={h.entryId} className="flex items-center justify-between gap-2 rounded-md border border-stone-200 bg-white p-3">
              <div>
                <p className="font-semibold text-ink">{h.candidateLabel ?? t("aCandidate")}</p>
                {h.jobTitle ? <p className="text-meta text-steel">{h.jobTitle}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => onStart(h.entryId)}
                className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-steel"
              >
                <UserPlus size={14} /> {t("startCta")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
