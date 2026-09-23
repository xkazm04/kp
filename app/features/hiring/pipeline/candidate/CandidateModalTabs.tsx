"use client";

// The candidate modal's tab strip — a real WAI-ARIA tablist: roving tabindex, the
// arrow keys / Home / End move AND select (tabs this cheap to switch need no
// separate activation step), and each tab controls its always-mounted panel.

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { CANDIDATE_TABS, type CandidateTab } from "./candidateView";

/** The ids a tab and its panel share, so the body can label its panels. */
export function tabIds(id: CandidateTab): { tab: string; panel: string } {
  return { tab: `candidate-tab-${id}`, panel: `candidate-panel-${id}` };
}

export function CandidateModalTabs({
  tab,
  onTab,
  activityNeedsYou = 0,
}: {
  tab: CandidateTab;
  onTab: (tab: CandidateTab) => void;
  /** Letters on the Activity tab that bounced or dead-lettered and offer a resend
   *  door (comms-resend-outcome.ts lettersNeedingYou) — raised on the label so an
   *  undelivered offer is met on open, not found by going looking. */
  activityNeedsYou?: number;
}) {
  const t = useTranslations("pipeline.candidate");
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (i: number) => {
    const n = CANDIDATE_TABS.length;
    const id = CANDIDATE_TABS[(i + n) % n];
    onTab(id);
    refs.current[(i + n) % n]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={t("tabsAria")}
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-stone-200 px-4 sm:px-6"
      onKeyDown={(e) => {
        const at = CANDIDATE_TABS.indexOf(tab);
        if (e.key === "ArrowRight") select(at + 1);
        else if (e.key === "ArrowLeft") select(at - 1);
        else if (e.key === "Home") select(0);
        else if (e.key === "End") select(CANDIDATE_TABS.length - 1);
        else return;
        e.preventDefault();
      }}
    >
      {CANDIDATE_TABS.map((id, i) => {
        const active = id === tab;
        return (
          <button
            key={id}
            ref={(node) => {
              refs.current[i] = node;
            }}
            type="button"
            role="tab"
            id={tabIds(id).tab}
            aria-controls={tabIds(id).panel}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onTab(id)}
            className={`focus-ring -mb-px cursor-pointer whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              active ? "border-coral text-ink" : "border-transparent text-steel hover:text-ink"
            }`}
          >
            {t(`tabs.${id}`)}
            {id === "activity" && activityNeedsYou > 0 ? (
              <>
                <span aria-hidden className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-micro font-semibold text-red-700">
                  {t("needsYou", { count: activityNeedsYou })}
                </span>
                <span className="sr-only">{t("needsYouAria", { count: activityNeedsYou })}</span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
