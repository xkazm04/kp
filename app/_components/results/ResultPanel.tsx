"use client";

import { GitBranch } from "lucide-react";
import { useState } from "react";
import { GithubAnalysisPanel } from "@/app/_components/GithubAnalysisPanel";
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
      <div className="rounded-lg border border-stone-200 bg-white p-2 shadow-panel">
        <div className={`grid gap-1 sm:grid-cols-2 ${lgGridClass}`}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold ${
                activeTab === tab.id ? "bg-ink text-white" : "text-steel hover:bg-paper hover:text-ink"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

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
    </section>
  );
}
