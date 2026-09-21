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

export function CandidateModalTabs({ tab, onTab }: { tab: CandidateTab; onTab: (tab: CandidateTab) => void }) {
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
          </button>
        );
      })}
    </div>
  );
}
