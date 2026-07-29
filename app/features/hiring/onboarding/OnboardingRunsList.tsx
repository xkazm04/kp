"use client";

// The "runs in progress" section of OnboardingTab: one row per active run,
// with its checklist progress + questionnaire status. Split out of
// OnboardingTab.tsx to keep the tab file under the 200-line cap.

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { RunSummary } from "./onboardingTabTypes";

export function OnboardingRunsList({ runs, onSelect }: { runs: RunSummary[]; onSelect: (id: string) => void }) {
  const t = useTranslations("onboarding");
  return (
    <section>
      <p className="text-meta uppercase tracking-wide text-steel">{t("runsTitle")}</p>
      {runs.length === 0 ? (
        <p className="mt-2 rounded-md border border-dashed border-stone-300 p-3 text-sm text-steel">{t("runsEmpty")}</p>
      ) : (
        <ul className="mt-2 space-y-2" role="list">
          {runs.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r.id)}
                className="focus-ring flex w-full items-center justify-between gap-3 rounded-md border border-stone-200 bg-white p-3 text-left hover:border-coral/40"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold text-ink">
                    {r.candidateLabel ?? t("aCandidate")}
                    {r.progress.complete ? (
                      <span className="rounded-full bg-moss/15 px-2 py-0.5 text-meta font-semibold uppercase text-moss">
                        {t("complete")}
                      </span>
                    ) : null}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="h-1.5 w-32 overflow-hidden rounded-full bg-stone-100">
                      <span className="block h-full rounded-full bg-coral" style={{ width: `${r.progress.pct}%` }} />
                    </span>
                    <span className="text-meta text-steel">{t("progress", { done: r.progress.done, total: r.progress.total })}</span>
                    {/* Pre-boarding questionnaire status (CW-4): a hire whose candidate
                        hasn't filled it in is visible, not a silently-empty record. */}
                    <span
                      className={`rounded-full px-2 py-0.5 text-meta font-semibold uppercase ${
                        r.intakeSubmitted ? "bg-moss/15 text-moss" : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {r.intakeSubmitted ? t("questionnaireDone") : t("questionnairePending")}
                    </span>
                  </div>
                </div>
                <ChevronRight size={16} className="shrink-0 text-steel" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
