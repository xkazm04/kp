"use client";

import { GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import { GithubAnalysisPanel } from "@/app/_components/GithubAnalysisPanel";
import { ArchetypeBanner } from "./ArchetypeBanner";
import type { Analysis, GithubAnalysis } from "@/app/_lib/schemas";
import { CompareIcon, ExtractionIcon, InterviewIcon, JobFitIcon, SalaryIcon } from "../icons";
import { CompareTab } from "./compare/CompareTab";
import { ExtractionTab } from "./extraction/ExtractionTab";
import { InterviewTab } from "./interview/InterviewTab";
import { JobFitTab } from "./job-fit/JobFitTab";
import { SalaryTab } from "./salary/SalaryTab";

export type ResultPanelGithub = {
  status: "loading" | "done" | "error";
  analysis: GithubAnalysis | null;
  error: string | null;
};

type ResultPanelProps = {
  analysis: Analysis;
  github?: ResultPanelGithub;
};

type ResultTab = "extraction" | "compare" | "jobFit" | "salary" | "interview" | "github";

export function ResultPanel({ analysis, github }: ResultPanelProps) {
  const hasComparison = Boolean(analysis.comparison);
  const hasGithub = Boolean(github);

  const tabs: Array<{ id: ResultTab; label: string; icon: React.ReactNode }> = [
    { id: "extraction", label: "Extraction", icon: <ExtractionIcon className="h-4 w-4" /> },
    ...(hasComparison
      ? [{ id: "compare" as const, label: "Compare", icon: <CompareIcon className="h-4 w-4" /> }]
      : []),
    { id: "jobFit", label: "Job fit", icon: <JobFitIcon className="h-4 w-4" /> },
    { id: "salary", label: "Salary", icon: <SalaryIcon className="h-4 w-4" /> },
    { id: "interview", label: "Interview", icon: <InterviewIcon className="h-4 w-4" /> },
    ...(hasGithub
      ? [
          {
            id: "github" as const,
            label: "GitHub",
            icon: <GitBranch className="h-4 w-4" />,
          },
        ]
      : []),
  ];

  const [activeTab, setActiveTab] = useState<ResultTab>(hasComparison ? "compare" : "extraction");

  const activeIndex = tabs.findIndex((t) => t.id === activeTab);

  // This component instance survives across analyses (rendered without a key),
  // so activeTab can point at a tab that no longer exists — e.g. running a
  // multi-variant compare (defaults to "compare") then a single-CV analysis
  // drops the Compare tab. Without this, activeIndex is -1 and the panel
  // renders blank. Fall back to the first available tab when that happens.
  useEffect(() => {
    if (activeIndex === -1 && tabs.length > 0) {
      setActiveTab(tabs[0].id);
    }
  }, [activeIndex, tabs]);

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let next = activeIndex;
    if (event.key === "ArrowRight") next = (activeIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (activeIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setActiveTab(tabs[next].id);
    document.getElementById(`tab-${tabs[next].id}`)?.focus();
  };

  // Tailwind needs explicit, statically-known class names for dynamic grid
  // counts to survive purge — so we pick from a small lookup table.
  const lgGridClass = (() => {
    switch (tabs.length) {
      case 4:
        return "lg:grid-cols-4";
      case 5:
        return "lg:grid-cols-5";
      case 6:
        return "lg:grid-cols-6";
      case 7:
        return "lg:grid-cols-7";
      default:
        return "lg:grid-cols-5";
    }
  })();

  return (
    <section className="animate-fade-in space-y-5">
      {analysis.v2Profile ? <ArchetypeBanner v2Profile={analysis.v2Profile} /> : null}
      <div className="rounded-lg border border-stone-200 bg-white p-2 shadow-panel">
        <div role="tablist" aria-label="Result sections" onKeyDown={onTabKeyDown} className={`grid gap-1 sm:grid-cols-2 ${lgGridClass}`}>
          {tabs.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                className={`focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-base font-semibold ${
                  selected ? "bg-ink text-white" : "text-steel hover:bg-paper hover:text-ink"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} tabIndex={0} className="focus-ring rounded-md">
        {activeTab === "extraction" ? <ExtractionTab analysis={analysis} /> : null}
        {activeTab === "compare" ? <CompareTab analysis={analysis} /> : null}
        {activeTab === "jobFit" ? <JobFitTab analysis={analysis} /> : null}
        {activeTab === "salary" ? <SalaryTab analysis={analysis} /> : null}
        {activeTab === "interview" ? <InterviewTab analysis={analysis} /> : null}
        {activeTab === "github" && github ? (
          <GithubAnalysisPanel
            status={github.status}
            analysis={github.analysis}
            error={github.error}
          />
        ) : null}
      </div>
    </section>
  );
}
